// Owner: Projects & tasks group.  tasksRouter -> /tasks
// Tasks are agency work. Every route needs a staff permission (CLIENT users hold none => 403) and every query goes through
// taskWhere(scope), which matches nothing for a CLIENT (defence in depth). Clients reach the few tasks shared with them
// only through routes/clientTasks.ts.
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PRIORITIES, RECURRENCE_FREQUENCIES, TASK_STATUSES, TASK_VISIBILITIES, type Priority, type TaskStatus } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { fileWhere, loadScope, taskWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum, type Paging } from '../lib/http';
import { addDaysKey, dateOnly, keyOf } from '../lib/zoned';
import { audit } from '../services/audit';
import { notify, clientRecipients } from '../services/notifications';
import { addDaysUtc, assertStaffForClient, round2, todayUtc } from '../services/projects';
import { and, fileSelect } from '../services/serializers';
import { normalizeFieldValues, parseOptions } from '../services/taskFields';
import { firstOccurrence, nextOccurrence } from '../services/taskRecurrence';
import {
  assignedTo, assigneeIdsOf, findTask, loadTaskDto, loadTaskDtos, loadTaskMeta, resolveCustomStatus, resolveTaskLinks, resolveWorkLinks,
  taskAccess, taskDto, taskInclude, taskSummary, type TaskRow,
} from '../services/tasks';
import { afterCreate, applyTaskPatch, deleteTaskTree, insertTask, MAX_ASSIGNEES, taskAuditOpts, type TaskPatch } from '../services/taskWrite';

export const tasksRouter = Router();
tasksRouter.use(authenticate, requirePerm('tasks.view'));

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);
const text = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v));
const hours = z.number().min(0).max(10_000).transform(round2);
const idField = z.string().min(1).max(64);
const tagList = z.array(z.string().trim().min(1).max(40)).max(20);
const fieldValues = z.record(z.string().min(1).max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]));

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: text(5000).nullish(),
    projectId: idField.nullish(),
    clientId: idField.nullish(),
    campaignId: idField.nullish(),
    listId: idField.nullish(),
    parentId: idField.nullish(),
    assignedToId: idField.nullish(),
    assigneeIds: z.array(idField).max(MAX_ASSIGNEES).optional(),
    reviewerId: idField.nullish(),
    deliverableId: idField.nullish(),
    requestId: idField.nullish(),
    priority: z.enum(PRIORITIES).default('NORMAL'),
    status: z.enum(TASK_STATUSES).default('TODO'),
    customStatusId: idField.nullish(),
    visibility: z.enum(TASK_VISIBILITIES).default('INTERNAL'),
    startDate: dateStr.nullish(),
    dueDate: dateStr.nullish(),
    estimatedHours: hours.nullish(),
    tags: tagList.optional(),
    blockOnDependencies: z.boolean().optional(),
    customFields: fieldValues.optional(),
  })
  .strict();

// actualHours / completedAt / createdById are NOT here on purpose: they are only ever derived by the server
const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: text(5000).nullable(),
    projectId: idField.nullable(),
    campaignId: idField.nullable(),
    listId: idField.nullable(),
    parentId: idField.nullable(),
    assignedToId: idField.nullable(),
    assigneeIds: z.array(idField).max(MAX_ASSIGNEES),
    reviewerId: idField.nullable(),
    deliverableId: idField.nullable(),
    requestId: idField.nullable(),
    priority: z.enum(PRIORITIES),
    status: z.enum(TASK_STATUSES),
    customStatusId: idField.nullable(),
    visibility: z.enum(TASK_VISIBILITIES),
    startDate: dateStr.nullable(),
    dueDate: dateStr.nullable(),
    estimatedHours: hours.nullable(),
    tags: tagList,
    blockOnDependencies: z.boolean(),
    archived: z.boolean(),
    customFields: fieldValues,
  })
  .partial()
  .strict();

const checklistCreateSchema = z.object({ text: z.string().trim().min(1).max(300) }).strict();
const checklistUpdateSchema = z.object({ text: z.string().trim().min(1).max(300), done: z.boolean() }).partial().strict();
const reorderSchema = z.object({ ids: z.array(idField).min(1).max(200) }).strict();
const commentSchema = z
  .object({
    comment: z.string().trim().min(1).max(2000),
    mentionIds: z.array(idField).max(10).optional(),
    attachmentIds: z.array(idField).max(10).optional(),
    clientVisible: z.boolean().optional(),
  })
  .strict();
const commentUpdateSchema = z.object({ comment: z.string().trim().min(1).max(2000), clientVisible: z.boolean() }).partial().strict();
const moveSchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    customStatusId: idField.nullish(),
    listId: idField.nullish(),
    parentId: idField.nullish(),
    beforeId: idField.nullish(), // the task that should come right AFTER the moved one
    afterId: idField.nullish(), // the task that should come right BEFORE the moved one
  })
  .strict();
const dependencySchema = z.object({ taskId: idField, type: z.enum(['BLOCKED_BY', 'BLOCKING', 'RELATED']) }).strict();
const recurrenceSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.number().int().min(1).max(365).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    monthDay: z.number().int().min(1).max(31).nullish(),
    endDate: dateStr.nullish(),
  })
  .strict();
const BULK_ACTIONS = ['status', 'priority', 'assign', 'unassign', 'dueDate', 'move', 'addTags', 'archive', 'unarchive', 'delete'] as const;
const bulkSchema = z
  .object({
    ids: z.array(idField).min(1).max(100),
    action: z.enum(BULK_ACTIONS),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeId: idField.optional(),
    dueDate: dateStr.nullable().optional(),
    listId: idField.nullable().optional(),
    tags: tagList.optional(),
  })
  .strict();

const MAX_CHECKLIST_ITEMS = 100;
const MAX_CALENDAR_DAYS = 100;
const MAX_DEPENDENCIES = 50;

// ───────────────────────── filters shared by the list, board, calendar, timeline and summary ─────────────────────────

function dateFilter(query: Request['query'], key: string): Date | undefined {
  const v = qs(query, key);
  if (v === undefined) return undefined;
  if (!isDateOnly(v)) throw Errors.validation({ [key]: 'invalid_date' });
  return parseDateOnly(v);
}

function rangeFilter(query: Request['query'], fromKey: string, toKey: string) {
  const from = dateFilter(query, fromKey);
  const to = dateFilter(query, toKey);
  if (from && to) {
    if (to < from) throw Errors.validation({ [toKey]: 'end_before_start' });
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_CALENDAR_DAYS) throw Errors.validation({ [toKey]: 'too_big' });
  }
  return { from, to: to ? endOfDayUtc(qs(query, toKey)!) : undefined };
}

