// Owner: Finance group. Shared helpers of the contracts / invoices routes and the maintenance job.
// Internal agency invoicing only: no payments, no payment links, no subscriptions.
import type { Prisma } from '@prisma/client';
import type { Permission } from '../../../shared/src/permissions';
import { effectivePermissions } from '../authz/permissions';
import { prisma } from '../db';
import { storage } from '../storage';
import { notify, type NotificationInput } from './notifications';

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** UTC midnight of "today" (date-only fields are stored as UTC midnight). */
export const todayUtc = (now = new Date()): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
export const daysBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / 86_400_000);

const isUnique = (err: unknown): boolean => {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === 'P2002' || /unique constraint/i.test(e?.message ?? '');
};

// ───────────────────────── numbering ─────────────────────────

type NumberKind = 'contract' | 'invoice';
const PREFIX: Record<NumberKind, string> = { contract: 'CT', invoice: 'INV' };

async function usedNumbers(kind: NumberKind, prefix: string): Promise<string[]> {
  if (kind === 'contract') {
    const rows = await prisma.contract.findMany({ where: { contractNumber: { startsWith: prefix } }, select: { contractNumber: true } });
    return rows.map((r) => r.contractNumber);
  }
  const rows = await prisma.invoice.findMany({ where: { invoiceNumber: { startsWith: prefix } }, select: { invoiceNumber: true } });
  return rows.map((r) => r.invoiceNumber);
}

/**
 * Creates a row with the next sequential number of the current year (CT-2026-0001, INV-2026-0001).
 * The number is always generated here (never taken from the request). If two requests race for the same number the
 * unique index rejects the loser, which simply retries with a fresh number.
 */
export async function createWithNumber<T>(kind: NumberKind, create: (number: string) => Promise<T>): Promise<T> {
  const prefix = `${PREFIX[kind]}-${new Date().getUTCFullYear()}-`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    const used = await usedNumbers(kind, prefix);
    const max = used.reduce((m, n) => Math.max(m, parseInt(n.slice(prefix.length), 10) || 0), 0);
    const number = `${prefix}${String(max + 1).padStart(4, '0')}`;
    try {
      return await create(number);
    } catch (err) {
      if (!isUnique(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

// ───────────────────────── attached files ─────────────────────────

/** Removes the File rows attached to a contract / invoice and then their stored blobs (same order as routes/files.ts). */
export async function removeAttachedFiles(where: { contractId: string } | { invoiceId: string }): Promise<number> {
  const files = await prisma.file.findMany({ where, select: { id: true, filePath: true } });
  if (files.length === 0) return 0;
  await prisma.file.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
  await Promise.all(files.map((f) => storage.delete(f.filePath).catch(() => undefined)));
  return files.length;
}

/** Files hanging off a contract / invoice follow the flag of their parent (fileWhere additionally checks the parent). */
export async function syncFileVisibility(where: { contractId: string } | { invoiceId: string }, visible: boolean): Promise<void> {
  await prisma.file.updateMany({ where, data: { visibleToClient: visible } });
}

// ───────────────────────── recipients / notifications ─────────────────────────

/** Active ADMINs + TEAM members assigned to the client who hold `perm` (e.g. contracts.view). */
export async function financeRecipients(clientId: string, perm: Permission): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', OR: [{ role: 'ADMIN' }, { role: 'TEAM', clientAssignments: { some: { clientId } } }] },
    select: { id: true, role: true, permissions: true },
  });
  return users.filter((u) => effectivePermissions({ role: u.role, permissions: u.permissions }).has(perm)).map((u) => u.id);
}

/** Notifies the users that do not already hold the same type+entityId notification created within the last 24 hours. */
export async function notifyDedup(recipientIds: string[], input: NotificationInput, actorId = 'system'): Promise<number> {
  const ids = [...new Set(recipientIds)].filter((id) => id !== actorId);
  if (ids.length === 0) return 0;
  const since = new Date(Date.now() - 24 * 3_600_000);
  const existing = await prisma.notification.findMany({
    where: { userId: { in: ids }, type: input.type, entityId: input.entityId, createdAt: { gte: since } },
    select: { userId: true },
  });
  const have = new Set(existing.map((e) => e.userId));
  const fresh = ids.filter((id) => !have.has(id));
  if (fresh.length === 0) return 0;
  await notify(fresh, input, actorId);
  return fresh.length;
}

// ───────────────────────── DTOs ─────────────────────────

type ContractRow = Prisma.ContractGetPayload<{ include: { client: { select: { id: true; companyName: true } }; createdBy: { select: { id: true; name: true } }; _count: { select: { files: true } } } }>;

export const contractInclude = {
  client: { select: { id: true, companyName: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { files: true } },
} satisfies Prisma.ContractInclude;

/** Staff shape: every field. */
export const staffContractDto = (c: ContractRow) => {
  const { _count, ...rest } = c;
  return { ...rest, filesCount: _count.files };
};

/** CLIENT shape: explicit whitelist. No notes, no creator, no visibility flag, no internal fields. */
export const portalContractDto = (c: ContractRow) => ({
  id: c.id,
  clientId: c.clientId,
  name: c.name,
  contractNumber: c.contractNumber,
  startDate: c.startDate,
  endDate: c.endDate,
  renewalDate: c.renewalDate,
  value: c.value,
  status: c.status,
  createdAt: c.createdAt,
});

export const contractDtoFor = (role: 'ADMIN' | 'TEAM' | 'CLIENT', c: ContractRow) => (role === 'CLIENT' ? portalContractDto(c) : staffContractDto(c));

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: { client: { select: { id: true; companyName: true } }; project: { select: { id: true; name: true; visibleToClient: true } }; createdBy: { select: { id: true; name: true } }; _count: { select: { files: true } } };
}>;

export const invoiceInclude = {
  client: { select: { id: true, companyName: true } },
  project: { select: { id: true, name: true, visibleToClient: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { files: true } },
} satisfies Prisma.InvoiceInclude;

export const staffInvoiceDto = (i: InvoiceRow) => {
  const { _count, project, ...rest } = i;
  return { ...rest, project: project ? { id: project.id, name: project.name } : null, filesCount: _count.files };
};

/** CLIENT shape: number, dates, amounts, status, description and the project name (only when that project is shared). */
export const portalInvoiceDto = (i: InvoiceRow) => ({
  id: i.id,
  clientId: i.clientId,
  invoiceNumber: i.invoiceNumber,
  issueDate: i.issueDate,
  dueDate: i.dueDate,
  amount: i.amount,
  tax: i.tax,
  total: i.total,
  status: i.status,
  description: i.description,
  paidAt: i.paidAt,
  project: i.project && i.project.visibleToClient ? { id: i.project.id, name: i.project.name } : null,
  createdAt: i.createdAt,
});

export const invoiceDtoFor = (role: 'ADMIN' | 'TEAM' | 'CLIENT', i: InvoiceRow) => (role === 'CLIENT' ? portalInvoiceDto(i) : staffInvoiceDto(i));

/** Sort keys are whitelisted: "field" ascending, "-field" descending. */
export function parseSort<K extends string>(raw: string | undefined, allowed: readonly K[], fallback: { key: K; dir: 'asc' | 'desc' }): { key: K; dir: 'asc' | 'desc' } {
  if (!raw) return fallback;
  const dir = raw.startsWith('-') ? 'desc' : 'asc';
  const key = raw.replace(/^-/, '') as K;
  return (allowed as readonly string[]).includes(key) ? { key, dir } : fallback;
}
