// Owner: Projects & tasks group.  projectsRouter -> /projects
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PRIORITIES, PROJECT_STATUSES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm, requirePermOrClient } from '../authz/permissions';
import { campaignWhere, canWriteClient, deliverableWhere, fileWhere, isClient, projectWhere, timeEntryWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { audit } from '../services/audit';
import {
  assertStaffForClient, CLOSED_PROJECT_STATUSES, clientMilestoneDto, clientProjectDto, findProject, findWritableProject,
  loadProjectStats, progressOf, projectInclude, round2, sortMilestonesForNext, staffProjectDto, todayUtc,
} from '../services/projects';
import { and, fileSelect } from '../services/serializers';

export const projectsRouter = Router();
projectsRouter.use(authenticate);

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);
const text = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v));
const money = z.number().min(0).max(1_000_000_000).transform(round2);

const createSchema = z
  .object({
    clientId: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    description: text(5000).nullish(),
    status: z.enum(PROJECT_STATUSES).default('PLANNING'),
    priority: z.enum(PRIORITIES).default('NORMAL'),
    startDate: dateStr.nullish(),
    dueDate: dateStr.nullish(),
    projectManagerId: z.string().min(1).nullish(),
    budget: money.nullish(),
    visibleToClient: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.startDate && v.dueDate && v.dueDate < v.startDate) c.addIssue({ code: 'custom', path: ['dueDate'], message: 'end_before_start' });
  });

// clientId is deliberately NOT updatable: moving a project would strand its tasks / deliverables under the wrong owner
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: text(5000).nullable(),
    status: z.enum(PROJECT_STATUSES),
    priority: z.enum(PRIORITIES),
    startDate: dateStr.nullable(),
    dueDate: dateStr.nullable(),
    projectManagerId: z.string().min(1).nullable(),
    budget: money.nullable(),
    visibleToClient: z.boolean(),
  })
  .partial()
  .strict();

const milestoneCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: text(2000).nullish(),
    dueDate: dateStr.nullish(),
  })
  .strict();

const milestoneUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: text(2000).nullable(),
    dueDate: dateStr.nullable(),
    completed: z.boolean(),
  })
  .partial()
  .strict();

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) }).strict();

const SORTS = ['createdAt', 'updatedAt', 'name', 'dueDate'] as const;

// ───────────────────────── list ─────────────────────────

projectsRouter.get(
  '/',
  requirePermOrClient('projects.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const client = isClient(scope);
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const status = qsEnum(req.query, 'status', PROJECT_STATUSES);
    const priority = qsEnum(req.query, 'priority', PRIORITIES);
    const clientId = qs(req.query, 'clientId');
    const managerId = qs(req.query, 'projectManagerId');
    const sort = qsEnum(req.query, 'sort', SORTS) ?? 'createdAt';
    const dir = qs(req.query, 'dir') === 'asc' ? 'asc' : 'desc';
    const today = todayUtc();
    const where = and<Prisma.ProjectWhereInput>(
      projectWhere(scope),
      status ? { status } : undefined,
      priority ? { priority } : undefined,
      clientId ? { clientId } : undefined,
      // clients never get to filter by (or thereby probe) internal staffing
      !client && managerId ? { projectManagerId: managerId } : undefined,
      !client && qs(req.query, 'mine') === '1' ? { OR: [{ projectManagerId: scope.userId }, { tasks: { some: { assignedToId: scope.userId } } }] } : undefined,
      qs(req.query, 'overdue') === '1' ? { dueDate: { lt: today }, status: { notIn: CLOSED_PROJECT_STATUSES } } : undefined,
      q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : undefined,
    );
    const [total, rows] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({ where, include: projectInclude, orderBy: [{ [sort]: dir }, { id: 'asc' }], skip: p.skip, take: p.take }),
    ]);
    const stats = await loadProjectStats(rows.map((r) => r.id), today);
    const items = rows.map((r) => (client ? clientProjectDto(r, stats.get(r.id)!, today) : staffProjectDto(r, stats.get(r.id)!, scope, today)));
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

// ───────────────────────── create ─────────────────────────

