// Owner: Time & workload group.  timeRouter -> /time
//
// Time data is INTERNAL: every route requires a staff permission (CLIENT users hold none, so they always get 403).
// The acting user always comes from the session; ids in the body are only ever *validated against the caller's scope*.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { timeEntryWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs } from '../lib/http';
import { audit } from '../services/audit';
import { and } from '../services/serializers';
import {
  DAY_MS, FUTURE_SLACK_MS, MAX_AGE_MS, MAX_ENTRY_SEC, MIN_ENTRY_SEC, MAX_RUNNING_SEC,
  canViewAllTime, csvRow, dayKeyTz, dayStartMs, effectiveSec, entryDto, entryInclude, hoursOf, resolveTarget, stopRunning,
  syncActualHours, weekStartMs,
} from '../services/time';

export const timeRouter = Router();
timeRouter.use(authenticate);

const trackPerm = requirePerm('time.track');
/** Listing entries needs time.track (own entries) or time.view_all (team view). CLIENT users hold neither -> 403. */
const listPerm = (req: Request, res: Response, next: (e?: unknown) => void) => {
  const s = req.scope;
  if (!req.user || !s) return next(Errors.unauthenticated());
  if (s.permissions.has('time.track') || s.permissions.has('time.view_all')) return next();
  next(Errors.forbidden());
};

// ───────────────────────── schemas ─────────────────────────

const idField = z.string().min(1).max(64);
const notesField = z.string().trim().max(1000);
const isoDate = z.string().max(40).datetime({ offset: true }).transform((s) => new Date(s));

const startSchema = z.object({ taskId: idField.nullish(), projectId: idField.nullish(), clientId: idField.nullish(), notes: notesField.nullish() }).strict();

const createSchema = z
  .object({
    taskId: idField.nullish(), projectId: idField.nullish(), clientId: idField.nullish(),
    startedAt: isoDate,
    endedAt: isoDate.optional(),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    notes: notesField.nullish(),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.endedAt === undefined) === (v.durationMinutes === undefined)) c.addIssue({ code: 'custom', path: ['endedAt'], message: 'invalid' });
  });

const updateSchema = z
  .object({
    taskId: idField.nullable(), projectId: idField.nullable(), clientId: idField.nullable(),
    startedAt: isoDate, endedAt: isoDate, durationMinutes: z.number().int().min(1).max(1440),
    notes: notesField.nullable(),
  })
  .partial()
  .strict()
  .superRefine((v, c) => {
    if (Object.keys(v).length === 0) c.addIssue({ code: 'custom', path: ['_'], message: 'required' });
    if (v.endedAt !== undefined && v.durationMinutes !== undefined) c.addIssue({ code: 'custom', path: ['endedAt'], message: 'invalid' });
  });

const notesOf = (n: string | null | undefined) => (n ? n : null);

/** Bounds of a finished entry: 1 minute - 24 h, not in the future (5 min slack), not older than a year. */
function checkSpan(startedAt: Date, endedAt: Date, now: Date) {
  const startMs = startedAt.getTime();
  const endMs = endedAt.getTime();
  if (endMs <= startMs) throw Errors.validation({ endedAt: 'end_before_start' });
  const sec = Math.round((endMs - startMs) / 1000);
  if (sec < MIN_ENTRY_SEC) throw Errors.validation({ endedAt: 'too_small' });
  if (sec > MAX_ENTRY_SEC) throw Errors.validation({ endedAt: 'too_big' });
  if (endMs > now.getTime() + FUTURE_SLACK_MS) throw Errors.validation({ endedAt: 'date_in_future' });
  if (startMs < now.getTime() - MAX_AGE_MS) throw Errors.validation({ startedAt: 'invalid_date' });
  return sec;
}

// ───────────────────────── helpers ─────────────────────────

