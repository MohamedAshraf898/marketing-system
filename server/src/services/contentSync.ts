import type { Prisma } from '@prisma/client';
import type { ContentStatus, DeliverableStatus } from '../../../shared/src/enums';
import { prisma } from '../db';
import type { Ctx } from '../lib/context';
import { audit } from './audit';

/**
 * The content calendar has NO approval system of its own: a content item is approved through the linked Deliverable
 * (append-only history lives there). This small module is the ONLY place where a deliverable's state is mirrored onto
 * the linked content item. It is deliberately dependency-free (no import of services/deliverables) so both modules can
 * use it without a cycle.
 */
type Db = Prisma.TransactionClient | typeof prisma;

export interface ContentSyncResult {
  id: string;
  clientId: string;
  title: string;
  from: ContentStatus;
  to: ContentStatus;
}

/** deliverable status -> content status, plus the content statuses the move may start from. */
const RULES: Record<DeliverableStatus, { to: ContentStatus; from: ContentStatus[] } | null> = {
  PENDING_APPROVAL: { to: 'CLIENT_APPROVAL', from: ['IDEA', 'DRAFT', 'IN_REVIEW', 'REJECTED'] },
  APPROVED: { to: 'APPROVED', from: ['IDEA', 'DRAFT', 'IN_REVIEW', 'CLIENT_APPROVAL', 'REJECTED'] },
  CHANGES_REQUESTED: { to: 'DRAFT', from: ['CLIENT_APPROVAL', 'IN_REVIEW'] },
  DRAFT: { to: 'DRAFT', from: ['CLIENT_APPROVAL'] }, // a new version was started
  PUBLISHED: { to: 'PUBLISHED', from: ['APPROVED', 'SCHEDULED'] },
};

/**
 * Mirrors the deliverable's current status onto the content item linked to it (if any).
 * No link -> nothing happens, so deliverables without a content item behave exactly as before.
 * Pass the transaction client to make the two updates atomic. The move is conditional (`status` must still be one of
 * the allowed source statuses), so it never overwrites a status staff moved on their own (e.g. SCHEDULED).
 */
export async function syncContentFromDeliverable(deliverableId: string, db: Db = prisma): Promise<ContentSyncResult | null> {
  const item = await db.contentItem.findUnique({
    where: { deliverableId },
    select: { id: true, clientId: true, title: true, status: true, deliverable: { select: { status: true } } },
  });
  if (!item?.deliverable) return null;
  const rule = RULES[item.deliverable.status as DeliverableStatus];
  const current = item.status as ContentStatus;
  if (!rule || current === rule.to || !rule.from.includes(current)) return null;
  const res = await db.contentItem.updateMany({ where: { id: item.id, status: current }, data: { status: rule.to } });
  if (res.count !== 1) return null;
  return { id: item.id, clientId: item.clientId, title: item.title, from: current, to: rule.to };
}

/** Audit row for a sync result (call AFTER the transaction committed). Internal-only: the deliverable events are the client-visible ones. */
export async function auditContentSync(ctx: Pick<Ctx, 'ip'> & { user: { id: string } }, r: ContentSyncResult | null): Promise<void> {
  if (!r) return;
  await audit(ctx, 'CONTENT_STATUS_CHANGED', 'content', r.id, { title: r.title, from: r.from, to: r.to, via: 'deliverable' }, { clientId: r.clientId, clientVisible: false });
}
