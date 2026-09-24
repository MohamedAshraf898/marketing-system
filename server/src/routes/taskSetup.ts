// Owner: Projects & tasks group.  spacesRouter -> /spaces, taskFieldsRouter -> /task-fields, taskTagsRouter -> /task-tags
//
// Hierarchy: Workspace (the agency) -> Space -> Folder -> List -> Task -> Subtask.
// Reading needs `tasks.view` and goes through spaceWhere (client spaces only for staff of that client). Changing the
// structure needs `tasks.manage_spaces`; a TEAM member can only manage internal spaces or spaces of clients they are fully
// assigned to. Task counts shown next to lists only count tasks the caller may see.
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CUSTOM_FIELD_TYPES, TASK_STATUSES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { projectWhere, spaceWhere, taskWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, parse, qs } from '../lib/http';
import { audit } from '../services/audit';
import { and } from '../services/serializers';
import { normalizeTagName, parseOptions } from '../services/taskFields';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalid');
const name = z.string().trim().min(1).max(80);
const idField = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v));
const manage = requirePerm('tasks.manage_spaces');

// ───────────────────────── access helpers ─────────────────────────

async function findSpace(scope: Scope, id: string) {
  const s = await prisma.space.findFirst({ where: and<Prisma.SpaceWhereInput>({ id }, spaceWhere(scope)) });
  if (!s) throw Errors.notFound();
  return s;
}

/** Manage = the permission AND (admin, internal space, or a client the TEAM member is fully assigned to). */
function assertManage(scope: Scope, space: { clientId: string | null }) {
  if (!scope.permissions.has('tasks.manage_spaces')) throw Errors.forbidden();
  if (scope.role !== 'ADMIN' && space.clientId && !scope.fullClientIds.includes(space.clientId)) throw Errors.forbidden();
}

async function checkClient(scope: Scope, clientId: string | null | undefined) {
  if (!clientId) return;
  const ok = scope.role === 'ADMIN' || scope.fullClientIds.includes(clientId);
  if (!ok || !(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw Errors.validation({ clientId: 'invalid_choice' });
}

/** A folder / list may link to a project the caller can write, of the same client as the space (when it has one). */
async function checkProject(scope: Scope, projectId: string | null | undefined, spaceClientId: string | null) {
  if (!projectId) return;
  const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: projectId }, projectWhere(scope)), select: { clientId: true, projectManagerId: true } });
  const writable = p && (scope.role === 'ADMIN' || scope.fullClientIds.includes(p.clientId) || p.projectManagerId === scope.userId);
  if (!p || !writable || (spaceClientId && p.clientId !== spaceClientId)) throw Errors.validation({ projectId: 'invalid_choice' });
}

async function findList(scope: Scope, id: string) {
  const l = await prisma.taskList.findFirst({ where: { id, space: { is: spaceWhere(scope) } }, include: { space: true } });
  if (!l) throw Errors.notFound();
  return l;
}

async function findFolder(scope: Scope, id: string) {
  const f = await prisma.folder.findFirst({ where: { id, space: { is: spaceWhere(scope) } }, include: { space: true } });
  if (!f) throw Errors.notFound();
  return f;
}

/** Tasks lose their list (they are kept, never deleted with a container). */
async function detachLists(listIds: string[]) {
  if (listIds.length === 0) return;
  await prisma.task.updateMany({ where: { listId: { in: listIds } }, data: { listId: null, customStatusId: null } });
}

// ───────────────────────── spaces ─────────────────────────

export const spacesRouter = Router();
spacesRouter.use(authenticate, requirePerm('tasks.view'));

