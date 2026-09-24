// Owner: Projects & tasks group.  taskTemplatesRouter -> /task-templates, taskAutomationsRouter -> /task-automations
//
// Templates: anybody with tasks.view can browse them and anybody with tasks.create can APPLY one (the created tasks go
// through exactly the same checks as creating them by hand). Creating / editing templates needs `tasks.templates`.
// Automation rules are managed with `tasks.automations` (administrators / team leads).
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, PRIORITIES, TASK_STATUSES, TASK_VISIBILITIES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { spaceWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, parse } from '../lib/http';
import { audit } from '../services/audit';
import { round2, todayUtc } from '../services/projects';
import { and } from '../services/serializers';
import { parseConfig } from '../services/taskAutomations';
import { findTask, loadTaskDto } from '../services/tasks';
import { createTaskFor } from './tasks';

const idField = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v));
const hours = z.number().min(0).max(10_000).transform(round2);
const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);

// ───────────────────────── templates ─────────────────────────

export const taskTemplatesRouter = Router();
taskTemplatesRouter.use(authenticate, requirePerm('tasks.view'));

const itemSchema = z
  .object({ title: z.string().trim().min(1).max(200), description: text(2000).nullish(), estimatedHours: hours.nullish(), dueOffsetDays: z.number().int().min(0).max(365).nullish() })
  .strict();
const templateFields = {
  name: z.string().trim().min(1).max(100),
  description: text(1000).nullish(),
  taskTitle: z.string().trim().min(1).max(200),
  taskDescription: text(5000).nullish(),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  estimatedHours: hours.nullish(),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  items: z.array(itemSchema).max(50).default([]),
};
const templateSchema = z.object(templateFields).strict();
const templateUpdateSchema = z.object(templateFields).partial().strict();
const applySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    listId: idField.nullish(),
    projectId: idField.nullish(),
    clientId: idField.nullish(),
    campaignId: idField.nullish(),
    parentId: idField.nullish(),
    startDate: dateStr.nullish(),
    dueDate: dateStr.nullish(),
    assigneeIds: z.array(idField).max(10).optional(),
    assignSubtasks: z.boolean().optional(),
    visibility: z.enum(TASK_VISIBILITIES).optional(),
  })
  .strict();

const templateInclude = { items: { orderBy: { position: 'asc' } } } satisfies Prisma.TaskTemplateInclude;
const json = (raw: string | null): string[] => {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const templateDto = (t: Prisma.TaskTemplateGetPayload<{ include: typeof templateInclude }>) => ({ ...t, checklist: json(t.checklist), tags: json(t.tags) });

async function findTemplate(id: string) {
  const t = await prisma.taskTemplate.findUnique({ where: { id }, include: templateInclude });
  if (!t) throw Errors.notFound();
  return t;
}

taskTemplatesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.taskTemplate.findMany({ orderBy: { name: 'asc' }, include: templateInclude, take: 200 });
    res.json({ items: rows.map(templateDto) });
  }),
);

taskTemplatesRouter.get('/:id', asyncHandler(async (req, res) => res.json({ item: templateDto(await findTemplate(idParam(req))) })));

taskTemplatesRouter.post(
  '/',
  requirePerm('tasks.templates'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const b = parse(templateSchema, req.body);
    const t = await prisma.taskTemplate.create({
      data: {
        name: b.name, description: b.description ?? null, taskTitle: b.taskTitle, taskDescription: b.taskDescription ?? null, priority: b.priority,
        estimatedHours: b.estimatedHours ?? null, checklist: b.checklist?.length ? JSON.stringify(b.checklist) : null, tags: b.tags?.length ? JSON.stringify(b.tags) : null,
        createdById: ctx.user.id,
        items: { create: b.items.map((i, position) => ({ title: i.title, description: i.description ?? null, estimatedHours: i.estimatedHours ?? null, dueOffsetDays: i.dueOffsetDays ?? null, position })) },
      },
      include: templateInclude,
    });
    await audit(ctx, 'TASK_TEMPLATE_CREATED', 'task_template', t.id, { name: t.name, items: t.items.length });
    res.status(201).json({ item: templateDto(t) });
  }),
);