function dateRange(query: Request['query']): { from?: Date; to?: Date } {
  const from = qs(query, 'from');
  const to = qs(query, 'to');
  if (from && !isDateOnly(from)) throw Errors.validation({ from: 'invalid_date' });
  if (to && !isDateOnly(to)) throw Errors.validation({ to: 'invalid_date' });
  // days are cut in the caller's zone (optional `tz`, minutes ahead of UTC) so a filter matches what the week strip shows
  const shift = tzOf(query) * 60_000;
  const r = { from: from ? new Date(parseDateOnly(from).getTime() - shift) : undefined, to: to ? new Date(endOfDayUtc(to).getTime() - shift) : undefined };
  if (r.from && r.to && r.to < r.from) throw Errors.validation({ to: 'end_before_start' });
  return r;
}

/** Minutes ahead of UTC of the caller's browser zone (optional `tz` query param, clamped). Used only to cut days/weeks. */
function tzOf(query: Request['query']): number {
  const n = parseInt(qs(query, 'tz') ?? '0', 10);
  return Number.isFinite(n) ? Math.max(-840, Math.min(840, n)) : 0;
}

/** Entry the caller may see (404 otherwise) AND may change (owner or ADMIN, else 403). */
async function findOwnEntry(ctx: Ctx, id: string) {
  const e = await prisma.timeEntry.findFirst({ where: and<Prisma.TimeEntryWhereInput>({ id }, timeEntryWhere(ctx.scope)), include: entryInclude });
  if (!e) throw Errors.notFound();
  if (e.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden();
  return e;
}

// ───────────────────────── timer ─────────────────────────

timeRouter.get(
  '/timer',
  trackPerm,
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    const now = new Date();
    const e = await prisma.timeEntry.findFirst({ where: { userId: user.id, endedAt: null }, orderBy: { startedAt: 'desc' }, include: entryInclude });
    const dto = e ? entryDto(e, now) : null;
    res.json({ item: dto, elapsedSec: dto?.durationSec ?? 0, capped: !!e && (now.getTime() - e.startedAt.getTime()) / 1000 > MAX_RUNNING_SEC, serverNow: now.toISOString() });
  }),
);

timeRouter.post(
  '/timer/start',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(startSchema, req.body);
    const target = await resolveTarget(ctx, body);
    const now = new Date();
    const { item, stopped } = await prisma.$transaction(async (tx) => {
      // one running timer per user: starting a new one stops (and saves) the old one
      const stoppedRows = await stopRunning(tx, ctx.user.id, now);
      const created = await tx.timeEntry.create({
        data: { userId: ctx.user.id, ...target, startedAt: now, endedAt: null, durationSec: 0, notes: notesOf(body.notes) },
        include: entryInclude,
      });
      return { item: created, stopped: stoppedRows };
    });
    res.status(201).json({
      item: entryDto(item, now),
      stopped: stopped[0] ? entryDto(stopped[0].entry, now) : null,
      stoppedCapped: stopped.some((s) => s.capped),
      serverNow: now.toISOString(),
    });
  }),
);

timeRouter.post(
  '/timer/stop',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const now = new Date();
    const stopped = await prisma.$transaction((tx) => stopRunning(tx, ctx.user.id, now));
    if (stopped.length === 0) throw Errors.conflict('NO_TIMER_RUNNING', 'There is no running timer.');
    res.json({ item: entryDto(stopped[0].entry, now), capped: stopped.some((s) => s.capped) });
  }),
);

// ───────────────────────── entries ─────────────────────────

