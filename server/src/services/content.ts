import type { Prisma } from '@prisma/client';
import {
  CONTENT_STATUSES, type ContentApprovalStatus, type ContentStatus, type ContentType, type DeliverableType,
} from '../../../shared/src/enums';
import { campaignWhere, canWriteClient, contentWhere, fileWhere, isClient, projectWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import type { Ctx } from '../lib/context';
import { Errors } from '../lib/errors';
import { storage } from '../storage';
import { audit } from './audit';
import { findDeliverable, startNewVersion, submitDeliverable } from './deliverables';
import { and, fileSelect } from './serializers';

// ───────────────────────── status rules (single table) ─────────────────────────

/**
 * Statuses staff may move an item to BY HAND. CLIENT_APPROVAL, APPROVED and REJECTED are absent everywhere on purpose:
 * they belong to the approval workflow (send-for-approval + the client's decision on the linked deliverable), so
 * nobody on staff can mark content "approved" manually.
 */
export const STAFF_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  IDEA: ['DRAFT', 'IN_REVIEW'],
  DRAFT: ['IDEA', 'IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'IDEA'],
  CLIENT_APPROVAL: [], // waiting for the client
  APPROVED: ['SCHEDULED', 'PUBLISHED'],
  SCHEDULED: ['APPROVED', 'PUBLISHED'],
  PUBLISHED: [],
  REJECTED: ['DRAFT', 'IDEA'],
};

/** Statuses a brand-new item may start in. */
export const CREATE_STATUSES = ['IDEA', 'DRAFT'] as const;

/** From these statuses the item can be (re)sent to the client. */
const SENDABLE: ContentStatus[] = ['IDEA', 'DRAFT', 'IN_REVIEW', 'REJECTED'];

/** Once the client is involved the creative (title / caption / type / platform) is frozen: it is what was approved. */
const CREATIVE_LOCKED: ContentStatus[] = ['CLIENT_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHED'];

export const isContentStatus = (v: string): v is ContentStatus => (CONTENT_STATUSES as readonly string[]).includes(v);

const TYPE_MAP: Record<ContentType, DeliverableType> = {
  POST: 'DESIGN', CAROUSEL: 'DESIGN', REEL: 'REEL', STORY: 'STORY', VIDEO: 'VIDEO', ARTICLE: 'COPY', AD: 'BANNER', OTHER: 'OTHER',
};
export const deliverableTypeFor = (t: ContentType): DeliverableType => TYPE_MAP[t] ?? 'OTHER';

// ───────────────────────── derived approval state ─────────────────────────

interface LinkedDeliverable { id: string; status: string; version: number; submittedAt: Date | null }

/** The approval state of a content item is ALWAYS derived from its linked deliverable (one approval system only). */
export function approvalStatusOf(d: LinkedDeliverable | null | undefined): ContentApprovalStatus {
  if (!d) return 'NOT_SUBMITTED';
  switch (d.status) {
    case 'PENDING_APPROVAL': return 'PENDING';
    case 'APPROVED':
    case 'PUBLISHED': return 'APPROVED';
    case 'CHANGES_REQUESTED': return 'CHANGES_REQUESTED';
    default: return d.submittedAt ? 'CHANGES_REQUESTED' : 'NOT_SUBMITTED'; // DRAFT: a revised version is being prepared
  }
}

// ───────────────────────── DTOs ─────────────────────────

const staffInclude = {
  client: { select: { id: true, companyName: true } },
  campaign: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  deliverable: { select: { id: true, status: true, version: true, submittedAt: true } },
} satisfies Prisma.ContentItemInclude;

const clientSelect = {
  id: true, title: true, platform: true, contentType: true, caption: true, publishDate: true, status: true, deliverableId: true,
  deliverable: { select: { id: true, status: true, version: true, submittedAt: true } },
} satisfies Prisma.ContentItemSelect;

type StaffRow = Prisma.ContentItemGetPayload<{ include: typeof staffInclude }>;
type ClientRow = Prisma.ContentItemGetPayload<{ select: typeof clientSelect }>;

export function staffDto(r: StaffRow) {
  const approvalStatus = approvalStatusOf(r.deliverable);
  const status = r.status as ContentStatus;
  const canSend = SENDABLE.includes(status) && (!r.deliverable || r.deliverable.status === 'DRAFT' || r.deliverable.status === 'CHANGES_REQUESTED');
  return {
    ...r,
    approvalStatus,
    allowedStatuses: STAFF_TRANSITIONS[status] ?? [],
    canSendForApproval: canSend,
    creativeLocked: CREATIVE_LOCKED.includes(status),
  };
}

/**
 * What a CLIENT user gets: an explicit WHITELIST (a field added to the model later stays private by default).
 * Never `notes`, assignee, campaign/project internals or the internal workflow status - the status is derived from the
 * approval state of the deliverable the client actually received.
 */
export function clientDto(r: ClientRow) {
  const approvalStatus = approvalStatusOf(r.deliverable);
  const stored = r.status as ContentStatus;
  let status: ContentStatus;
  if (approvalStatus === 'PENDING') status = 'CLIENT_APPROVAL';
  else if (approvalStatus === 'APPROVED') status = ['APPROVED', 'SCHEDULED', 'PUBLISHED'].includes(stored) ? stored : 'APPROVED';
  else status = 'DRAFT'; // changes requested / being revised
  return {
    id: r.id,
    title: r.title,
    platform: r.platform,
    contentType: r.contentType,
    caption: r.caption,
    publishDate: r.publishDate,
    status,
    deliverableId: r.deliverableId,
    deliverableVersion: r.deliverable?.version ?? null,
    approvalStatus,
  };
}

// ───────────────────────── queries ─────────────────────────

export async function findContent(scope: Scope, id: string) {
  const where = and<Prisma.ContentItemWhereInput>({ id }, contentWhere(scope));
  if (isClient(scope)) {
    const r = await prisma.contentItem.findFirst({ where, select: clientSelect });
    if (!r) throw Errors.notFound();
    return clientDto(r);
  }
  const r = await prisma.contentItem.findFirst({ where, include: staffInclude });
  if (!r) throw Errors.notFound();
  return staffDto(r);
}

/** Staff detail: the DTO + the files attached to the item (visible to the caller). */
export async function contentDetail(scope: Scope, id: string) {
  const item = await findContent(scope, id);
  if (isClient(scope)) return item;
  const files = await prisma.file.findMany({
    where: and<Prisma.FileWhereInput>(fileWhere(scope), { contentItemId: id }),
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    select: fileSelect,
  });
  return { ...item, files };
}

// ───────────────────────── write helpers ─────────────────────────

/** Loads an item the caller can see AND may modify (their client, or a campaign they are assigned to). */
export async function findContentForWrite(scope: Scope, id: string) {
  const item = await prisma.contentItem.findFirst({ where: and<Prisma.ContentItemWhereInput>({ id }, contentWhere(scope)), include: { deliverable: { select: { id: true, status: true, version: true, submittedAt: true, description: true, previewUrl: true, _count: { select: { files: true } } } } } });
  if (!item) throw Errors.notFound();
  const ok = canWriteClient(scope, item.clientId) || (!!item.campaignId && scope.campaignIds.includes(item.campaignId));
  if (!ok) throw Errors.forbidden(); // visible (e.g. assigned to them) but not theirs to change
  return item;
}

/** The campaign / project must be in the caller's scope AND belong to the same client (no cross-client links). */
export async function assertLinks(scope: Scope, clientId: string, campaignId: string | null | undefined, projectId: string | null | undefined) {
  if (campaignId) {
    const c = await prisma.campaign.findFirst({ where: and<Prisma.CampaignWhereInput>({ id: campaignId }, campaignWhere(scope)), select: { clientId: true } });
    if (!c || c.clientId !== clientId) throw Errors.validation({ campaignId: 'invalid_choice' });
  }
  if (projectId) {
    const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: projectId }, projectWhere(scope)), select: { clientId: true } });
    if (!p || p.clientId !== clientId) throw Errors.validation({ projectId: 'invalid_choice' });
  }
}

