// Time tracking + workload helpers (Group C).  Routes live in routes/time.ts and routes/workload.ts.
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { taskWhere, projectWhere, canWriteClient, type Scope } from '../authz/scope';
import { Errors } from '../lib/errors';
import type { Ctx } from '../lib/context';
import { and } from './serializers';

type Tx = Prisma.TransactionClient;

// ───────────────────────── constants ─────────────────────────

/** A timer that was forgotten is closed at this length when it is stopped (flagged `capped` in the response). */
export const MAX_RUNNING_SEC = 16 * 3600;
export const MIN_ENTRY_SEC = 60;
export const MAX_ENTRY_SEC = 24 * 3600;
export const FUTURE_SLACK_MS = 5 * 60_000;
export const MAX_AGE_MS = 366 * 86_400_000;

/** Weekly capacity used when a person has none configured (User.weeklyCapacityHours defaults to 40). */
export const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;
/** Utilization thresholds (ratio of planned hours to capacity). Capacity indicator only - never a performance score. */
export const UTILIZATION_THRESHOLDS = { low: 0.5, balanced: 0.9, high: 1.1 } as const;
export type LoadIndicator = 'LOW' | 'BALANCED' | 'HIGH' | 'OVERLOADED';

export const DAY_MS = 86_400_000;

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const hoursOf = (sec: number) => round2(sec / 3600);

/** <50% LOW, 50-<90% BALANCED, 90-110% HIGH, >110% OVERLOADED. */
export function indicatorFor(utilization: number): LoadIndicator {
  if (utilization < UTILIZATION_THRESHOLDS.low) return 'LOW';
  if (utilization < UTILIZATION_THRESHOLDS.balanced) return 'BALANCED';
  if (utilization <= UTILIZATION_THRESHOLDS.high) return 'HIGH';
  return 'OVERLOADED';
}

// ───────────────────────── entry serialisation ─────────────────────────

export const entryInclude = {
  task: { select: { id: true, title: true } },
  project: { select: { id: true, name: true } },
  client: { select: { id: true, companyName: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.TimeEntryInclude;

export type EntryRow = Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>;

/** Seconds the entry counts for: finished entries use their stored duration, a running one its (capped) elapsed time. */
export function effectiveSec(e: { endedAt: Date | null; startedAt: Date; durationSec: number }, now = new Date()): number {
  if (e.endedAt) return e.durationSec;
  return Math.max(0, Math.min(MAX_RUNNING_SEC, Math.floor((now.getTime() - e.startedAt.getTime()) / 1000)));
}

export function entryDto(e: EntryRow, now = new Date()) {
  const running = e.endedAt === null;
  return {
    id: e.id,
    userId: e.userId,
    user: e.user,
    taskId: e.taskId,
    task: e.task,
    projectId: e.projectId,
    project: e.project,
    clientId: e.clientId,
    client: e.client,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    running,
    durationSec: effectiveSec(e, now),
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  };
}

// ───────────────────────── targets (task / project / client) ─────────────────────────

export interface Target { taskId: string | null; projectId: string | null; clientId: string | null }

/**
 * Turns the (untrusted) ids of a request body into a consistent target the caller may log time against.
 *  - taskId    -> must be in the caller's task scope; project and client are DERIVED from the task (body values ignored)
 *  - projectId -> must be in the caller's project scope; client is derived
 *  - clientId  -> ADMIN, or a client the TEAM member is assigned to (whole client)
 * Anything else is a 400 invalid_choice (never reveals whether the row exists).
 */
export async function resolveTarget(ctx: Ctx, input: { taskId?: string | null; projectId?: string | null; clientId?: string | null }): Promise<Target> {
  const { scope } = ctx;
  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: and<Prisma.TaskWhereInput>({ id: input.taskId }, taskWhere(scope)),
      select: { id: true, projectId: true, clientId: true, project: { select: { clientId: true } } },
    });
    if (!task) throw Errors.validation({ taskId: 'invalid_choice' });
    return { taskId: task.id, projectId: task.projectId, clientId: task.clientId ?? task.project?.clientId ?? null };
  }
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: input.projectId }, projectWhere(scope)), select: { id: true, clientId: true } });
    if (!project) throw Errors.validation({ projectId: 'invalid_choice' });
    return { taskId: null, projectId: project.id, clientId: project.clientId };
  }
  if (input.clientId) {
    if (!canWriteClient(scope, input.clientId)) throw Errors.validation({ clientId: 'invalid_choice' });
    const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } });
    if (!client) throw Errors.validation({ clientId: 'invalid_choice' });
    return { taskId: null, projectId: null, clientId: client.id };
  }
  return { taskId: null, projectId: null, clientId: null };
}

