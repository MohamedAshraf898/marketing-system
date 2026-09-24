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
import { assignedTo, assigneeIdsOf } from '../services/tasks';
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
    const onlyUser = qs(req.query, 'userId');
    const members = (await visibleMembers(scope)).filter((m) => !onlyUser || m.id === onlyUser);
    const ids = members.map((m) => m.id);
    // optional project / client filters narrow the WORK that is counted (people stay listed)
    const workFilter = and<Prisma.TaskWhereInput>(
      taskWhere(scope),
      { archivedAt: null },
      qs(req.query, 'projectId') ? { projectId: qs(req.query, 'projectId') } : undefined,
      qs(req.query, 'clientId') ? { clientId: qs(req.query, 'clientId') } : undefined,
    );
    const anyOf: Prisma.TaskWhereInput = { OR: [{ assignedToId: { in: ids } }, { assignees: { some: { userId: { in: ids } } } }] };
    const assigneeSelect = { assignedToId: true, assignees: { select: { userId: true } } } satisfies Prisma.TaskSelect;

    // A handful of bulk/grouped queries in total (no per-person loops with queries).
    const [tasks, completed, managed, logged] = await Promise.all([
      // open tasks the caller may see. A colleague's task the caller has no access to is not counted (no leaking of hidden work).
      prisma.task.findMany({
        where: and<Prisma.TaskWhereInput>(workFilter, anyOf, { status: { not: 'DONE' } }),
        select: { ...assigneeSelect, dueDate: true, estimatedHours: true, actualHours: true },
        take: TASK_CAP,
      }),
      prisma.task.findMany({
        where: and<Prisma.TaskWhereInput>(workFilter, anyOf, { status: 'DONE', completedAt: { gte: w.from, lte: w.to } }),
        select: { ...assigneeSelect, actualHours: true },
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
        where: and<Prisma.TimeEntryWhereInput>(
          timeEntryWhere(scope),
          { userId: { in: ids }, endedAt: { not: null }, startedAt: { gte: w.from, lte: w.to } },
          qs(req.query, 'projectId') ? { projectId: qs(req.query, 'projectId') } : undefined,
          qs(req.query, 'clientId') ? { clientId: qs(req.query, 'clientId') } : undefined,
        ),
        _sum: { durationSec: true },
      }),
    ]);

    type Acc = { open: number; overdue: number; dueInWindow: number; dueToday: number; unestimated: number; plannedHours: number; completed: number };
    const blank = (): Acc => ({ open: 0, overdue: 0, dueInWindow: 0, dueToday: 0, unestimated: 0, plannedHours: 0, completed: 0 });
    const acc = new Map<string, Acc>();
    const tomorrow = new Date(w.today.getTime() + DAY_MS);
    for (const t of tasks) {
      // a shared task counts for every assignee; its remaining estimate is split evenly between them
      const people = assigneeIdsOf(t);
      const share = people.length > 0 ? 1 / people.length : 1;
      for (const key of people.filter((p) => ids.includes(p))) {
        const a = acc.get(key) ?? blank();
        a.open += 1;
        if (t.dueDate) {
          if (t.dueDate < w.today) a.overdue += 1;
          if (t.dueDate >= w.today && t.dueDate < tomorrow) a.dueToday += 1;
          if (t.dueDate >= w.from && t.dueDate <= w.to) a.dueInWindow += 1;
          // Planned hours = REMAINING estimate (estimatedHours - hours already logged, never below 0) of open tasks that are
          // due in the window or are overdue carry-over (due before it). Tasks without a due date are unscheduled: counted as open only.
          if (t.dueDate <= w.to) {
            if (t.estimatedHours === null) a.unestimated += 1;
            else a.plannedHours += Math.max(0, t.estimatedHours - (t.actualHours ?? 0)) * share;
          }
        }
        acc.set(key, a);
      }
    }
    for (const t of completed) {
      for (const key of assigneeIdsOf(t).filter((p) => ids.includes(p))) {
        const a = acc.get(key) ?? blank();
        a.completed += 1;
        acc.set(key, a);
      }
    }
    const managedBy = new Map(managed.map((m) => [m.projectManagerId, m._count._all]));
    const loggedBy = new Map(logged.map((l) => [l.userId, l._sum.durationSec ?? 0]));

    const items = members.map((m) => {
      const a = acc.get(m.id) ?? blank();
      const weekly = m.weeklyCapacityHours > 0 ? m.weeklyCapacityHours : DEFAULT_WEEKLY_CAPACITY_HOURS;
      const capacityHours = round2(weekly * w.weeks);
      const utilization = capacityHours > 0 ? a.plannedHours / capacityHours : 0;
      return {
        user: { id: m.id, name: m.name, role: m.role, jobTitle: m.jobTitle, avatar: m.avatar },
        openTasks: a.open,
        overdueTasks: a.overdue,
        dueInWindow: a.dueInWindow,
        dueToday: a.dueToday,
        completedTasks: a.completed,
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
      where: and<Prisma.TaskWhereInput>(taskWhere(scope), assignedTo(userId), { archivedAt: null, status: { not: 'DONE' } }),
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