timeRouter.get(
  '/entries',
  listPerm,
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const p = paging(req.query, 20);
    const { from, to } = dateRange(req.query);
    const clientId = qs(req.query, 'clientId');
    const projectId = qs(req.query, 'projectId');
    const taskId = qs(req.query, 'taskId');
    const running = qs(req.query, 'running');
    // another person's entries only for time.view_all / ADMIN; everybody else is forced to their own
    const wanted = qs(req.query, 'userId');
    const userId = canViewAllTime(scope) ? wanted : user.id;
    const where = and<Prisma.TimeEntryWhereInput>(
      timeEntryWhere(scope),
      canViewAllTime(scope) ? undefined : { userId: user.id },
      userId ? { userId } : undefined,
      clientId ? { clientId } : undefined,
      projectId ? { projectId } : undefined,
      taskId ? { taskId } : undefined,
      from ? { startedAt: { gte: from } } : undefined,
      to ? { startedAt: { lte: to } } : undefined,
      running === '1' || running === 'true' ? { endedAt: null } : running === '0' || running === 'false' ? { endedAt: { not: null } } : undefined,
    );
    const now = new Date();
    const [total, rows, sum] = await Promise.all([
      prisma.timeEntry.count({ where }),
      prisma.timeEntry.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take, include: entryInclude }),
      prisma.timeEntry.aggregate({ where: and<Prisma.TimeEntryWhereInput>(where, { endedAt: { not: null } }), _sum: { durationSec: true } }),
    ]);
    const seconds = sum._sum.durationSec ?? 0;
    res.json({ items: rows.map((r) => entryDto(r, now)), meta: pageMeta(p, total), totals: { seconds, hours: hoursOf(seconds), count: total } });
  }),
);

timeRouter.post(
  '/entries',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    const now = new Date();
    const endedAt = body.endedAt ?? new Date(body.startedAt.getTime() + (body.durationMinutes as number) * 60_000);
    const durationSec = checkSpan(body.startedAt, endedAt, now);
    const target = await resolveTarget(ctx, body);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.timeEntry.create({
        data: { userId: ctx.user.id, ...target, startedAt: body.startedAt, endedAt, durationSec, notes: notesOf(body.notes) },
        include: entryInclude,
      });
      await syncActualHours(tx, [target.taskId]);
      return created;
    });
    // parallel entries are allowed (one meeting can be logged to two clients); the UI warns about them
    const overlapping = await prisma.timeEntry.count({
      where: { userId: ctx.user.id, id: { not: item.id }, startedAt: { lt: endedAt }, OR: [{ endedAt: null }, { endedAt: { gt: body.startedAt } }] },
    });
    res.status(201).json({ item: entryDto(item, now), overlapping });
  }),
);

timeRouter.patch(
  '/entries/:id',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findOwnEntry(ctx, idParam(req));
    const body = parse(updateSchema, req.body);
    const now = new Date();
    const data: Prisma.TimeEntryUncheckedUpdateInput = {};

    if (body.notes !== undefined) data.notes = notesOf(body.notes);

    // re-targeting: whichever target ids are sent replace the old target (missing ones = none); derivation rules apply again
    let target: { taskId: string | null; projectId: string | null; clientId: string | null } | null = null;
    if (body.taskId !== undefined || body.projectId !== undefined || body.clientId !== undefined) {
      target = await resolveTarget(ctx, body);
      Object.assign(data, target);
    }

    const running = existing.endedAt === null;
    if (running && (body.endedAt !== undefined || body.durationMinutes !== undefined)) throw Errors.conflict('INVALID_STATE', 'Stop the timer first.');
    if (body.startedAt !== undefined || body.endedAt !== undefined || body.durationMinutes !== undefined) {
      const startedAt = body.startedAt ?? existing.startedAt;
      if (running) {
        if (startedAt.getTime() > now.getTime() || startedAt.getTime() < now.getTime() - MAX_AGE_MS) throw Errors.validation({ startedAt: 'invalid_date' });
        data.startedAt = startedAt;
      } else {
        const endedAt =
          body.endedAt ??
          (body.durationMinutes !== undefined
            ? new Date(startedAt.getTime() + body.durationMinutes * 60_000)
            : new Date(startedAt.getTime() + existing.durationSec * 1000)); // only the start moved: keep the length
        data.startedAt = startedAt;
        data.endedAt = endedAt;
        data.durationSec = checkSpan(startedAt, endedAt, now);
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.timeEntry.update({ where: { id: existing.id }, data, include: entryInclude });
      await syncActualHours(tx, [existing.taskId, updated.taskId]);
      return updated;
    });
    res.json({ item: entryDto(item, now) });
  }),
);

timeRouter.delete(
  '/entries/:id',
  trackPerm,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findOwnEntry(ctx, idParam(req));
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.delete({ where: { id: existing.id } });
      await syncActualHours(tx, [existing.taskId]);
    });
    res.json({ ok: true });
  }),
);

