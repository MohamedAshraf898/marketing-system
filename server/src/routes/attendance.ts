// Owner: Attendance group.  attendanceRouter -> /attendance
//
// Security model
//  - Self-service routes (check-in / check-out / breaks / "my" data) act on the SESSION user only; no route accepts a
//    user id or a timestamp for them. The server clock decides every time.
//  - Other people's attendance needs `attendance.view_all` (read) or `attendance.manage` (corrections). CLIENT users hold
//    neither (and never `attendance.track`), so every route answers 403 for them.
//  - A correction always needs a reason, is flagged isManual, is written to the audit log with before / after values and
//    notifies the employee. A non-admin manager may never correct their own record.
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ATTENDANCE_STATUSES, PRESENCE_STATES, type AttendanceStatus, type PresenceState } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { isDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { addDaysKey, dateOnly, eachDayKey, keyOf, zonedToUtc } from '../lib/zoned';
import {
  approvedLeaves, attendanceDto, attendanceInclude, dayBoard, holidayKeys, leaveOn, loadSchedules, memberSelect, recompute, rosterMembers, scheduleDto,
  scheduleOf, todayKeyFor, virtualDto, type AttendanceDto, type AttendanceRow, type Member, type ScheduleBook,
} from '../services/attendance';
import { audit } from '../services/audit';
import { notify } from '../services/notifications';
import { csvRow } from '../services/time';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const trackPerm = requirePerm('attendance.track');
const viewAllPerm = requirePerm('attendance.view_all');
const managePerm = requirePerm('attendance.manage');

const OPEN_WINDOW_MS = 20 * 3_600_000; // a check-in older than this is a forgotten one, not "still at work"
const MAX_BREAKS = 20;
const MAX_RANGE_DAYS = 92;
const MAX_REPORT_DAYS = 366;
const FUTURE_SLACK_MS = 5 * 60_000;

const canViewAll = (ctx: Ctx) => ctx.scope.permissions.has('attendance.view_all') || ctx.scope.permissions.has('attendance.manage');

// ───────────────────────── schemas ─────────────────────────

const notes = z.string().trim().max(1000).transform((v) => (v === '' ? null : v));
const isoDate = z.string().max(40).datetime({ offset: true }).transform((s) => new Date(s));
const dateKey = z.string().refine(isDateOnly, { message: 'invalid_date' });

const checkInSchema = z.object({ remote: z.boolean().optional(), notes: notes.nullish() }).strict();
const checkOutSchema = z.object({ notes: notes.nullish() }).strict();

const breakSpan = z.object({ startAt: isoDate, endAt: isoDate }).strict();
const correctionFields = {
  checkInAt: isoDate.nullable().optional(),
  checkOutAt: isoDate.nullable().optional(),
  remote: z.boolean().optional(),
  status: z.enum(ATTENDANCE_STATUSES).nullable().optional(), // a value locks the status, null unlocks it (computed again)
  notes: notes.nullable().optional(),
  breaks: z.array(breakSpan).max(MAX_BREAKS).optional(), // replaces every break of the day
  reason: z.string().trim().min(3).max(500),
};
const correctionSchema = z.object(correctionFields).strict();
const manualSchema = z.object({ ...correctionFields, userId: z.string().min(1).max(64), date: dateKey }).strict();
const memberSchema = z.object({ workScheduleId: z.string().min(1).max(64).nullable().optional(), trackAttendance: z.boolean().optional() }).strict();

// ───────────────────────── helpers ─────────────────────────

function rangeOf(query: Request['query'], fallback: { from: string; to: string }, maxDays = MAX_RANGE_DAYS) {
  const from = qs(query, 'from') ?? fallback.from;
  const to = qs(query, 'to') ?? fallback.to;
  if (!isDateOnly(from)) throw Errors.validation({ from: 'invalid_date' });
  if (!isDateOnly(to)) throw Errors.validation({ to: 'invalid_date' });
  if (to < from) throw Errors.validation({ to: 'end_before_start' });
  if (eachDayKey(from, to, maxDays + 1).length > maxDays) throw Errors.validation({ to: 'too_big' });
  return { from, to };
}

const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
const monthEnd = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return keyOf(new Date(Date.UTC(y, m, 0)));
};

/** The session user's schedule + local "today". */
async function mySchedule(userId: string, book?: ScheduleBook) {
  const b = book ?? (await loadSchedules());
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { workScheduleId: true, trackAttendance: true } });
  const s = scheduleOf(b, me?.workScheduleId);
  return { s, tracked: me?.trackAttendance ?? false };
}

