// Owner: Time & workload group.  teamReportsRouter -> /team-reports
//
// Task reports for team leads (`tasks.view_team`). Transparent counts and hours only - never a "productivity score".
// Everything is limited to tasks / time entries the caller may see (taskWhere / timeEntryWhere).
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { taskWhere, timeEntryWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, qs, qsEnum } from '../lib/http';
import { addDaysKey, keyOf } from '../lib/zoned';
import { audit } from '../services/audit';
import { round2, todayUtc } from '../services/projects';
import { and } from '../services/serializers';
import { assigneeIdsOf } from '../services/tasks';
import { csvRow, hoursOf } from '../services/time';

export const teamReportsRouter = Router();
teamReportsRouter.use(authenticate, requirePerm('tasks.view', 'tasks.view_team'));

const GROUPS = ['assignee', 'client', 'project'] as const;
const TASK_CAP = 20_000;

interface Row {
  key: string | null;
  label: string | null;
  created: number;
  completed: number;
  completedOnTime: number;
  open: number;
  overdue: number;
  estimatedHours: number; // estimates of the tasks completed in the period
  trackedOnCompleted: number; // hours logged on those same tasks (all time)
  trackedInPeriod: number; // hours logged inside the period (time entries)
}

teamReportsRouter.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const by = qsEnum(req.query, 'by', GROUPS) ?? 'assignee';
    const today = keyOf(todayUtc());
    const fromKey = qs(req.query, 'from') ?? `${today.slice(0, 7)}-01`;
    const toKey = qs(req.query, 'to') ?? today;
    if (!isDateOnly(fromKey)) throw Errors.validation({ from: 'invalid_date' });
    if (!isDateOnly(toKey)) throw Errors.validation({ to: 'invalid_date' });
    if (toKey < fromKey) throw Errors.validation({ to: 'end_before_start' });
    if (addDaysKey(fromKey, 366) < toKey) throw Errors.validation({ to: 'too_big' });
    const from = parseDateOnly(fromKey);
    const to = endOfDayUtc(toKey);
    const filter = and<Prisma.TaskWhereInput>(
      taskWhere(ctx.scope),
      qs(req.query, 'projectId') ? { projectId: qs(req.query, 'projectId') } : undefined,
      qs(req.query, 'clientId') ? { clientId: qs(req.query, 'clientId') } : undefined,
    );
    const select = {
      id: true, status: true, dueDate: true, createdAt: true, completedAt: true, estimatedHours: true, actualHours: true, archivedAt: true,
      clientId: true, projectId: true, assignedToId: true, assignees: { select: { userId: true } },
    } satisfies Prisma.TaskSelect;
    const [tasks, entries] = await Promise.all([
      prisma.task.findMany({
        where: and<Prisma.TaskWhereInput>(filter, {
          OR: [{ createdAt: { gte: from, lte: to } }, { completedAt: { gte: from, lte: to } }, { status: { not: 'DONE' }, archivedAt: null }],
        }),
        select,
        take: TASK_CAP,
      }),
      prisma.timeEntry.groupBy({
        by: [by === 'assignee' ? 'userId' : by === 'client' ? 'clientId' : 'projectId'],
        where: and<Prisma.TimeEntryWhereInput>(
          timeEntryWhere(ctx.scope),
          { endedAt: { not: null }, startedAt: { gte: from, lte: to } },
          qs(req.query, 'projectId') ? { projectId: qs(req.query, 'projectId') } : undefined,
          qs(req.query, 'clientId') ? { clientId: qs(req.query, 'clientId') } : undefined,
        ),
        _sum: { durationSec: true },
      }),
    ]);

    const rows = new Map<string | null, Row>();
    const get = (key: string | null) => {
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { key, label: null, created: 0, completed: 0, completedOnTime: 0, open: 0, overdue: 0, estimatedHours: 0, trackedOnCompleted: 0, trackedInPeriod: 0 }));
      return r;
    };
    const todayDate = todayUtc();
    for (const t of tasks) {
      const keys = by === 'assignee' ? (assigneeIdsOf(t).length ? assigneeIdsOf(t) : [null]) : [by === 'client' ? t.clientId : t.projectId];
      for (const k of keys) {
        const r = get(k);
        if (t.createdAt >= from && t.createdAt <= to) r.created++;
        if (t.completedAt && t.completedAt >= from && t.completedAt <= to) {
          r.completed++;
          if (!t.dueDate || t.completedAt.getTime() <= t.dueDate.getTime() + 86_400_000 - 1) r.completedOnTime++;
          r.estimatedHours += t.estimatedHours ?? 0;
          r.trackedOnCompleted += t.actualHours;
        }
        if (t.status !== 'DONE' && !t.archivedAt) {
          r.open++;
          if (t.dueDate && t.dueDate < todayDate) r.overdue++;
        }
      }
    }
    for (const e of entries) {
      const key = (e as Record<string, unknown>)[by === 'assignee' ? 'userId' : by === 'client' ? 'clientId' : 'projectId'] as string | null;
      get(key).trackedInPeriod += hoursOf(e._sum.durationSec ?? 0);
    }

    const ids = [...rows.keys()].filter((k): k is string => !!k);
    const labels =
      by === 'assignee' ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).then((r) => new Map(r.map((x) => [x.id, x.name])))
        : by === 'client' ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, companyName: true } }).then((r) => new Map(r.map((x) => [x.id, x.companyName])))
          : await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).then((r) => new Map(r.map((x) => [x.id, x.name])));
    const items = [...rows.values()]
      .map((r) => ({ ...r, label: r.key ? (labels.get(r.key) ?? null) : null, estimatedHours: round2(r.estimatedHours), trackedOnCompleted: round2(r.trackedOnCompleted), trackedInPeriod: round2(r.trackedInPeriod) }))
      .sort((a, b) => (a.label ?? '~').localeCompare(b.label ?? '~'));
    const totals = items.reduce(
      (t, r) => ({ created: t.created + r.created, completed: t.completed + r.completed, completedOnTime: t.completedOnTime + r.completedOnTime, open: t.open + r.open, overdue: t.overdue + r.overdue, estimatedHours: round2(t.estimatedHours + r.estimatedHours), trackedOnCompleted: round2(t.trackedOnCompleted + r.trackedOnCompleted), trackedInPeriod: round2(t.trackedInPeriod + r.trackedInPeriod) }),
      { created: 0, completed: 0, completedOnTime: 0, open: 0, overdue: 0, estimatedHours: 0, trackedOnCompleted: 0, trackedInPeriod: 0 },
    );

    if (qs(req.query, 'format') === 'csv') {
      const head = { assignee: 'Team member', client: 'Client', project: 'Project' }[by];
      const lines = [
        csvRow([head, 'Created', 'Completed', 'Completed on time', 'Open', 'Overdue', 'Estimated h (completed)', 'Tracked h (completed)', 'Tracked h (period)']),
        ...items.map((r) => csvRow([r.label ?? '—', r.created, r.completed, r.completedOnTime, r.open, r.overdue, r.estimatedHours, r.trackedOnCompleted, r.trackedInPeriod])),
      ];
      await audit(ctx, 'REPORT_EXPORTED', 'task', null, { kind: `tasks_by_${by}`, from: fromKey, to: toKey, rows: items.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tasks-by-${by}-${fromKey}-to-${toKey}.csv"`);
      return res.send(`﻿${lines.join('\r\n')}\r\n`);
    }
    res.json({ by, range: { from: fromKey, to: toKey }, items, totals, truncated: tasks.length === TASK_CAP });
  }),
);
