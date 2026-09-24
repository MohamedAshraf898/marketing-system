// Owner: Finance group. Scheduled housekeeping (contract expiry, overdue invoices, task reminders, attendance days,
// recurring tasks, overdue-task automations).
// startMaintenance() is called once when the server starts (never in tests; tests call runMaintenance() directly).
//
// The job is idempotent: a second run right after the first changes nothing and creates no notification, because
//   - status transitions only fire for rows that still have the old status, and
//   - every notification is de-duplicated (same user + type + entity within 24 hours).
import { prisma } from '../db';
import { closePastDays } from './attendance';
import { audit } from './audit';
import { runOverdueAutomations } from './taskAutomations';
import { generateRecurringTasks } from './taskRecurrence';
import { addDays, daysBetween, financeRecipients, notifyDedup, todayUtc } from './finance';

const INTERVAL = 3_600_000; // hourly: every step is idempotent
const SYSTEM = { ip: null, user: null } as const;

export interface MaintenanceResult {
  contractsExpiring: number;
  contractsExpired: number;
  invoicesOverdue: number;
  taskReminders: number;
  attendanceDaysClosed: number;
  recurringTasksCreated: number;
  automationsRun: number;
}

/** Contracts: ACTIVE -> EXPIRING (end date within 30 days), ACTIVE / EXPIRING -> EXPIRED (end date passed). Never touches DRAFT / TERMINATED. */
async function contractStep(r: MaintenanceResult): Promise<void> {
  const today = todayUtc();
  const include = { client: { select: { companyName: true } } } as const;

  const expired = await prisma.contract.findMany({ where: { status: { in: ['ACTIVE', 'EXPIRING'] }, endDate: { lt: today } }, include });
  for (const c of expired) {
    const flipped = await prisma.contract.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'EXPIRED' } });
    if (flipped.count === 0) continue;
    r.contractsExpired++;
    await audit(SYSTEM, 'CONTRACT_STATUS_CHANGED', 'contract', c.id, { number: c.contractNumber, from: c.status, to: 'EXPIRED', auto: true }, { clientId: c.clientId, clientVisible: c.visibleToClient });
    await notifyDedup(await financeRecipients(c.clientId, 'contracts.view'), {
      type: 'CONTRACT_EXPIRED', entity: 'contract', entityId: c.id, data: { name: c.name, client: c.client.companyName },
    });
  }

  const expiring = await prisma.contract.findMany({ where: { status: 'ACTIVE', endDate: { gte: today, lte: addDays(today, 30) } }, include });
  for (const c of expiring) {
    const flipped = await prisma.contract.updateMany({ where: { id: c.id, status: 'ACTIVE' }, data: { status: 'EXPIRING' } });
    if (flipped.count === 0) continue;
    r.contractsExpiring++;
    await audit(SYSTEM, 'CONTRACT_STATUS_CHANGED', 'contract', c.id, { number: c.contractNumber, from: 'ACTIVE', to: 'EXPIRING', auto: true }, { clientId: c.clientId, clientVisible: c.visibleToClient });
    await notifyDedup(await financeRecipients(c.clientId, 'contracts.view'), {
      type: 'CONTRACT_EXPIRING', entity: 'contract', entityId: c.id,
      data: { name: c.name, client: c.client.companyName, days: c.endDate ? daysBetween(today, c.endDate) : 0 },
    });
  }
}