/** Free-text search: title, description, assignee, client, project, campaign and tags. */
export const taskSearch = (q: string): Prisma.TaskWhereInput => ({
  OR: [
    { title: { contains: q } },
    { description: { contains: q } },
    { client: { is: { companyName: { contains: q } } } },
    { project: { is: { name: { contains: q } } } },
    { campaign: { is: { name: { contains: q } } } },
    { assignees: { some: { user: { name: { contains: q } } } } },
    { tagLinks: { some: { tag: { name: { contains: q } } } } },
  ],
});

function taskFilters(query: Request['query'], me: string, forceMine = false): Array<Prisma.TaskWhereInput | undefined> {
  const status = qsEnum(query, 'status', TASK_STATUSES);
  const priority = qsEnum(query, 'priority', PRIORITIES);
  const visibility = qsEnum(query, 'visibility', TASK_VISIBILITIES);
  const q = qs(query, 'q')?.slice(0, 80);
  const assignedToId = qs(query, 'assignedToId') ?? qs(query, 'assigneeId');
  const due = rangeFilter(query, 'dueFrom', 'dueTo');
  const start = rangeFilter(query, 'startFrom', 'startTo');
  const done = rangeFilter(query, 'completedFrom', 'completedTo');
  // calendar: "anyFrom/anyTo" = the task starts OR is due inside the range
  const any = rangeFilter(query, 'anyFrom', 'anyTo');
  const archived = qs(query, 'archived');
  return [
    archived === '1' ? { archivedAt: { not: null } } : archived === 'all' ? undefined : { archivedAt: null },
    status ? { status } : undefined,
    qs(query, 'statuses') ? { status: { in: qs(query, 'statuses')!.split(',').filter((s): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s)) } } : undefined,
    qs(query, 'open') === '1' ? { status: { not: 'DONE' } } : undefined,
    priority ? { priority } : undefined,
    qs(query, 'priorities') ? { priority: { in: qs(query, 'priorities')!.split(',').filter((s): s is Priority => (PRIORITIES as readonly string[]).includes(s)) } } : undefined,
    visibility ? { visibility } : undefined,
    qs(query, 'customStatusId') ? { customStatusId: qs(query, 'customStatusId') } : undefined,
    qs(query, 'projectId') ? { projectId: qs(query, 'projectId') } : undefined,
    qs(query, 'clientId') ? { clientId: qs(query, 'clientId') } : undefined,
    qs(query, 'campaignId') ? { campaignId: qs(query, 'campaignId') } : undefined,
    qs(query, 'listId') ? { listId: qs(query, 'listId') } : undefined,
    qs(query, 'folderId') ? { list: { is: { folderId: qs(query, 'folderId') } } } : undefined,
    qs(query, 'spaceId') ? { list: { is: { spaceId: qs(query, 'spaceId') } } } : undefined,
    qs(query, 'parentId') ? { parentId: qs(query, 'parentId') } : undefined,
    qs(query, 'topLevel') === '1' ? { parentId: null } : undefined,
    qs(query, 'tag') ? { tagLinks: { some: { tagId: qs(query, 'tag') } } } : undefined,
    qs(query, 'reviewerId') ? { reviewerId: qs(query, 'reviewerId') } : undefined,
    forceMine || qs(query, 'mine') === '1' ? assignedTo(me) : assignedToId ? assignedTo(assignedToId) : undefined,
    qs(query, 'unassigned') === '1' ? { assignedToId: null, assignees: { none: {} } } : undefined,
    due.from || due.to ? { dueDate: { ...(due.from ? { gte: due.from } : {}), ...(due.to ? { lte: due.to } : {}) } } : undefined,
    start.from || start.to ? { startDate: { ...(start.from ? { gte: start.from } : {}), ...(start.to ? { lte: start.to } : {}) } } : undefined,
    done.from || done.to ? { completedAt: { ...(done.from ? { gte: done.from } : {}), ...(done.to ? { lte: done.to } : {}) } } : undefined,
    any.from && any.to ? { OR: [{ dueDate: { gte: any.from, lte: any.to } }, { startDate: { gte: any.from, lte: any.to } }] } : undefined,
    qs(query, 'overdue') === '1' ? { dueDate: { lt: todayUtc() }, status: { not: 'DONE' } } : undefined,
    q ? taskSearch(q) : undefined,
  ];
}

const SORTS = ['dueDate', 'startDate', 'createdAt', 'updatedAt', 'title', 'priority', 'status', 'position'] as const;
type Sort = (typeof SORTS)[number];
type Row = TaskRow;

const PRIORITY_ORDER: Priority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
const STATUS_ORDER: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE'];

/**
 * One page across several ordered "buckets" (each a filter, fetched in order). This is how enum sorts (priority, status)
 * and "dated first, undated last" are paginated correctly in SQLite without loading everything.
 */
async function pageBuckets(buckets: Prisma.TaskWhereInput[], orderBy: Prisma.TaskOrderByWithRelationInput[], p: Paging) {
  const counts = await Promise.all(buckets.map((where) => prisma.task.count({ where })));
  const rows: Row[] = [];
  let offset = 0;
  for (let i = 0; i < buckets.length && rows.length < p.take; i++) {
    const n = counts[i];
    const start = Math.max(0, p.skip - offset);
    if (start < n) rows.push(...(await prisma.task.findMany({ where: buckets[i], include: taskInclude, orderBy, skip: start, take: p.take - rows.length })));
    offset += n;
  }
  return { total: counts.reduce((a, b) => a + b, 0), rows };
}