projectsRouter.post(
  '/',
  requirePerm('projects.create'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    // the caller must be allowed to write to this client (also proves the client exists)
    if (!canWriteClient(ctx.scope, body.clientId)) throw Errors.validation({ clientId: 'invalid_choice' });
    const exists = await prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true } });
    if (!exists) throw Errors.validation({ clientId: 'invalid_choice' });
    const managerId = body.projectManagerId === undefined ? ctx.user.id : body.projectManagerId;
    if (managerId) await assertStaffForClient(managerId, body.clientId, null, 'projectManagerId');

    const project = await prisma.project.create({
      data: {
        clientId: body.clientId,
        name: body.name,
        description: body.description ?? null,
        status: body.status,
        priority: body.priority,
        startDate: body.startDate ?? null,
        dueDate: body.dueDate ?? null,
        completedAt: body.status === 'COMPLETED' ? new Date() : null,
        projectManagerId: managerId,
        budget: body.budget ?? null,
        visibleToClient: body.visibleToClient,
        createdById: ctx.user.id,
      },
      include: projectInclude,
    });
    await audit(ctx, 'PROJECT_CREATED', 'project', project.id, { name: project.name, status: project.status }, { clientId: project.clientId, projectId: project.id });
    const stats = await loadProjectStats([project.id]);
    res.status(201).json({ item: staffProjectDto(project, stats.get(project.id)!, ctx.scope) });
  }),
);

// ───────────────────────── detail ─────────────────────────

