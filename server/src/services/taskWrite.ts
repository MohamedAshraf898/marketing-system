// Task writes shared by the tasks route, bulk actions, templates, recurring tasks and automations, so that every path
// enforces the same rules and produces the same audit trail / notifications / automation triggers.
import type { Prisma, Priority, TaskStatus, TaskVisibility } from '@prisma/client';
import { prisma } from '../db';
import type { Ctx } from '../lib/context';
import { Errors } from '../lib/errors';
import { storage } from '../storage';
import { audit } from './audit';
import { notify } from './notifications';
import { assertStaffForClient, todayUtc } from './projects';
import { runAutomations } from './taskAutomations';
import { normalizeFieldValues, setTaskTags, type FieldInput } from './taskFields';
import {
  assigneeIdsOf, descendantIds, MAX_TASK_DEPTH, openBlockers, resolveCustomStatus, resolveTaskLinks, resolveWorkLinks, taskAccess, type TaskLinks, type TaskRow,
} from './tasks';

type Db = Prisma.TransactionClient | typeof prisma;

/** Who acts. A system actor (recurring tasks, overdue rules) has no user and no scope. */
export type Actor = Ctx | { ip: null; user: null; scope?: undefined };
export const SYSTEM: Actor = { ip: null, user: null };
const actorId = (a: Actor) => a.user?.id ?? 'system';
const actorName = (a: Actor) => a.user?.name ?? 'System';

export const taskAuditOpts = (t: { clientId: string | null; projectId: string | null }) => ({ clientId: t.clientId, projectId: t.projectId, clientVisible: false });

/** Starting a task is blocked while one of its blockers is open (only when the task opts in). */
const STARTED: TaskStatus[] = ['IN_PROGRESS', 'REVIEW', 'DONE'];

export const MAX_ASSIGNEES = 10;

// ───────────────────────── create ─────────────────────────

export interface NewTask {
  title: string;
  description: string | null;
  priority: Priority;
  status: TaskStatus;
  customStatusId: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  visibility: TaskVisibility;
  links: TaskLinks;
  deliverableId: string | null;
  requestId: string | null;
  reviewerId: string | null;
  assigneeIds: string[];
  primaryAssigneeId: string | null;
  tagNames: string[];
  blockOnDependencies: boolean;
  createdById: string | null;
  checklist?: string[];
  fieldValues?: Array<{ fieldId: string; value: string }>;
  recurrenceSourceId?: string | null;
  occurrenceDate?: Date | null;
}

/** Inserts a task + its assignees / tags / checklist / field values. The caller has validated everything. */
export async function insertTask(db: Db, t: NewTask): Promise<string> {
  const assignees = [...new Set(t.assigneeIds)];
  const primary = t.primaryAssigneeId && assignees.includes(t.primaryAssigneeId) ? t.primaryAssigneeId : (assignees[0] ?? null);
  const row = await db.task.create({
    data: {
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      customStatusId: t.customStatusId,
      startDate: t.startDate,
      dueDate: t.dueDate,
      completedAt: t.status === 'DONE' ? new Date() : null,
      estimatedHours: t.estimatedHours,
      visibility: t.visibility,
      clientId: t.links.clientId,
      projectId: t.links.projectId,
      campaignId: t.links.campaignId,
      listId: t.links.listId,
      parentId: t.links.parentId,
      depth: t.links.depth,
      position: Date.now() / 1000, // new tasks go to the end of their list / column
      deliverableId: t.deliverableId,
      requestId: t.requestId,
      reviewerId: t.reviewerId,
      assignedToId: primary,
      createdById: t.createdById,
      blockOnDependencies: t.blockOnDependencies,
      recurrenceSourceId: t.recurrenceSourceId ?? null,
      occurrenceDate: t.occurrenceDate ?? null,
    },
  });
  if (assignees.length) await db.taskAssignee.createMany({ data: assignees.map((userId) => ({ taskId: row.id, userId })) });
  if (t.tagNames.length) await setTaskTags(db, row.id, t.tagNames);
  if (t.checklist?.length) await db.taskChecklistItem.createMany({ data: t.checklist.map((text, position) => ({ taskId: row.id, text, position })) });
  if (t.fieldValues?.length) await db.taskCustomFieldValue.createMany({ data: t.fieldValues.map((v) => ({ taskId: row.id, fieldId: v.fieldId, value: v.value })) });
  return row.id;
}