async function pageTasks(where: Prisma.TaskWhereInput, p: Paging, sort: Sort, dir: 'asc' | 'desc') {
  const tie: Prisma.TaskOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'asc' }];
  const w = (extra: Prisma.TaskWhereInput) => and<Prisma.TaskWhereInput>(where, extra);
  if (sort === 'priority') {
    const order = dir === 'asc' ? [...PRIORITY_ORDER].reverse() : PRIORITY_ORDER;
    return pageBuckets(order.map((priority) => w({ priority })), [{ dueDate: 'asc' }, ...tie], p);
  }
  if (sort === 'status') {
    const order = dir === 'desc' ? [...STATUS_ORDER].reverse() : STATUS_ORDER;
    return pageBuckets(order.map((status) => w({ status })), [{ position: 'asc' }, ...tie], p);
  }
  // SQLite sorts NULL first when ascending, which would bury dated tasks under undated ones: dated first, undated last
  if ((sort === 'dueDate' || sort === 'startDate') && dir === 'asc') {
    return pageBuckets([w({ [sort]: { not: null } }), w({ [sort]: null })], [{ [sort]: 'asc' } as Prisma.TaskOrderByWithRelationInput, ...tie], p);
  }
  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    sort === 'title' ? [{ title: dir }, ...tie] : sort === 'position' ? [{ position: dir }, { id: 'asc' }] : [{ [sort]: dir } as Prisma.TaskOrderByWithRelationInput, { id: 'asc' }];
  const [total, rows] = await Promise.all([prisma.task.count({ where }), prisma.task.findMany({ where, include: taskInclude, orderBy, skip: p.skip, take: p.take })]);
  return { total, rows };
}

// ───────────────────────── list / summary / overviews ─────────────────────────

tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const p = paging(req.query, 20);
    const sort = qsEnum(req.query, 'sort', SORTS) ?? 'dueDate';
    const dir = qs(req.query, 'dir') === 'desc' ? 'desc' : 'asc';
    const where = and<Prisma.TaskWhereInput>(taskWhere(scope), ...taskFilters(req.query, user.id));
    const { total, rows } = await pageTasks(where, p, sort, dir);
    res.json({ items: await loadTaskDtos(rows, scope), meta: pageMeta(p, total) });
  }),
);

// counts for the chips / dashboard: /tasks/summary?projectId=..&mine=1   and   /tasks/my (always the caller's own tasks)
tasksRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const filters = [
      qs(req.query, 'projectId') ? { projectId: qs(req.query, 'projectId') } : undefined,
      qs(req.query, 'clientId') ? { clientId: qs(req.query, 'clientId') } : undefined,
      qs(req.query, 'listId') ? { listId: qs(req.query, 'listId') } : undefined,
      qs(req.query, 'spaceId') ? { list: { is: { spaceId: qs(req.query, 'spaceId') } } } : undefined,
      qs(req.query, 'folderId') ? { list: { is: { folderId: qs(req.query, 'folderId') } } } : undefined,
      qs(req.query, 'mine') === '1' ? assignedTo(user.id) : undefined,
    ];
    res.json({ item: await taskSummary(scope, and<Prisma.TaskWhereInput>(...filters)) });
  }),
);

tasksRouter.get(
  '/my',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    res.json({ item: await taskSummary(scope, assignedTo(user.id)) });
  }),
);

/** Monday (UTC date) of the week containing today, shifted by the caller's zone offset (optional `tz`, minutes). */
function weekStart(query: Request['query']): Date {
  const tz = Math.max(-840, Math.min(840, parseInt(qs(query, 'tz') ?? '0', 10) || 0));
  const local = new Date(Date.now() + tz * 60_000);
  const key = local.toISOString().slice(0, 10);
  const dow = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
  return dateOnly(addDaysKey(key, -dow));
}

/** "My Tasks": the caller's own counts + the first rows of each bucket. */
tasksRouter.get(
  '/my-overview',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const today = todayUtc();
    const tomorrow = addDaysUtc(today, 1);
    const base = and<Prisma.TaskWhereInput>(taskWhere(scope), { archivedAt: null }, assignedTo(user.id));
    const open = (extra: Prisma.TaskWhereInput) => and<Prisma.TaskWhereInput>(base, { status: { not: 'DONE' } }, extra);
    const buckets = {
      overdue: open({ dueDate: { lt: today } }),
      dueToday: open({ dueDate: { gte: today, lt: tomorrow } }),
      upcoming: open({ dueDate: { gte: tomorrow, lt: addDaysUtc(today, 8) } }),
      highPriority: open({ priority: 'HIGH' }),
      urgent: open({ priority: 'URGENT' }),
      noDueDate: open({ dueDate: null }),
    };
    const week = weekStart(req.query);
    const completed = and<Prisma.TaskWhereInput>(base, { status: 'DONE', completedAt: { gte: week } });
    const take = Math.min(20, Math.max(1, parseInt(qs(req.query, 'take') ?? '8', 10) || 8));
    const order: Prisma.TaskOrderByWithRelationInput[] = [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }];
    const entries = Object.entries(buckets) as Array<[keyof typeof buckets, Prisma.TaskWhereInput]>;
    const [counts, rows, assigned, completedCount, completedRows] = await Promise.all([
      Promise.all(entries.map(([, where]) => prisma.task.count({ where }))),
      Promise.all(entries.map(([, where]) => prisma.task.findMany({ where, include: taskInclude, orderBy: order, take }))),
      prisma.task.count({ where: open({}) }),
      prisma.task.count({ where: completed }),
      prisma.task.findMany({ where: completed, include: taskInclude, orderBy: { completedAt: 'desc' }, take }),
    ]);
    const all = [...rows.flat(), ...completedRows];
    const meta = await loadTaskMeta([...new Set(all.map((r) => r.id))]);
    const dto = (r: Row) => taskDto(r, meta.get(r.id)!, scope, today);
    const lists = Object.fromEntries(entries.map(([k], i) => [k, rows[i].map(dto)]));
    res.json({
      counts: { assigned, completedThisWeek: completedCount, ...Object.fromEntries(entries.map(([k], i) => [k, counts[i]])) },
      lists: { ...lists, completed: completedRows.map(dto) },
      weekStart: keyOf(week),
    });
  }),
);

