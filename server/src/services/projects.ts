import type { Prisma } from '@prisma/client';
import { TASK_STATUSES, type ProjectStatus, type TaskStatus } from '../../../shared/src/enums';
import { projectWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { Errors } from '../lib/errors';
import { and } from './serializers';

/** Projects in these statuses no longer count as "overdue" or "active". */
export const CLOSED_PROJECT_STATUSES: ProjectStatus[] = ['COMPLETED', 'CANCELLED'];

/** Today as a date-only value (UTC midnight), the same convention used for every due date in the database. */
export function todayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const addDaysUtc = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const emptyStatusCounts = (): Record<TaskStatus, number> =>
  Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;

const managerSelect = { id: true, name: true, avatar: true, role: true } satisfies Prisma.UserSelect;

export const projectInclude = {
  client: { select: { id: true, companyName: true, name: true } },
  projectManager: { select: managerSelect },
} satisfies Prisma.ProjectInclude;

/** Scoped single-record lookup: out-of-scope (or an internal project, for clients) == 404. */
export async function findProject(scope: Scope, id: string) {
  const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id }, projectWhere(scope)), include: projectInclude });
  if (!p) throw Errors.notFound();
  return p;
}

/**
 * Who may CHANGE a project (the caller has already passed the `projects.edit/create/delete` permission gate).
 * ADMIN: any. TEAM: projects of clients they are assigned to, or projects they manage. Being able to *see* a project
 * (through one assigned task or campaign) is not enough to edit it.
 */
export const canWriteProject = (scope: Scope, p: { clientId: string; projectManagerId: string | null }) =>
  scope.role === 'ADMIN' || (scope.role === 'TEAM' && (scope.fullClientIds.includes(p.clientId) || p.projectManagerId === scope.userId));

export async function findWritableProject(scope: Scope, id: string) {
  const p = await findProject(scope, id);
  // out-of-scope is a 404; visible-but-read-only is a 403 (the caller already knows the project exists)
  if (!canWriteProject(scope, p)) throw Errors.forbidden();
  return p;
}

/**
 * A staff user that may be given work on a client: an active ADMIN, or an active TEAM member assigned to that client
 * (or, when a campaign is given, assigned to that campaign). Throws 400 invalid_choice on `field` otherwise.
 * With no client (personal task) only an ADMIN qualifies.
 */
export async function assertStaffForClient(userId: string, clientId: string | null, campaignId: string | null, field: string): Promise<void> {
  const or: Prisma.UserWhereInput[] = [{ role: 'ADMIN' }];
  if (clientId) or.push({ role: 'TEAM', clientAssignments: { some: { clientId } } });
  if (campaignId) or.push({ role: 'TEAM', campaignAssignments: { some: { campaignId } } });
  const u = await prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE', OR: or }, select: { id: true } });
  if (!u) throw Errors.validation({ [field]: 'invalid_choice' });
}

// ───────────────────────── statistics (one grouped query per metric, never N+1) ─────────────────────────

export interface NextMilestone { id: string; title: string; dueDate: Date | null }
export interface ProjectStats {
  total: number;
  done: number;
  overdue: number;
  byStatus: Record<TaskStatus, number>;
  milestonesTotal: number;
  milestonesDone: number;
  nextMilestone: NextMilestone | null;
}

const emptyStats = (): ProjectStats => ({ total: 0, done: 0, overdue: 0, byStatus: emptyStatusCounts(), milestonesTotal: 0, milestonesDone: 0, nextMilestone: null });

/** Order used for "next milestone": earliest due date first (undated last), then manual position. */
export function sortMilestonesForNext<T extends { dueDate: Date | null; position: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ad = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
    const bd = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
    return ad === bd ? a.position - b.position : ad - bd;
  });
}

/**
 * Task + milestone aggregates for many projects at once. Task counts are aggregates over the whole project (the
 * project itself is already inside the caller's scope) - they never contain task data, only numbers.
 */