/** Audit + notifications + automations after a task was created (by a person or the system). */
export async function afterCreate(actor: Actor, id: string, opts: { automationDepth?: number; extraAudit?: Record<string, unknown> } = {}) {
  const t = await prisma.task.findUnique({ where: { id }, select: { id: true, title: true, status: true, clientId: true, projectId: true, parentId: true, assignedToId: true, assignees: { select: { userId: true } } } });
  if (!t) return;
  const opt = taskAuditOpts(t);
  await audit(actor, 'TASK_CREATED', 'task', t.id, { title: t.title, status: t.status, ...(opts.extraAudit ?? {}) }, opt);
  if (t.parentId) {
    const parent = await prisma.task.findUnique({ where: { id: t.parentId }, select: { id: true, title: true, status: true } });
    if (parent) await audit(actor, 'SUBTASK_CREATED', 'task', parent.id, { title: parent.title, status: parent.status, subtaskId: t.id, subtask: t.title }, opt);
  }
  const assignees = assigneeIdsOf(t);
  if (assignees.length) {
    await audit(actor, 'TASK_ASSIGNED', 'task', t.id, { title: t.title, status: t.status, assigneeId: t.assignedToId }, opt);
    await notify(assignees, { type: 'TASK_ASSIGNED', entity: 'task', entityId: t.id, data: { title: t.title, by: actorName(actor) } }, actorId(actor));
  }
  const depth = opts.automationDepth ?? 0;
  await runAutomations(actor, 'TASK_CREATED', t.id, { depth });
  if (assignees.length) await runAutomations(actor, 'TASK_ASSIGNED', t.id, { depth, assigneeIds: assignees });
}

// ───────────────────────── update ─────────────────────────

export interface TaskPatch {
  title?: string;
  description?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  customStatusId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number | null;
  visibility?: TaskVisibility;
  listId?: string | null;
  projectId?: string | null;
  campaignId?: string | null;
  parentId?: string | null;
  deliverableId?: string | null;
  requestId?: string | null;
  reviewerId?: string | null;
  assignedToId?: string | null;
  assigneeIds?: string[];
  addAssigneeIds?: string[];
  tags?: string[];
  addTags?: string[];
  blockOnDependencies?: boolean;
  archived?: boolean;
  customFields?: FieldInput;
}

/** Fields that need `tasks.edit_all` or being the creator. Everything else only needs "may work on it". */
const PLANNING_FIELDS: Array<keyof TaskPatch> = [
  'title', 'priority', 'startDate', 'dueDate', 'assignedToId', 'assigneeIds', 'addAssigneeIds', 'reviewerId', 'projectId', 'campaignId', 'listId',
  'parentId', 'estimatedHours', 'visibility', 'deliverableId', 'requestId', 'blockOnDependencies', 'archived',
];

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const same = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? iso(a as Date | null) === iso(b as Date | null) : a === b);

/**
 * Applies a change to one task on behalf of a person. Throws 403 / 400 / 409 like the PATCH route. Also used by bulk
 * actions, so a bulk change can never do more than the same change made one task at a time.
 */
