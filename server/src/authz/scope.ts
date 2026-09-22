import type { Prisma } from '@prisma/client';
import type { Role } from '../../../shared/src/enums';
import type { Permission } from '../../../shared/src/permissions';
import { prisma } from '../db';
import { effectivePermissions } from './permissions';

/**
 * The Scope answers "which data may this user touch?" and is loaded once per request.
 *
 *  ADMIN  -> everything
 *  CLIENT -> only rows whose clientId === user.clientId (and only client-visible ones)
 *  TEAM   -> whole clients they are assigned to (fullClientIds)
 *            + individual campaigns they are assigned to (campaignIds)
 *
 * Every list query is built from the *Where helpers below and every single-record lookup is
 * `findFirst({ where: { AND: [{ id }, scopeWhere] } })`, so a record outside the scope simply
 * does not exist for that user (404) - which is what defeats IDOR (/clients/123 -> /clients/124).
 */
export interface Scope {
  role: Role;
  userId: string;
  clientId: string | null; // CLIENT users
  fullClientIds: string[]; // TEAM users: entire clients
  campaignIds: string[]; // TEAM users: explicitly assigned campaigns
  visibleClientIds: string[]; // TEAM users: clients they may see (full + owners of assigned campaigns)
  permissions: ReadonlySet<Permission>; // granular permissions (ADMIN: all, CLIENT: none)
}

export const isAdmin = (s: Scope) => s.role === 'ADMIN';
export const isClient = (s: Scope) => s.role === 'CLIENT';
export const isTeam = (s: Scope) => s.role === 'TEAM';
export const isStaff = (s: Scope) => s.role !== 'CLIENT';

export async function loadScope(user: { id: string; role: Role; clientId: string | null; permissions?: string | null }): Promise<Scope> {
  const base: Scope = {
    role: user.role,
    userId: user.id,
    clientId: user.role === 'CLIENT' ? user.clientId : null,
    fullClientIds: [],
    campaignIds: [],
    visibleClientIds: [],
    permissions: effectivePermissions({ role: user.role, permissions: user.permissions ?? null }),
  };
  if (user.role !== 'TEAM') return base;

  const [clientRows, campaignRows] = await Promise.all([
    prisma.clientAssignment.findMany({ where: { userId: user.id }, select: { clientId: true } }),
    prisma.campaignAssignment.findMany({
      where: { userId: user.id },
      select: { campaignId: true, campaign: { select: { clientId: true } } },
    }),
  ]);
  base.fullClientIds = clientRows.map((r) => r.clientId);
  base.campaignIds = campaignRows.map((r) => r.campaignId);
  base.visibleClientIds = [...new Set([...base.fullClientIds, ...campaignRows.map((r) => r.campaign.clientId)])];
  return base;
}

// ───────────────────────── where-clause builders ─────────────────────────

export function clientWhere(s: Scope): Prisma.ClientWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { id: s.clientId ?? '__none__' };
  return { id: { in: s.visibleClientIds } };
}

export function campaignWhere(s: Scope): Prisma.CampaignWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? '__none__' };
  return { OR: [{ clientId: { in: s.fullClientIds } }, { id: { in: s.campaignIds } }] };
}

/** Generic filter for rows that carry clientId + optional campaignId (requests, reports, ...). */
export function ownedWhere(s: Scope): { clientId?: string; OR?: Array<{ clientId: { in: string[] } } | { campaignId: { in: string[] } }> } {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? '__none__' };
  return { OR: [{ clientId: { in: s.fullClientIds } }, { campaignId: { in: s.campaignIds } }] };
}

/** Clients only see deliverables that have been sent to them at least once. */
export function deliverableWhere(s: Scope): Prisma.DeliverableWhereInput {
  const own = ownedWhere(s);
  return s.role === 'CLIENT' ? { ...own, submittedAt: { not: null } } : own;
}

export function requestWhere(s: Scope): Prisma.RequestWhereInput {
  return ownedWhere(s);
}

export function reportWhere(s: Scope): Prisma.ReportWhereInput {
  return ownedWhere(s);
}

/**
 * Files. Clients additionally only see files flagged visibleToClient, and never internal attachments (tasks,
 * onboarding), files of unsent deliverables / content items, or contract / invoice files that were not shared.
 * Team members without invoices.view / contracts.view do not see invoice / contract files either.
 */
export function fileWhere(s: Scope): Prisma.FileWhereInput {
  const own = ownedWhere(s);
  if (s.role === 'ADMIN') return own;
  if (s.role === 'TEAM') {
    const hidden: Prisma.FileWhereInput[] = [];
    if (!s.permissions.has('invoices.view')) hidden.push({ invoiceId: null });
    if (!s.permissions.has('contracts.view')) hidden.push({ contractId: null });
    return hidden.length ? { AND: [own, ...hidden] } : own;
  }
  const sent = { deliverable: { is: { submittedAt: { not: null } } } } satisfies Prisma.FileWhereInput;
  return {
    AND: [
      own,
      // defence in depth: internal attachments are never client-visible, whatever the flag says
      { visibleToClient: true, taskId: null, onboardingItemId: null },
      // files hanging off a deliverable that was never sent to the client stay hidden
      { OR: [{ deliverableId: null }, sent] },
      { OR: [{ contentItemId: null }, sent] },
      { OR: [{ contractId: null }, { contract: { is: { visibleToClient: true, status: { not: 'DRAFT' } } } }] },
      { OR: [{ invoiceId: null }, { invoice: { is: { visibleToClient: true, status: { not: 'DRAFT' } } } }] },
    ],
  };
}

