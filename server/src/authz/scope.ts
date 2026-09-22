import type { Prisma } from '@prisma/client';
import type { Role } from '../../../shared/src/enums';
import { prisma } from '../db';

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
}

export const isAdmin = (s: Scope) => s.role === 'ADMIN';
export const isClient = (s: Scope) => s.role === 'CLIENT';
export const isTeam = (s: Scope) => s.role === 'TEAM';
export const isStaff = (s: Scope) => s.role !== 'CLIENT';

export async function loadScope(user: { id: string; role: Role; clientId: string | null }): Promise<Scope> {
  const base: Scope = {
    role: user.role,
    userId: user.id,
    clientId: user.role === 'CLIENT' ? user.clientId : null,
    fullClientIds: [],
    campaignIds: [],
    visibleClientIds: [],
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

/** Files: clients additionally only see files flagged visibleToClient. */
export function fileWhere(s: Scope): Prisma.FileWhereInput {
  const own = ownedWhere(s);
  if (s.role !== 'CLIENT') return own;
  return {
    ...own,
    visibleToClient: true,
    // files hanging off a deliverable that was never sent to the client stay hidden
    OR: [{ deliverableId: null }, { deliverable: { is: { submittedAt: { not: null } } } }],
  };
}

/** Approvals & deliverable comments are scoped through their deliverable. */
export function approvalWhere(s: Scope): Prisma.ApprovalWhereInput {
  return { deliverable: { is: deliverableWhere(s) } };
}

export function commentWhere(s: Scope): Prisma.CommentWhereInput {
  return {
    OR: [{ deliverable: { is: deliverableWhere(s) } }, { request: { is: requestWhere(s) } }],
  };
}

// ───────────────────────── point checks for writes ─────────────────────────

export const canWriteClient = (s: Scope, clientId: string) =>
  s.role === 'ADMIN' || (s.role === 'CLIENT' && s.clientId === clientId) || (s.role === 'TEAM' && s.fullClientIds.includes(clientId));

export const canAccessCampaign = (s: Scope, c: { id: string; clientId: string }) =>
  s.role === 'ADMIN' ||
  (s.role === 'CLIENT' && s.clientId === c.clientId) ||
  (s.role === 'TEAM' && (s.fullClientIds.includes(c.clientId) || s.campaignIds.includes(c.id)));
