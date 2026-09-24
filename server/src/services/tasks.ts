import type { Prisma } from '@prisma/client';
import { TASK_STATUSES, type TaskStatus } from '../../../shared/src/enums';
import { campaignWhere, deliverableWhere, projectWhere, requestWhere, spaceWhere, taskWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { Errors } from '../lib/errors';
import { addDaysUtc, emptyStatusCounts, todayUtc } from './projects';
import { and } from './serializers';

/** 0 = top-level task. Subtasks may nest this deep (task -> subtask -> sub-subtask -> one more level). */
export const MAX_TASK_DEPTH = 3;

const userLite = { id: true, name: true, avatar: true, role: true } satisfies Prisma.UserSelect;

export const taskInclude = {
  assignedTo: { select: userLite },
  createdBy: { select: { id: true, name: true } },
  reviewer: { select: userLite },
  client: { select: { id: true, companyName: true } },
  project: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  list: { select: { id: true, name: true, spaceId: true, folderId: true, space: { select: { id: true, name: true, color: true } } } },
  parent: { select: { id: true, title: true } },
  customStatus: { select: { id: true, name: true, color: true, category: true } },
  deliverable: { select: { id: true, name: true, status: true } },
  request: { select: { id: true, title: true, status: true } },
  assignees: { select: { user: { select: userLite } }, orderBy: { createdAt: 'asc' } },
  tagLinks: { select: { tag: { select: { id: true, name: true, color: true } } } },
  recurrence: { select: { id: true, frequency: true, interval: true, weekdays: true, monthDay: true, nextDate: true, endDate: true, active: true } },
  _count: { select: { comments: true, files: true, subtasks: true } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** Scoped single-record lookup: out-of-scope (and every task, for clients) == 404. */
export async function findTask(scope: Scope, id: string) {
  const t = await prisma.task.findFirst({ where: and<Prisma.TaskWhereInput>({ id }, taskWhere(scope)), include: taskInclude });
  if (!t) throw Errors.notFound();
  return t;
}

export interface TaskAccess {
  /** may change status / description / checklist / subtasks / dependencies */
  canWork: boolean;
  /** may change title, priority, dates, estimate, assignees, reviewer, list, project / campaign, visibility */
  canEditFields: boolean;
  canDelete: boolean;
  canAssign: boolean;
}

type AccessInput = {
  createdById: string | null;
  assignedToId: string | null;
  reviewerId?: string | null;
  assignees?: Array<{ user?: { id: string } | null; userId?: string }>;
};

export const assigneeIdsOf = (t: Pick<AccessInput, 'assignedToId' | 'assignees'>): string[] => {
  const ids = (t.assignees ?? []).map((a) => a.user?.id ?? a.userId).filter((x): x is string => !!x);
  if (t.assignedToId && !ids.includes(t.assignedToId)) ids.unshift(t.assignedToId);
  return ids;
};

/**
 * Being inside taskWhere means "may see". Working on a task needs more:
 *   - an assignee, the reviewer or the creator, or `tasks.edit_all` (ADMIN always) may update status / description / checklist
 *   - changing the planning fields needs `tasks.edit_all` or being the creator
 */
export function taskAccess(scope: Scope, t: AccessInput): TaskAccess {
  const editAll = scope.permissions.has('tasks.edit_all');
  const creator = t.createdById === scope.userId;
  const assignee = assigneeIdsOf(t).includes(scope.userId);
  const reviewer = !!t.reviewerId && t.reviewerId === scope.userId;
  return {
    canWork: editAll || creator || assignee || reviewer,
    canEditFields: editAll || creator,
    canDelete: scope.permissions.has('tasks.delete'),
    canAssign: scope.permissions.has('tasks.assign'),
  };
}

export const isTaskOverdue = (t: { dueDate: Date | null; status: TaskStatus }, today = todayUtc()) => !!t.dueDate && t.dueDate < today && t.status !== 'DONE';

export interface ChecklistProgress { done: number; total: number }
export interface TaskMeta { checklist: ChecklistProgress; subtasks: ChecklistProgress; blockedBy: number }

export async function loadChecklistProgress(taskIds: string[]): Promise<Map<string, ChecklistProgress>> {
  const out = new Map<string, ChecklistProgress>();
  for (const id of taskIds) out.set(id, { done: 0, total: 0 });
  if (taskIds.length === 0) return out;
  const rows = await prisma.taskChecklistItem.groupBy({ by: ['taskId', 'done'], where: { taskId: { in: taskIds } }, _count: { _all: true } });
  for (const r of rows) {
    const p = out.get(r.taskId);
    if (!p) continue;
    p.total += r._count._all;
    if (r.done) p.done += r._count._all;
  }
  return out;
}

/** Checklist + subtask progress + open blockers for many tasks: three grouped queries in total (never per task). */
export async function loadTaskMeta(taskIds: string[]): Promise<Map<string, TaskMeta>> {
  const out = new Map<string, TaskMeta>();
  for (const id of taskIds) out.set(id, { checklist: { done: 0, total: 0 }, subtasks: { done: 0, total: 0 }, blockedBy: 0 });
  if (taskIds.length === 0) return out;
  const [checklist, subtasks, blockers] = await Promise.all([
    loadChecklistProgress(taskIds),
    prisma.task.groupBy({ by: ['parentId', 'status'], where: { parentId: { in: taskIds }, archivedAt: null }, _count: { _all: true } }),
    prisma.taskDependency.groupBy({ by: ['taskId'], where: { taskId: { in: taskIds }, type: 'BLOCKS', dependsOn: { status: { not: 'DONE' } } }, _count: { _all: true } }),
  ]);
  for (const [id, c] of checklist) out.get(id)!.checklist = c;
  for (const r of subtasks) {
    const m = r.parentId ? out.get(r.parentId) : undefined;
    if (!m) continue;
    m.subtasks.total += r._count._all;
    if (r.status === 'DONE') m.subtasks.done += r._count._all;
  }
  for (const r of blockers) {
    const m = out.get(r.taskId);
    if (m) m.blockedBy = r._count._all;
  }
  return out;
}

const emptyMeta = (): TaskMeta => ({ checklist: { done: 0, total: 0 }, subtasks: { done: 0, total: 0 }, blockedBy: 0 });

export function taskDto(t: TaskRow, meta: TaskMeta | ChecklistProgress, scope: Scope, today = todayUtc()) {
  const { _count, assignees, tagLinks, recurrence, ...rest } = t;
  const m: TaskMeta = 'checklist' in meta ? meta : { ...emptyMeta(), checklist: meta };
  return {
    ...rest,
    assignees: assignees.map((a) => a.user),
    tags: tagLinks.map((l) => l.tag),
    recurrence,
    recurring: !!recurrence?.active,
    overdue: isTaskOverdue(t, today),
    checklist: m.checklist,
    subtaskCounts: m.subtasks,
    blocked: m.blockedBy > 0,
    blockedByCount: m.blockedBy,
    commentCount: _count.comments,
    fileCount: _count.files,
    subtaskCount: _count.subtasks,
    permissions: taskAccess(scope, t),
  };
}

export type TaskDto = ReturnType<typeof taskDto>;

/** A task as the API returns it (list rows and the single-item responses share this shape). */
export async function loadTaskDto(scope: Scope, id: string) {
  const t = await findTask(scope, id);
  const meta = await loadTaskMeta([t.id]);
  return taskDto(t, meta.get(t.id)!, scope);
}

export async function loadTaskDtos(rows: TaskRow[], scope: Scope) {
  const meta = await loadTaskMeta(rows.map((r) => r.id));
  const today = todayUtc();
  return rows.map((r) => taskDto(r, meta.get(r.id)!, scope, today));
}

// ───────────────────────── linking helpers (parent / list / project / campaign / client) ─────────────────────────

export interface TaskLinks {
  clientId: string | null;
  projectId: string | null;
  campaignId: string | null;
  listId: string | null;
  spaceId: string | null;
  parentId: string | null;
  depth: number;
}

const invalid = (field: string) => Errors.validation({ [field]: 'invalid_choice' });

/**
 * Resolves where a task lives and proves the caller may put it there. Nothing is trusted:
 *  - a subtask inherits EVERYTHING (client, project, campaign, list) from its parent; disagreeing ids are refused
 *  - a list implies its project (if linked) and its space's client (if any)
 *  - the client is DERIVED from the project (or campaign) - a body `clientId` that disagrees is refused
 * A task with none of these is a personal (client-less) task.
 */
export async function resolveTaskLinks(
  scope: Scope,
  input: { projectId?: string | null; campaignId?: string | null; clientId?: string | null; listId?: string | null; parentId?: string | null },
): Promise<TaskLinks> {
  if (input.parentId) {
    const p = await prisma.task.findFirst({
      where: and<Prisma.TaskWhereInput>({ id: input.parentId }, taskWhere(scope)),
      select: { id: true, depth: true, clientId: true, projectId: true, campaignId: true, listId: true, list: { select: { spaceId: true } } },
    });
    if (!p) throw invalid('parentId');
    if (p.depth + 1 > MAX_TASK_DEPTH) throw Errors.validation({ parentId: 'too_deep' });
    for (const [k, v] of [['clientId', p.clientId], ['projectId', p.projectId], ['campaignId', p.campaignId], ['listId', p.listId]] as const) {
      const given = input[k];
      if (given && given !== v) throw invalid(k);
    }
    return { clientId: p.clientId, projectId: p.projectId, campaignId: p.campaignId, listId: p.listId, spaceId: p.list?.spaceId ?? null, parentId: p.id, depth: p.depth + 1 };
  }

  let listId: string | null = null;
  let spaceId: string | null = null;
  let listClientId: string | null = null;
  let projectInput = input.projectId ?? null;
  if (input.listId) {
    const l = await prisma.taskList.findFirst({
      where: { id: input.listId, archivedAt: null, space: { is: and<Prisma.SpaceWhereInput>(spaceWhere(scope), { archivedAt: null }) } },
      select: { id: true, spaceId: true, projectId: true, space: { select: { clientId: true } } },
    });
    if (!l) throw invalid('listId');
    listId = l.id;
    spaceId = l.spaceId;
    listClientId = l.space.clientId;
    if (l.projectId) {
      if (projectInput && projectInput !== l.projectId) throw invalid('projectId');
      projectInput = l.projectId;
    }
  }

  let clientId: string | null = null;
  let projectId: string | null = null;
  let campaignId: string | null = null;

  if (projectInput) {
    const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: projectInput }, projectWhere(scope)), select: { id: true, clientId: true, projectManagerId: true } });
    const writable = p && (scope.role === 'ADMIN' || scope.fullClientIds.includes(p.clientId) || p.projectManagerId === scope.userId);
    if (!p || !writable) throw invalid(input.projectId ? 'projectId' : 'listId');
    projectId = p.id;
    clientId = p.clientId;
  }
  if (input.campaignId) {
    const c = await prisma.campaign.findFirst({ where: and<Prisma.CampaignWhereInput>({ id: input.campaignId }, campaignWhere(scope)), select: { id: true, clientId: true } });
    if (!c) throw invalid('campaignId');
    if (clientId && c.clientId !== clientId) throw invalid('campaignId');
    campaignId = c.id;
    clientId = c.clientId;
  }
  const wantedClient = input.clientId ?? listClientId;
  if (wantedClient) {
    const field = input.clientId ? 'clientId' : 'listId';
    if (clientId && wantedClient !== clientId) throw invalid(field);
    if (!clientId) {
      const allowed = scope.role === 'ADMIN' || scope.fullClientIds.includes(wantedClient);
      const exists = allowed && (await prisma.client.findUnique({ where: { id: wantedClient }, select: { id: true } }));
      if (!exists) throw invalid(field);
      clientId = wantedClient;
    }
  }
  if (listClientId && clientId && listClientId !== clientId) throw invalid('listId');
  return { clientId, projectId, campaignId, listId, spaceId, parentId: null, depth: 0 };
}