// ───────────────────────── Task.actualHours sync ─────────────────────────

/** Recomputes actualHours (hours, 2 decimals) of the given tasks from the finished entries in the DB. Never increments blindly. */
export async function syncActualHours(tx: Tx, taskIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(taskIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const sums = await tx.timeEntry.groupBy({ by: ['taskId'], where: { taskId: { in: ids }, endedAt: { not: null } }, _sum: { durationSec: true } });
  const byTask = new Map(sums.map((s) => [s.taskId, s._sum.durationSec ?? 0]));
  for (const id of ids) {
    await tx.task.updateMany({ where: { id }, data: { actualHours: hoursOf(byTask.get(id) ?? 0) } });
  }
}

// ───────────────────────── timer ─────────────────────────

/** Closes a running entry using SERVER time only. Returns whether the safety cap had to be applied. */
export function closeData(e: { startedAt: Date }, now: Date): { endedAt: Date; durationSec: number; capped: boolean } {
  const raw = Math.max(0, Math.floor((now.getTime() - e.startedAt.getTime()) / 1000));
  if (raw > MAX_RUNNING_SEC) return { endedAt: new Date(e.startedAt.getTime() + MAX_RUNNING_SEC * 1000), durationSec: MAX_RUNNING_SEC, capped: true };
  return { endedAt: now, durationSec: raw, capped: false };
}

/** Stops every running entry of the user (normally at most one) inside the given transaction. */
export async function stopRunning(tx: Tx, userId: string, now: Date) {
  const running = await tx.timeEntry.findMany({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' }, include: entryInclude });
  const stopped: Array<{ entry: EntryRow; capped: boolean }> = [];
  for (const r of running) {
    const c = closeData(r, now);
    const updated = await tx.timeEntry.update({ where: { id: r.id }, data: { endedAt: c.endedAt, durationSec: c.durationSec }, include: entryInclude });
    stopped.push({ entry: updated, capped: c.capped });
  }
  await syncActualHours(tx, running.map((r) => r.taskId));
  return stopped;
}

// ───────────────────────── dates ─────────────────────────

/** Start (UTC ms) of the day containing `t` in a zone that is `tzMin` minutes ahead of UTC. */
export function dayStartMs(t: number, tzMin: number): number {
  const shifted = t + tzMin * 60_000;
  return Math.floor(shifted / DAY_MS) * DAY_MS - tzMin * 60_000;
}
/** Monday start of the week containing `t` in the given zone. */
export function weekStartMs(t: number, tzMin: number): number {
  const d0 = dayStartMs(t, tzMin);
  const dow = new Date(d0 + tzMin * 60_000).getUTCDay(); // 0 = Sunday
  return d0 - ((dow + 6) % 7) * DAY_MS;
}
/** yyyy-mm-dd of `t` in the given zone. */
export const dayKeyTz = (t: number, tzMin: number): string => new Date(t + tzMin * 60_000).toISOString().slice(0, 10);

/** Whether the caller may see other people's entries (time.view_all or ADMIN). */
export const canViewAllTime = (s: Scope) => s.role === 'ADMIN' || s.permissions.has('time.view_all');

// ───────────────────────── CSV ─────────────────────────

/**
 * One CSV cell. Text starting with = + - @ (or a tab / CR) is prefixed with a single quote so spreadsheet apps never
 * evaluate it as a formula; cells containing , " or line breaks are quoted with doubled quotes.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v) : v;
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
export const csvRow = (cells: Array<string | number | null | undefined>) => cells.map(csvCell).join(',');