/** The record the person is currently checked in on (it may belong to yesterday for a late shift). */
function openRecord(userId: string, now: Date) {
  return prisma.attendance.findFirst({
    where: { userId, checkInAt: { not: null, gte: new Date(now.getTime() - OPEN_WINDOW_MS) }, checkOutAt: null },
    orderBy: { checkInAt: 'desc' },
    include: attendanceInclude,
  });
}

async function dtoOf(row: AttendanceRow, book: ScheduleBook, now: Date) {
  const key = keyOf(row.date);
  const holidays = await holidayKeys(key, key);
  return attendanceDto(row, scheduleOf(book, row.scheduleId ?? row.user.workScheduleId), holidays.has(key), now);
}

async function loadRow(id: string) {
  const row = await prisma.attendance.findUnique({ where: { id }, include: attendanceInclude });
  if (!row) throw Errors.notFound();
  return row;
}

/** Own record, or anybody's with view_all / manage. Someone else's record without the permission is a 404. */
async function readableRow(ctx: Ctx, id: string) {
  const row = await loadRow(id);
  if (row.userId !== ctx.user.id && !canViewAll(ctx)) throw Errors.notFound();
  return row;
}

const emptyPresence = (): Record<PresenceState, number> => Object.fromEntries(PRESENCE_STATES.map((p) => [p, 0])) as Record<PresenceState, number>;
const emptyStatus = (): Record<AttendanceStatus, number> => Object.fromEntries(ATTENDANCE_STATUSES.map((p) => [p, 0])) as Record<AttendanceStatus, number>;

function totalsOf(list: Array<Pick<AttendanceDto, 'workedMinutes' | 'overtimeMinutes' | 'lateMinutes' | 'checkInAt' | 'status'>>) {
  const worked = list.filter((r) => r.checkInAt);
  const workedMinutes = worked.reduce((a, r) => a + r.workedMinutes, 0);
  return {
    workedMinutes,
    overtimeMinutes: list.reduce((a, r) => a + r.overtimeMinutes, 0),
    lateMinutes: list.reduce((a, r) => a + r.lateMinutes, 0),
    daysWorked: worked.length,
    avgWorkedMinutes: worked.length ? Math.round(workedMinutes / worked.length) : 0,
  };
}

// ───────────────────────── self service ─────────────────────────

attendanceRouter.get(
  '/today',
  trackPerm,
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    const now = new Date();
    const book = await loadSchedules();
    const { s, tracked } = await mySchedule(user.id, book);
    const key = todayKeyFor(s, now);
    const [row, open, holidays, leaves] = await Promise.all([
      prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date: dateOnly(key) } }, include: attendanceInclude }),
      openRecord(user.id, now),
      holidayKeys(key, key),
      approvedLeaves([user.id], key, key),
    ]);
    const leave = leaveOn(leaves, user.id, key);
    const me = { id: user.id, name: user.name, avatar: user.avatar, jobTitle: null };
    res.json({
      item: row ? attendanceDto(row, scheduleOf(book, row.scheduleId ?? s.id), holidays.has(key), now) : virtualDto(me, key, s, holidays.has(key), leave, now),
      // still checked in on an earlier day (late shift that crossed midnight)
      carryOver: open && open.id !== row?.id ? await dtoOf(open, book, now) : null,
      schedule: scheduleDto(s),
      today: key,
      holiday: holidays.get(key) ?? null,
      leave,
      tracked,
      serverNow: now.toISOString(),
    });
  }),
);

