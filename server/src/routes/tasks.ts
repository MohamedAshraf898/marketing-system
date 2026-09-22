// Owner: Projects & tasks group.  tasksRouter -> /tasks
// Tasks are INTERNAL agency work. Every route needs a staff permission (CLIENT users hold none => 403) and every query
// goes through taskWhere(scope), which matches nothing for a CLIENT (defence in depth).
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PRIORITIES, TASK_STATUSES, type TaskStatus } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { fileWhere, taskWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum, type Paging } from '../lib/http';
import { storage } from '../storage';
import { audit } from '../services/audit';
import { notify } from '../services/notifications';
import { assertStaffForClient, round2, todayUtc } from '../services/projects';
import { and, fileSelect } from '../services/serializers';
import { findTask, loadChecklistProgress, loadTaskDto, loadTaskDtos, resolveTaskLinks, taskAccess, taskInclude, taskSummary, taskDto } from '../services/tasks';

export const tasksRouter = Router();
tasksRouter.use(authenticate, requirePerm('tasks.view'));

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);
const text = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v));
const hours = z.number().min(0).max(10_000).transform(round2);

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: text(5000).nullish(),
    projectId: z.string().min(1).nullish(),
    clientId: z.string().min(1).nullish(),
    campaignId: z.string().min(1).nullish(),
    assignedToId: z.string().min(1).nullish(),
    priority: z.enum(PRIORITIES).default('NORMAL'),
    status: z.enum(TASK_STATUSES).default('TODO'),
    dueDate: dateStr.nullish(),
    estimatedHours: hours.nullish(),
  })
  .strict();

// actualHours is NOT here on purpose: it is only ever derived from time entries
const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: text(5000).nullable(),
    projectId: z.string().min(1).nullable(),
    campaignId: z.string().min(1).nullable(),
    assignedToId: z.string().min(1).nullable(),
    priority: z.enum(PRIORITIES),
    status: z.enum(TASK_STATUSES),
    dueDate: dateStr.nullable(),
    estimatedHours: hours.nullable(),
  })
  .partial()
  .strict();

/** Fields that need `tasks.edit_all` or being the creator. */
const PLANNING_FIELDS = ['title', 'priority', 'dueDate', 'assignedToId', 'projectId', 'campaignId', 'estimatedHours'] as const;

const checklistCreateSchema = z.object({ text: z.string().trim().min(1).max(300) }).strict();
const checklistUpdateSchema = z.object({ text: z.string().trim().min(1).max(300), done: z.boolean() }).partial().strict();
const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }).strict();
const commentSchema = z.object({ comment: z.string().trim().min(1).max(2000) }).strict();

const MAX_CHECKLIST_ITEMS = 100;
const MAX_CALENDAR_DAYS = 100;

const auditOpts = (t: { clientId: string | null; projectId: string | null }) => ({ clientId: t.clientId, projectId: t.projectId, clientVisible: false });

// ───────────────────────── filters shared by the list and the summary ─────────────────────────

function dateFilter(query: Parameters<typeof qs>[0], key: string): Date | undefined {
  const v = qs(query, key);
  if (v === undefined) return undefined;
  if (!isDateOnly(v)) throw Errors.validation({ [key]: 'invalid_date' });
  return parseDateOnly(v);
}

