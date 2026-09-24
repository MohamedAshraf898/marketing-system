// Owner: Projects & tasks group.  clientTasksRouter -> /client-tasks
//
// The client portal's view of tasks. CLIENT users only (staff use /tasks). Every query goes through clientTaskWhere:
// their own company, explicitly CLIENT_VISIBLE, not archived, not inside an internal project. The response is a
// WHITELIST - no estimates, tracked time, internal comments, attachments, tags, assignees or custom fields.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { TASK_STATUSES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { clientTaskWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { audit } from '../services/audit';
import { notify } from '../services/notifications';
import { emptyStatusCounts, todayUtc } from '../services/projects';
import { and } from '../services/serializers';
import { assigneeIdsOf, isTaskOverdue } from '../services/tasks';

export const clientTasksRouter = Router();

const clientOnly = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(Errors.unauthenticated());
  if (req.user.role !== 'CLIENT') return next(Errors.forbidden());
  next();
};
clientTasksRouter.use(authenticate, clientOnly);

const select = {
  id: true, title: true, description: true, status: true, priority: true, startDate: true, dueDate: true, completedAt: true, createdAt: true, updatedAt: true, parentId: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;
type Row = Prisma.TaskGetPayload<{ select: typeof select }>;

async function progressOf(ids: string[], scopeWhere: Prisma.TaskWhereInput) {
  const out = new Map<string, { done: number; total: number; comments: number }>();
  ids.forEach((id) => out.set(id, { done: 0, total: 0, comments: 0 }));
  if (ids.length === 0) return out;
  const [subs, comments] = await Promise.all([
    // only subtasks that are themselves shared with the client count
    prisma.task.groupBy({ by: ['parentId', 'status'], where: and<Prisma.TaskWhereInput>(scopeWhere, { parentId: { in: ids } }), _count: { _all: true } }),
    prisma.taskComment.groupBy({ by: ['taskId'], where: { taskId: { in: ids }, clientVisible: true }, _count: { _all: true } }),
  ]);
  for (const r of subs) {
    const p = r.parentId ? out.get(r.parentId) : undefined;
    if (!p) continue;
    p.total += r._count._all;
    if (r.status === 'DONE') p.done += r._count._all;
  }
  for (const c of comments) {
    const p = out.get(c.taskId);
    if (p) p.comments = c._count._all;
  }
  return out;
}

const dto = (t: Row, p: { done: number; total: number; comments: number }, today = todayUtc()) => ({
  id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, startDate: t.startDate, dueDate: t.dueDate,
  completedAt: t.completedAt, createdAt: t.createdAt, updatedAt: t.updatedAt, project: t.project, parentId: t.parentId,
  overdue: isTaskOverdue(t, today), subtasks: { done: p.done, total: p.total }, commentCount: p.comments,
});

clientTasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const p = paging(req.query, 20);
    const status = qsEnum(req.query, 'status', TASK_STATUSES);
    const q = qs(req.query, 'q')?.slice(0, 80);
    const base = clientTaskWhere(scope);
    const where = and<Prisma.TaskWhereInput>(
      base,
      status ? { status } : undefined,
      qs(req.query, 'projectId') ? { projectId: qs(req.query, 'projectId') } : undefined,
      qs(req.query, 'topLevel') === '0' ? undefined : { OR: [{ parentId: null }, { parent: { is: { visibility: 'INTERNAL' } } }] },
      q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : undefined,
    );
    const [total, rows, byStatus] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({ where, select, orderBy: [{ dueDate: 'asc' }, { position: 'asc' }, { createdAt: 'desc' }], skip: p.skip, take: p.take }),
      prisma.task.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const prog = await progressOf(rows.map((r) => r.id), base);
    const counts = emptyStatusCounts();
    for (const r of byStatus) counts[r.status] = r._count._all;
    res.json({ items: rows.map((r) => dto(r, prog.get(r.id)!)), meta: pageMeta(p, total), counts });
  }),
);

async function findShared(scope: ReturnType<typeof ctxOf>['scope'], id: string) {
  const t = await prisma.task.findFirst({ where: and<Prisma.TaskWhereInput>({ id }, clientTaskWhere(scope)), select });
  if (!t) throw Errors.notFound();
  return t;
}

const commentSelect = { id: true, comment: true, createdAt: true, editedAt: true, authorType: true, user: { select: { id: true, name: true, avatar: true } } } satisfies Prisma.TaskCommentSelect;

clientTasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const base = clientTaskWhere(scope);
    const t = await findShared(scope, idParam(req));
    const [subRows, comments] = await Promise.all([
      prisma.task.findMany({ where: and<Prisma.TaskWhereInput>(base, { parentId: t.id }), select, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 100 }),
      prisma.taskComment.findMany({ where: { taskId: t.id, clientVisible: true }, select: commentSelect, orderBy: { createdAt: 'asc' }, take: 300 }),
    ]);
    const prog = await progressOf([t.id, ...subRows.map((s) => s.id)], base);
    res.json({ item: { ...dto(t, prog.get(t.id)!), subtasks: subRows.map((s) => dto(s, prog.get(s.id)!)), comments } });
  }),
);

const commentSchema = z.object({ comment: z.string().trim().min(1).max(2000) }).strict();

/** Clients can discuss a shared task; their comments are always visible to both sides. */
clientTasksRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findShared(ctx.scope, idParam(req));
    const body = parse(commentSchema, req.body);
    const item = await prisma.taskComment.create({
      data: { taskId: t.id, userId: ctx.user.id, comment: body.comment, authorType: 'CLIENT', clientVisible: true },
      select: commentSelect,
    });
    const full = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { clientId: true, projectId: true, createdById: true, assignedToId: true, assignees: { select: { userId: true } } } });
    await audit(ctx, 'COMMENT_CREATED', 'task', t.id, { title: t.title, status: t.status, byClient: true }, { clientId: full.clientId, projectId: full.projectId, clientVisible: true });
    const staff = [...assigneeIdsOf(full), full.createdById].filter((x): x is string => !!x);
    await notify(staff, { type: 'TASK_COMMENT', entity: 'task', entityId: t.id, data: { title: t.title, by: ctx.user.name } }, ctx.user.id);
    res.status(201).json({ item });
  }),
);