/** Team Tasks: counts grouped by assignee / project / client / status / list (team leads). */
const GROUPS = ['assignee', 'project', 'client', 'status', 'list'] as const;
tasksRouter.get(
  '/grouped',
  requirePerm('tasks.view_team'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const by = qsEnum(req.query, 'by', GROUPS) ?? 'assignee';
    const where = and<Prisma.TaskWhereInput>(taskWhere(scope), ...taskFilters(req.query, user.id));
    const today = todayUtc();
    const openW = and<Prisma.TaskWhereInput>(where, { status: { not: 'DONE' } });
    const overdueW = and<Prisma.TaskWhereInput>(where, { status: { not: 'DONE' }, dueDate: { lt: today } });
    const doneW = and<Prisma.TaskWhereInput>(where, { status: 'DONE' });
    type G = { key: string | null; label: string | null; total: number; open: number; overdue: number; done: number };
    const merge = (lists: Array<Array<{ key: string | null; n: number }>>) => {
      const m = new Map<string | null, G>();
      const names: Array<keyof G> = ['total', 'open', 'overdue', 'done'];
      lists.forEach((l, i) => l.forEach((r) => {
        const g = m.get(r.key) ?? { key: r.key, label: null, total: 0, open: 0, overdue: 0, done: 0 };
        (g[names[i]] as number) = r.n;
        m.set(r.key, g);
      }));
      return [...m.values()];
    };

    let groups: G[];
    if (by === 'assignee') {
      const q = (w: Prisma.TaskWhereInput) => prisma.taskAssignee.groupBy({ by: ['userId'], where: { task: w }, _count: { _all: true } }).then((r) => r.map((x) => ({ key: x.userId as string | null, n: x._count._all })));
      const un = (w: Prisma.TaskWhereInput) => prisma.task.count({ where: and<Prisma.TaskWhereInput>(w, { assignees: { none: {} }, assignedToId: null }) }).then((n) => (n ? [{ key: null, n }] : []));
      const lists = await Promise.all([where, openW, overdueW, doneW].map(async (w) => [...(await q(w)), ...(await un(w))]));
      groups = merge(lists);
      const users = await prisma.user.findMany({ where: { id: { in: groups.map((g) => g.key).filter((k): k is string => !!k) } }, select: { id: true, name: true } });
      const names = new Map(users.map((u) => [u.id, u.name]));
      groups.forEach((g) => { g.label = g.key ? (names.get(g.key) ?? null) : null; });
    } else {
      const field = ({ project: 'projectId', client: 'clientId', status: 'status', list: 'listId' } as const)[by];
      const q = (w: Prisma.TaskWhereInput) =>
        prisma.task.groupBy({ by: [field], where: w, _count: { _all: true } }).then((r) => r.map((x) => ({ key: (x as Record<string, unknown>)[field] as string | null, n: x._count._all })));
      groups = merge(await Promise.all([where, openW, overdueW, doneW].map(q)));
      const ids = groups.map((g) => g.key).filter((k): k is string => !!k);
      const labels =
        by === 'project' ? await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).then((r) => new Map(r.map((x) => [x.id, x.name])))
          : by === 'client' ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, companyName: true } }).then((r) => new Map(r.map((x) => [x.id, x.companyName])))
            : by === 'list' ? await prisma.taskList.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).then((r) => new Map(r.map((x) => [x.id, x.name])))
              : new Map(ids.map((s) => [s, s]));
      groups.forEach((g) => { g.label = g.key ? (labels.get(g.key) ?? null) : null; });
    }
    groups.sort((a, b) => (by === 'status' ? STATUS_ORDER.indexOf(a.key as TaskStatus) - STATUS_ORDER.indexOf(b.key as TaskStatus) : b.open - a.open || (a.label ?? '').localeCompare(b.label ?? '')));
    res.json({ by, groups });
  }),
);

/** Timeline (Gantt): tasks with a date inside the window + the dependencies between them. */
tasksRouter.get(
  '/timeline',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const from = dateFilter(req.query, 'from') ?? addDaysUtc(todayUtc(), -14);
    const to = dateFilter(req.query, 'to') ?? addDaysUtc(todayUtc(), 45);
    if (to < from) throw Errors.validation({ to: 'end_before_start' });
    if ((to.getTime() - from.getTime()) / 86_400_000 > 370) throw Errors.validation({ to: 'too_big' });
    const overlaps: Prisma.TaskWhereInput = {
      OR: [
        { startDate: { lte: to }, dueDate: { gte: from } },
        { startDate: null, dueDate: { gte: from, lte: to } },
        { dueDate: null, startDate: { gte: from, lte: to } },
      ],
    };
    const where = and<Prisma.TaskWhereInput>(taskWhere(scope), overlaps, ...taskFilters(req.query, user.id));
    const rows = await prisma.task.findMany({ where, include: taskInclude, orderBy: [{ startDate: 'asc' }, { dueDate: 'asc' }, { position: 'asc' }], take: 300 });
    const ids = rows.map((r) => r.id);
    const deps = ids.length ? await prisma.taskDependency.findMany({ where: { taskId: { in: ids }, dependsOnId: { in: ids }, type: 'BLOCKS' }, select: { id: true, taskId: true, dependsOnId: true } }) : [];
    res.json({ range: { from: keyOf(from), to: keyOf(to) }, items: await loadTaskDtos(rows, scope), dependencies: deps, truncated: rows.length === 300 });
  }),
);

// ───────────────────────── create ─────────────────────────

/** Validates and inserts one task on behalf of the caller (the create route and template application share it). */
async function createTaskFor(ctx: Ctx, body: z.infer<typeof createSchema>) {
  const links = await resolveTaskLinks(ctx.scope, body);
  if (links.parentId) {
    // adding a subtask is "working on" the parent
    const parent = await findTask(ctx.scope, links.parentId);
    if (!taskAccess(ctx.scope, parent).canWork) throw Errors.forbidden();
  }
  const work = await resolveWorkLinks(ctx.scope, links.clientId, body);

  const assignees = [...new Set([...(body.assigneeIds ?? []), ...(body.assignedToId ? [body.assignedToId] : [])])];
  if (assignees.length > MAX_ASSIGNEES) throw Errors.validation({ assigneeIds: 'too_big' });
  const field = body.assigneeIds ? 'assigneeIds' : 'assignedToId';
  for (const id of assignees) {
    if (id !== ctx.user.id && !ctx.scope.permissions.has('tasks.assign')) throw Errors.forbidden();
    await assertStaffForClient(id, links.clientId, links.campaignId, field); // yourself too: still an active account on this client
  }
  if (body.reviewerId) await assertStaffForClient(body.reviewerId, links.clientId, links.campaignId, 'reviewerId');
  if (body.startDate && body.dueDate && body.dueDate < body.startDate) throw Errors.validation({ dueDate: 'end_before_start' });
  if (body.visibility === 'CLIENT_VISIBLE' && !links.clientId) throw Errors.validation({ visibility: 'needs_client' });
  const st = await resolveCustomStatus(links.spaceId, { customStatusId: body.customStatusId, status: body.status });
  const values = body.customFields ? (await normalizeFieldValues(body.customFields, links.spaceId)).filter((v): v is { fieldId: string; value: string } => v.value !== null) : [];

  const id = await prisma.$transaction((tx) =>
    insertTask(tx, {
      title: body.title, description: body.description ?? null, priority: body.priority, status: st.status ?? body.status, customStatusId: st.customStatusId,
      startDate: body.startDate ?? null, dueDate: body.dueDate ?? null, estimatedHours: body.estimatedHours ?? null, visibility: body.visibility,
      links, deliverableId: work.deliverableId ?? null, requestId: work.requestId ?? null, reviewerId: body.reviewerId ?? null,
      assigneeIds: assignees, primaryAssigneeId: body.assignedToId ?? null, tagNames: body.tags ?? [], blockOnDependencies: body.blockOnDependencies ?? false,
      createdById: ctx.user.id, fieldValues: values,
    }),
  );
  await afterCreate(ctx, id);
  return id;
}