attendanceRouter.post(
  '/check-in',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(checkInSchema, req.body);
    const now = new Date();
    const book = await loadSchedules();
    const { s } = await mySchedule(ctx.user.id, book);
    const key = todayKeyFor(s, now);

    const open = await openRecord(ctx.user.id, now);
    if (open && keyOf(open.date) !== key) throw Errors.conflict('STILL_CHECKED_IN', 'Check out of your previous day first.');
    const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: ctx.user.id, date: dateOnly(key) } }, select: { id: true, checkInAt: true, notes: true } });
    if (existing?.checkInAt) throw Errors.conflict('ALREADY_CHECKED_IN', 'You already checked in today.');

    const id = await prisma.$transaction(async (tx) => {
      let rid: string;
      if (existing) {
        // an ON_LEAVE / HOLIDAY / ABSENT placeholder: the person came in after all. Only claim it if still empty (race-safe).
        const claimed = await tx.attendance.updateMany({
          where: { id: existing.id, checkInAt: null },
          data: { checkInAt: now, remote: body.remote ?? false, scheduleId: s.id, statusLocked: false, notes: body.notes ?? existing.notes },
        });
        if (claimed.count === 0) throw Errors.conflict('ALREADY_CHECKED_IN', 'You already checked in today.');
        rid = existing.id;
      } else {
        const created = await tx.attendance.create({
          data: { userId: ctx.user.id, date: dateOnly(key), scheduleId: s.id, checkInAt: now, remote: body.remote ?? false, status: 'PRESENT', notes: body.notes ?? null },
        });
        rid = created.id;
      }
      await recompute(tx, rid, now);
      return rid;
    });
    const dto = await dtoOf(await loadRow(id), book, now);
    await audit(ctx, 'ATTENDANCE_CHECK_IN', 'attendance', id, { date: key, remote: dto.remote, lateMinutes: dto.lateMinutes, status: dto.status });
    res.status(201).json({ item: dto });
  }),
);

attendanceRouter.post(
  '/check-out',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(checkOutSchema, req.body);
    const now = new Date();
    const open = await openRecord(ctx.user.id, now);
    if (!open) throw Errors.conflict('NOT_CHECKED_IN', 'You are not checked in.');
    await prisma.$transaction(async (tx) => {
      await tx.attendanceBreak.updateMany({ where: { attendanceId: open.id, endAt: null }, data: { endAt: now } });
      const done = await tx.attendance.updateMany({
        where: { id: open.id, checkOutAt: null },
        data: { checkOutAt: now, ...(body.notes !== undefined ? { notes: body.notes } : {}) },
      });
      if (done.count === 0) throw Errors.conflict('NOT_CHECKED_IN', 'You are not checked in.');
      await recompute(tx, open.id, now);
    });
    const dto = await dtoOf(await loadRow(open.id), await loadSchedules(), now);
    await audit(ctx, 'ATTENDANCE_CHECK_OUT', 'attendance', open.id, { date: dto.date, workedMinutes: dto.workedMinutes, overtimeMinutes: dto.overtimeMinutes, earlyLeaveMinutes: dto.earlyLeaveMinutes });
    res.json({ item: dto });
  }),
);

attendanceRouter.post(
  '/break/start',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    parse(z.object({}).strict(), req.body);
    const now = new Date();
    const open = await openRecord(ctx.user.id, now);
    if (!open) throw Errors.conflict('NOT_CHECKED_IN', 'You are not checked in.');
    if (open.breaks.some((b) => !b.endAt)) throw Errors.conflict('BREAK_ALREADY_STARTED', 'You are already on a break.');
    if (open.breaks.length >= MAX_BREAKS) throw Errors.conflict('TOO_MANY_BREAKS', 'Too many breaks today.');
    await prisma.$transaction(async (tx) => {
      await tx.attendanceBreak.create({ data: { attendanceId: open.id, startAt: now } });
      await recompute(tx, open.id, now);
    });
    await audit(ctx, 'ATTENDANCE_BREAK_STARTED', 'attendance', open.id, { date: keyOf(open.date) });
    res.status(201).json({ item: await dtoOf(await loadRow(open.id), await loadSchedules(), now) });
  }),
);

attendanceRouter.post(
  '/break/end',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    parse(z.object({}).strict(), req.body);
    const now = new Date();
    const open = await openRecord(ctx.user.id, now);
    const running = open?.breaks.find((b) => !b.endAt);
    if (!open || !running) throw Errors.conflict('NO_BREAK_RUNNING', 'You are not on a break.');
    await prisma.$transaction(async (tx) => {
      await tx.attendanceBreak.update({ where: { id: running.id }, data: { endAt: now } });
      await recompute(tx, open.id, now);
    });
    const minutes = Math.round((now.getTime() - running.startAt.getTime()) / 60_000);
    await audit(ctx, 'ATTENDANCE_BREAK_ENDED', 'attendance', open.id, { date: keyOf(open.date), minutes });
    res.json({ item: await dtoOf(await loadRow(open.id), await loadSchedules(), now) });
  }),
);