function taskFilters(query: Parameters<typeof qs>[0], me: string, forceMine = false): Array<Prisma.TaskWhereInput | undefined> {
  const status = qsEnum(query, 'status', TASK_STATUSES);
  const priority = qsEnum(query, 'priority', PRIORITIES);
  const q = qs(query, 'q');
  const assignedToId = qs(query, 'assignedToId');
  const from = dateFilter(query, 'dueFrom');
  const to = dateFilter(query, 'dueTo');
  if (from && to) {
    if (to < from) throw Errors.validation({ dueTo: 'end_before_start' });
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_CALENDAR_DAYS) throw Errors.validation({ dueTo: 'too_big' });
  }
  const toEnd = to ? endOfDayUtc(qs(query, 'dueTo')!) : undefined;
  return [
    status ? { status } : undefined,
    priority ? { priority } : undefined,
    qs(query, 'projectId') ? { projectId: qs(query, 'projectId') } : undefined,
    qs(query, 'clientId') ? { clientId: qs(query, 'clientId') } : undefined,
    qs(query, 'campaignId') ? { campaignId: qs(query, 'campaignId') } : undefined,
    forceMine || qs(query, 'mine') === '1' ? { assignedToId: me } : assignedToId ? { assignedToId } : undefined,
    qs(query, 'unassigned') === '1' ? { assignedToId: null } : undefined,
    from || toEnd ? { dueDate: { ...(from ? { gte: from } : {}), ...(toEnd ? { lte: toEnd } : {}) } } : undefined,
    qs(query, 'overdue') === '1' ? { dueDate: { lt: todayUtc() }, status: { not: 'DONE' } } : undefined,
    q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : undefined,
  ];
}

const SORTS = ['dueDate', 'createdAt', 'updatedAt', 'title'] as const;

/**
 * Pages through tasks. SQLite sorts NULL first when ascending, which would bury "My tasks" under undated ones, so an
 * ascending due-date sort is done as two ranges (dated first, undated last) and stitched into one page.
 */
async function pageTasks(where: Prisma.TaskWhereInput, p: Paging, sort: (typeof SORTS)[number], dir: 'asc' | 'desc') {
  const tie: Prisma.TaskOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'asc' }];
  if (sort !== 'dueDate' || dir === 'desc') {
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = sort === 'dueDate' ? [{ dueDate: 'desc' }, ...tie] : sort === 'title' ? [{ title: dir }, ...tie] : [{ [sort]: dir } as Prisma.TaskOrderByWithRelationInput, { id: 'asc' }];
    const [total, rows] = await Promise.all([prisma.task.count({ where }), prisma.task.findMany({ where, include: taskInclude, orderBy, skip: p.skip, take: p.take })]);
    return { total, rows };
  }
  const dated = and<Prisma.TaskWhereInput>(where, { dueDate: { not: null } });
  const undated = and<Prisma.TaskWhereInput>(where, { dueDate: null });
  const [nDated, nUndated] = await Promise.all([prisma.task.count({ where: dated }), prisma.task.count({ where: undated })]);
  const rows: Awaited<ReturnType<typeof prisma.task.findMany<{ include: typeof taskInclude }>>> = [];
  if (p.skip < nDated) rows.push(...(await prisma.task.findMany({ where: dated, include: taskInclude, orderBy: [{ dueDate: 'asc' }, ...tie], skip: p.skip, take: p.take })));
  const remaining = p.take - rows.length;
  if (remaining > 0 && nUndated > 0) {
    rows.push(...(await prisma.task.findMany({ where: undated, include: taskInclude, orderBy: tie, skip: Math.max(0, p.skip - nDated), take: remaining })));
  }
  return { total: nDated + nUndated, rows };
}

// ───────────────────────── list / summary ─────────────────────────

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
      qs(req.query, 'mine') === '1' ? { assignedToId: user.id } : undefined,
    ];
    res.json({ item: await taskSummary(scope, and<Prisma.TaskWhereInput>(...filters)) });
  }),
);

tasksRouter.get(
  '/my',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    res.json({ item: await taskSummary(scope, { assignedToId: user.id }) });
  }),
);

// ───────────────────────── create ─────────────────────────