/** Save an existing task (with its direct subtasks, checklist and tags) as a template. */
taskTemplatesRouter.post(
  '/from-task/:taskId',
  requirePerm('tasks.templates'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }).strict(), req.body);
    const task = await findTask(ctx.scope, idParam(req, 'taskId'));
    const [subtasks, checklist] = await Promise.all([
      prisma.task.findMany({ where: { parentId: task.id, archivedAt: null }, orderBy: { position: 'asc' }, take: 50, select: { title: true, description: true, estimatedHours: true, dueDate: true } }),
      prisma.taskChecklistItem.findMany({ where: { taskId: task.id }, orderBy: { position: 'asc' }, take: 50, select: { text: true } }),
    ]);
    const start = task.startDate ?? task.createdAt;
    const offset = (d: Date | null) => (d ? Math.max(0, Math.min(365, Math.round((d.getTime() - start.getTime()) / 86_400_000))) : null);
    const t = await prisma.taskTemplate.create({
      data: {
        name, taskTitle: task.title, taskDescription: task.description, priority: task.priority, estimatedHours: task.estimatedHours,
        checklist: checklist.length ? JSON.stringify(checklist.map((c) => c.text)) : null,
        tags: task.tagLinks.length ? JSON.stringify(task.tagLinks.map((l) => l.tag.name)) : null,
        createdById: ctx.user.id,
        items: { create: subtasks.map((s, position) => ({ title: s.title, description: s.description, estimatedHours: s.estimatedHours, dueOffsetDays: offset(s.dueDate), position })) },
      },
      include: templateInclude,
    });
    await audit(ctx, 'TASK_TEMPLATE_CREATED', 'task_template', t.id, { name: t.name, items: t.items.length, fromTask: task.id });
    res.status(201).json({ item: templateDto(t) });
  }),
);

taskTemplatesRouter.patch(
  '/:id',
  requirePerm('tasks.templates'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findTemplate(idParam(req));
    const b = parse(templateUpdateSchema, req.body);
    await prisma.$transaction(async (tx) => {
      const data: Prisma.TaskTemplateUpdateInput = {};
      if (b.name !== undefined) data.name = b.name;
      if (b.description !== undefined) data.description = b.description;
      if (b.taskTitle !== undefined) data.taskTitle = b.taskTitle;
      if (b.taskDescription !== undefined) data.taskDescription = b.taskDescription;
      if (b.priority !== undefined) data.priority = b.priority;
      if (b.estimatedHours !== undefined) data.estimatedHours = b.estimatedHours;
      if (b.checklist !== undefined) data.checklist = b.checklist.length ? JSON.stringify(b.checklist) : null;
      if (b.tags !== undefined) data.tags = b.tags.length ? JSON.stringify(b.tags) : null;
      await tx.taskTemplate.update({ where: { id: existing.id }, data });
      if (b.items !== undefined) {
        await tx.taskTemplateItem.deleteMany({ where: { templateId: existing.id } });
        if (b.items.length) {
          await tx.taskTemplateItem.createMany({ data: b.items.map((i, position) => ({ templateId: existing.id, title: i.title, description: i.description ?? null, estimatedHours: i.estimatedHours ?? null, dueOffsetDays: i.dueOffsetDays ?? null, position })) });
        }
      }
    });
    await audit(ctx, 'TASK_TEMPLATE_UPDATED', 'task_template', existing.id, { name: b.name ?? existing.name, fields: Object.keys(b) });
    res.json({ item: templateDto(await findTemplate(existing.id)) });
  }),
);

