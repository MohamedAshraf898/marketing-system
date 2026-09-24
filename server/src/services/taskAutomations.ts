// Configurable task automations ("when X happens, do Y"). No external service: rules are rows in TaskAutomation and run
// in-process right after the change that triggered them (overdue rules run from the maintenance job).
//
// Safety
//  - An automation can trigger further automations only one level deep (depth guard) - rules can never loop.
//  - A failing rule is logged and skipped; it never breaks the user's own action.
//  - Actions still respect the data rules (an auto-assignee must be staff allowed on the task's client, a created task
//    stays inside the same client / project / list).
import type { AutomationAction, AutomationTrigger, Prisma, TaskStatus } from '@prisma/client';
import { PRIORITIES } from '../../../shared/src/enums';
import { prisma } from '../db';
import type { Ctx } from '../lib/context';
import { audit } from './audit';
import { submitDeliverable } from './deliverables';
import { notify } from './notifications';
import { assertStaffForClient, todayUtc } from './projects';
import { assigneeIdsOf, MAX_TASK_DEPTH } from './tasks';
import { afterCreate, insertTask, taskAuditOpts, type Actor } from './taskWrite';

export const MAX_AUTOMATION_DEPTH = 1;

export interface AutomationConfig {
  userId?: string; // NOTIFY_USER, ASSIGN_USER, CREATE_TASK (assignee)
  priority?: string; // SET_PRIORITY, CREATE_TASK
  title?: string; // CREATE_TASK ("{title}" = the triggering task's title)
  description?: string;
  dueInDays?: number;
  assign?: 'same' | 'none' | 'user';
  asSubtask?: boolean;
  message?: string; // optional note shown in notifications
}

export const parseConfig = (raw: string | null): AutomationConfig => {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as AutomationConfig) : {};
  } catch {
    return {};
  }
};

const taskSelect = {
  id: true, title: true, status: true, priority: true, listId: true, clientId: true, projectId: true, campaignId: true, parentId: true, depth: true,
  assignedToId: true, reviewerId: true, createdById: true, deliverableId: true, visibility: true,
  list: { select: { spaceId: true } },
  assignees: { select: { userId: true } },
} satisfies Prisma.TaskSelect;
type AutoTask = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

const actorId = (a: Actor) => a.user?.id ?? 'system';
const isCtx = (a: Actor): a is Ctx => !!a.user && !!a.scope;