projectsRouter.get(
  '/:id',
  requirePermOrClient('projects.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const project = await findProject(scope, idParam(req));
    const id = project.id;
    const client = isClient(scope);
    const today = todayUtc();
    const [stats, milestones, campaigns, deliverableRows, fileCount] = await Promise.all([
      loadProjectStats([id], today),
      prisma.milestone.findMany({ where: { projectId: id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      prisma.campaign.findMany({
        where: and<Prisma.CampaignWhereInput>(campaignWhere(scope), { projectId: id }),
        orderBy: { createdAt: 'desc' },
        select: client
          ? { id: true, name: true, status: true, platform: true, objective: true }
          : { id: true, name: true, status: true, platform: true, objective: true, startDate: true, endDate: true, budget: true, spent: true },
      }),
      prisma.deliverable.groupBy({ by: ['status'], where: and<Prisma.DeliverableWhereInput>(deliverableWhere(scope), { projectId: id }), _count: { _all: true } }),
      prisma.file.count({ where: and<Prisma.FileWhereInput>(fileWhere(scope), { projectId: id }) }),
    ]);
    const s = stats.get(id)!;
    const deliverables = { total: 0, byStatus: {} as Record<string, number> };
    for (const r of deliverableRows) {
      deliverables.byStatus[r.status] = r._count._all;
      deliverables.total += r._count._all;
    }
    if (client) {
      res.json({
        item: {
          ...clientProjectDto(project, s, today),
          milestones: milestones.map(clientMilestoneDto),
          campaigns,
          deliverableCounts: deliverables,
          counts: { files: fileCount, deliverables: deliverables.total },
        },
      });
      return;
    }
    res.json({
      item: {
        ...staffProjectDto(project, s, scope, today),
        milestones,
        taskCountsByStatus: s.byStatus,
        campaigns,
        deliverableCounts: deliverables,
        counts: { files: fileCount, deliverables: deliverables.total, campaigns: campaigns.length, tasks: s.total },
      },
    });
  }),
);

// files attached to the project (fileWhere already hides internal / unsent files from clients)
projectsRouter.get(
  '/:id/files',
  requirePermOrClient('projects.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const project = await findProject(scope, idParam(req));
    const p = paging(req.query, 25);
    const where = and<Prisma.FileWhereInput>(fileWhere(scope), { projectId: project.id });
    const [total, items] = await Promise.all([
      prisma.file.count({ where }),
      prisma.file.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, select: fileSelect }),
    ]);
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

// ───────────────────────── dashboard ─────────────────────────

projectsRouter.get(
  '/:id/dashboard',
  requirePermOrClient('projects.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const project = await findProject(scope, idParam(req));
    const id = project.id;
    const today = todayUtc();
    const [stats, milestones, deliverableRows] = await Promise.all([
      loadProjectStats([id], today),
      prisma.milestone.findMany({ where: { projectId: id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      prisma.deliverable.groupBy({ by: ['status'], where: and<Prisma.DeliverableWhereInput>(deliverableWhere(scope), { projectId: id }), _count: { _all: true } }),
    ]);
    const s = stats.get(id)!;
    const deliverables = { total: 0, pendingApproval: 0, byStatus: {} as Record<string, number> };
    for (const r of deliverableRows) {
      deliverables.byStatus[r.status] = r._count._all;
      deliverables.total += r._count._all;
      if (r.status === 'PENDING_APPROVAL') deliverables.pendingApproval = r._count._all;
    }
    const upcoming = sortMilestonesForNext(milestones.filter((m) => !m.completedAt)).slice(0, 5);

    if (isClient(scope)) {
      // CLIENT variant: progress, milestones and deliverable statuses only - never task numbers or time
      res.json({
        item: {
          progress: progressOf(s, project.status),
          milestones: milestones.map(clientMilestoneDto),
          upcomingMilestones: upcoming.map(clientMilestoneDto),
          milestoneCounts: { total: s.milestonesTotal, done: s.milestonesDone },
          deliverables,
        },
      });
      return;
    }

    const item: Record<string, unknown> = {
      progress: progressOf(s, project.status),
      tasks: { total: s.total, done: s.done, overdue: s.overdue, byStatus: s.byStatus },
      milestoneCounts: { total: s.milestonesTotal, done: s.milestonesDone },
      upcomingMilestones: upcoming,
      deliverables,
    };
    // people-cost data: only with time.view_all (ADMIN always has it)
    if (scope.permissions.has('time.view_all')) {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [all, recent] = await Promise.all([
        prisma.timeEntry.aggregate({ where: and<Prisma.TimeEntryWhereInput>(timeEntryWhere(scope), { projectId: id }), _sum: { durationSec: true } }),
        prisma.timeEntry.aggregate({ where: and<Prisma.TimeEntryWhereInput>(timeEntryWhere(scope), { projectId: id, startedAt: { gte: since } }), _sum: { durationSec: true } }),
      ]);
      item.timeLogged = {
        totalHours: round2((all._sum.durationSec ?? 0) / 3600),
        last30DaysHours: round2((recent._sum.durationSec ?? 0) / 3600),
      };
    }
    res.json({ item });
  }),
);

// ───────────────────────── update / delete ─────────────────────────

projectsRouter.patch(
  '/:id',
  requirePerm('projects.edit'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findWritableProject(ctx.scope, idParam(req));
    const body = parse(updateSchema, req.body);

    const start = body.startDate !== undefined ? body.startDate : existing.startDate;
    const due = body.dueDate !== undefined ? body.dueDate : existing.dueDate;
    if (start && due && due < start) throw Errors.validation({ dueDate: 'end_before_start' });
    if (body.projectManagerId) await assertStaffForClient(body.projectManagerId, existing.clientId, null, 'projectManagerId');

    const data: Prisma.ProjectUncheckedUpdateInput = { ...body };
    const statusChanged = body.status !== undefined && body.status !== existing.status;
    if (statusChanged) {
      if (body.status === 'COMPLETED') data.completedAt = existing.completedAt ?? new Date();
      else if (existing.status === 'COMPLETED') data.completedAt = null;
    }
    const updated = await prisma.project.update({ where: { id: existing.id }, data, include: projectInclude });
    const visible = updated.visibleToClient;
    const fields = Object.keys(body).filter((k) => k !== 'status');

    if (body.visibleToClient === false && existing.visibleToClient) {
      // the project became internal: what it already published to the client's activity feed must disappear too
      await prisma.auditLog.updateMany({ where: { projectId: existing.id, clientVisible: true }, data: { clientVisible: false } });
    }
    if (statusChanged) {
      await audit(
        ctx, 'PROJECT_STATUS_CHANGED', 'project', existing.id,
        { name: updated.name, from: existing.status, to: updated.status },
        { clientId: existing.clientId, projectId: existing.id, clientVisible: visible },
      );
    }
    if (fields.length > 0) {
      await audit(ctx, 'PROJECT_UPDATED', 'project', existing.id, { name: updated.name, fields }, { clientId: existing.clientId, projectId: existing.id });
    }
    const stats = await loadProjectStats([updated.id]);
    res.json({ item: staffProjectDto(updated, stats.get(updated.id)!, ctx.scope) });
  }),
);

projectsRouter.delete(
  '/:id',
  requirePerm('projects.delete'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findWritableProject(ctx.scope, idParam(req));
    const id = existing.id;
    // Nothing that hangs off the project is destroyed: tasks, campaigns, deliverables (and their approval history),
    // content, files, invoices, time entries and internal notes stay and simply lose the link. Milestones and the
    // project's own shared comments go with it.
    const [tasks, campaigns, deliverables] = await Promise.all([
      prisma.task.count({ where: { projectId: id } }),
      prisma.campaign.count({ where: { projectId: id } }),
      prisma.deliverable.count({ where: { projectId: id } }),
    ]);
    await prisma.$transaction([
      prisma.task.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.campaign.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.deliverable.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.contentItem.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.file.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.invoice.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.timeEntry.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.internalNote.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      prisma.comment.deleteMany({ where: { projectId: id } }),
      prisma.milestone.deleteMany({ where: { projectId: id } }),
      prisma.project.delete({ where: { id } }),
    ]);
    await audit(ctx, 'PROJECT_DELETED', 'project', id, { name: existing.name, detachedTasks: tasks, detachedCampaigns: campaigns, detachedDeliverables: deliverables }, { clientId: existing.clientId, projectId: id });
    res.json({ ok: true });
  }),
);

// ───────────────────────── milestones ─────────────────────────

const milestoneAudit = (project: { id: string; clientId: string; visibleToClient: boolean }) => ({
  clientId: project.clientId,
  projectId: project.id,
  clientVisible: project.visibleToClient,
});

async function findMilestone(projectId: string, milestoneId: string) {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
  if (!m) throw Errors.notFound();
  return m;
}

projectsRouter.get(
  '/:id/milestones',
  requirePermOrClient('projects.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const project = await findProject(scope, idParam(req)); // a milestone is only visible when its project is
    const items = await prisma.milestone.findMany({ where: { projectId: project.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    res.json({ items: isClient(scope) ? items.map(clientMilestoneDto) : items });
  }),
);

projectsRouter.post(
  '/:id/milestones',
  requirePerm('projects.edit'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const project = await findWritableProject(ctx.scope, idParam(req));
    const body = parse(milestoneCreateSchema, req.body);
    const last = await prisma.milestone.aggregate({ where: { projectId: project.id }, _max: { position: true } });
    const item = await prisma.milestone.create({
      data: { projectId: project.id, title: body.title, description: body.description ?? null, dueDate: body.dueDate ?? null, position: (last._max.position ?? -1) + 1 },
    });
    await audit(ctx, 'MILESTONE_CREATED', 'milestone', item.id, { title: item.title, project: project.name }, milestoneAudit(project));
    res.status(201).json({ item });
  }),
);

// declared before /:mid so "reorder" is never read as a milestone id
projectsRouter.put(
  '/:id/milestones/reorder',
  requirePerm('projects.edit'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const project = await findWritableProject(ctx.scope, idParam(req));
    const { ids } = parse(reorderSchema, req.body);
    const current = await prisma.milestone.findMany({ where: { projectId: project.id }, select: { id: true } });
    const same = ids.length === current.length && new Set(ids).size === ids.length && current.every((m) => ids.includes(m.id));
    if (!same) throw Errors.validation({ ids: 'invalid_choice' });
    await prisma.$transaction(ids.map((mid, position) => prisma.milestone.update({ where: { id: mid }, data: { position } })));
    await audit(ctx, 'MILESTONE_UPDATED', 'milestone', null, { reordered: true, project: project.name }, { clientId: project.clientId, projectId: project.id });
    const items = await prisma.milestone.findMany({ where: { projectId: project.id }, orderBy: { position: 'asc' } });
    res.json({ items });
  }),
);

async function setMilestoneDone(req: Parameters<typeof ctxOf>[0], completed: boolean) {
  const ctx = ctxOf(req);
  const project = await findWritableProject(ctx.scope, idParam(req));
  const existing = await findMilestone(project.id, idParam(req, 'mid'));
  const item = existing.completedAt && completed ? existing : await prisma.milestone.update({ where: { id: existing.id }, data: { completedAt: completed ? new Date() : null } });
  if (!!existing.completedAt !== completed) {
    await audit(ctx, 'MILESTONE_UPDATED', 'milestone', item.id, { title: item.title, completed, project: project.name }, milestoneAudit(project));
  }
  return item;
}

projectsRouter.post('/:id/milestones/:mid/complete', requirePerm('projects.edit'), asyncHandler(async (req, res) => {
  res.json({ item: await setMilestoneDone(req, true) });
}));
projectsRouter.post('/:id/milestones/:mid/uncomplete', requirePerm('projects.edit'), asyncHandler(async (req, res) => {
  res.json({ item: await setMilestoneDone(req, false) });
}));

projectsRouter.patch(
  '/:id/milestones/:mid',
  requirePerm('projects.edit'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const project = await findWritableProject(ctx.scope, idParam(req));
    const existing = await findMilestone(project.id, idParam(req, 'mid'));
    const { completed, ...rest } = parse(milestoneUpdateSchema, req.body);
    const data: Prisma.MilestoneUpdateInput = { ...rest };
    if (completed !== undefined && completed !== !!existing.completedAt) data.completedAt = completed ? new Date() : null;
    const item = await prisma.milestone.update({ where: { id: existing.id }, data });
    await audit(ctx, 'MILESTONE_UPDATED', 'milestone', item.id, { title: item.title, fields: [...Object.keys(rest), ...(completed !== undefined ? ['completed'] : [])], project: project.name }, milestoneAudit(project));
    res.json({ item });
  }),
);

projectsRouter.delete(
  '/:id/milestones/:mid',
  requirePerm('projects.edit'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const project = await findWritableProject(ctx.scope, idParam(req));
    const existing = await findMilestone(project.id, idParam(req, 'mid'));
    await prisma.milestone.delete({ where: { id: existing.id } });
    await audit(ctx, 'MILESTONE_DELETED', 'milestone', existing.id, { title: existing.title, project: project.name }, milestoneAudit(project));
    res.json({ ok: true });
  }),
);