tasksRouter.post(
  '/',
  requirePerm('tasks.create'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    const links = await resolveTaskLinks(ctx.scope, body);

    const assigneeId = body.assignedToId ?? null;
    if (assigneeId && assigneeId !== ctx.user.id) {
      if (!ctx.scope.permissions.has('tasks.assign')) throw Errors.forbidden();
      await assertStaffForClient(assigneeId, links.clientId, links.campaignId, 'assignedToId');
    } else if (assigneeId) {
      await assertStaffForClient(assigneeId, links.clientId, links.campaignId, 'assignedToId'); // yourself, but still an active account
    }

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        projectId: links.projectId,
        clientId: links.clientId,
        campaignId: links.campaignId,
        assignedToId: assigneeId,
        createdById: ctx.user.id,
        priority: body.priority,
        status: body.status,
        dueDate: body.dueDate ?? null,
        completedAt: body.status === 'DONE' ? new Date() : null,
        estimatedHours: body.estimatedHours ?? null,
      },
    });
    await audit(ctx, 'TASK_CREATED', 'task', task.id, { title: task.title, status: task.status }, auditOpts(task));
    if (assigneeId) {
      await audit(ctx, 'TASK_ASSIGNED', 'task', task.id, { title: task.title, status: task.status, assigneeId }, auditOpts(task));
      await notify([assigneeId], { type: 'TASK_ASSIGNED', entity: 'task', entityId: task.id, data: { title: task.title, by: ctx.user.name } }, ctx.user.id);
    }
    res.status(201).json({ item: await loadTaskDto(ctx.scope, task.id) });
  }),
);

// ───────────────────────── detail ─────────────────────────

tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const t = await findTask(scope, idParam(req));
    const [progress, checklistItems, files] = await Promise.all([
      loadChecklistProgress([t.id]),
      prisma.taskChecklistItem.findMany({ where: { taskId: t.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      prisma.file.findMany({ where: and<Prisma.FileWhereInput>(fileWhere(scope), { taskId: t.id }), orderBy: { createdAt: 'desc' }, select: fileSelect }),
    ]);
    res.json({ item: { ...taskDto(t, progress.get(t.id)!, scope), checklistItems, files } });
  }),
);

// ───────────────────────── update ─────────────────────────

tasksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findTask(ctx.scope, idParam(req));
    const body = parse(updateSchema, req.body);
    const access = taskAccess(ctx.scope, existing);
    if (!access.canWork) throw Errors.forbidden();
    if (PLANNING_FIELDS.some((k) => k in body) && !access.canEditFields) throw Errors.forbidden();

    const links = { clientId: existing.clientId, projectId: existing.projectId, campaignId: existing.campaignId };
    if ('projectId' in body) {
      if (body.projectId) {
        const r = await resolveTaskLinks(ctx.scope, { projectId: body.projectId });
        if (existing.clientId && r.clientId !== existing.clientId) throw Errors.validation({ projectId: 'invalid_choice' });
        links.projectId = r.projectId;
        links.clientId = r.clientId;
      } else links.projectId = null;
    }
    if ('campaignId' in body) {
      if (body.campaignId) {
        const r = await resolveTaskLinks(ctx.scope, { campaignId: body.campaignId });
        if (links.clientId && r.clientId !== links.clientId) throw Errors.validation({ campaignId: 'invalid_choice' });
        links.campaignId = r.campaignId;
        links.clientId = r.clientId;
      } else links.campaignId = null;
    }

    const assigneeChanged = 'assignedToId' in body && (body.assignedToId ?? null) !== existing.assignedToId;
    if (assigneeChanged && body.assignedToId) {
      if (body.assignedToId !== ctx.user.id && !access.canAssign) throw Errors.forbidden();
      await assertStaffForClient(body.assignedToId, links.clientId, links.campaignId, 'assignedToId');
    }

    const data: Prisma.TaskUncheckedUpdateInput = { ...body, ...links };
    const statusChanged = body.status !== undefined && body.status !== existing.status;
    if (statusChanged) data.completedAt = body.status === 'DONE' ? new Date() : null;
    await prisma.task.update({ where: { id: existing.id }, data });

    const opts = auditOpts(links);
    const now: TaskStatus = body.status ?? existing.status;
    const title = body.title ?? existing.title;
    const otherFields = Object.keys(body).filter((k) => k !== 'status' && k !== 'assignedToId');
    if (otherFields.length > 0) await audit(ctx, 'TASK_UPDATED', 'task', existing.id, { title, status: now, fields: otherFields }, opts);
    if (statusChanged) {
      await audit(ctx, 'TASK_STATUS_CHANGED', 'task', existing.id, { title, status: now, from: existing.status, to: now }, opts);
      if (now === 'DONE') await audit(ctx, 'TASK_COMPLETED', 'task', existing.id, { title, status: now }, opts);
    }
    if (assigneeChanged) {
      await audit(ctx, 'TASK_ASSIGNED', 'task', existing.id, { title, status: now, assigneeId: body.assignedToId ?? null }, opts);
      if (body.assignedToId) await notify([body.assignedToId], { type: 'TASK_ASSIGNED', entity: 'task', entityId: existing.id, data: { title, by: ctx.user.name } }, ctx.user.id);
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
    const id = existing.id;
    const files = await prisma.file.findMany({ where: { taskId: id }, select: { id: true, filePath: true } });
    // Time entries keep the hours already logged (they just lose the task link); checklist + comments go with the task;
    // task attachments are internal to the task and are removed with it.
    await prisma.$transaction([
      prisma.timeEntry.updateMany({ where: { taskId: id }, data: { taskId: null } }),
      prisma.file.deleteMany({ where: { taskId: id } }),
      prisma.taskComment.deleteMany({ where: { taskId: id } }),
      prisma.taskChecklistItem.deleteMany({ where: { taskId: id } }),
      prisma.task.delete({ where: { id } }),
    ]);
    await Promise.all(files.map((f) => storage.delete(f.filePath).catch(() => undefined)));
    await audit(ctx, 'TASK_DELETED', 'task', id, { title: existing.title, status: existing.status }, auditOpts(existing));
    res.json({ ok: true });
  }),
);