/** Deliverable / request links must be visible to the caller AND belong to the task's client. */
export async function resolveWorkLinks(scope: Scope, clientId: string | null, input: { deliverableId?: string | null; requestId?: string | null }) {
  const out: { deliverableId?: string | null; requestId?: string | null } = {};
  if (input.deliverableId !== undefined) {
    if (input.deliverableId) {
      const d = await prisma.deliverable.findFirst({ where: and<Prisma.DeliverableWhereInput>({ id: input.deliverableId }, deliverableWhere(scope)), select: { id: true, clientId: true } });
      if (!d || !clientId || d.clientId !== clientId) throw invalid('deliverableId');
      out.deliverableId = d.id;
    } else out.deliverableId = null;
  }
  if (input.requestId !== undefined) {
    if (input.requestId) {
      const r = await prisma.request.findFirst({ where: and<Prisma.RequestWhereInput>({ id: input.requestId }, requestWhere(scope)), select: { id: true, clientId: true } });
      if (!r || !clientId || r.clientId !== clientId) throw invalid('requestId');
      out.requestId = r.id;
    } else out.requestId = null;
  }
  return out;
}

/**
 * The custom status of a space for a move. With an explicit customStatusId it must belong to the space; with only a
 * built-in status the first custom status of that category is used (null when the space has none).
 */