taskTemplatesRouter.delete(
  '/:id',
  requirePerm('tasks.templates'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const t = await findTemplate(idParam(req));
    await prisma.$transaction([prisma.taskTemplateItem.deleteMany({ where: { templateId: t.id } }), prisma.taskTemplate.delete({ where: { id: t.id } })]);
    await audit(ctx, 'TASK_TEMPLATE_DELETED', 'task_template', t.id, { name: t.name });
    res.json({ ok: true });
  }),
);

/** Creates the parent task + one subtask per template item. Every task goes through the normal create checks. */
taskTemplatesRouter.post(
  '/:id/apply',
  requirePerm('tasks.create'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const tpl = await findTemplate(idParam(req));
    const b = parse(applySchema, req.body);
    const start = b.startDate ?? todayUtc();
    const lastOffset = Math.max(0, ...tpl.items.map((i) => i.dueOffsetDays ?? 0));
    const parentId = await createTaskFor(ctx, {
      title: b.title ?? tpl.taskTitle, description: tpl.taskDescription, priority: tpl.priority, status: 'TODO', visibility: b.visibility ?? 'INTERNAL',
      listId: b.listId, projectId: b.projectId, clientId: b.clientId, campaignId: b.campaignId, parentId: b.parentId,
      startDate: start, dueDate: b.dueDate ?? (lastOffset ? new Date(start.getTime() + lastOffset * 86_400_000) : null),
      estimatedHours: tpl.estimatedHours, assigneeIds: b.assigneeIds, tags: json(tpl.tags),
    });
    const checklist = json(tpl.checklist);
    if (checklist.length) await prisma.taskChecklistItem.createMany({ data: checklist.map((text, position) => ({ taskId: parentId, text, position })) });
    for (const item of tpl.items) {
      await createTaskFor(ctx, {
        title: item.title, description: item.description, priority: tpl.priority, status: 'TODO', visibility: 'INTERNAL', parentId,
        startDate: start, dueDate: item.dueOffsetDays !== null ? new Date(start.getTime() + item.dueOffsetDays * 86_400_000) : null,
        estimatedHours: item.estimatedHours, assigneeIds: b.assignSubtasks ? b.assigneeIds : undefined,
      });
    }
    const parent = await findTask(ctx.scope, parentId);
    await audit(ctx, 'TASK_TEMPLATE_APPLIED', 'task', parentId, { title: parent.title, status: parent.status, template: tpl.name, subtasks: tpl.items.length }, { clientId: parent.clientId, projectId: parent.projectId });
    res.status(201).json({ item: await loadTaskDto(ctx.scope, parentId) });
  }),
);

// ───────────────────────── automations ─────────────────────────

export const taskAutomationsRouter = Router();
taskAutomationsRouter.use(authenticate, requirePerm('tasks.automations'));

const configSchema = z
  .object({
    userId: idField.optional(),
    priority: z.enum(PRIORITIES).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    dueInDays: z.number().int().min(0).max(365).optional(),
    assign: z.enum(['same', 'none', 'user']).optional(),
    asSubtask: z.boolean().optional(),
    message: z.string().trim().max(200).optional(),
  })
  .strict();
const ruleFields = {
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  triggerStatus: z.enum(TASK_STATUSES).nullish(),
  action: z.enum(AUTOMATION_ACTIONS),
  config: configSchema.default({}),
  spaceId: idField.nullish(),
  listId: idField.nullish(),
};
const ruleSchema = z.object(ruleFields).strict();
const ruleUpdateSchema = z.object(ruleFields).partial().strict();

type RuleInput = z.infer<typeof ruleUpdateSchema>;