/** My history (paged) + totals. */
attendanceRouter.get(
  '/me',
  trackPerm,
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    const now = new Date();
    const book = await loadSchedules();
    const { s } = await mySchedule(user.id, book);
    const today = todayKeyFor(s, now);
    const { from, to } = rangeOf(req.query, { from: monthStart(today), to: today }, MAX_REPORT_DAYS);
    const p = paging(req.query, 31, 100);
    const where: Prisma.AttendanceWhereInput = { userId: user.id, date: { gte: dateOnly(from), lte: dateOnly(to) } };
    const [total, rows, sums, byStatus, holidays] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({ where, include: attendanceInclude, orderBy: { date: 'desc' }, skip: p.skip, take: p.take }),
      prisma.attendance.aggregate({ where, _sum: { workedMinutes: true, overtimeMinutes: true, lateMinutes: true, breakMinutes: true, expectedMinutes: true } }),
      prisma.attendance.groupBy({ by: ['status'], where, _count: { _all: true } }),
      holidayKeys(from, to),
    ]);
    const statusCounts = emptyStatus();
    for (const r of byStatus) statusCounts[r.status] = r._count._all;
    res.json({
      items: rows.map((r) => attendanceDto(r, scheduleOf(book, r.scheduleId ?? s.id), holidays.has(keyOf(r.date)), now)),
      meta: pageMeta(p, total),
      range: { from, to },
      totals: {
        workedMinutes: sums._sum.workedMinutes ?? 0, overtimeMinutes: sums._sum.overtimeMinutes ?? 0, lateMinutes: sums._sum.lateMinutes ?? 0,
        breakMinutes: sums._sum.breakMinutes ?? 0, expectedMinutes: sums._sum.expectedMinutes ?? 0,
      },
      statusCounts,
    });
  }),
);

// ───────────────────────── team board (attendance.view_all) ─────────────────────────

/** KPI numbers for the admin dashboard. A single day includes the live state of everybody on the roster. */
attendanceRouter.get(
  '/summary',
  viewAllPerm,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const book = await loadSchedules();
    const today = todayKeyFor(book.def, now);
    const { from, to } = rangeOf(req.query, { from: today, to: today });
    const userId = qs(req.query, 'userId');
    const members = await rosterMembers(userId ? { id: userId } : undefined);
    const presence = emptyPresence();
    const statusCounts = emptyStatus();
    let totals;

    if (from === to) {
      const rows = await dayBoard(from, book, now, userId);
      for (const r of rows) {
        presence[r.presence]++;
        statusCounts[r.status]++;
      }
      totals = totalsOf(rows);
    } else {
      const where: Prisma.AttendanceWhereInput = { date: { gte: dateOnly(from), lte: dateOnly(to) }, userId: { in: members.map((m) => m.id) } };
      const [byStatus, rows] = await Promise.all([
        prisma.attendance.groupBy({ by: ['status'], where, _count: { _all: true } }),
        prisma.attendance.findMany({ where, select: { workedMinutes: true, overtimeMinutes: true, lateMinutes: true, checkInAt: true, status: true } }),
      ]);
      for (const r of byStatus) statusCounts[r.status] = r._count._all;
      totals = totalsOf(rows.map((r) => ({ ...r, checkInAt: r.checkInAt?.toISOString() ?? null })));
      if (from <= today && today <= to) for (const r of await dayBoard(today, book, now, userId)) presence[r.presence]++;
    }
    res.json({ range: { from, to }, today, timezone: book.def.timezone, members: members.length, presence, statusCounts, totals });
  }),
);

/**
 * The table. A single day lists every roster member (virtual rows for people without a record); a longer range lists
 * the stored records (past working days are persisted as ABSENT by the nightly job). `format=csv` exports it.
 */