const spaceSchema = z.object({ name, description: text(500).nullish(), color: color.optional(), clientId: idField.nullish() }).strict();
const spaceUpdateSchema = z.object({ name, description: text(500).nullable(), color, clientId: idField.nullable(), archived: z.boolean() }).partial().strict();
const folderSchema = z.object({ name, projectId: idField.nullish() }).strict();
const folderUpdateSchema = z.object({ name, projectId: idField.nullable(), archived: z.boolean() }).partial().strict();
const listSchema = z.object({ name, description: text(500).nullish(), color: color.nullish(), folderId: idField.nullish(), projectId: idField.nullish() }).strict();
const listUpdateSchema = z.object({ name, description: text(500).nullable(), color: color.nullable(), folderId: idField.nullable(), projectId: idField.nullable(), archived: z.boolean() }).partial().strict();
const reorderSchema = z.object({ ids: z.array(idField).min(1).max(500) }).strict();
const statusesSchema = z
  .object({ statuses: z.array(z.object({ id: idField.optional(), name: z.string().trim().min(1).max(40), color, category: z.enum(TASK_STATUSES) }).strict()).max(20) })
  .strict();

/** The whole tree the caller may see, with open-task counts per list (one grouped query). */
spacesRouter.get(
  '/tree',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const archived = qs(req.query, 'archived') === '1';
    const live = archived ? {} : { archivedAt: null };
    const spaces = await prisma.space.findMany({
      where: and<Prisma.SpaceWhereInput>(spaceWhere(scope), live),
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        client: { select: { id: true, companyName: true } },
        folders: { where: live, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { project: { select: { id: true, name: true } } } },
        lists: { where: live, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { project: { select: { id: true, name: true } } } },
        statuses: { orderBy: { position: 'asc' } },
      },
    });
    const listIds = spaces.flatMap((s) => s.lists.map((l) => l.id));
    const counts = listIds.length
      ? await prisma.task.groupBy({ by: ['listId'], where: and<Prisma.TaskWhereInput>(taskWhere(scope), { listId: { in: listIds }, archivedAt: null, status: { not: 'DONE' } }), _count: { _all: true } })
      : [];
    const open = new Map(counts.map((c) => [c.listId, c._count._all]));
    const listDto = (l: (typeof spaces)[number]['lists'][number]) => ({ id: l.id, name: l.name, description: l.description, color: l.color, folderId: l.folderId, spaceId: l.spaceId, projectId: l.projectId, project: l.project, position: l.position, archivedAt: l.archivedAt, openTasks: open.get(l.id) ?? 0 });
    res.json({
      items: spaces.map((s) => ({
        id: s.id, name: s.name, description: s.description, color: s.color, clientId: s.clientId, client: s.client, position: s.position, archivedAt: s.archivedAt,
        statuses: s.statuses.map((st) => ({ id: st.id, name: st.name, color: st.color, category: st.category, position: st.position })),
        folders: s.folders.map((f) => ({ id: f.id, name: f.name, projectId: f.projectId, project: f.project, position: f.position, archivedAt: f.archivedAt, lists: s.lists.filter((l) => l.folderId === f.id).map(listDto) })),
        lists: s.lists.filter((l) => !l.folderId).map(listDto),
        canManage: scope.permissions.has('tasks.manage_spaces') && (scope.role === 'ADMIN' || !s.clientId || scope.fullClientIds.includes(s.clientId)),
      })),
      canCreate: scope.permissions.has('tasks.manage_spaces'),
    });
  }),
);

spacesRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(spaceSchema, req.body);
    await checkClient(ctx.scope, body.clientId);
    const max = await prisma.space.aggregate({ _max: { position: true } });
    const s = await prisma.space.create({
      data: { name: body.name, description: body.description ?? null, color: body.color ?? '#6366f1', clientId: body.clientId ?? null, position: (max._max.position ?? -1) + 1, createdById: ctx.user.id },
    });
    await audit(ctx, 'SPACE_CREATED', 'space', s.id, { name: s.name }, { clientId: s.clientId });
    res.status(201).json({ item: s });
  }),
);

spacesRouter.put(
  '/reorder',
  manage,
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const { ids } = parse(reorderSchema, req.body);
    const visible = await prisma.space.findMany({ where: and<Prisma.SpaceWhereInput>(spaceWhere(scope), { id: { in: ids } }), select: { id: true } });
    if (visible.length !== new Set(ids).size) throw Errors.validation({ ids: 'invalid_choice' });
    await prisma.$transaction(ids.map((id, position) => prisma.space.update({ where: { id }, data: { position } })));
    res.json({ ok: true });
  }),
);

spacesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const s = await findSpace(ctx.scope, idParam(req));
    assertManage(ctx.scope, s);
    const body = parse(spaceUpdateSchema, req.body);
    if (body.clientId !== undefined && body.clientId !== s.clientId) {
      await checkClient(ctx.scope, body.clientId);
      // lists already holding tasks of another client cannot move under a client space
      if (body.clientId) {
        const foreign = await prisma.task.count({ where: { list: { is: { spaceId: s.id } }, clientId: { not: body.clientId } } });
        if (foreign) throw Errors.validation({ clientId: 'space_has_other_clients' });
      }
    }
    const { archived, ...rest } = body;
    const item = await prisma.space.update({ where: { id: s.id }, data: { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) } });
    await audit(ctx, 'SPACE_UPDATED', 'space', s.id, { name: item.name, fields: Object.keys(body) }, { clientId: item.clientId });
    res.json({ item });
  }),
);

spacesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const s = await findSpace(ctx.scope, idParam(req));
    assertManage(ctx.scope, s);
    const lists = await prisma.taskList.findMany({ where: { spaceId: s.id }, select: { id: true } });
    await detachLists(lists.map((l) => l.id));
    await prisma.$transaction([
      prisma.taskCustomField.deleteMany({ where: { spaceId: s.id } }),
      prisma.taskStatusOption.deleteMany({ where: { spaceId: s.id } }),
      prisma.taskList.deleteMany({ where: { spaceId: s.id } }),
      prisma.folder.deleteMany({ where: { spaceId: s.id } }),
      prisma.taskAutomation.deleteMany({ where: { spaceId: s.id } }),
      prisma.space.delete({ where: { id: s.id } }),
    ]);
    await audit(ctx, 'SPACE_DELETED', 'space', s.id, { name: s.name, lists: lists.length }, { clientId: s.clientId });
    res.json({ ok: true });
  }),
);

/** Replaces the custom statuses of a space. Tasks on a removed status move to the first status of the same category. */
spacesRouter.put(
  '/:id/statuses',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const s = await findSpace(ctx.scope, idParam(req));
    assertManage(ctx.scope, s);
    const { statuses } = parse(statusesSchema, req.body);
    const existing = await prisma.taskStatusOption.findMany({ where: { spaceId: s.id } });
    const keepIds = statuses.map((x) => x.id).filter((id): id is string => !!id);
    if (keepIds.some((id) => !existing.find((e) => e.id === id))) throw Errors.validation({ statuses: 'invalid_choice' });
    await prisma.$transaction(async (tx) => {
      const saved: Array<{ id: string; category: string }> = [];
      for (const [position, st] of statuses.entries()) {
        const row = st.id
          ? await tx.taskStatusOption.update({ where: { id: st.id }, data: { name: st.name, color: st.color, category: st.category, position } })
          : await tx.taskStatusOption.create({ data: { spaceId: s.id, name: st.name, color: st.color, category: st.category, position } });
        saved.push(row);
        // a status whose category changed takes its tasks along to the new category
        if (st.id) await tx.task.updateMany({ where: { customStatusId: row.id }, data: { status: st.category } });
      }
      for (const old of existing.filter((e) => !keepIds.includes(e.id))) {
        const replacement = saved.find((x) => x.category === old.category);
        await tx.task.updateMany({ where: { customStatusId: old.id }, data: { customStatusId: replacement?.id ?? null } });
        await tx.taskStatusOption.delete({ where: { id: old.id } });
      }
    });
    await audit(ctx, 'SPACE_STATUSES_UPDATED', 'space', s.id, { name: s.name, statuses: statuses.map((x) => `${x.name}:${x.category}`) }, { clientId: s.clientId });
    res.json({ items: await prisma.taskStatusOption.findMany({ where: { spaceId: s.id }, orderBy: { position: 'asc' } }) });
  }),
);