/** Checks that the rule makes sense and only points at things the caller may see. */
async function validateRule(ctx: Ctx, r: Required<Pick<RuleInput, 'trigger' | 'action'>> & RuleInput) {
  const cfg = r.config ?? {};
  if ((r.action === 'NOTIFY_USER' || r.action === 'ASSIGN_USER' || cfg.assign === 'user') && !cfg.userId) throw Errors.validation({ 'config.userId': 'required' });
  if (cfg.userId && !(await prisma.user.findFirst({ where: { id: cfg.userId, status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true } }))) {
    throw Errors.validation({ 'config.userId': 'invalid_choice' });
  }
  if (r.action === 'SET_PRIORITY' && !cfg.priority) throw Errors.validation({ 'config.priority': 'required' });
  if (r.action === 'REQUEST_CLIENT_APPROVAL' && r.trigger === 'TASK_OVERDUE') throw Errors.validation({ action: 'invalid_choice' });
  if (r.triggerStatus && r.trigger !== 'STATUS_CHANGED') throw Errors.validation({ triggerStatus: 'not_allowed' });
  let spaceId = r.spaceId ?? null;
  if (r.listId) {
    const l = await prisma.taskList.findFirst({ where: { id: r.listId, space: { is: spaceWhere(ctx.scope) } }, select: { spaceId: true } });
    if (!l) throw Errors.validation({ listId: 'invalid_choice' });
    if (spaceId && spaceId !== l.spaceId) throw Errors.validation({ listId: 'invalid_choice' });
    spaceId = l.spaceId;
  }
  if (spaceId && !(await prisma.space.findFirst({ where: and<Prisma.SpaceWhereInput>({ id: spaceId }, spaceWhere(ctx.scope)), select: { id: true } }))) {
    throw Errors.validation({ spaceId: 'invalid_choice' });
  }
  return spaceId;
}

const ruleDto = (r: Prisma.TaskAutomationGetPayload<object>) => ({ ...r, config: parseConfig(r.config) });

taskAutomationsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.taskAutomation.findMany({ orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }] });
    res.json({ items: rows.map(ruleDto) });
  }),
);

taskAutomationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const b = parse(ruleSchema, req.body);
    const spaceId = await validateRule(ctx, b);
    const r = await prisma.taskAutomation.create({
      data: { name: b.name, enabled: b.enabled, trigger: b.trigger, triggerStatus: b.triggerStatus ?? null, action: b.action, config: JSON.stringify(b.config), spaceId, listId: b.listId ?? null, createdById: ctx.user.id },
    });
    await audit(ctx, 'AUTOMATION_CREATED', 'automation', r.id, { name: r.name, trigger: r.trigger, action: r.action });
    res.status(201).json({ item: ruleDto(r) });
  }),
);

taskAutomationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.taskAutomation.findUnique({ where: { id: idParam(req) } });
    if (!existing) throw Errors.notFound();
    const b = parse(ruleUpdateSchema, req.body);
    const merged = {
      ...b,
      trigger: b.trigger ?? existing.trigger,
      action: b.action ?? existing.action,
      triggerStatus: b.triggerStatus !== undefined ? b.triggerStatus : existing.triggerStatus,
      config: b.config ?? (parseConfig(existing.config) as z.infer<typeof configSchema>),
      spaceId: b.spaceId !== undefined ? b.spaceId : existing.spaceId,
      listId: b.listId !== undefined ? b.listId : existing.listId,
    };
    const spaceId = await validateRule(ctx, merged);
    const r = await prisma.taskAutomation.update({
      where: { id: existing.id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        trigger: merged.trigger, action: merged.action, triggerStatus: merged.triggerStatus ?? null, config: JSON.stringify(merged.config), spaceId, listId: merged.listId ?? null,
      },
    });
    await audit(ctx, 'AUTOMATION_UPDATED', 'automation', r.id, { name: r.name, fields: Object.keys(b) });
    res.json({ item: ruleDto(r) });
  }),
);

taskAutomationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.taskAutomation.findUnique({ where: { id: idParam(req) } });
    if (!existing) throw Errors.notFound();
    await prisma.taskAutomation.delete({ where: { id: existing.id } });
    await audit(ctx, 'AUTOMATION_DELETED', 'automation', existing.id, { name: existing.name });
    res.json({ ok: true });
  }),
);