attendanceRouter.get(
  '/records',
  viewAllPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const now = new Date();
    const book = await loadSchedules();
    const today = todayKeyFor(book.def, now);
    const { from, to } = rangeOf(req.query, { from: today, to: today }, qs(req.query, 'format') === 'csv' ? MAX_REPORT_DAYS : MAX_RANGE_DAYS);
    const userId = qs(req.query, 'userId');
    const status = qsEnum(req.query, 'status', ATTENDANCE_STATUSES);
    const presence = qsEnum(req.query, 'presence', PRESENCE_STATES);
    const csv = qs(req.query, 'format') === 'csv';
    const p = csv ? { page: 1, pageSize: 10_000, skip: 0, take: 10_000 } : paging(req.query, 25, 200);

    let items: AttendanceDto[];
    let total: number;
    if (from === to) {
      const rows = (await dayBoard(from, book, now, userId)).filter((r) => (!status || r.status === status) && (!presence || r.presence === presence));
      total = rows.length;
      items = rows.slice(p.skip, p.skip + p.take);
    } else {
      const members = await rosterMembers();
      const where: Prisma.AttendanceWhereInput = {
        date: { gte: dateOnly(from), lte: dateOnly(to) },
        userId: userId ? userId : { in: members.map((m) => m.id) },
        ...(status ? { status } : {}),
      };
      const [count, rows, holidays] = await Promise.all([
        prisma.attendance.count({ where }),
        prisma.attendance.findMany({ where, include: attendanceInclude, orderBy: [{ date: 'desc' }, { user: { name: 'asc' } }], skip: p.skip, take: p.take }),
        holidayKeys(from, to),
      ]);
      total = count;
      items = rows.map((r) => attendanceDto(r, scheduleOf(book, r.scheduleId ?? r.user.workScheduleId), holidays.has(keyOf(r.date)), now));
    }

    if (csv) {
      const header = ['Date', 'Employee', 'Status', 'Check in', 'Check out', 'Worked (min)', 'Break (min)', 'Late (min)', 'Early leave (min)', 'Overtime (min)', 'Remote', 'Corrected', 'Notes'];
      const lines = [csvRow(header), ...items.map((r) => csvRow([r.date, r.user?.name ?? '', r.status, r.checkInAt ?? '', r.checkOutAt ?? '', r.workedMinutes, r.breakMinutes, r.lateMinutes, r.earlyLeaveMinutes, r.overtimeMinutes, r.remote ? 'yes' : 'no', r.isManual ? 'yes' : 'no', r.notes ?? '']))];
      await audit(ctx, 'REPORT_EXPORTED', 'attendance', null, { kind: 'attendance_records', from, to, rows: items.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${from}-to-${to}.csv"`);
      return res.send(`﻿${lines.join('\r\n')}\r\n`);
    }
    res.json({ items, meta: pageMeta(p, total), range: { from, to }, today });
  }),
);

/** Month calendar of one person: own calendar for everybody, anybody's with view_all. */
attendanceRouter.get(
  '/calendar',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const wanted = qs(req.query, 'userId') ?? ctx.user.id;
    if (wanted === ctx.user.id ? !ctx.scope.permissions.has('attendance.track') && !canViewAll(ctx) : !canViewAll(ctx)) throw Errors.forbidden();
    const month = qs(req.query, 'month');
    const now = new Date();
    const book = await loadSchedules();
    const member = await prisma.user.findFirst({ where: { id: wanted, role: { in: ['ADMIN', 'TEAM'] } }, select: memberSelect });
    if (!member) throw Errors.notFound();
    const s = scheduleOf(book, member.workScheduleId);
    const today = todayKeyFor(s, now);
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Errors.validation({ month: 'invalid_date' });
    const from = month ? `${month}-01` : monthStart(today);
    const to = monthEnd(from);
    const [rows, holidays, leaves] = await Promise.all([
      prisma.attendance.findMany({ where: { userId: member.id, date: { gte: dateOnly(from), lte: dateOnly(to) } }, include: attendanceInclude }),
      holidayKeys(from, to),
      approvedLeaves([member.id], from, to),
    ]);
    const byKey = new Map(rows.map((r) => [keyOf(r.date), r]));
    const days = eachDayKey(from, to).map((k) => {
      const r = byKey.get(k);
      const dto = r ? attendanceDto(r, scheduleOf(book, r.scheduleId ?? member.workScheduleId), holidays.has(k), now) : virtualDto(member, k, s, holidays.has(k), leaveOn(leaves, member.id, k), now);
      return { ...dto, future: k > today, holidayName: holidays.get(k) ?? null };
    });
    const past = days.filter((d) => !d.future);
    const statusCounts = emptyStatus();
    for (const d of past) statusCounts[d.status]++;
    res.json({ user: { id: member.id, name: member.name, avatar: member.avatar, jobTitle: member.jobTitle }, month: from.slice(0, 7), today, schedule: scheduleDto(s), days, statusCounts, totals: totalsOf(past) });
  }),
);

// ───────────────────────── roster settings ─────────────────────────

attendanceRouter.get(
  '/members',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    if (!canViewAll(ctx)) throw Errors.forbidden();
    const [users, book] = await Promise.all([
      prisma.user.findMany({
        where: { status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] } },
        select: { ...memberSelect, trackAttendance: true },
        orderBy: [{ trackAttendance: 'desc' }, { name: 'asc' }],
      }),
      loadSchedules(),
    ]);
    res.json({
      items: users.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, jobTitle: u.jobTitle, role: u.role, trackAttendance: u.trackAttendance, workScheduleId: u.workScheduleId, schedule: scheduleDto(scheduleOf(book, u.workScheduleId)) })),
    });
  }),
);