tasksRouter.post(
  '/',
  requirePerm('tasks.create'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const id = await createTaskFor(ctx, parse(createSchema, req.body));
    res.status(201).json({ item: await loadTaskDto(ctx.scope, id) });
  }),
);

// ───────────────────────── bulk ─────────────────────────

/** Bulk changes run the SAME rules as one change at a time: every task is looked up in scope and authorised individually. */
tasksRouter.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(bulkSchema, req.body);
    const need: Partial<Record<(typeof BULK_ACTIONS)[number], string>> = { status: 'status', priority: 'priority', assign: 'assigneeId', dueDate: 'dueDate', move: 'listId', addTags: 'tags' };
    const k = need[body.action];
    if (k && (body as Record<string, unknown>)[k] === undefined) throw Errors.validation({ [k]: 'required' });
    if (body.action === 'delete' && !ctx.scope.permissions.has('tasks.delete')) throw Errors.forbidden();

    const patch: TaskPatch =
      body.action === 'status' ? { status: body.status }
        : body.action === 'priority' ? { priority: body.priority }
          : body.action === 'assign' ? { addAssigneeIds: [body.assigneeId!] }
            : body.action === 'unassign' ? { assigneeIds: [] }
              : body.action === 'dueDate' ? { dueDate: body.dueDate ?? null }
                : body.action === 'move' ? { listId: body.listId ?? null }
                  : body.action === 'addTags' ? { addTags: body.tags }
                    : body.action === 'archive' ? { archived: true }
                      : body.action === 'unarchive' ? { archived: false }
                        : {};
    const updated: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const deleted = new Set<string>();
    for (const id of [...new Set(body.ids)]) {
      if (deleted.has(id)) continue;
      try {
        const t = await findTask(ctx.scope, id);
        if (body.action === 'delete') {
          await deleteTaskTree(ctx, t);
          deleted.add(id);
        } else await applyTaskPatch(ctx, t, patch);
        updated.push(id);
      } catch (err) {
        const e = err as { status?: number; code?: string; fields?: Record<string, string> };
        skipped.push({ id, reason: e.code === 'VALIDATION_ERROR' ? `VALIDATION_ERROR:${Object.values(e.fields ?? {})[0] ?? ''}` : (e.code ?? 'ERROR') });
      }
    }
    await audit(ctx, 'TASK_BULK_UPDATED', 'task', null, { action: body.action, updated: updated.length, skipped: skipped.length });
    res.json({ updated: updated.length, skipped });
  }),
);

// ───────────────────────── detail ─────────────────────────

const depTaskSelect = { id: true, title: true, status: true, dueDate: true, assignedTo: { select: { id: true, name: true } } } satisfies Prisma.TaskSelect;

tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const t = await findTask(scope, idParam(req));
    const visible = taskWhere(scope);
    const [meta, checklistItems, files, subRows, blockedBy, blocking, related, values, fields, ancestors, timeCount] = await Promise.all([
      loadTaskMeta([t.id]),
      prisma.taskChecklistItem.findMany({ where: { taskId: t.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      prisma.file.findMany({ where: and<Prisma.FileWhereInput>(fileWhere(scope), { taskId: t.id }), orderBy: { createdAt: 'desc' }, select: fileSelect }),
      prisma.task.findMany({ where: and<Prisma.TaskWhereInput>(visible, { parentId: t.id, archivedAt: null }), include: taskInclude, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 200 }),
      prisma.taskDependency.findMany({ where: { taskId: t.id, type: 'BLOCKS', dependsOn: visible }, select: { id: true, dependsOn: { select: depTaskSelect } } }),
      prisma.taskDependency.findMany({ where: { dependsOnId: t.id, type: 'BLOCKS', task: visible }, select: { id: true, task: { select: depTaskSelect } } }),
      prisma.taskDependency.findMany({ where: { type: 'RELATED', OR: [{ taskId: t.id, dependsOn: visible }, { dependsOnId: t.id, task: visible }] }, select: { id: true, taskId: true, task: { select: depTaskSelect }, dependsOn: { select: depTaskSelect } } }),
      prisma.taskCustomFieldValue.findMany({ where: { taskId: t.id }, select: { fieldId: true, value: true } }),
      prisma.taskCustomField.findMany({ where: { OR: [{ spaceId: null }, ...(t.list?.spaceId ? [{ spaceId: t.list.spaceId }] : [])] }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      ancestorsOf(t.parentId),
      prisma.timeEntry.count({ where: { taskId: t.id } }),
    ]);
    const subtasks = await loadTaskDtos(subRows, scope);
    res.json({
      item: {
        ...taskDto(t, meta.get(t.id)!, scope),
        checklistItems,
        files,
        subtasks,
        ancestors,
        dependencies: {
          blockedBy: blockedBy.map((d) => ({ id: d.id, task: d.dependsOn })),
          blocking: blocking.map((d) => ({ id: d.id, task: d.task })),
          related: related.map((d) => ({ id: d.id, task: d.taskId === t.id ? d.dependsOn : d.task })),
        },
        customFields: fields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: parseOptions(f.options), spaceId: f.spaceId, value: values.find((v) => v.fieldId === f.id)?.value ?? null })),
        time: { trackedHours: t.actualHours, estimatedHours: t.estimatedHours, entries: timeCount },
      },
    });
  }),
);

/** Parent chain (root first) for breadcrumbs. Titles only - the parents are in scope when the child is. */
async function ancestorsOf(parentId: string | null) {
  const out: Array<{ id: string; title: string }> = [];
  let cur = parentId;
  for (let i = 0; cur && i < 5; i++) {
    const p = await prisma.task.findUnique({ where: { id: cur }, select: { id: true, title: true, parentId: true } });
    if (!p) break;
    out.unshift({ id: p.id, title: p.title });
    cur = p.parentId;
  }
  return out;
}

