// Owner: Attendance group.  workSchedulesRouter -> /work-schedules, holidaysRouter -> /holidays
// Reading needs any attendance permission; changing needs `attendance.manage`. Nothing here is ever visible to clients.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { isDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, parse, qs } from '../lib/http';
import { dateOnly, isValidTimeZone, keyOf, parseHm } from '../lib/zoned';
import { recompute, scheduleDto, toSchedule } from '../services/attendance';
import { audit } from '../services/audit';

const anyAttendancePerm = (req: Request, _res: Response, next: NextFunction) => {
  const s = req.scope;
  if (!req.user || !s) return next(Errors.unauthenticated());
  if (['attendance.track', 'attendance.view_all', 'attendance.manage'].some((p) => s.permissions.has(p as never))) return next();
  next(Errors.forbidden());
};
const managePerm = requirePerm('attendance.manage');

// ───────────────────────── schedules ─────────────────────────

export const workSchedulesRouter = Router();
workSchedulesRouter.use(authenticate, anyAttendancePerm);

const hmField = z.string().refine((v) => parseHm(v) !== null, { message: 'invalid' });
const scheduleFields = {
  name: z.string().trim().min(1).max(80),
  timezone: z.string().trim().refine(isValidTimeZone, { message: 'invalid_choice' }),
  workDays: z.array(z.number().int().min(0).max(6)).max(7),
  startTime: hmField,
  endTime: hmField,
  breakMinutes: z.number().int().min(0).max(600),
  graceMinutes: z.number().int().min(0).max(240),
  minimumMinutes: z.number().int().min(0).max(1440),
};
const createSchema = z.object(scheduleFields).strict();
const updateSchema = z.object(scheduleFields).partial().strict();

function checkTimes(v: { startTime?: string; endTime?: string; breakMinutes?: number }, existing?: { startTime: string; endTime: string; breakMinutes: number }) {
  const start = parseHm(v.startTime ?? existing?.startTime ?? '09:00')!;
  const end = parseHm(v.endTime ?? existing?.endTime ?? '17:00')!;
  const brk = v.breakMinutes ?? existing?.breakMinutes ?? 0;
  if (end <= start) throw Errors.validation({ endTime: 'end_before_start' }); // overnight shifts are not supported
  if (brk >= end - start) throw Errors.validation({ breakMinutes: 'too_big' });
}

const withCounts = async () => {
  const [rows, counts] = await Promise.all([
    prisma.workSchedule.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    prisma.user.groupBy({ by: ['workScheduleId'], where: { status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] } }, _count: { _all: true } }),
  ]);
  const byId = new Map(counts.map((c) => [c.workScheduleId, c._count._all]));
  const unassigned = byId.get(null) ?? 0;
  return rows.map((r) => ({ ...scheduleDto(toSchedule(r)), isDefault: r.isDefault, memberCount: (byId.get(r.id) ?? 0) + (r.isDefault ? unassigned : 0) }));
};

workSchedulesRouter.get('/', asyncHandler(async (_req, res) => res.json({ items: await withCounts() })));

workSchedulesRouter.post(
  '/',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    checkTimes(body);
    const hasAny = (await prisma.workSchedule.count()) > 0;
    const row = await prisma.workSchedule.create({ data: { ...body, workDays: [...new Set(body.workDays)].sort().join(','), isDefault: !hasAny } });
    await audit(ctx, 'WORK_SCHEDULE_CREATED', 'work_schedule', row.id, { name: row.name });
    res.status(201).json({ item: (await withCounts()).find((s) => s.id === row.id) });
  }),
);

workSchedulesRouter.patch(
  '/:id',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.workSchedule.findUnique({ where: { id: idParam(req) } });
    if (!existing) throw Errors.notFound();
    const body = parse(updateSchema, req.body);
    checkTimes(body, existing);
    const { workDays, ...rest } = body;
    const data = { ...rest, ...(workDays ? { workDays: [...new Set(workDays)].sort().join(',') } : {}) };
    await prisma.workSchedule.update({ where: { id: existing.id }, data });
    const changes = Object.fromEntries(Object.keys(body).map((k) => [k, { from: (existing as Record<string, unknown>)[k], to: (data as Record<string, unknown>)[k] }]));
    await audit(ctx, 'WORK_SCHEDULE_UPDATED', 'work_schedule', existing.id, { name: body.name ?? existing.name, changes });
    res.json({ item: (await withCounts()).find((s) => s.id === existing.id) });
  }),
);