export async function applyTaskPatch(ctx: Ctx, existing: TaskRow, body: TaskPatch, opts: { automationDepth?: number } = {}): Promise<void> {
  const access = taskAccess(ctx.scope, existing);
  if (!access.canWork) throw Errors.forbidden();
  if (PLANNING_FIELDS.some((k) => k in body) && !access.canEditFields) throw Errors.forbidden();

  // ── where the task lives ──
  const links: TaskLinks = {
    clientId: existing.clientId, projectId: existing.projectId, campaignId: existing.campaignId, listId: existing.listId,
    spaceId: existing.list?.spaceId ?? null, parentId: existing.parentId, depth: existing.depth,
  };
  let moved = false;
  if ('parentId' in body && (body.parentId ?? null) !== existing.parentId) {
    moved = true;
    if (body.parentId) {
      if (body.parentId === existing.id) throw Errors.validation({ parentId: 'invalid_choice' });
      const desc = await descendantIds([existing.id]);
      if (desc.includes(body.parentId)) throw Errors.validation({ parentId: 'invalid_choice' });
      const r = await resolveTaskLinks(ctx.scope, { parentId: body.parentId });
      const deepest = desc.length ? (await prisma.task.aggregate({ where: { id: { in: desc } }, _max: { depth: true } }))._max.depth ?? existing.depth : existing.depth;
      if (r.depth + (deepest - existing.depth) > MAX_TASK_DEPTH) throw Errors.validation({ parentId: 'too_deep' });
      if (existing.clientId && r.clientId !== existing.clientId) throw Errors.validation({ parentId: 'invalid_choice' });
      Object.assign(links, r);
    } else {
      links.parentId = null;
      links.depth = 0;
    }
  }
  if ('listId' in body && !moved && (body.listId ?? null) !== existing.listId) {
    if (existing.parentId) throw Errors.validation({ listId: 'not_allowed' }); // subtasks follow their parent
    moved = true;
    if (body.listId) {
      const r = await resolveTaskLinks(ctx.scope, { listId: body.listId });
      if (existing.clientId && r.clientId && r.clientId !== existing.clientId) throw Errors.validation({ listId: 'invalid_choice' });
      links.listId = r.listId;
      links.spaceId = r.spaceId;
      if (r.projectId) links.projectId = r.projectId;
      if (r.clientId) links.clientId = r.clientId;
    } else {
      links.listId = null;
      links.spaceId = null;
    }
  }
  if ('projectId' in body && !existing.parentId) {
    if (body.projectId) {
      const r = await resolveTaskLinks(ctx.scope, { projectId: body.projectId });
      if (links.clientId && r.clientId !== links.clientId) throw Errors.validation({ projectId: 'invalid_choice' });
      links.projectId = r.projectId;
      links.clientId = r.clientId;
    } else links.projectId = null;
  }
  if ('campaignId' in body && !existing.parentId) {
    if (body.campaignId) {
      const r = await resolveTaskLinks(ctx.scope, { campaignId: body.campaignId });
      if (links.clientId && r.clientId !== links.clientId) throw Errors.validation({ campaignId: 'invalid_choice' });
      links.campaignId = r.campaignId;
      links.clientId = r.clientId;
    } else links.campaignId = null;
  }
  const work = await resolveWorkLinks(ctx.scope, links.clientId, { deliverableId: body.deliverableId, requestId: body.requestId });

  // ── people ──
  const before = assigneeIdsOf(existing);
  let nextAssignees = before;
  let primary = existing.assignedToId;
  if (body.assigneeIds !== undefined) {
    nextAssignees = [...new Set(body.assigneeIds)];
    primary = body.assignedToId && nextAssignees.includes(body.assignedToId) ? body.assignedToId : (nextAssignees[0] ?? null);
  } else if ('assignedToId' in body) {
    nextAssignees = body.assignedToId ? [body.assignedToId] : [];
    primary = body.assignedToId ?? null;
  } else if (body.addAssigneeIds?.length) {
    nextAssignees = [...new Set([...before, ...body.addAssigneeIds])];
    primary = primary ?? nextAssignees[0] ?? null;
  }
  if (nextAssignees.length > MAX_ASSIGNEES) throw Errors.validation({ assigneeIds: 'too_big' });
  const added = nextAssignees.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !nextAssignees.includes(id));
  const field = body.assigneeIds !== undefined ? 'assigneeIds' : 'assignedToId';
  for (const id of added) {
    if (id !== ctx.user.id && !access.canAssign) throw Errors.forbidden();
    await assertStaffForClient(id, links.clientId, links.campaignId, field);
  }
  if (body.reviewerId) await assertStaffForClient(body.reviewerId, links.clientId, links.campaignId, 'reviewerId');

  // ── status ──
  const spaceChanged = links.spaceId !== (existing.list?.spaceId ?? null);
  let status = existing.status;
  let customStatusId = existing.customStatusId;
  if (body.customStatusId !== undefined || body.status !== undefined || spaceChanged) {
    const r = await resolveCustomStatus(links.spaceId, {
      customStatusId: body.customStatusId,
      status: body.status ?? (spaceChanged && body.customStatusId === undefined ? existing.status : undefined),
    });
    if (r.status) status = r.status;
    customStatusId = r.customStatusId;
  }
  const statusChanged = status !== existing.status;
  const blockOn = body.blockOnDependencies ?? existing.blockOnDependencies;
  if (statusChanged && blockOn && STARTED.includes(status)) {
    const blockers = await openBlockers(existing.id);
    if (blockers.length) throw Errors.conflict('TASK_BLOCKED', `Waiting for: ${blockers.map((b) => b.dependsOn.title).join(', ')}`);
  }

  // ── dates / visibility ──
  const startDate = body.startDate !== undefined ? body.startDate : existing.startDate;
  const dueDate = body.dueDate !== undefined ? body.dueDate : existing.dueDate;
  if (startDate && dueDate && dueDate < startDate) throw Errors.validation({ dueDate: 'end_before_start' });
  const visibility = body.visibility ?? existing.visibility;
  if (visibility === 'CLIENT_VISIBLE' && !links.clientId) throw Errors.validation({ visibility: 'needs_client' });

  const fieldValues = body.customFields ? await normalizeFieldValues(body.customFields, links.spaceId) : null;

  // ── write ──
  const data: Prisma.TaskUncheckedUpdateInput = {
    clientId: links.clientId, projectId: links.projectId, campaignId: links.campaignId, listId: links.listId, parentId: links.parentId, depth: links.depth,
    status, customStatusId, assignedToId: primary, startDate, dueDate, visibility,
  };
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.estimatedHours !== undefined) data.estimatedHours = body.estimatedHours;
  if (body.reviewerId !== undefined) data.reviewerId = body.reviewerId;
  if (body.blockOnDependencies !== undefined) data.blockOnDependencies = body.blockOnDependencies;
  if (work.deliverableId !== undefined) data.deliverableId = work.deliverableId;
  if (work.requestId !== undefined) data.requestId = work.requestId;
  if (statusChanged) data.completedAt = status === 'DONE' ? new Date() : null;
  const archiving = body.archived !== undefined && body.archived !== !!existing.archivedAt;
  if (archiving) data.archivedAt = body.archived ? new Date() : null;

  const linksChanged = moved || links.clientId !== existing.clientId || links.projectId !== existing.projectId || links.campaignId !== existing.campaignId;
  // read before the transaction: on SQLite a read through the global client inside it would wait on the transaction's own lock
  const desc = linksChanged || archiving ? await descendantIds([existing.id]) : [];
  const descRows = desc.length && links.depth !== existing.depth ? await prisma.task.findMany({ where: { id: { in: desc } }, select: { id: true, depth: true } }) : [];
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: existing.id }, data });
    if (removed.length) await tx.taskAssignee.deleteMany({ where: { taskId: existing.id, userId: { in: removed } } });
    if (added.length) await tx.taskAssignee.createMany({ data: added.map((userId) => ({ taskId: existing.id, userId })) });
    if (body.tags !== undefined) await setTaskTags(tx, existing.id, body.tags);
    if (body.addTags?.length) await setTaskTags(tx, existing.id, [...existing.tagLinks.map((l) => l.tag.name), ...body.addTags]);
    if (fieldValues) {
      for (const v of fieldValues) {
        if (v.value === null) await tx.taskCustomFieldValue.deleteMany({ where: { taskId: existing.id, fieldId: v.fieldId } });
        else await tx.taskCustomFieldValue.upsert({ where: { taskId_fieldId: { taskId: existing.id, fieldId: v.fieldId } }, create: { taskId: existing.id, fieldId: v.fieldId, value: v.value }, update: { value: v.value } });
      }
    }
    // the subtree follows its root: same client / project / campaign / list, depth shifted, archived together
    if (desc.length) {
      const sub: Prisma.TaskUncheckedUpdateManyInput = {};
      if (linksChanged) Object.assign(sub, { clientId: links.clientId, projectId: links.projectId, campaignId: links.campaignId, listId: links.listId });
      if (archiving) sub.archivedAt = data.archivedAt as Date | null;
      await tx.task.updateMany({ where: { id: { in: desc } }, data: sub });
      const shift = links.depth - existing.depth;
      for (const r of descRows) await tx.task.update({ where: { id: r.id }, data: { depth: r.depth + shift } });
    }
  });

  // ── audit trail (old -> new) ──
  const opt = taskAuditOpts(links);
  const title = body.title ?? existing.title;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const track = (k: string, from: unknown, to: unknown) => { if (!same(from, to)) changes[k] = { from: from instanceof Date ? iso(from) : from, to: to instanceof Date ? iso(to) : to }; };
  if (body.title !== undefined) track('title', existing.title, body.title);
  if (body.description !== undefined) track('description', existing.description ? '…' : null, body.description ? '…' : null);
  if (body.estimatedHours !== undefined) track('estimatedHours', existing.estimatedHours, body.estimatedHours);
  if (body.startDate !== undefined) track('startDate', existing.startDate, body.startDate);
  if (body.visibility !== undefined) track('visibility', existing.visibility, body.visibility);
  if (body.reviewerId !== undefined) track('reviewerId', existing.reviewerId, body.reviewerId);
  if (body.blockOnDependencies !== undefined) track('blockOnDependencies', existing.blockOnDependencies, body.blockOnDependencies);
  if (work.deliverableId !== undefined) track('deliverableId', existing.deliverableId, work.deliverableId);
  if (work.requestId !== undefined) track('requestId', existing.requestId, work.requestId);
  track('projectId', existing.projectId, links.projectId);
  track('campaignId', existing.campaignId, links.campaignId);
  track('listId', existing.listId, links.listId);
  track('parentId', existing.parentId, links.parentId);
  if (body.tags !== undefined || body.addTags?.length) changes.tags = { from: existing.tagLinks.map((l) => l.tag.name), to: body.tags ?? [...existing.tagLinks.map((l) => l.tag.name), ...(body.addTags ?? [])] };
  if (fieldValues?.length) changes.customFields = { from: null, to: fieldValues.map((v) => v.fieldId) };
  if (customStatusId !== existing.customStatusId && !statusChanged) track('customStatusId', existing.customStatusId, customStatusId);
  if (Object.keys(changes).length) await audit(ctx, 'TASK_UPDATED', 'task', existing.id, { title, status, fields: Object.keys(changes), changes }, opt);
  if (body.priority !== undefined && body.priority !== existing.priority) await audit(ctx, 'TASK_PRIORITY_CHANGED', 'task', existing.id, { title, status, from: existing.priority, to: body.priority }, opt);
  if (body.dueDate !== undefined && !same(existing.dueDate, body.dueDate)) await audit(ctx, 'TASK_DUE_DATE_CHANGED', 'task', existing.id, { title, status, from: iso(existing.dueDate), to: iso(body.dueDate) }, opt);
  if (statusChanged) {
    await audit(ctx, 'TASK_STATUS_CHANGED', 'task', existing.id, { title, status, from: existing.status, to: status }, opt);
    if (status === 'DONE') await audit(ctx, 'TASK_COMPLETED', 'task', existing.id, { title, status }, opt);
  }
  if (added.length || removed.length) await audit(ctx, 'TASK_ASSIGNED', 'task', existing.id, { title, status, assigneeId: primary, added, removed }, opt);
  if (archiving) await audit(ctx, body.archived ? 'TASK_ARCHIVED' : 'TASK_UNARCHIVED', 'task', existing.id, { title, status }, opt);

  // ── notifications + automations ──
  if (added.length) await notify(added, { type: 'TASK_ASSIGNED', entity: 'task', entityId: existing.id, data: { title, by: ctx.user.name } }, ctx.user.id);
  if (statusChanged) await afterStatusChange(ctx, { ...existing, title, status, reviewerId: body.reviewerId !== undefined ? body.reviewerId : existing.reviewerId, assigneeIds: nextAssignees }, existing.status);
  const depth = opts.automationDepth ?? 0;
  if (statusChanged) await runAutomations(ctx, 'STATUS_CHANGED', existing.id, { depth, fromStatus: existing.status });
  if (added.length) await runAutomations(ctx, 'TASK_ASSIGNED', existing.id, { depth, assigneeIds: added });
}