// ───────────────────────── "my time" ─────────────────────────

timeRouter.get(
  '/my',
  trackPerm,
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    const tz = tzOf(req.query);
    const now = new Date();
    const anchorRaw = qs(req.query, 'week');
    if (anchorRaw && !isDateOnly(anchorRaw)) throw Errors.validation({ week: 'invalid_date' });
    const anchor = anchorRaw ? parseDateOnly(anchorRaw).getTime() - tz * 60_000 + 12 * 3_600_000 : now.getTime();
    const wStart = weekStartMs(anchor, tz);
    const wEnd = wStart + 7 * DAY_MS;
    const tStart = dayStartMs(now.getTime(), tz);
    const tEnd = tStart + DAY_MS;

    const rows = await prisma.timeEntry.findMany({
      where: { userId: user.id, startedAt: { gte: new Date(Math.min(wStart, tStart)), lt: new Date(Math.max(wEnd, tEnd)) } },
      orderBy: { startedAt: 'desc' },
      take: 2000,
      include: entryInclude,
    });
    let weekSec = 0;
    let todaySec = 0;
    const days = Array.from({ length: 7 }, (_, i) => ({ date: dayKeyTz(wStart + i * DAY_MS, tz), seconds: 0, entries: [] as ReturnType<typeof entryDto>[] }));
    for (const r of rows) {
      const t = r.startedAt.getTime();
      const sec = effectiveSec(r, now);
      if (t >= tStart && t < tEnd) todaySec += sec;
      if (t >= wStart && t < wEnd) {
        weekSec += sec;
        const day = days[Math.min(6, Math.floor((t - wStart) / DAY_MS))];
        day.seconds += sec;
        day.entries.push(entryDto(r, now));
      }
    }
    const running = await prisma.timeEntry.findFirst({ where: { userId: user.id, endedAt: null }, orderBy: { startedAt: 'desc' }, include: entryInclude });
    res.json({
      tz,
      serverNow: now.toISOString(),
      today: { date: dayKeyTz(tStart, tz), seconds: todaySec, hours: hoursOf(todaySec) },
      week: { start: dayKeyTz(wStart, tz), end: dayKeyTz(wEnd - DAY_MS, tz), seconds: weekSec, hours: hoursOf(weekSec) },
      days: days.map((d) => ({ ...d, hours: hoursOf(d.seconds) })),
      running: running ? entryDto(running, now) : null,
    });
  }),
);

// ───────────────────────── client time report ─────────────────────────

const reportPerm = requirePerm('time.view_all');
const REPORT_ROW_CAP = 50_000;