export async function resolveCustomStatus(spaceId: string | null, input: { customStatusId?: string | null; status?: TaskStatus }): Promise<{ customStatusId: string | null; status?: TaskStatus }> {
  if (input.customStatusId) {
    const s = spaceId ? await prisma.taskStatusOption.findFirst({ where: { id: input.customStatusId, spaceId }, select: { id: true, category: true } }) : null;
    if (!s) throw invalid('customStatusId');
    if (input.status && input.status !== s.category) throw invalid('status');
    return { customStatusId: s.id, status: s.category };
  }
  if (!spaceId || !input.status) return { customStatusId: null, status: input.status };
  const first = await prisma.taskStatusOption.findFirst({ where: { spaceId, category: input.status }, orderBy: { position: 'asc' }, select: { id: true } });
  return { customStatusId: first?.id ?? null, status: input.status };
}

/** Every descendant id of the given tasks (breadth first; the depth limit keeps this to a few queries). */
export async function descendantIds(ids: string[]): Promise<string[]> {
  const out: string[] = [];
  let frontier = ids;
  for (let level = 0; level <= MAX_TASK_DEPTH && frontier.length > 0; level++) {
    const kids = await prisma.task.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !out.includes(id) && !ids.includes(id));
    out.push(...frontier);
  }
  return out;
}