/** Built-in rules that always run on a status change (the configurable ones live in taskAutomations.ts). */
async function afterStatusChange(
  actor: Actor,
  t: { id: string; title: string; status: TaskStatus; createdById: string | null; reviewerId: string | null; parentId: string | null; clientId: string | null; projectId: string | null; assigneeIds: string[] },
  from: TaskStatus,
) {
  const by = actorName(actor);
  const reviewTarget = t.status === 'REVIEW' ? (t.reviewerId ?? t.createdById) : null;
  const watchers = [...t.assigneeIds, t.createdById].filter((id): id is string => !!id && id !== reviewTarget);
  await notify(watchers, { type: 'TASK_STATUS_CHANGED', entity: 'task', entityId: t.id, data: { title: t.title, taskStatus: t.status, from, by } }, actorId(actor));
  if (reviewTarget) await notify([reviewTarget], { type: 'TASK_REVIEW', entity: 'task', entityId: t.id, data: { title: t.title, by } }, actorId(actor));

  if (t.status === 'DONE') {
    // dependents: tell their people the blocker is done
    const dependents = await prisma.taskDependency.findMany({
      where: { dependsOnId: t.id, type: 'BLOCKS' },
      select: { task: { select: { id: true, title: true, assignedToId: true, assignees: { select: { userId: true } } } } },
    });
    for (const d of dependents) {
      await notify(assigneeIdsOf(d.task), { type: 'TASK_DEPENDENCY_DONE', entity: 'task', entityId: d.task.id, data: { title: d.task.title, blocker: t.title } }, actorId(actor));
    }
    if (t.parentId) {
      const parent = await prisma.task.findUnique({ where: { id: t.parentId }, select: { id: true, title: true, status: true, clientId: true, projectId: true } });
      if (parent) await audit(actor, 'SUBTASK_COMPLETED', 'task', parent.id, { title: parent.title, status: parent.status, subtaskId: t.id, subtask: t.title }, taskAuditOpts(parent));
    }
  }
}