// ── folders ──

spacesRouter.post(
  '/:id/folders',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const s = await findSpace(ctx.scope, idParam(req));
    assertManage(ctx.scope, s);
    const body = parse(folderSchema, req.body);
    await checkProject(ctx.scope, body.projectId, s.clientId);
    const max = await prisma.folder.aggregate({ where: { spaceId: s.id }, _max: { position: true } });
    const f = await prisma.folder.create({ data: { spaceId: s.id, name: body.name, projectId: body.projectId ?? null, position: (max._max.position ?? -1) + 1 } });
    await audit(ctx, 'FOLDER_CREATED', 'folder', f.id, { name: f.name, space: s.name }, { clientId: s.clientId, projectId: f.projectId });
    res.status(201).json({ item: f });
  }),
);

spacesRouter.patch(
  '/folders/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const f = await findFolder(ctx.scope, idParam(req));
    assertManage(ctx.scope, f.space);
    const body = parse(folderUpdateSchema, req.body);
    if (body.projectId) await checkProject(ctx.scope, body.projectId, f.space.clientId);
    const { archived, ...rest } = body;
    const item = await prisma.folder.update({ where: { id: f.id }, data: { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) } });
    await audit(ctx, 'FOLDER_UPDATED', 'folder', f.id, { name: item.name, fields: Object.keys(body) }, { clientId: f.space.clientId });
    res.json({ item });
  }),
);

spacesRouter.delete(
  '/folders/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const f = await findFolder(ctx.scope, idParam(req));
    assertManage(ctx.scope, f.space);
    const lists = await prisma.taskList.findMany({ where: { folderId: f.id }, select: { id: true } });
    await detachLists(lists.map((l) => l.id));
    await prisma.$transaction([prisma.taskList.deleteMany({ where: { folderId: f.id } }), prisma.folder.delete({ where: { id: f.id } })]);
    await audit(ctx, 'FOLDER_DELETED', 'folder', f.id, { name: f.name, lists: lists.length }, { clientId: f.space.clientId });
    res.json({ ok: true });
  }),
);

// ── lists ──

spacesRouter.post(
  '/:id/lists',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const s = await findSpace(ctx.scope, idParam(req));
    assertManage(ctx.scope, s);
    const body = parse(listSchema, req.body);
    if (body.folderId && !(await prisma.folder.findFirst({ where: { id: body.folderId, spaceId: s.id }, select: { id: true } }))) throw Errors.validation({ folderId: 'invalid_choice' });
    // a list inside a project folder belongs to that project unless another one is given
    const folderProject = body.folderId ? (await prisma.folder.findUnique({ where: { id: body.folderId }, select: { projectId: true } }))?.projectId : null;
    const projectId = body.projectId ?? folderProject ?? null;
    await checkProject(ctx.scope, projectId, s.clientId);
    const max = await prisma.taskList.aggregate({ where: { spaceId: s.id, folderId: body.folderId ?? null }, _max: { position: true } });
    const l = await prisma.taskList.create({
      data: { spaceId: s.id, folderId: body.folderId ?? null, projectId, name: body.name, description: body.description ?? null, color: body.color ?? null, position: (max._max.position ?? -1) + 1 },
    });
    await audit(ctx, 'LIST_CREATED', 'list', l.id, { name: l.name, space: s.name }, { clientId: s.clientId, projectId: l.projectId });
    res.status(201).json({ item: l });
  }),
);

spacesRouter.put(
  '/:id/lists/reorder',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const s = await findSpace(ctx.scope, idParam(req));
    assertManage(ctx.scope, s);
    const { ids } = parse(reorderSchema, req.body);
    const n = await prisma.taskList.count({ where: { id: { in: ids }, spaceId: s.id } });
    if (n !== new Set(ids).size) throw Errors.validation({ ids: 'invalid_choice' });
    await prisma.$transaction(ids.map((id, position) => prisma.taskList.update({ where: { id }, data: { position } })));
    res.json({ ok: true });
  }),
);