attendanceRouter.patch(
  '/members/:userId',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const userId = idParam(req, 'userId');
    const body = parse(memberSchema, req.body);
    const target = await prisma.user.findFirst({ where: { id: userId, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, name: true, workScheduleId: true, trackAttendance: true } });
    if (!target) throw Errors.notFound();
    if (body.workScheduleId) {
      const exists = await prisma.workSchedule.findUnique({ where: { id: body.workScheduleId }, select: { id: true } });
      if (!exists) throw Errors.validation({ workScheduleId: 'invalid_choice' });
    }
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (body.workScheduleId !== undefined) data.workScheduleId = body.workScheduleId;
    if (body.trackAttendance !== undefined) data.trackAttendance = body.trackAttendance;
    await prisma.user.update({ where: { id: userId }, data });
    await audit(ctx, 'ATTENDANCE_MEMBER_UPDATED', 'user', userId, {
      name: target.name,
      changes: {
        ...(body.workScheduleId !== undefined ? { workScheduleId: { from: target.workScheduleId, to: body.workScheduleId } } : {}),
        ...(body.trackAttendance !== undefined ? { trackAttendance: { from: target.trackAttendance, to: body.trackAttendance } } : {}),
      },
    });
    res.json({ ok: true });
  }),
);

// ───────────────────────── report ─────────────────────────

/** Per-person summary over a period (monthly attendance, hours, overtime ...). `format=csv` downloads it. */
attendanceRouter.get(
  '/report',
  viewAllPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const now = new Date();
    const book = await loadSchedules();
    const today = todayKeyFor(book.def, now);
    const { from, to } = rangeOf(req.query, { from: monthStart(today), to: monthEnd(today) }, MAX_REPORT_DAYS);
    const userId = qs(req.query, 'userId');
    const members = await rosterMembers(userId ? { id: userId } : undefined);
    const ids = members.map((m) => m.id);
    const where: Prisma.AttendanceWhereInput = { userId: { in: ids }, date: { gte: dateOnly(from), lte: dateOnly(to) } };
    const [byStatus, sums] = await Promise.all([
      prisma.attendance.groupBy({ by: ['userId', 'status'], where, _count: { _all: true } }),
      prisma.attendance.groupBy({ by: ['userId'], where, _sum: { workedMinutes: true, expectedMinutes: true, overtimeMinutes: true, lateMinutes: true, earlyLeaveMinutes: true, breakMinutes: true } }),
    ]);
    const counts = new Map<string, Record<AttendanceStatus, number>>();
    for (const r of byStatus) {
      const c = counts.get(r.userId) ?? emptyStatus();
      c[r.status] = r._count._all;
      counts.set(r.userId, c);
    }
    const sumBy = new Map(sums.map((s) => [s.userId, s._sum]));
    const items = members.map((m: Member) => {
      const c = counts.get(m.id) ?? emptyStatus();
      const s = sumBy.get(m.id);
      return {
        user: { id: m.id, name: m.name, avatar: m.avatar, jobTitle: m.jobTitle },
        statusCounts: c,
        daysWorked: c.PRESENT + c.LATE + c.HALF_DAY + c.WFH,
        workedMinutes: s?.workedMinutes ?? 0,
        expectedMinutes: s?.expectedMinutes ?? 0,
        overtimeMinutes: s?.overtimeMinutes ?? 0,
        lateMinutes: s?.lateMinutes ?? 0,
        earlyLeaveMinutes: s?.earlyLeaveMinutes ?? 0,
        breakMinutes: s?.breakMinutes ?? 0,
      };
    });
    if (qs(req.query, 'format') === 'csv') {
      const h = (m: number) => (m / 60).toFixed(2);
      const lines = [
        csvRow(['Employee', 'Days worked', 'Present', 'Late', 'Half day', 'WFH', 'Absent', 'On leave', 'Holiday', 'Worked (h)', 'Expected (h)', 'Overtime (h)', 'Late (min)', 'Early leave (min)']),
        ...items.map((i) => csvRow([i.user.name, i.daysWorked, i.statusCounts.PRESENT, i.statusCounts.LATE, i.statusCounts.HALF_DAY, i.statusCounts.WFH, i.statusCounts.ABSENT, i.statusCounts.ON_LEAVE, i.statusCounts.HOLIDAY, h(i.workedMinutes), h(i.expectedMinutes), h(i.overtimeMinutes), i.lateMinutes, i.earlyLeaveMinutes])),
      ];
      await audit(ctx, 'REPORT_EXPORTED', 'attendance', null, { kind: 'attendance_summary', from, to, rows: items.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-summary-${from}-to-${to}.csv"`);
      return res.send(`﻿${lines.join('\r\n')}\r\n`);
    }
    res.json({ range: { from, to }, items });
  }),
);

