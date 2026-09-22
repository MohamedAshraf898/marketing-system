import type { Prisma } from '@prisma/client';
import { TASK_STATUSES, type TaskStatus } from '../../../shared/src/enums';
import { campaignWhere, projectWhere, taskWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { Errors } from '../lib/errors';
import { addDaysUtc, emptyStatusCounts, todayUtc } from './projects';
import { and } from './serializers';

const userLite = { id: true, name: true, avatar: true, role: true } satisfies Prisma.UserSelect;

export const taskInclude = {
  assignedTo: { select: userLite },
  createdBy: { select: { id: true, name: true } },
  client: { select: { id: true, companyName: true } },
  project: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  _count: { select: { comments: true, files: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** Scoped single-record lookup: out-of-scope (and every task, for clients) == 404. */
export async function findTask(scope: Scope, id: string) {
  const t = await prisma.task.findFirst({ where: and<Prisma.TaskWhereInput>({ id }, taskWhere(scope)), include: taskInclude });
  if (!t) throw Errors.notFound();
  return t;
}

export interface TaskAccess {
  /** may change status / description / checklist */
  canWork: boolean;
  /** may change title, priority, due date, estimate, assignee, project / campaign */
  canEditFields: boolean;
  canDelete: boolean;
  canAssign: boolean;
}

/**
 * Being inside taskWhere means "may see". Working on a task needs more:
 *   - the assignee or the creator, or `tasks.edit_all` (ADMIN always) may update status / description / checklist
 *   - changing the planning fields (title, priority, due date, estimate, assignee, project) needs `tasks.edit_all` or being the creator
 */
export function taskAccess(scope: Scope, t: { createdById: string | null; assignedToId: string | null }): TaskAccess {
  const editAll = scope.permissions.has('tasks.edit_all');
  const creator = t.createdById === scope.userId;
  const assignee = t.assignedToId === scope.userId;
  return {
    canWork: editAll || creator || assignee,
    canEditFields: editAll || creator,
    canDelete: scope.permissions.has('tasks.delete'),
    canAssign: scope.permissions.has('tasks.assign'),
  };
}

export const isTaskOverdue = (t: { dueDate: Date | null; status: TaskStatus }, today = todayUtc()) => !!t.dueDate && t.dueDate < today && t.status !== 'DONE';

export interface ChecklistProgress { done: number; total: number }

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

export function taskDto(t: TaskRow, checklist: ChecklistProgress, scope: Scope, today = todayUtc()) {
  const { _count, ...rest } = t;
  return {
    ...rest,
    overdue: isTaskOverdue(t, today),
    checklist,
    commentCount: _count.comments,
    fileCount: _count.files,
    permissions: taskAccess(scope, t),
  };
}

/** A task as the API returns it (list rows and the single-item responses share this shape). */
export async function loadTaskDto(scope: Scope, id: string) {
  const t = await findTask(scope, id);
  const progress = await loadChecklistProgress([t.id]);
  return taskDto(t, progress.get(t.id)!, scope);
}

export async function loadTaskDtos(rows: TaskRow[], scope: Scope) {
  const progress = await loadChecklistProgress(rows.map((r) => r.id));
  const today = todayUtc();
  return rows.map((r) => taskDto(r, progress.get(r.id)!, scope, today));
}

// ───────────────────────── linking helpers (project / campaign / client) ─────────────────────────

export interface TaskLinks { clientId: string | null; projectId: string | null; campaignId: string | null }

/**
 * Resolves the project / campaign / client a task is attached to and proves the caller may use them. The client is
 * DERIVED from the project (or campaign) - a body `clientId` that disagrees is refused, never trusted.
 * A task with none of the three is a personal (client-less) task.
 */
export async function resolveTaskLinks(scope: Scope, input: { projectId?: string | null; campaignId?: string | null; clientId?: string | null }): Promise<TaskLinks> {
  let clientId: string | null = null;
  let projectId: string | null = null;
  let campaignId: string | null = null;

  if (input.projectId) {
    const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: input.projectId }, projectWhere(scope)), select: { id: true, clientId: true, projectManagerId: true } });
    const writable = p && (scope.role === 'ADMIN' || scope.fullClientIds.includes(p.clientId) || p.projectManagerId === scope.userId);
    if (!p || !writable) throw Errors.validation({ projectId: 'invalid_choice' });
    projectId = p.id;
    clientId = p.clientId;
  }
  if (input.campaignId) {
    const c = await prisma.campaign.findFirst({ where: and<Prisma.CampaignWhereInput>({ id: input.campaignId }, campaignWhere(scope)), select: { id: true, clientId: true } });
    if (!c) throw Errors.validation({ campaignId: 'invalid_choice' });
    if (clientId && c.clientId !== clientId) throw Errors.validation({ campaignId: 'invalid_choice' });
    campaignId = c.id;
    clientId = c.clientId;
  }
  if (input.clientId) {
    if (clientId && input.clientId !== clientId) throw Errors.validation({ clientId: 'invalid_choice' });
    if (!clientId) {
      const allowed = scope.role === 'ADMIN' || scope.fullClientIds.includes(input.clientId);
      const exists = allowed && (await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } }));
      if (!exists) throw Errors.validation({ clientId: 'invalid_choice' });
      clientId = input.clientId;
    }
  }
  return { clientId, projectId, campaignId };
}

// ───────────────────────── summary (dashboards / chips) ─────────────────────────

export interface TaskSummary {
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  open: number;
  byStatus: Record<TaskStatus, number>;
}

/** Counts for the chips on the tasks page and the dashboard. All counts respect the caller's scope. */
export async function taskSummary(scope: Scope, extra?: Prisma.TaskWhereInput): Promise<TaskSummary> {
  const base = and<Prisma.TaskWhereInput>(taskWhere(scope), extra);
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