/** Invoices: SENT / PENDING with a due date in the past -> OVERDUE (+ notify admins and finance-permitted team). */
async function invoiceStep(r: MaintenanceResult): Promise<void> {
  const today = todayUtc();
  const late = await prisma.invoice.findMany({
    where: { status: { in: ['SENT', 'PENDING'] }, dueDate: { lt: today } },
    include: { client: { select: { companyName: true } } },
  });
  for (const i of late) {
    const flipped = await prisma.invoice.updateMany({ where: { id: i.id, status: i.status }, data: { status: 'OVERDUE' } });
    if (flipped.count === 0) continue;
    r.invoicesOverdue++;
    await audit(SYSTEM, 'INVOICE_STATUS_CHANGED', 'invoice', i.id, { number: i.invoiceNumber, from: i.status, to: 'OVERDUE', auto: true }, {
      clientId: i.clientId, projectId: i.projectId, clientVisible: i.visibleToClient && i.status !== 'DRAFT',
    });
    await notifyDedup(await financeRecipients(i.clientId, 'invoices.view'), {
      type: 'INVOICE_OVERDUE', entity: 'invoice', entityId: i.id, data: { number: i.invoiceNumber, client: i.client.companyName },
    });
  }
}

/**
 * Task reminders (tasks are read only here): open tasks with an assignee whose due date is within the next 24 hours
 * -> TASK_DUE_SOON; past due -> TASK_OVERDUE (once per task per day, thanks to the 24 h de-duplication).
 * A date-only due date (stored as UTC midnight) means "end of that day".
 */
async function taskStep(r: MaintenanceResult): Promise<void> {
  const now = Date.now();
  const tasks = await prisma.task.findMany({
    where: { status: { not: 'DONE' }, assignedToId: { not: null }, dueDate: { not: null, lte: new Date(now + 2 * 86_400_000) }, assignedTo: { is: { status: 'ACTIVE' } } },
    select: { id: true, title: true, dueDate: true, assignedToId: true },
  });
  for (const t of tasks) {
    if (!t.dueDate || !t.assignedToId) continue;
    const dateOnly = t.dueDate.getTime() % 86_400_000 === 0;
    const dueAt = dateOnly ? t.dueDate.getTime() + 86_400_000 - 1 : t.dueDate.getTime();
    let type: 'TASK_DUE_SOON' | 'TASK_OVERDUE' | null = null;
    if (dueAt < now) type = 'TASK_OVERDUE';
    else if (dueAt <= now + 24 * 3_600_000) type = 'TASK_DUE_SOON';
    if (!type) continue;
    r.taskReminders += await notifyDedup([t.assignedToId], { type, entity: 'task', entityId: t.id, data: { title: t.title } });
  }
}

/** Past working days without a record become ABSENT (or ON_LEAVE / HOLIDAY). */
async function attendanceStep(r: MaintenanceResult): Promise<void> {
  r.attendanceDaysClosed += await closePastDays();
}

/** Recurring tasks: every due occurrence becomes a task (duplicate-proof, see taskRecurrence.ts). */
async function recurringStep(r: MaintenanceResult): Promise<void> {
  r.recurringTasksCreated += await generateRecurringTasks();
}

/** "When a task becomes overdue" automation rules (each rule runs once per task). */
async function automationStep(r: MaintenanceResult): Promise<void> {
  r.automationsRun += await runOverdueAutomations();
}

let running = false;

export async function runMaintenance(): Promise<MaintenanceResult> {
  const r: MaintenanceResult = { contractsExpiring: 0, contractsExpired: 0, invoicesOverdue: 0, taskReminders: 0, attendanceDaysClosed: 0, recurringTasksCreated: 0, automationsRun: 0 };
  if (running) return r;
  running = true;
  try {
    // each step is isolated: one failing step never stops the others, and nothing sensitive is logged
    for (const [name, step] of [['contracts', contractStep], ['invoices', invoiceStep], ['tasks', taskStep], ['attendance', attendanceStep], ['recurring', recurringStep], ['automations', automationStep]] as const) {
      try {
        await step(r);
      } catch (err) {
        console.error(`[maintenance] ${name} step failed (${(err as Error)?.name ?? 'error'})`);
      }
    }
  } finally {
    running = false;
  }
  return r;
}

let timer: NodeJS.Timeout | null = null;

export function startMaintenance(): void {
  if (process.env.NODE_ENV === 'test' || timer) return;
  void runMaintenance().catch(() => undefined);
  timer = setInterval(() => void runMaintenance().catch(() => undefined), INTERVAL);
  timer.unref();
}