/** Everything that happened to a task (the audit trail is the activity timeline). */
tasksRouter.get(
  '/:id/activity',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const t = await findTask(scope, idParam(req));
    const p = paging(req.query, 50, 100);
    const where: Prisma.AuditLogWhereInput = { entity: 'task', entityId: t.id };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take, include: { user: { select: { id: true, name: true, avatar: true } } } }),
    ]);
    res.json({
      items: rows.map((r) => ({ id: r.id, action: r.action, user: r.user, createdAt: r.createdAt, metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null })),
      meta: pageMeta(p, total),
    });
  }),
);

// ───────────────────────── update ─────────────────────────

tasksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findTask(ctx.scope, idParam(req));
    const body = parse(updateSchema, req.body);
    await applyTaskPatch(ctx, existing, body);
    res.json({ item: await loadTaskDto(ctx.scope, existing.id) });
  }),
);

/** Drag & drop: change status / list / parent and/or the position between two neighbours, persisted server-side. */
tasksRouter.post(
  '/:id/move',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findTask(ctx.scope, idParam(req));
    const body = parse(moveSchema, req.body);
    if (!taskAccess(ctx.scope, existing).canWork) throw Errors.forbidden();
    const patch: TaskPatch = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.customStatusId !== undefined) patch.customStatusId = body.customStatusId;
    if (body.listId !== undefined) patch.listId = body.listId;
    if (body.parentId !== undefined) patch.parentId = body.parentId;
    if (Object.keys(patch).length) await applyTaskPatch(ctx, existing, patch);

    if (body.beforeId !== undefined || body.afterId !== undefined) {
      const neighbour = async (id: string | null | undefined) =>
        id ? prisma.task.findFirst({ where: and<Prisma.TaskWhereInput>({ id }, taskWhere(ctx.scope)), select: { position: true } }) : null;
      const [before, after] = await Promise.all([neighbour(body.beforeId), neighbour(body.afterId)]);
      let position: number;
      if (before && after) position = (before.position + after.position) / 2;
      else if (after) position = after.position + 1;
      else if (before) position = before.position - 1;
      else position = Date.now() / 1000;
      await prisma.task.update({ where: { id: existing.id }, data: { position } });
      // neighbours got too close after many moves: spread that container out again
      if (before && after && Math.abs(before.position - after.position) < 1e-6) {
        const siblings = await prisma.task.findMany({ where: { listId: existing.listId, parentId: existing.parentId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true }, take: 2000 });
        await prisma.$transaction(siblings.map((s, i) => prisma.task.update({ where: { id: s.id }, data: { position: i } })));
      }
    }
    res.json({ item: await loadTaskDto(ctx.scope, existing.id) });
  }),
);

// ───────────────────────── delete ─────────────────────────

tasksRouter.delete(
  '/:id',
  requirePerm('tasks.delete'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findTask(ctx.scope, idParam(req));
    await deleteTaskTree(ctx, existing);
    res.json({ ok: true });
  }),
);

// ───────────────────────── subtasks ─────────────────────────

/** Looks the task up in scope and proves the caller may work on it (assignee / reviewer / creator / tasks.edit_all). */
async function workableTask(ctx: Ctx, id: string) {
  const t = await findTask(ctx.scope, id);
  if (!taskAccess(ctx.scope, t).canWork) throw Errors.forbidden();
  return t;
}

tasksRouter.put(
  '/:id/subtasks/reorder',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await workableTask(ctx, idParam(req));
    const { ids } = parse(reorderSchema, req.body);
    const current = await prisma.task.findMany({ where: { parentId: t.id, archivedAt: null }, select: { id: true } });
    const same = ids.length === current.length && new Set(ids).size === ids.length && current.every((i) => ids.includes(i.id));
    if (!same) throw Errors.validation({ ids: 'invalid_choice' });
    await prisma.$transaction(ids.map((sid, position) => prisma.task.update({ where: { id: sid }, data: { position } })));
    res.json({ ok: true });
  }),
);

// ───────────────────────── dependencies ─────────────────────────

/** Would "task is blocked by blocker" close a loop? (walks the blockers of `blocker` looking for `task`) */
async function createsCycle(task: string, blocker: string): Promise<boolean> {
  const seen = new Set<string>();
  let frontier = [blocker];
  while (frontier.length && seen.size < 2000) {
    if (frontier.includes(task)) return true;
    frontier.forEach((f) => seen.add(f));
    const next = await prisma.taskDependency.findMany({ where: { taskId: { in: frontier }, type: 'BLOCKS' }, select: { dependsOnId: true } });
    frontier = [...new Set(next.map((n) => n.dependsOnId))].filter((id) => !seen.has(id));
  }
  return false;
}

tasksRouter.post(
  '/:id/dependencies',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await workableTask(ctx, idParam(req));
    const body = parse(dependencySchema, req.body);
    if (body.taskId === t.id) throw Errors.validation({ taskId: 'invalid_choice' });
    const other = await prisma.task.findFirst({ where: and<Prisma.TaskWhereInput>({ id: body.taskId }, taskWhere(ctx.scope)), select: { id: true, title: true } });
    if (!other) throw Errors.validation({ taskId: 'invalid_choice' });
    const count = await prisma.taskDependency.count({ where: { OR: [{ taskId: t.id }, { dependsOnId: t.id }] } });
    if (count >= MAX_DEPENDENCIES) throw Errors.validation({ taskId: 'too_big' });
    const [taskId, dependsOnId] = body.type === 'BLOCKING' ? [other.id, t.id] : [t.id, other.id];
    const type = body.type === 'RELATED' ? 'RELATED' : 'BLOCKS';
    const exists = await prisma.taskDependency.findFirst({ where: { OR: [{ taskId, dependsOnId }, { taskId: dependsOnId, dependsOnId: taskId }] }, select: { id: true } });
    if (exists) throw Errors.conflict('DEPENDENCY_EXISTS', 'These tasks are already linked.');
    if (type === 'BLOCKS' && (await createsCycle(taskId, dependsOnId))) throw Errors.conflict('DEPENDENCY_CYCLE', 'This would create a circular dependency.');
    const dep = await prisma.taskDependency.create({ data: { taskId, dependsOnId, type, createdById: ctx.user.id } });
    await audit(ctx, 'TASK_DEPENDENCY_ADDED', 'task', t.id, { title: t.title, status: t.status, type: body.type, other: other.title, otherId: other.id }, taskAuditOpts(t));
    res.status(201).json({ item: { id: dep.id, taskId, dependsOnId, type } });
  }),
);