/** Rules that apply to a task: enabled, same trigger, scoped to its list / space or global. */
async function rulesFor(trigger: AutomationTrigger, t: AutoTask, status?: TaskStatus) {
  const spaceId = t.list?.spaceId ?? null;
  const rules = await prisma.taskAutomation.findMany({
    where: {
      enabled: true,
      trigger,
      AND: [
        { OR: [{ spaceId: null }, ...(spaceId ? [{ spaceId }] : [])] },
        { OR: [{ listId: null }, ...(t.listId ? [{ listId: t.listId }] : [])] },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  return trigger === 'STATUS_CHANGED' ? rules.filter((r) => !r.triggerStatus || r.triggerStatus === status) : rules;
}

export async function runAutomations(actor: Actor, trigger: AutomationTrigger, taskId: string, opts: { depth: number; fromStatus?: TaskStatus; assigneeIds?: string[] }) {
  if (opts.depth > MAX_AUTOMATION_DEPTH) return 0;
  try {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: taskSelect });
    if (!t) return 0;
    const rules = await rulesFor(trigger, t, t.status);
    let ran = 0;
    for (const rule of rules) if (await execute(actor, rule, t, opts.depth)) ran++;
    return ran;
  } catch (err) {
    console.error('[automation] failed', (err as Error)?.message);
    return 0;
  }
}

/** Runs one rule on one task. Returns true when it did something. */
async function execute(actor: Actor, rule: { id: string; name: string; action: AutomationAction; config: string | null }, t: AutoTask, depth: number): Promise<boolean> {
  const cfg = parseConfig(rule.config);
  const data = { title: t.title, rule: rule.name, ...(cfg.message ? { message: cfg.message.slice(0, 200) } : {}) };
  const assignees = assigneeIdsOf(t);
  let did = false;
  try {
    switch (rule.action) {
      case 'NOTIFY_ASSIGNEES':
        await notify(assignees, { type: 'TASK_AUTOMATION', entity: 'task', entityId: t.id, data }, actorId(actor));
        did = assignees.length > 0;
        break;
      case 'NOTIFY_REVIEWER': {
        const to = t.reviewerId ?? t.createdById;
        if (to) await notify([to], { type: 'TASK_REVIEW', entity: 'task', entityId: t.id, data: { title: t.title, by: actor.user?.name ?? rule.name } }, actorId(actor));
        did = !!to;
        break;
      }
      case 'NOTIFY_USER':
        if (cfg.userId && (await prisma.user.findFirst({ where: { id: cfg.userId, status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true } }))) {
          await notify([cfg.userId], { type: 'TASK_AUTOMATION', entity: 'task', entityId: t.id, data }, actorId(actor));
          did = true;
        }
        break;
      case 'SET_PRIORITY':
        if (cfg.priority && (PRIORITIES as readonly string[]).includes(cfg.priority) && cfg.priority !== t.priority) {
          await prisma.task.update({ where: { id: t.id }, data: { priority: cfg.priority as (typeof PRIORITIES)[number] } });
          await audit(actor, 'TASK_PRIORITY_CHANGED', 'task', t.id, { title: t.title, status: t.status, from: t.priority, to: cfg.priority, automation: rule.name }, taskAuditOpts(t));
          did = true;
        }
        break;
      case 'ASSIGN_USER':
        if (cfg.userId && !assignees.includes(cfg.userId)) {
          await assertStaffForClient(cfg.userId, t.clientId, t.campaignId, 'userId');
          await prisma.$transaction([
            prisma.taskAssignee.create({ data: { taskId: t.id, userId: cfg.userId } }),
            ...(t.assignedToId ? [] : [prisma.task.update({ where: { id: t.id }, data: { assignedToId: cfg.userId } })]),
          ]);
          await audit(actor, 'TASK_ASSIGNED', 'task', t.id, { title: t.title, status: t.status, assigneeId: t.assignedToId ?? cfg.userId, added: [cfg.userId], removed: [], automation: rule.name }, taskAuditOpts(t));
          await notify([cfg.userId], { type: 'TASK_ASSIGNED', entity: 'task', entityId: t.id, data: { title: t.title, by: rule.name } }, actorId(actor));
          did = true;
        }
        break;
      case 'CREATE_TASK':
        did = await createFollowUp(actor, rule, cfg, t, depth);
        break;
      case 'REQUEST_CLIENT_APPROVAL':
        did = await requestApproval(actor, rule, t, assignees);
        break;
    }
  } catch (err) {
    console.error(`[automation] rule ${rule.id} failed`, (err as Error)?.message);
    return false;
  }
  if (did) {
    await prisma.taskAutomation.update({ where: { id: rule.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
    await audit(actor, 'TASK_AUTOMATION_RAN', 'task', t.id, { title: t.title, status: t.status, automationId: rule.id, name: rule.name, action: rule.action }, taskAuditOpts(t));
  }
  return did;
}

async function createFollowUp(actor: Actor, rule: { id: string; name: string }, cfg: AutomationConfig, t: AutoTask, depth: number) {
  const title = (cfg.title || 'Follow-up: {title}').replaceAll('{title}', t.title).trim().slice(0, 200);
  const asSubtask = !!cfg.asSubtask && t.depth + 1 <= MAX_TASK_DEPTH;
  let assigneeIds: string[] = [];
  if (cfg.assign === 'same') assigneeIds = assigneeIdsOf(t);
  else if (cfg.assign === 'user' && cfg.userId) {
    try {
      await assertStaffForClient(cfg.userId, t.clientId, t.campaignId, 'userId');
      assigneeIds = [cfg.userId];
    } catch { /* not allowed on this client any more: create unassigned */ }
  }
  const due = typeof cfg.dueInDays === 'number' && cfg.dueInDays >= 0 && cfg.dueInDays <= 365 ? new Date(todayUtc().getTime() + Math.round(cfg.dueInDays) * 86_400_000) : null;
  const priority = cfg.priority && (PRIORITIES as readonly string[]).includes(cfg.priority) ? (cfg.priority as (typeof PRIORITIES)[number]) : 'NORMAL';
  const id = await insertTask(prisma, {
    title, description: cfg.description?.slice(0, 5000) ?? null, priority, status: 'TODO', customStatusId: null, startDate: null, dueDate: due, estimatedHours: null,
    visibility: 'INTERNAL',
    links: { clientId: t.clientId, projectId: t.projectId, campaignId: t.campaignId, listId: t.listId, spaceId: t.list?.spaceId ?? null, parentId: asSubtask ? t.id : t.parentId, depth: asSubtask ? t.depth + 1 : t.depth },
    deliverableId: null, requestId: null, reviewerId: null, assigneeIds, primaryAssigneeId: null, tagNames: [], blockOnDependencies: false,
    createdById: actor.user?.id ?? t.createdById,
  });
  await afterCreate(actor, id, { automationDepth: depth + 1, extraAudit: { automationId: rule.id, from: t.id } });
  return true;
}

/** Sends the linked deliverable to the client (normal approval workflow) or, without one, reminds the team to do it. */
async function requestApproval(actor: Actor, rule: { name: string }, t: AutoTask, assignees: string[]) {
  if (t.deliverableId && isCtx(actor)) {
    const d = await prisma.deliverable.findUnique({ where: { id: t.deliverableId }, select: { status: true } });
    if (d?.status === 'DRAFT') {
      await submitDeliverable(actor, t.deliverableId);
      await notify(assignees, { type: 'TASK_APPROVAL_REQUESTED', entity: 'task', entityId: t.id, data: { title: t.title, rule: rule.name, sent: true } }, actorId(actor));
      return true;
    }
  }
  const to = [...assignees, t.createdById].filter((x): x is string => !!x);
  await notify(to, { type: 'TASK_APPROVAL_REQUESTED', entity: 'task', entityId: t.id, data: { title: t.title, rule: rule.name, sent: false } }, actorId(actor));
  return to.length > 0;
}

/**
 * TASK_OVERDUE rules (called by the maintenance job): each rule runs at most once per task, however often the job runs.
 */
export async function runOverdueAutomations(): Promise<number> {
  const rules = await prisma.taskAutomation.findMany({ where: { enabled: true, trigger: 'TASK_OVERDUE' } });
  if (rules.length === 0) return 0;
  const tasks = await prisma.task.findMany({
    where: { status: { not: 'DONE' }, archivedAt: null, dueDate: { lt: todayUtc() } },
    select: taskSelect,
    orderBy: { dueDate: 'asc' },
    take: 500,
  });
  const system: Actor = { ip: null, user: null };
  let ran = 0;
  for (const t of tasks) {
    const spaceId = t.list?.spaceId ?? null;
    for (const rule of rules) {
      if (rule.spaceId && rule.spaceId !== spaceId) continue;
      if (rule.listId && rule.listId !== t.listId) continue;
      const done = await prisma.auditLog.findFirst({ where: { action: 'TASK_AUTOMATION_RAN', entity: 'task', entityId: t.id, metadata: { contains: `"automationId":"${rule.id}"` } }, select: { id: true } });
      if (done) continue;
      if (await execute(system, rule, t, 0)) ran++;
    }
  }
  return ran;
}
