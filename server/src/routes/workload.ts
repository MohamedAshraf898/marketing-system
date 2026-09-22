// Owner: Time & workload group.  workloadRouter -> /workload
//
// This is a CAPACITY indicator (how much planned work sits on a person compared with their weekly hours), NOT a
// performance score: people are listed alphabetically and never ranked by productivity.
import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { ACTIVE_PROJECT_STATUSES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { projectWhere, taskWhere, timeEntryWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, qs } from '../lib/http';
import { and } from '../services/serializers';
import { DAY_MS, DEFAULT_WEEKLY_CAPACITY_HOURS, UTILIZATION_THRESHOLDS, dayStartMs, hoursOf, indicatorFor, round2, weekStartMs } from '../services/time';

export const workloadRouter = Router();
workloadRouter.use(authenticate);
workloadRouter.use(requirePerm('workload.view'));

const MAX_WINDOW_DAYS = 92;
const TASK_CAP = 20_000;

/** People the caller may see. ADMIN: every active staff member. TEAM: themselves + team members who share at least one of their assigned clients. */
async function visibleMembers(scope: Scope) {
  const select = { id: true, name: true, role: true, jobTitle: true, avatar: true, weeklyCapacityHours: true } satisfies Prisma.UserSelect;
  if (scope.role === 'ADMIN') {
    return prisma.user.findMany({ where: { role: { in: ['ADMIN', 'TEAM'] }, status: 'ACTIVE' }, select, orderBy: { name: 'asc' } });
  }
  const shared = scope.fullClientIds.length
    ? await prisma.clientAssignment.findMany({ where: { clientId: { in: scope.fullClientIds } }, select: { userId: true }, distinct: ['userId'] })
    : [];
  const ids = [...new Set([scope.userId, ...shared.map((s) => s.userId)])];
  return prisma.user.findMany({ where: { id: { in: ids }, role: 'TEAM', status: 'ACTIVE' }, select, orderBy: { name: 'asc' } });
}

function windowOf(query: Request['query']) {
  const tz = Math.max(-840, Math.min(840, parseInt(qs(query, 'tz') ?? '0', 10) || 0));
  const now = Date.now();
  const fromQ = qs(query, 'from');
  const toQ = qs(query, 'to');
  if (fromQ && !isDateOnly(fromQ)) throw Errors.validation({ from: 'invalid_date' });
  if (toQ && !isDateOnly(toQ)) throw Errors.validation({ to: 'invalid_date' });
  // default: this week (Monday) + next week. Dates are date-only (UTC midnight), like task due dates.
  const monday = weekStartMs(now, tz);
  const mondayKey = new Date(monday + tz * 60_000).toISOString().slice(0, 10);
  const from = fromQ ? parseDateOnly(fromQ) : parseDateOnly(mondayKey);
  const to = toQ ? endOfDayUtc(toQ) : new Date(from.getTime() + 14 * DAY_MS - 1);
  if (to.getTime() < from.getTime()) throw Errors.validation({ to: 'end_before_start' });
  const days = Math.ceil((to.getTime() - from.getTime() + 1) / DAY_MS);
  if (days > MAX_WINDOW_DAYS) throw Errors.validation({ to: 'too_big' });
  const todayKey = new Date(dayStartMs(now, tz) + tz * 60_000).toISOString().slice(0, 10);
  return { from, to, days, weeks: days / 7, today: parseDateOnly(todayKey) };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

workloadRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const w = windowOf(req.query);
    const members = await visibleMembers(scope);
    const ids = members.map((m) => m.id);

    // Three bulk/grouped queries in total (no per-person loops with queries).
    const [tasks, managed, logged] = await Promise.all([
      // open tasks the caller may see. A colleague's task the caller has no access to is not counted (no leaking of hidden work).
      prisma.task.findMany({
        where: and<Prisma.TaskWhereInput>(taskWhere(scope), { assignedToId: { in: ids }, status: { not: 'DONE' } }),
        select: { assignedToId: true, dueDate: true, estimatedHours: true, actualHours: true },
        take: TASK_CAP,
      }),
      prisma.project.groupBy({
        by: ['projectManagerId'],
        where: and<Prisma.ProjectWhereInput>(projectWhere(scope), { projectManagerId: { in: ids }, status: { in: ACTIVE_PROJECT_STATUSES } }),
        _count: { _all: true },
      }),
      // logged time: only what timeEntryWhere lets the caller see (own entries, or client entries with time.view_all)
      prisma.timeEntry.groupBy({
        by: ['userId'],
        where: and<Prisma.TimeEntryWhereInput>(timeEntryWhere(scope), { userId: { in: ids }, endedAt: { not: null }, startedAt: { gte: w.from, lte: w.to } }),
        _sum: { durationSec: true },
      }),
    ]);

    type Acc = { open: number; overdue: number; dueInWindow: number; unestimated: number; plannedHours: number };
    const acc = new Map<string, Acc>();
    for (const t of tasks) {
      const key = t.assignedToId as string;
      const a = acc.get(key) ?? { open: 0, overdue: 0, dueInWindow: 0, unestimated: 0, plannedHours: 0 };
      a.open += 1;
      if (t.dueDate) {
        if (t.dueDate < w.today) a.overdue += 1;
        if (t.dueDate >= w.from && t.dueDate <= w.to) a.dueInWindow += 1;
        // Planned hours = REMAINING estimate (estimatedHours - hours already logged, never below 0) of open tasks that are
        // due in the window or are overdue carry-over (due before it). Tasks without a due date are unscheduled: counted as open only.
        if (t.dueDate <= w.to) {
          if (t.estimatedHours === null) a.unestimated += 1;
          else a.plannedHours += Math.max(0, t.estimatedHours - (t.actualHours ?? 0));
        }
      }
      acc.set(key, a);
    }
    const managedBy = new Map(managed.map((m) => [m.projectManagerId, m._count._all]));
    const loggedBy = new Map(logged.map((l) => [l.userId, l._sum.durationSec ?? 0]));

    const items = members.map((m) => {
      const a = acc.get(m.id) ?? { open: 0, overdue: 0, dueInWindow: 0, unestimated: 0, plannedHours: 0 };
      const weekly = m.weeklyCapacityHours > 0 ? m.weeklyCapacityHours : DEFAULT_WEEKLY_CAPACITY_HOURS;
      const capacityHours = round2(weekly * w.weeks);
      const utilization = capacityHours > 0 ? a.plannedHours / capacityHours : 0;
      return {
        user: { id: m.id, name: m.name, role: m.role, jobTitle: m.jobTitle, avatar: m.avatar },
        openTasks: a.open,
        overdueTasks: a.overdue,
        dueInWindow: a.dueInWindow,
        unestimatedTasks: a.unestimated,
        estimatedHours: round2(a.plannedHours),
        loggedHours: hoursOf(loggedBy.get(m.id) ?? 0),
        // logged hours of other people are only what this caller is allowed to see, so they can be partial
        loggedPartial: scope.role !== 'ADMIN' && m.id !== scope.userId,
        activeProjects: managedBy.get(m.id) ?? 0,
        weeklyCapacityHours: weekly,
        capacityHours,
        utilization: Math.round(utilization * 1000) / 1000,
        indicator: indicatorFor(utilization),
      };
    });

    res.json({
      window: { from: isoDay(w.from), to: isoDay(w.to), days: w.days, weeks: Math.round(w.weeks * 100) / 100 },
      thresholds: UTILIZATION_THRESHOLDS,
      items,
    });
  }),
);

workloadRouter.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const userId = idParam(req, 'userId');
    const members = await visibleMembers(scope);
    const member = members.find((m) => m.id === userId);
    if (!member) throw Errors.notFound();
    const rows = await prisma.task.findMany({
      where: and<Prisma.TaskWhereInput>(taskWhere(scope), { assignedToId: userId, status: { not: 'DONE' } }),
      select: {
        id: true, title: true, status: true, priority: true, dueDate: true, estimatedHours: true, actualHours: true,
        project: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } },
      },
      take: 500,
    });
    // by due date, undated tasks last
    const far = Number.MAX_SAFE_INTEGER;
    rows.sort((a, b) => (a.dueDate?.getTime() ?? far) - (b.dueDate?.getTime() ?? far) || a.title.localeCompare(b.title));
    const today = dayStartMs(Date.now(), 0);
    res.json({
      user: { id: member.id, name: member.name, role: member.role, jobTitle: member.jobTitle, avatar: member.avatar },
      items: rows.map((t) => ({ ...t, overdue: !!t.dueDate && t.dueDate.getTime() < today })),
    });
  }),
);