async function loadReport(ctx: Ctx, clientId: string, query: Request['query']) {
  const { scope } = ctx;
  // ADMIN: any client; TEAM: only clients they are fully assigned to (whole-client access, not just a campaign)
  if (scope.role !== 'ADMIN' && !scope.fullClientIds.includes(clientId)) throw Errors.notFound();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, companyName: true } });
  if (!client) throw Errors.notFound();
  const { from, to } = dateRange(query);
  const tz = tzOf(query);
  const where = and<Prisma.TimeEntryWhereInput>(
    timeEntryWhere(scope),
    { clientId, endedAt: { not: null } },
    from ? { startedAt: { gte: from } } : undefined,
    to ? { startedAt: { lte: to } } : undefined,
  );
  const rows = await prisma.timeEntry.findMany({
    where,
    orderBy: { startedAt: 'asc' },
    take: REPORT_ROW_CAP + 1,
    select: { id: true, userId: true, projectId: true, taskId: true, startedAt: true, endedAt: true, durationSec: true, notes: true },
  });
  const truncated = rows.length > REPORT_ROW_CAP;
  if (truncated) rows.pop();
  const [users, projects, tasks] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
    prisma.task.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))] } }, select: { id: true, title: true, projectId: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const taskInfo = new Map(tasks.map((t) => [t.id, t]));

  const sum = <K extends string | null>(keyOf: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, { seconds: number; entries: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      const cur = m.get(k) ?? { seconds: 0, entries: 0 };
      cur.seconds += r.durationSec;
      cur.entries += 1;
      m.set(k, cur);
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v, hours: hoursOf(v.seconds) }));
  };
  const bySeconds = <T extends { seconds: number }>(a: T[]) => a.sort((x, y) => y.seconds - x.seconds);
  const totalSec = rows.reduce((a, r) => a + r.durationSec, 0);

  return {
    client, rows, truncated, from: qs(query, 'from') ?? null, to: qs(query, 'to') ?? null, userName, projectName, taskInfo, tz,
    report: {
      client,
      range: { from: qs(query, 'from') ?? null, to: qs(query, 'to') ?? null },
      truncated,
      totals: { seconds: totalSec, hours: hoursOf(totalSec), entries: rows.length },
      byProject: bySeconds(sum((r) => r.projectId).map((x) => ({ projectId: x.key, name: x.key ? (projectName.get(x.key) ?? null) : null, seconds: x.seconds, hours: x.hours, entries: x.entries }))),
      byTask: bySeconds(sum((r) => r.taskId).map((x) => ({ taskId: x.key, title: x.key ? (taskInfo.get(x.key)?.title ?? null) : null, projectId: x.key ? (taskInfo.get(x.key)?.projectId ?? null) : null, seconds: x.seconds, hours: x.hours, entries: x.entries }))),
      byUser: bySeconds(sum((r) => r.userId).map((x) => ({ userId: x.key, name: userName.get(x.key as string) ?? null, seconds: x.seconds, hours: x.hours, entries: x.entries }))),
      byDay: sum((r) => dayKeyTz(r.startedAt.getTime(), tz)).map((x) => ({ date: x.key as string, seconds: x.seconds, hours: x.hours, entries: x.entries })).sort((a, b) => a.date.localeCompare(b.date)),
    },
  };
}

async function sendCsv(req: Request, res: Response, clientId: string) {
  const ctx = ctxOf(req);
  const r = await loadReport(ctx, clientId, req.query);
  const lines = [csvRow(['Date', 'Start', 'End', 'Hours', 'Minutes', 'User', 'Project', 'Task', 'Notes'])];
  for (const e of r.rows) {
    const hm = (d: Date) => new Date(d.getTime() + r.tz * 60_000).toISOString().slice(11, 16);
    lines.push(csvRow([
      dayKeyTz(e.startedAt.getTime(), r.tz), hm(e.startedAt), e.endedAt ? hm(e.endedAt) : '',
      (e.durationSec / 3600).toFixed(2), Math.round(e.durationSec / 60),
      r.userName.get(e.userId) ?? '', e.projectId ? (r.projectName.get(e.projectId) ?? '') : '', e.taskId ? (r.taskInfo.get(e.taskId)?.title ?? '') : '', e.notes ?? '',
    ]));
  }
  lines.push(csvRow(['Total', '', '', (r.report.totals.seconds / 3600).toFixed(2), Math.round(r.report.totals.seconds / 60), '', '', '', '']));
  await audit(ctx, 'REPORT_EXPORTED', 'report', null, { kind: 'client_time', format: 'csv', from: r.from, to: r.to, rows: r.rows.length }, { clientId, clientVisible: false });
  const safe = r.client.companyName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="time-${safe}-${r.from ?? 'start'}-${r.to ?? 'now'}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send('﻿' + lines.join('\r\n') + '\r\n');
}

// the .csv route must be registered first: ":clientId" would otherwise swallow the extension
timeRouter.get('/report/client/:clientId.csv', reportPerm, asyncHandler(async (req, res) => sendCsv(req, res, idParam(req, 'clientId'))));

timeRouter.get(
  '/report/client/:clientId',
  reportPerm,
  asyncHandler(async (req, res) => {
    const clientId = idParam(req, 'clientId');
    if (qs(req.query, 'format') === 'csv') return sendCsv(req, res, clientId);
    const r = await loadReport(ctxOf(req), clientId, req.query);
    res.json(r.report);
  }),
);