tasksRouter.delete(
  '/:id/dependencies/:depId',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await workableTask(ctx, idParam(req));
    const dep = await prisma.taskDependency.findFirst({
      where: { id: idParam(req, 'depId'), OR: [{ taskId: t.id }, { dependsOnId: t.id }] },
      include: { task: { select: { id: true, title: true } }, dependsOn: { select: { id: true, title: true } } },
    });
    if (!dep) throw Errors.notFound();
    await prisma.taskDependency.delete({ where: { id: dep.id } });
    const other = dep.taskId === t.id ? dep.dependsOn : dep.task;
    await audit(ctx, 'TASK_DEPENDENCY_REMOVED', 'task', t.id, { title: t.title, status: t.status, type: dep.type, other: other.title, otherId: other.id }, taskAuditOpts(t));
    res.json({ ok: true });
  }),
);

// ───────────────────────── recurrence ─────────────────────────

tasksRouter.put(
  '/:id/recurrence',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findTask(ctx.scope, idParam(req));
    if (!taskAccess(ctx.scope, t).canEditFields) throw Errors.forbidden();
    const body = parse(recurrenceSchema, req.body);
    if (body.frequency === 'WEEKLY' && !body.weekdays?.length) throw Errors.validation({ weekdays: 'required' });
    const rule = {
      frequency: body.frequency,
      interval: body.frequency === 'DAILY' ? Math.max(1, body.interval) : body.interval,
      weekdays: body.frequency === 'WEEKLY' ? [...new Set(body.weekdays)].sort().join(',') : null,
      monthDay: body.frequency === 'MONTHLY' ? (body.monthDay ?? (t.dueDate ?? todayUtc()).getUTCDate()) : null,
    };
    // the task itself covers its own due date; the series continues after it (or starts today when undated)
    const next = t.dueDate ? nextOccurrence(rule, keyOf(t.dueDate)) : firstOccurrence(rule, keyOf(todayUtc()));
    if (body.endDate && keyOf(body.endDate) < next) throw Errors.validation({ endDate: 'end_before_start' });
    const data = { ...rule, nextDate: dateOnly(next), endDate: body.endDate ?? null, active: true };
    await prisma.taskRecurrence.upsert({ where: { taskId: t.id }, create: { taskId: t.id, ...data }, update: data });
    await audit(ctx, 'TASK_RECURRENCE_SET', 'task', t.id, { title: t.title, status: t.status, frequency: rule.frequency, interval: rule.interval, next }, taskAuditOpts(t));
    res.json({ item: await loadTaskDto(ctx.scope, t.id) });
  }),
);

tasksRouter.delete(
  '/:id/recurrence',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findTask(ctx.scope, idParam(req));
    if (!taskAccess(ctx.scope, t).canEditFields) throw Errors.forbidden();
    const n = await prisma.taskRecurrence.deleteMany({ where: { taskId: t.id } });
    if (n.count) await audit(ctx, 'TASK_RECURRENCE_REMOVED', 'task', t.id, { title: t.title, status: t.status }, taskAuditOpts(t));
    res.json({ item: await loadTaskDto(ctx.scope, t.id) });
  }),
);

// ───────────────────────── checklist ─────────────────────────

async function checklistItem(taskId: string, itemId: string) {
  const item = await prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId } });
  if (!item) throw Errors.notFound();
  return item;
}

const checklistAudit = (ctx: Ctx, t: { id: string; title: string; status: TaskStatus; clientId: string | null; projectId: string | null }, change: string) =>
  audit(ctx, 'TASK_UPDATED', 'task', t.id, { title: t.title, status: t.status, fields: ['checklist'], change }, taskAuditOpts(t));

tasksRouter.post(
  '/:id/checklist',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await workableTask(ctx, idParam(req));
    const body = parse(checklistCreateSchema, req.body);
    const agg = await prisma.taskChecklistItem.aggregate({ where: { taskId: t.id }, _max: { position: true }, _count: { _all: true } });
    if (agg._count._all >= MAX_CHECKLIST_ITEMS) throw Errors.validation({ text: 'too_big' });
    const item = await prisma.taskChecklistItem.create({ data: { taskId: t.id, text: body.text, position: (agg._max.position ?? -1) + 1 } });
    await checklistAudit(ctx, t, 'added');
    res.status(201).json({ item });
  }),
);

// declared before /:itemId so "reorder" is never read as an item id
tasksRouter.put(
  '/:id/checklist/reorder',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await workableTask(ctx, idParam(req));
    const { ids } = parse(reorderSchema, req.body);
    const current = await prisma.taskChecklistItem.findMany({ where: { taskId: t.id }, select: { id: true } });
    const same = ids.length === current.length && new Set(ids).size === ids.length && current.every((i) => ids.includes(i.id));
    if (!same) throw Errors.validation({ ids: 'invalid_choice' });
    await prisma.$transaction(ids.map((iid, position) => prisma.taskChecklistItem.update({ where: { id: iid }, data: { position } })));
    await checklistAudit(ctx, t, 'reordered');
    res.json({ items: await prisma.taskChecklistItem.findMany({ where: { taskId: t.id }, orderBy: { position: 'asc' } }) });
  }),
);

tasksRouter.patch(
  '/:id/checklist/:itemId',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await workableTask(ctx, idParam(req));
    const existing = await checklistItem(t.id, idParam(req, 'itemId'));
    const body = parse(checklistUpdateSchema, req.body);
    const data: Prisma.TaskChecklistItemUpdateInput = {};
    if (body.text !== undefined) data.text = body.text;
    if (body.done !== undefined && body.done !== existing.done) {
      data.done = body.done;
      data.completedAt = body.done ? new Date() : null;
    }
    const item = await prisma.taskChecklistItem.update({ where: { id: existing.id }, data });
    await checklistAudit(ctx, t, body.done !== undefined && body.done !== existing.done ? (body.done ? 'checked' : 'unchecked') : 'edited');
    res.json({ item });
  }),
);

tasksRouter.delete(
  '/:id/checklist/:itemId',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await workableTask(ctx, idParam(req));
    const existing = await checklistItem(t.id, idParam(req, 'itemId'));
    await prisma.taskChecklistItem.delete({ where: { id: existing.id } });
    await checklistAudit(ctx, t, 'removed');
    res.json({ ok: true });
  }),
);

// ───────────────────────── comments ─────────────────────────