spacesRouter.get(
  '/lists/:id',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const l = await findList(scope, idParam(req));
    const statuses = await prisma.taskStatusOption.findMany({ where: { spaceId: l.spaceId }, orderBy: { position: 'asc' } });
    res.json({ item: { ...l, statuses } });
  }),
);

spacesRouter.patch(
  '/lists/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const l = await findList(ctx.scope, idParam(req));
    assertManage(ctx.scope, l.space);
    const body = parse(listUpdateSchema, req.body);
    if (body.folderId && !(await prisma.folder.findFirst({ where: { id: body.folderId, spaceId: l.spaceId }, select: { id: true } }))) throw Errors.validation({ folderId: 'invalid_choice' });
    if (body.projectId !== undefined && body.projectId !== l.projectId) {
      await checkProject(ctx.scope, body.projectId, l.space.clientId);
      // tasks already in the list must belong to that project's client
      if (body.projectId) {
        const p = await prisma.project.findUniqueOrThrow({ where: { id: body.projectId }, select: { clientId: true } });
        if (await prisma.task.count({ where: { listId: l.id, clientId: { not: p.clientId } } })) throw Errors.validation({ projectId: 'list_has_other_clients' });
      }
    }
    const { archived, ...rest } = body;
    const item = await prisma.taskList.update({ where: { id: l.id }, data: { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) } });
    await audit(ctx, 'LIST_UPDATED', 'list', l.id, { name: item.name, fields: Object.keys(body) }, { clientId: l.space.clientId, projectId: item.projectId });
    res.json({ item });
  }),
);

spacesRouter.delete(
  '/lists/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const l = await findList(ctx.scope, idParam(req));
    assertManage(ctx.scope, l.space);
    await detachLists([l.id]);
    await prisma.$transaction([prisma.taskAutomation.deleteMany({ where: { listId: l.id } }), prisma.taskList.delete({ where: { id: l.id } })]);
    await audit(ctx, 'LIST_DELETED', 'list', l.id, { name: l.name }, { clientId: l.space.clientId, projectId: l.projectId });
    res.json({ ok: true });
  }),
);

// ───────────────────────── custom fields ─────────────────────────

export const taskFieldsRouter = Router();
taskFieldsRouter.use(authenticate, requirePerm('tasks.view'));

const fieldSchema = z
  .object({ name: z.string().trim().min(1).max(60), type: z.enum(CUSTOM_FIELD_TYPES), options: z.array(z.string().trim().min(1).max(60)).max(30).optional(), spaceId: idField.nullish() })
  .strict();
const fieldUpdateSchema = z.object({ name: z.string().trim().min(1).max(60), options: z.array(z.string().trim().min(1).max(60)).max(30) }).partial().strict();

const fieldDto = (f: { id: string; name: string; type: string; options: string | null; spaceId: string | null; position: number }) => ({ ...f, options: parseOptions(f.options) });

taskFieldsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const spaceId = qs(req.query, 'spaceId');
    const spaces = await prisma.space.findMany({ where: spaceWhere(scope), select: { id: true } });
    const allowed = spaces.map((s) => s.id);
    const where: Prisma.TaskCustomFieldWhereInput = spaceId ? { OR: [{ spaceId: null }, { spaceId: allowed.includes(spaceId) ? spaceId : '__none__' }] } : { OR: [{ spaceId: null }, { spaceId: { in: allowed } }] };
    const rows = await prisma.taskCustomField.findMany({ where, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    res.json({ items: rows.map(fieldDto) });
  }),
);

taskFieldsRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(fieldSchema, req.body);
    if (body.spaceId) assertManage(ctx.scope, await findSpace(ctx.scope, body.spaceId));
    else if (ctx.user.role !== 'ADMIN') throw Errors.forbidden(); // global fields are an administrator decision
    const options = body.type === 'SELECT' ? [...new Set(body.options ?? [])] : [];
    if (body.type === 'SELECT' && options.length === 0) throw Errors.validation({ options: 'required' });
    const max = await prisma.taskCustomField.aggregate({ _max: { position: true } });
    const f = await prisma.taskCustomField.create({ data: { name: body.name, type: body.type, options: options.length ? JSON.stringify(options) : null, spaceId: body.spaceId ?? null, position: (max._max.position ?? -1) + 1 } });
    await audit(ctx, 'CUSTOM_FIELD_CREATED', 'custom_field', f.id, { name: f.name, type: f.type });
    res.status(201).json({ item: fieldDto(f) });
  }),
);