export async function loadProjectStats(projectIds: string[], today = todayUtc()): Promise<Map<string, ProjectStats>> {
  const out = new Map<string, ProjectStats>();
  for (const id of projectIds) out.set(id, emptyStats());
  if (projectIds.length === 0) return out;

  const [byStatus, overdue, milestones] = await Promise.all([
    prisma.task.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: projectIds } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: { not: 'DONE' }, dueDate: { lt: today } }, _count: { _all: true } }),
    prisma.milestone.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, projectId: true, title: true, dueDate: true, completedAt: true, position: true },
    }),
  ]);
  for (const r of byStatus) {
    const s = r.projectId ? out.get(r.projectId) : undefined;
    if (!s) continue;
    s.byStatus[r.status] = r._count._all;
    s.total += r._count._all;
    if (r.status === 'DONE') s.done += r._count._all;
  }
  for (const r of overdue) {
    const s = r.projectId ? out.get(r.projectId) : undefined;
    if (s) s.overdue = r._count._all;
  }
  const open = new Map<string, typeof milestones>();
  for (const m of milestones) {
    const s = out.get(m.projectId);
    if (!s) continue;
    s.milestonesTotal += 1;
    if (m.completedAt) s.milestonesDone += 1;
    else (open.get(m.projectId) ?? open.set(m.projectId, []).get(m.projectId)!).push(m);
  }
  for (const [pid, list] of open) {
    const next = sortMilestonesForNext(list)[0];
    if (next) out.get(pid)!.nextMilestone = { id: next.id, title: next.title, dueDate: next.dueDate };
  }
  return out;
}

/**
 * Progress %: done tasks / all tasks. A project without tasks falls back to completed milestones / all milestones, and a
 * COMPLETED project always shows 100. This single number is the only progress information a client ever gets.
 */
export function progressOf(s: ProjectStats, status: ProjectStatus): number {
  if (status === 'COMPLETED') return 100;
  if (s.total > 0) return Math.round((s.done / s.total) * 100);
  if (s.milestonesTotal > 0) return Math.round((s.milestonesDone / s.milestonesTotal) * 100);
  return 0;
}

export const isProjectOverdue = (p: { dueDate: Date | null; status: ProjectStatus }, today = todayUtc()) =>
  !!p.dueDate && p.dueDate < today && !CLOSED_PROJECT_STATUSES.includes(p.status);

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/** Everything a staff member sees. `budget` only when the caller may edit projects (ADMIN always). */
export function staffProjectDto(p: ProjectRow, s: ProjectStats, scope: Scope, today = todayUtc()) {
  const { budget, ...rest } = p;
  return {
    ...rest,
    ...(scope.permissions.has('projects.edit') ? { budget } : {}),
    progress: progressOf(s, p.status),
    overdue: isProjectOverdue(p, today),
    taskCounts: { total: s.total, done: s.done, overdue: s.overdue },
    milestoneCounts: { total: s.milestonesTotal, done: s.milestonesDone },
    nextMilestone: s.nextMilestone,
    permissions: { canEdit: scope.permissions.has('projects.edit') && canWriteProject(scope, p), canDelete: scope.permissions.has('projects.delete') && canWriteProject(scope, p) },
  };
}

/**
 * What a CLIENT user gets: an explicit WHITELIST. No budget, no manager, no task data (only the progress number),
 * no internal flags. A field added to the model later stays private by default.
 */
export function clientProjectDto(p: ProjectRow, s: ProjectStats, today = todayUtc()) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    priority: p.priority,
    startDate: p.startDate,
    dueDate: p.dueDate,
    completedAt: p.completedAt,
    createdAt: p.createdAt,
    client: { id: p.client.id, companyName: p.client.companyName },
    progress: progressOf(s, p.status),
    overdue: isProjectOverdue(p, today),
    milestoneCounts: { total: s.milestonesTotal, done: s.milestonesDone },
    nextMilestone: s.nextMilestone,
  };
}

export const clientMilestoneDto = (m: { id: string; title: string; description: string | null; dueDate: Date | null; completedAt: Date | null; position: number }) => ({
  id: m.id,
  title: m.title,
  description: m.description,
  dueDate: m.dueDate,
  completedAt: m.completedAt,
  position: m.position,
});