const commentInclude = { user: { select: { id: true, name: true, avatar: true, role: true } } } satisfies Prisma.TaskCommentInclude;
type CommentRow = Prisma.TaskCommentGetPayload<{ include: typeof commentInclude }>;

const jsonIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

async function commentDtos(rows: CommentRow[], scope: Ctx['scope'], me: string) {
  const fileIds = [...new Set(rows.flatMap((r) => jsonIds(r.attachmentIds)))];
  const mentionIds = [...new Set(rows.flatMap((r) => jsonIds(r.mentions)))];
  const [files, users] = await Promise.all([
    fileIds.length ? prisma.file.findMany({ where: and<Prisma.FileWhereInput>(fileWhere(scope), { id: { in: fileIds } }), select: fileSelect }) : [],
    mentionIds.length ? prisma.user.findMany({ where: { id: { in: mentionIds } }, select: { id: true, name: true } }) : [],
  ]);
  const fileBy = new Map(files.map((f) => [f.id, f]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  return rows.map((c) => ({
    id: c.id, taskId: c.taskId, userId: c.userId, comment: c.comment, createdAt: c.createdAt, editedAt: c.editedAt, authorType: c.authorType, clientVisible: c.clientVisible, user: c.user,
    mentions: jsonIds(c.mentions).map((id) => userBy.get(id)).filter(Boolean),
    attachments: jsonIds(c.attachmentIds).map((id) => fileBy.get(id)).filter(Boolean),
    permissions: { canEdit: c.userId === me, canDelete: c.userId === me || scope.role === 'ADMIN' },
  }));
}

tasksRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const t = await findTask(scope, idParam(req));
    const items = await prisma.taskComment.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' }, take: 500, include: commentInclude });
    res.json({ items: await commentDtos(items, scope, user.id) });
  }),
);

/** Staff users who can see the task (mentions may only reach people who are allowed to read it). */
async function usersWhoCanSee(taskId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, role: true, clientId: true, permissions: true } });
  const ok: string[] = [];
  for (const u of users) {
    const s = await loadScope(u);
    if (!s.permissions.has('tasks.view')) continue;
    if (await prisma.task.findFirst({ where: and<Prisma.TaskWhereInput>({ id: taskId }, taskWhere(s)), select: { id: true } })) ok.push(u.id);
  }
  return ok;
}

tasksRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findTask(ctx.scope, idParam(req)); // anyone who can see the task may join the discussion
    const body = parse(commentSchema, req.body);
    if (body.clientVisible && t.visibility !== 'CLIENT_VISIBLE') throw Errors.validation({ clientVisible: 'task_not_shared' });
    const mentions = await usersWhoCanSee(t.id, [...new Set(body.mentionIds ?? [])].filter((id) => id !== ctx.user.id));
    if ((body.mentionIds?.length ?? 0) > 0 && mentions.length !== new Set(body.mentionIds!.filter((id) => id !== ctx.user.id)).size) throw Errors.validation({ mentionIds: 'invalid_choice' });
    const attachmentIds = [...new Set(body.attachmentIds ?? [])];
    if (attachmentIds.length) {
      const n = await prisma.file.count({ where: { id: { in: attachmentIds }, taskId: t.id } });
      if (n !== attachmentIds.length) throw Errors.validation({ attachmentIds: 'invalid_choice' });
    }
    // the author always comes from the session
    const item = await prisma.taskComment.create({
      data: {
        taskId: t.id, userId: ctx.user.id, comment: body.comment, authorType: 'TEAM', clientVisible: !!body.clientVisible,
        mentions: mentions.length ? JSON.stringify(mentions) : null, attachmentIds: attachmentIds.length ? JSON.stringify(attachmentIds) : null,
      },
      include: commentInclude,
    });
    await audit(ctx, 'COMMENT_CREATED', 'task', t.id, { title: t.title, status: t.status }, taskAuditOpts(t));
    const recipients = [...assigneeIdsOf(t), t.createdById].filter((id): id is string => !!id && !mentions.includes(id));
    await notify(recipients, { type: 'TASK_COMMENT', entity: 'task', entityId: t.id, data: { title: t.title, by: ctx.user.name } }, ctx.user.id);
    if (mentions.length) await notify(mentions, { type: 'TASK_MENTION', entity: 'task', entityId: t.id, data: { title: t.title, by: ctx.user.name } }, ctx.user.id);
    if (item.clientVisible && t.clientId) await notify(await clientRecipients(t.clientId), { type: 'TASK_COMMENT', entity: 'task', entityId: t.id, data: { title: t.title, by: ctx.user.name } }, ctx.user.id);
    res.status(201).json({ item: (await commentDtos([item], ctx.scope, ctx.user.id))[0] });
  }),
);

async function ownComment(ctx: Ctx, taskId: string, commentId: string) {
  const c = await prisma.taskComment.findFirst({ where: { id: commentId, taskId }, include: commentInclude });
  if (!c) throw Errors.notFound();
  return c;
}

tasksRouter.patch(
  '/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findTask(ctx.scope, idParam(req));
    const c = await ownComment(ctx, t.id, idParam(req, 'commentId'));
    if (c.userId !== ctx.user.id) throw Errors.forbidden(); // only the author edits their words
    const body = parse(commentUpdateSchema, req.body);
    if (body.clientVisible && t.visibility !== 'CLIENT_VISIBLE') throw Errors.validation({ clientVisible: 'task_not_shared' });
    const item = await prisma.taskComment.update({
      where: { id: c.id },
      data: { ...(body.comment !== undefined ? { comment: body.comment, editedAt: new Date() } : {}), ...(body.clientVisible !== undefined ? { clientVisible: body.clientVisible } : {}) },
      include: commentInclude,
    });
    await audit(ctx, 'COMMENT_UPDATED', 'task', t.id, { title: t.title, status: t.status, commentId: c.id }, taskAuditOpts(t));
    res.json({ item: (await commentDtos([item], ctx.scope, ctx.user.id))[0] });
  }),
);

tasksRouter.delete(
  '/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findTask(ctx.scope, idParam(req));
    const c = await ownComment(ctx, t.id, idParam(req, 'commentId'));
    if (c.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden();
    await prisma.taskComment.delete({ where: { id: c.id } });
    await audit(ctx, 'COMMENT_DELETED', 'task', t.id, { title: t.title, status: t.status, commentId: c.id }, taskAuditOpts(t));
    res.json({ ok: true });
  }),
);

export { createTaskFor, createSchema as taskCreateSchema };