/** Approvals & deliverable comments are scoped through their deliverable. */
export function approvalWhere(s: Scope): Prisma.ApprovalWhereInput {
  return { deliverable: { is: deliverableWhere(s) } };
}

export function commentWhere(s: Scope): Prisma.CommentWhereInput {
  return {
    OR: [{ deliverable: { is: deliverableWhere(s) } }, { request: { is: requestWhere(s) } }, { project: { is: projectWhere(s) } }],
  };
}

// ───────────────────────── phase 2 entities ─────────────────────────

const NONE = '__none__';

/** Rows that belong to a client and are INTERNAL (onboarding checklist, internal notes ...): staff only. */
export function staffClientWhere(s: Scope): { clientId?: string | { in: string[] } } {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: NONE };
  return { clientId: { in: s.fullClientIds } };
}

/** Contacts: clients see only the contacts of their own company that are flagged visible. */
export function contactWhere(s: Scope): Prisma.ClientContactWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? NONE, visibleToClient: true };
  return { clientId: { in: s.fullClientIds } };
}

/**
 * Projects: clients see the visible projects of their company. Team members see projects of their clients, projects
 * they manage, projects that contain a campaign they are assigned to and projects where a task is assigned to them.
 */
export function projectWhere(s: Scope): Prisma.ProjectWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? NONE, visibleToClient: true };
  return {
    OR: [
      { clientId: { in: s.fullClientIds } },
      { projectManagerId: s.userId },
      { campaigns: { some: { id: { in: s.campaignIds } } } },
      { tasks: { some: { assignedToId: s.userId } } },
    ],
  };
}

/** Tasks are internal agency work: a CLIENT user matches nothing, ever. */
export function taskWhere(s: Scope): Prisma.TaskWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { id: NONE };
  return {
    OR: [
      { clientId: { in: s.fullClientIds } },
      { assignedToId: s.userId },
      { createdById: s.userId },
      { campaignId: { in: s.campaignIds } },
      { project: { is: { projectManagerId: s.userId } } },
    ],
  };
}

/** Content calendar: clients only see items that were actually sent to them (their linked deliverable was submitted). */
export function contentWhere(s: Scope): Prisma.ContentItemWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? NONE, deliverable: { is: { submittedAt: { not: null } } } };
  return { OR: [{ clientId: { in: s.fullClientIds } }, { campaignId: { in: s.campaignIds } }, { assignedToId: s.userId }] };
}

/** Contracts / invoices: clients only see their own rows that were explicitly shared (and never drafts). */
export function contractWhere(s: Scope): Prisma.ContractWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? NONE, visibleToClient: true, status: { not: 'DRAFT' } };
  return { clientId: { in: s.fullClientIds } };
}

export function invoiceWhere(s: Scope): Prisma.InvoiceWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? NONE, visibleToClient: true, status: { not: 'DRAFT' } };
  return { clientId: { in: s.fullClientIds } };
}

/** Time entries: everybody sees their own; `time.view_all` adds the entries logged on their clients. Clients see none. */
export function timeEntryWhere(s: Scope): Prisma.TimeEntryWhereInput {
  if (s.role === 'ADMIN') return {};
  if (s.role === 'CLIENT') return { id: NONE };
  if (s.permissions.has('time.view_all')) return { OR: [{ userId: s.userId }, { clientId: { in: s.fullClientIds } }] };
  return { userId: s.userId };
}

/** Proofing pins are scoped through their deliverable. */
export function proofingWhere(s: Scope): Prisma.ProofingCommentWhereInput {
  return { deliverable: { is: deliverableWhere(s) } };
}

/**
 * Activity feed (audit rows that carry a clientId). Clients only get the rows explicitly marked clientVisible for
 * their own company; the raw audit log itself stays administrator-only.
 */
export function activityWhere(s: Scope): Prisma.AuditLogWhereInput {
  if (s.role === 'ADMIN') return { clientId: { not: null } };
  if (s.role === 'CLIENT') return { clientId: s.clientId ?? NONE, clientVisible: true };
  return { clientId: { in: s.visibleClientIds } };
}

// ───────────────────────── point checks for writes ─────────────────────────

export const canWriteClient = (s: Scope, clientId: string) =>
  s.role === 'ADMIN' || (s.role === 'CLIENT' && s.clientId === clientId) || (s.role === 'TEAM' && s.fullClientIds.includes(clientId));

export const canAccessCampaign = (s: Scope, c: { id: string; clientId: string }) =>
  s.role === 'ADMIN' ||
  (s.role === 'CLIENT' && s.clientId === c.clientId) ||
  (s.role === 'TEAM' && (s.fullClientIds.includes(c.clientId) || s.campaignIds.includes(c.id)));