async function managedField(ctx: ReturnType<typeof ctxOf>, id: string) {
  const f = await prisma.taskCustomField.findUnique({ where: { id } });
  if (!f) throw Errors.notFound();
  if (f.spaceId) assertManage(ctx.scope, await findSpace(ctx.scope, f.spaceId));
  else if (ctx.user.role !== 'ADMIN') throw Errors.forbidden();
  return f;
}

taskFieldsRouter.patch(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const f = await managedField(ctx, idParam(req));
    const body = parse(fieldUpdateSchema, req.body);
    if (body.options && f.type !== 'SELECT') throw Errors.validation({ options: 'not_allowed' });
    const item = await prisma.taskCustomField.update({ where: { id: f.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.options ? { options: JSON.stringify([...new Set(body.options)]) } : {}) } });
    await audit(ctx, 'CUSTOM_FIELD_UPDATED', 'custom_field', f.id, { name: item.name, fields: Object.keys(body) });
    res.json({ item: fieldDto(item) });
  }),
);

taskFieldsRouter.delete(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const f = await managedField(ctx, idParam(req));
    await prisma.$transaction([prisma.taskCustomFieldValue.deleteMany({ where: { fieldId: f.id } }), prisma.taskCustomField.delete({ where: { id: f.id } })]);
    await audit(ctx, 'CUSTOM_FIELD_DELETED', 'custom_field', f.id, { name: f.name });
    res.json({ ok: true });
  }),
);

// ───────────────────────── tags ─────────────────────────

export const taskTagsRouter = Router();
taskTagsRouter.use(authenticate, requirePerm('tasks.view'));

const tagUpdateSchema = z.object({ name: z.string().trim().min(1).max(40), color }).partial().strict();

taskTagsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = qs(req.query, 'q');
    const rows = await prisma.taskTag.findMany({
      where: q ? { name: { contains: q } } : {},
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true, color: true, _count: { select: { links: true } } },
    });
    res.json({ items: rows.map((r) => ({ id: r.id, name: r.name, color: r.color, count: r._count.links })) });
  }),
);

taskTagsRouter.patch(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const tag = await prisma.taskTag.findUnique({ where: { id: idParam(req) } });
    if (!tag) throw Errors.notFound();
    const body = parse(tagUpdateSchema, req.body);
    const nameNorm = body.name ? normalizeTagName(body.name) : undefined;
    if (nameNorm && nameNorm.toLowerCase() !== tag.name.toLowerCase()) {
      const all = await prisma.taskTag.findMany({ select: { id: true, name: true } });
      if (all.some((t) => t.id !== tag.id && t.name.toLowerCase() === nameNorm.toLowerCase())) throw Errors.validation({ name: 'duplicate' });
    }
    const item = await prisma.taskTag.update({ where: { id: tag.id }, data: { ...(nameNorm ? { name: nameNorm } : {}), ...(body.color ? { color: body.color } : {}) } });
    await audit(ctx, 'TAG_UPDATED', 'tag', tag.id, { name: item.name });
    res.json({ item });
  }),
);

taskTagsRouter.delete(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const tag = await prisma.taskTag.findUnique({ where: { id: idParam(req) } });
    if (!tag) throw Errors.notFound();
    await prisma.$transaction([prisma.taskTagLink.deleteMany({ where: { tagId: tag.id } }), prisma.taskTag.delete({ where: { id: tag.id } })]);
    await audit(ctx, 'TAG_DELETED', 'tag', tag.id, { name: tag.name });
    res.json({ ok: true });
  }),
);