// ───────────────────────── corrections (attendance.manage) ─────────────────────────

interface Span { checkInAt: Date | null; checkOutAt: Date | null; breaks: Array<{ startAt: Date; endAt: Date }> | null }

/** Times of a corrected day must be coherent, inside that day (with a 12 h margin for late shifts) and not in the future. */
function validateSpan(key: string, tz: string, v: Span, now: Date) {
  const lo = zonedToUtc(key, 0, tz).getTime() - 12 * 3_600_000;
  const hi = zonedToUtc(addDaysKey(key, 1), 0, tz).getTime() + 12 * 3_600_000;
  const future = now.getTime() + FUTURE_SLACK_MS;
  const inDay = (d: Date) => d.getTime() >= lo && d.getTime() <= hi;
  if (v.checkInAt && (!inDay(v.checkInAt) || v.checkInAt.getTime() > future)) throw Errors.validation({ checkInAt: 'invalid_date' });
  if (v.checkOutAt) {
    if (!v.checkInAt) throw Errors.validation({ checkOutAt: 'required_check_in' });
    if (v.checkOutAt <= v.checkInAt) throw Errors.validation({ checkOutAt: 'end_before_start' });
    if (!inDay(v.checkOutAt) || v.checkOutAt.getTime() > future) throw Errors.validation({ checkOutAt: 'invalid_date' });
  }
  if (v.breaks && v.breaks.length > 0) {
    if (!v.checkInAt) throw Errors.validation({ breaks: 'required_check_in' });
    const endBound = (v.checkOutAt ?? now).getTime();
    const sorted = [...v.breaks].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    let prevEnd = v.checkInAt.getTime();
    for (const b of sorted) {
      if (b.endAt <= b.startAt) throw Errors.validation({ breaks: 'end_before_start' });
      if (b.startAt.getTime() < prevEnd || b.endAt.getTime() > endBound) throw Errors.validation({ breaks: 'invalid' });
      prevEnd = b.endAt.getTime();
    }
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const breakSummary = (list: Array<{ startAt: Date; endAt: Date | null }>) => list.map((b) => `${b.startAt.toISOString()}/${b.endAt?.toISOString() ?? ''}`).join(', ');

attendanceRouter.post(
  '/',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(manualSchema, req.body);
    if (body.userId === ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden();
    const target = await prisma.user.findFirst({ where: { id: body.userId, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, name: true, workScheduleId: true } });
    if (!target) throw Errors.validation({ userId: 'invalid_choice' });
    const now = new Date();
    const book = await loadSchedules();
    const s = scheduleOf(book, target.workScheduleId);
    if (body.date > todayKeyFor(s, now)) throw Errors.validation({ date: 'date_in_future' });
    const span: Span = { checkInAt: body.checkInAt ?? null, checkOutAt: body.checkOutAt ?? null, breaks: body.breaks ?? null };
    validateSpan(body.date, s.timezone, span, now);
    if (await prisma.attendance.findUnique({ where: { userId_date: { userId: target.id, date: dateOnly(body.date) } }, select: { id: true } })) {
      throw Errors.conflict('ATTENDANCE_EXISTS', 'A record already exists for this day - correct it instead.');
    }
    const id = await prisma.$transaction(async (tx) => {
      const row = await tx.attendance.create({
        data: {
          userId: target.id, date: dateOnly(body.date), scheduleId: s.id, checkInAt: span.checkInAt, checkOutAt: span.checkOutAt, remote: body.remote ?? false,
          status: body.status ?? 'PRESENT', statusLocked: !!body.status, notes: body.notes ?? null, isManual: true, correctedById: ctx.user.id, correctedAt: now,
        },
      });
      if (span.breaks?.length) await tx.attendanceBreak.createMany({ data: span.breaks.map((b) => ({ attendanceId: row.id, startAt: b.startAt, endAt: b.endAt })) });
      await recompute(tx, row.id, now);
      return row.id;
    });
    const dto = await dtoOf(await loadRow(id), book, now);
    await audit(ctx, 'ATTENDANCE_CREATED', 'attendance', id, {
      userId: target.id, userName: target.name, date: body.date, reason: body.reason,
      changes: { checkInAt: { from: null, to: iso(span.checkInAt) }, checkOutAt: { from: null, to: iso(span.checkOutAt) }, status: { from: null, to: dto.status } },
    });
    await notify([target.id], { type: 'ATTENDANCE_CORRECTED', entity: 'attendance', entityId: id, data: { date: body.date, by: ctx.user.name } }, ctx.user.id);
    res.status(201).json({ item: dto });
  }),
);

attendanceRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const row = await readableRow(ctx, idParam(req));
    const now = new Date();
    const book = await loadSchedules();
    const history = await prisma.auditLog.findMany({
      where: { entity: 'attendance', entityId: row.id, action: { in: ['ATTENDANCE_CREATED', 'ATTENDANCE_CORRECTED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { id: true, name: true } } },
    });
    res.json({
      item: await dtoOf(row, book, now),
      corrections: history.map((h) => ({ id: h.id, action: h.action, user: h.user, createdAt: h.createdAt, metadata: h.metadata ? (JSON.parse(h.metadata) as Record<string, unknown>) : null })),
    });
  }),
);

attendanceRouter.patch(
  '/:id',
  managePerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const row = await loadRow(idParam(req));
    if (row.userId === ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden(); // no self-corrections
    const body = parse(correctionSchema, req.body);
    const now = new Date();
    const book = await loadSchedules();
    const s = scheduleOf(book, row.scheduleId ?? row.user.workScheduleId);
    const key = keyOf(row.date);

    const next: Span = {
      checkInAt: body.checkInAt !== undefined ? body.checkInAt : row.checkInAt,
      checkOutAt: body.checkOutAt !== undefined ? body.checkOutAt : row.checkOutAt,
      breaks: body.breaks ?? null,
    };
    if (next.checkInAt === null && body.checkOutAt === undefined) next.checkOutAt = null; // removing the check-in removes the check-out
    const keptBreaks = next.checkInAt ? row.breaks.filter((b): b is typeof b & { endAt: Date } => !!b.endAt) : [];
    validateSpan(key, s.timezone, { ...next, breaks: next.breaks ?? keptBreaks }, now);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const track = (field: string, from: unknown, to: unknown) => { if (from !== to) changes[field] = { from, to }; };
    track('checkInAt', iso(row.checkInAt), iso(next.checkInAt));
    track('checkOutAt', iso(row.checkOutAt), iso(next.checkOutAt));
    if (body.remote !== undefined) track('remote', row.remote, body.remote);
    if (body.notes !== undefined) track('notes', row.notes, body.notes);
    if (body.breaks) track('breaks', breakSummary(row.breaks), breakSummary(body.breaks));
    const before = row.status;

    await prisma.$transaction(async (tx) => {
      const data: Prisma.AttendanceUncheckedUpdateInput = {
        checkInAt: next.checkInAt, checkOutAt: next.checkOutAt, isManual: true, correctedById: ctx.user.id, correctedAt: now,
      };
      if (body.remote !== undefined) data.remote = body.remote;
      if (body.notes !== undefined) data.notes = body.notes;
      if (body.status !== undefined) {
        data.statusLocked = body.status !== null;
        if (body.status) data.status = body.status;
      }
      await tx.attendance.update({ where: { id: row.id }, data });
      if (body.breaks) {
        await tx.attendanceBreak.deleteMany({ where: { attendanceId: row.id } });
        if (body.breaks.length) await tx.attendanceBreak.createMany({ data: body.breaks.map((b) => ({ attendanceId: row.id, startAt: b.startAt, endAt: b.endAt })) });
      } else if (!next.checkInAt) {
        await tx.attendanceBreak.deleteMany({ where: { attendanceId: row.id } });
      } else if (next.checkOutAt) {
        await tx.attendanceBreak.updateMany({ where: { attendanceId: row.id, endAt: null }, data: { endAt: next.checkOutAt } });
      }
      await recompute(tx, row.id, now);
    });
    const dto = await dtoOf(await loadRow(row.id), book, now);
    track('status', before, dto.status);
    await audit(ctx, 'ATTENDANCE_CORRECTED', 'attendance', row.id, { userId: row.userId, userName: row.user.name, date: key, reason: body.reason, changes });
    await notify([row.userId], { type: 'ATTENDANCE_CORRECTED', entity: 'attendance', entityId: row.id, data: { date: key, by: ctx.user.name } }, ctx.user.id);
    res.json({ item: dto });
  }),
);