workSchedulesRouter.post(
  '/:id/default',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.workSchedule.findUnique({ where: { id: idParam(req) } });
    if (!existing) throw Errors.notFound();
    await prisma.$transaction([
      prisma.workSchedule.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.workSchedule.update({ where: { id: existing.id }, data: { isDefault: true } }),
    ]);
    await audit(ctx, 'WORK_SCHEDULE_UPDATED', 'work_schedule', existing.id, { name: existing.name, changes: { isDefault: { from: false, to: true } } });
    res.json({ items: await withCounts() });
  }),
);

/** The default schedule cannot be deleted; people on a deleted schedule fall back to the default one. */
workSchedulesRouter.delete(
  '/:id',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.workSchedule.findUnique({ where: { id: idParam(req) } });
    if (!existing) throw Errors.notFound();
    if (existing.isDefault) throw Errors.conflict('DEFAULT_SCHEDULE', 'Choose another default schedule first.');
    await prisma.$transaction([
      prisma.user.updateMany({ where: { workScheduleId: existing.id }, data: { workScheduleId: null } }),
      prisma.attendance.updateMany({ where: { scheduleId: existing.id }, data: { scheduleId: null } }),
      prisma.workSchedule.delete({ where: { id: existing.id } }),
    ]);
    await audit(ctx, 'WORK_SCHEDULE_DELETED', 'work_schedule', existing.id, { name: existing.name });
    res.json({ ok: true });
  }),
);

// ───────────────────────── holidays ─────────────────────────

export const holidaysRouter = Router();
holidaysRouter.use(authenticate, anyAttendancePerm);

const holidaySchema = z.object({ date: z.string().refine(isDateOnly, { message: 'invalid_date' }), name: z.string().trim().min(1).max(120) }).strict();

/** Re-judges stored days on a date whose holiday status changed (people who did not come in become HOLIDAY / ABSENT). */
async function rejudge(date: Date) {
  const rows = await prisma.attendance.findMany({ where: { date }, select: { id: true } });
  for (const r of rows) await recompute(prisma, r.id);
}

holidaysRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const year = qs(req.query, 'year');
    if (year !== undefined && !/^\d{4}$/.test(year)) throw Errors.validation({ year: 'invalid' });
    const where = year ? { date: { gte: dateOnly(`${year}-01-01`), lte: dateOnly(`${year}-12-31`) } } : {};
    const rows = await prisma.holiday.findMany({ where, orderBy: { date: 'asc' }, take: 500 });
    res.json({ items: rows.map((h) => ({ id: h.id, date: keyOf(h.date), name: h.name })) });
  }),
);

holidaysRouter.post(
  '/',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(holidaySchema, req.body);
    if (await prisma.holiday.findUnique({ where: { date: dateOnly(body.date) }, select: { id: true } })) throw Errors.validation({ date: 'duplicate' });
    const h = await prisma.holiday.create({ data: { date: dateOnly(body.date), name: body.name } });
    await rejudge(h.date);
    await audit(ctx, 'HOLIDAY_CREATED', 'holiday', h.id, { date: body.date, name: h.name });
    res.status(201).json({ item: { id: h.id, date: body.date, name: h.name } });
  }),
);

holidaysRouter.delete(
  '/:id',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const h = await prisma.holiday.findUnique({ where: { id: idParam(req) } });
    if (!h) throw Errors.notFound();
    await prisma.holiday.delete({ where: { id: h.id } });
    await rejudge(h.date);
    await audit(ctx, 'HOLIDAY_DELETED', 'holiday', h.id, { date: keyOf(h.date), name: h.name });
    res.json({ ok: true });
  }),
);