// ───────────────────────── delete ─────────────────────────

/** Deletes tasks with their whole subtree. Logged time is kept (entries just lose the task link). */
export async function deleteTaskTree(ctx: Ctx, root: { id: string; title: string; status: TaskStatus; clientId: string | null; projectId: string | null }) {
  const ids = [root.id, ...(await descendantIds([root.id]))];
  const files = await prisma.file.findMany({ where: { taskId: { in: ids } }, select: { id: true, filePath: true } });
  const recurring = await prisma.taskRecurrence.findMany({ where: { taskId: { in: ids } }, select: { id: true } });
  await prisma.$transaction([
    prisma.timeEntry.updateMany({ where: { taskId: { in: ids } }, data: { taskId: null } }),
    prisma.task.updateMany({ where: { recurrenceSourceId: { in: ids } }, data: { recurrenceSourceId: null } }),
    prisma.file.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskComment.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskChecklistItem.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskAssignee.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskTagLink.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskCustomFieldValue.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskDependency.deleteMany({ where: { OR: [{ taskId: { in: ids } }, { dependsOnId: { in: ids } }] } }),
    prisma.taskRecurrence.deleteMany({ where: { id: { in: recurring.map((r) => r.id) } } }),
    // children first (deepest level last created), then the root
    prisma.task.deleteMany({ where: { id: { in: ids.slice(1) }, depth: { gte: 3 } } }),
    prisma.task.deleteMany({ where: { id: { in: ids.slice(1) }, depth: 2 } }),
    prisma.task.deleteMany({ where: { id: { in: ids.slice(1) } } }),
    prisma.task.delete({ where: { id: root.id } }),
  ]);
  await Promise.all(files.map((f) => storage.delete(f.filePath).catch(() => undefined)));
  await audit(ctx, 'TASK_DELETED', 'task', root.id, { title: root.title, status: root.status, ...(ids.length > 1 ? { subtasks: ids.length - 1 } : {}) }, taskAuditOpts(root));
  return ids.length;
}

/** Due date is in the past and the task is still open (date-only values: the whole due day counts). */
export const isOverdueNow = (dueDate: Date | null, status: TaskStatus) => !!dueDate && dueDate < todayUtc() && status !== 'DONE';