// ───────────────────────── checklist ─────────────────────────

/** Looks the task up in scope and proves the caller may work on it (assignee / creator / tasks.edit_all). */
async function workableTask(ctx: Ctx, id: string) {
  const t = await findTask(ctx.scope, id);
  if (!taskAccess(ctx.scope, t).canWork) throw Errors.forbidden();
  return t;
}

async function checklistItem(taskId: string, itemId: string) {
  const item = await prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId } });
  if (!item) throw Errors.notFound();
  return item;
}

const checklistAudit = (ctx: Ctx, t: { id: string; title: string; status: TaskStatus; clientId: string | null; projectId: string | null }, change: string) =>
  audit(ctx, 'TASK_UPDATED', 'task', t.id, { title: t.title, status: t.status, fields: ['checklist'], change }, auditOpts(t));

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

// ───────────────────────── comments (internal discussion, staff only) ─────────────────────────

tasksRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const t = await findTask(scope, idParam(req));
    const items = await prisma.taskComment.findMany({
      where: { taskId: t.id },
      orderBy: { createdAt: 'asc' },
      take: 500,
      include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
    });
    res.json({ items });
  }),
);

tasksRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findTask(ctx.scope, idParam(req)); // anyone who can see the task may join the discussion
    const body = parse(commentSchema, req.body);
    // the author always comes from the session
    const item = await prisma.taskComment.create({
      data: { taskId: t.id, userId: ctx.user.id, comment: body.comment },
      include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
    });
    await audit(ctx, 'COMMENT_CREATED', 'task', t.id, { title: t.title, status: t.status }, auditOpts(t));
    const recipients = [t.assignedToId, t.createdById].filter((id): id is string => !!id);
    await notify(recipients, { type: 'TASK_COMMENT', entity: 'task', entityId: t.id, data: { title: t.title, by: ctx.user.name } }, ctx.user.id);
    res.status(201).json({ item });
  }),
);