/** Assignee: an active ADMIN, or a TEAM member who works on that client (whole client or one of its campaigns). */
export async function assertAssignee(userId: string | null | undefined, clientId: string) {
  if (!userId) return;
  const u = await prisma.user.findFirst({
    where: {
      id: userId,
      status: 'ACTIVE',
      OR: [
        { role: 'ADMIN' },
        { role: 'TEAM', clientAssignments: { some: { clientId } } },
        { role: 'TEAM', campaignAssignments: { some: { campaign: { clientId } } } },
      ],
    },
    select: { id: true },
  });
  if (!u) throw Errors.validation({ assignedToId: 'invalid_choice' });
}

export function assertStaffTransition(from: ContentStatus, to: ContentStatus) {
  if (from === to) return;
  if (!STAFF_TRANSITIONS[from]?.includes(to)) {
    throw Errors.conflict('CONTENT_INVALID_TRANSITION', `Content cannot be moved from ${from} to ${to} manually.`);
  }
}

export function assertCreativeUnlocked(status: ContentStatus) {
  if (CREATIVE_LOCKED.includes(status)) throw Errors.conflict('CONTENT_LOCKED', 'This content is with the client or already approved and can no longer be edited.');
}

// ───────────────────────── send for approval ─────────────────────────

/**
 * Creates (or reuses) the linked Deliverable and submits it through the SAME functions the deliverables routes use, so the
 * client gets the normal notification and an append-only PENDING approval row. Resubmission after "changes requested"
 * starts the next version of the same deliverable (v1 approvals stay untouched).
 */