/** Open blockers (BLOCKS dependencies whose blocking task is not completed). */
export function openBlockers(taskId: string) {
  return prisma.taskDependency.findMany({
    where: { taskId, type: 'BLOCKS', dependsOn: { status: { not: 'DONE' } } },
    select: { dependsOn: { select: { id: true, title: true, status: true } } },
  });
}

// ───────────────────────── summary (dashboards / chips) ─────────────────────────

export interface TaskSummary {
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  open: number;
  byStatus: Record<TaskStatus, number>;
}

/** Counts for the chips on the tasks page and the dashboard. All counts respect the caller's scope; archived tasks never count. */
export async function taskSummary(scope: Scope, extra?: Prisma.TaskWhereInput): Promise<TaskSummary> {
  const base = and<Prisma.TaskWhereInput>(taskWhere(scope), { archivedAt: null }, extra);
  const today = todayUtc();
  const open: Prisma.TaskWhereInput = { status: { not: 'DONE' } };
  const [rows, overdue, dueToday, dueThisWeek] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.task.count({ where: and<Prisma.TaskWhereInput>(base, open, { dueDate: { lt: today } }) }),
    prisma.task.count({ where: and<Prisma.TaskWhereInput>(base, open, { dueDate: { gte: today, lt: addDaysUtc(today, 1) } }) }),
    // "this week" = the next 7 days including today
    prisma.task.count({ where: and<Prisma.TaskWhereInput>(base, open, { dueDate: { gte: today, lt: addDaysUtc(today, 7) } }) }),
  ]);
  const byStatus = emptyStatusCounts();
  let openCount = 0;
  for (const r of rows) {
    if ((TASK_STATUSES as readonly string[]).includes(r.status)) byStatus[r.status] = r._count._all;
    if (r.status !== 'DONE') openCount += r._count._all;
  }
  return { overdue, dueToday, dueThisWeek, open: openCount, byStatus };
}

/** Tasks assigned to a user through the primary field OR the assignee list. */
export const assignedTo = (userId: string): Prisma.TaskWhereInput => ({ OR: [{ assignedToId: userId }, { assignees: { some: { userId } } }] });