export async function sendContentForApproval(ctx: Ctx, id: string) {
  const item = await findContentForWrite(ctx.scope, id);
  const status = item.status as ContentStatus;
  if (status === 'CLIENT_APPROVAL') throw Errors.conflict('CONTENT_ALREADY_PENDING', 'This content is already waiting for the client.');
  if (!SENDABLE.includes(status)) throw Errors.conflict('CONTENT_INVALID_TRANSITION', 'This content has already been approved.');
  const linked = item.deliverable;
  if (linked && linked.status !== 'DRAFT' && linked.status !== 'CHANGES_REQUESTED') {
    throw Errors.conflict(linked.status === 'PENDING_APPROVAL' ? 'CONTENT_ALREADY_PENDING' : 'CONTENT_INVALID_TRANSITION', 'The linked deliverable cannot be sent again.');
  }

  // fail early (before anything is created) when there is nothing to show the client
  const looseFiles = await prisma.file.count({ where: { contentItemId: item.id, deliverableId: null } });
  const material = !!item.caption?.trim() || looseFiles > 0 || !!linked?.description || !!linked?.previewUrl || (linked?._count.files ?? 0) > 0;
  if (!material) throw Errors.badRequest('DELIVERABLE_EMPTY', 'Add a caption or a file before sending for approval.');

  const fields = {
    name: item.title,
    type: deliverableTypeFor(item.contentType as ContentType),
    description: item.caption?.trim() || null,
    campaignId: item.campaignId,
    projectId: item.projectId,
  };

  let deliverableId: string;
  if (!linked) {
    const created = await prisma.$transaction(async (tx) => {
      const d = await tx.deliverable.create({ data: { ...fields, clientId: item.clientId, createdById: ctx.user.id } });
      const res = await tx.contentItem.updateMany({ where: { id: item.id, deliverableId: null }, data: { deliverableId: d.id } });
      if (res.count !== 1) throw Errors.conflict('CONFLICT', 'The content item changed. Please refresh.'); // rolls the deliverable back
      return d;
    });
    deliverableId = created.id;
    await audit(ctx, 'DELIVERABLE_CREATED', 'deliverable', created.id, { name: created.name, type: created.type, contentItemId: item.id }, { clientId: created.clientId, projectId: created.projectId });
  } else {
    deliverableId = linked.id;
    if (linked.status === 'CHANGES_REQUESTED') await startNewVersion(ctx, linked.id); // v+1, DRAFT (approval history untouched)
    await prisma.deliverable.updateMany({ where: { id: linked.id, status: 'DRAFT' }, data: fields });
  }

  // attach the item's own files to the deliverable version being sent. They stay hidden from the client until
  // submitDeliverable() flips the visibility of this version's files together with the submission.
  const d = await findDeliverable(ctx.scope, deliverableId);
  await prisma.file.updateMany({ where: { contentItemId: item.id, deliverableId: null }, data: { deliverableId, version: d.version, visibleToClient: false } });

  await submitDeliverable(ctx, deliverableId); // notification + approval row + content -> CLIENT_APPROVAL (syncContentFromDeliverable)
  await prisma.contentItem.updateMany({ where: { id: item.id, status: { in: SENDABLE } }, data: { status: 'CLIENT_APPROVAL' } }); // belt and braces

  await audit(ctx, 'CONTENT_SENT_FOR_APPROVAL', 'content', item.id, { title: item.title, deliverableId, version: d.version }, { clientId: item.clientId, clientVisible: true });
  return findContent(ctx.scope, item.id);
}

// ───────────────────────── delete ─────────────────────────

export async function deleteContent(ctx: Ctx, id: string) {
  const item = await findContentForWrite(ctx.scope, id);
  // a submitted deliverable carries the approval history: the item that produced it must stay so the history keeps its context
  if (item.deliverable?.submittedAt) {
    throw Errors.conflict('CONTENT_HAS_APPROVAL_HISTORY', 'This content was sent to the client. Its approval history must be preserved.');
  }
  const loose = await prisma.file.findMany({ where: { contentItemId: item.id, deliverableId: null }, select: { id: true, filePath: true } });
  await prisma.$transaction([
    prisma.file.deleteMany({ where: { id: { in: loose.map((f) => f.id) } } }),
    prisma.contentItem.delete({ where: { id: item.id } }),
  ]);
  await Promise.all(loose.map((f) => storage.delete(f.filePath).catch(() => undefined)));
  await audit(ctx, 'CONTENT_DELETED', 'content', item.id, { title: item.title, status: item.status }, { clientId: item.clientId });
}
