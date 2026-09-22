import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { deliverableWhere, fileWhere, type Scope } from '../authz/scope';
import { Errors } from '../lib/errors';
import type { Ctx } from '../lib/context';
import { audit } from './audit';
import { clientRecipients, notify, staffRecipients } from './notifications';
import { and } from './serializers';

/** Loads a deliverable only if it is inside the caller's scope - otherwise it "does not exist". */
export async function findDeliverable(scope: Scope, id: string) {
  const d = await prisma.deliverable.findFirst({
    where: and<Prisma.DeliverableWhereInput>({ id }, deliverableWhere(scope)),
    include: {
      client: { select: { id: true, companyName: true, name: true } },
      campaign: { select: { id: true, name: true, clientId: true } },
      _count: { select: { files: true } },
    },
  });
  if (!d) throw Errors.notFound();
  return d;
}

/** Adds `previewFileId` (latest visible image file) so lists can show thumbnails. */
export async function attachPreviews<T extends { id: string }>(scope: Scope, items: T[]): Promise<Array<T & { previewFileId: string | null }>> {
  if (items.length === 0) return [];
  const files = await prisma.file.findMany({
    where: and<Prisma.FileWhereInput>(fileWhere(scope), { deliverableId: { in: items.map((i) => i.id) }, fileType: { startsWith: 'image/' } }),
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, deliverableId: true },
  });
  const first = new Map<string, string>();
  for (const f of files) if (f.deliverableId && !first.has(f.deliverableId)) first.set(f.deliverableId, f.id);
  return items.map((i) => ({ ...i, previewFileId: first.get(i.id) ?? null }));
}

/** DRAFT -> PENDING_APPROVAL. Creates an (append-only) PENDING history row for this version. */
export async function submitDeliverable(ctx: Ctx, id: string) {
  const d = await findDeliverable(ctx.scope, id);
  if (d.status !== 'DRAFT') throw Errors.conflict('INVALID_STATE', 'Only drafts can be submitted for approval.');
  if (!d.previewUrl && !d.description && d._count.files === 0) {
    throw Errors.badRequest('DELIVERABLE_EMPTY', 'Add a preview link, a description or a file before submitting.');
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const res = await tx.deliverable.updateMany({
      where: { id, status: 'DRAFT', version: d.version },
      data: { status: 'PENDING_APPROVAL', submittedAt: now, approvedAt: null },
    });
    if (res.count !== 1) throw Errors.conflict('INVALID_STATE', 'The deliverable changed. Please refresh.');
    await tx.approval.create({
      data: { deliverableId: id, clientId: d.clientId, userId: ctx.user.id, decision: 'PENDING', version: d.version, submittedAt: now },
    });
    // files of this version become visible to the client together with the submission
    await tx.file.updateMany({ where: { deliverableId: id, version: d.version }, data: { visibleToClient: true } });
  });

  await audit(ctx, 'DELIVERABLE_SUBMITTED', 'deliverable', id, { version: d.version, name: d.name });
  await notify(
    await clientRecipients(d.clientId),
    { type: 'DELIVERABLE_SUBMITTED', entity: 'deliverable', entityId: id, data: { name: d.name, version: d.version } },
    ctx.user.id,
  );
  return prisma.deliverable.findUniqueOrThrow({ where: { id } });
}

/** CHANGES_REQUESTED -> DRAFT with version + 1 so the team can upload/edit the next round. */
export async function startNewVersion(ctx: Ctx, id: string) {
  const d = await findDeliverable(ctx.scope, id);
  if (d.status !== 'CHANGES_REQUESTED') throw Errors.conflict('INVALID_STATE', 'A new version can only be started after changes were requested.');
  const res = await prisma.deliverable.updateMany({
    where: { id, status: 'CHANGES_REQUESTED', version: d.version },
    data: { status: 'DRAFT', version: d.version + 1 },
  });
  if (res.count !== 1) throw Errors.conflict('INVALID_STATE', 'The deliverable changed. Please refresh.');
  await audit(ctx, 'DELIVERABLE_NEW_VERSION', 'deliverable', id, { from: d.version, to: d.version + 1 });
  return prisma.deliverable.findUniqueOrThrow({ where: { id } });
}

/** APPROVED -> PUBLISHED (team marks the creative as live). */
export async function publishDeliverable(ctx: Ctx, id: string) {
  const d = await findDeliverable(ctx.scope, id);
  if (d.status !== 'APPROVED') throw Errors.conflict('INVALID_STATE', 'Only approved deliverables can be published.');
  const res = await prisma.deliverable.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PUBLISHED' } });
  if (res.count !== 1) throw Errors.conflict('INVALID_STATE', 'The deliverable changed. Please refresh.');
  await audit(ctx, 'DELIVERABLE_PUBLISHED', 'deliverable', id, { version: d.version });
  return prisma.deliverable.findUniqueOrThrow({ where: { id } });
}

/**
 * The client's decision. The route guarantees role === CLIENT and the scope guarantees the
 * deliverable belongs to the client's own company.
 *
 * History is APPEND-ONLY: the PENDING row written at submission is left untouched and a NEW row
 * is inserted for the decision. The status change is a conditional update (status must still be
 * PENDING_APPROVAL for this version), so two simultaneous clicks cannot both succeed.
 */
export async function decideDeliverable(ctx: Ctx, id: string, decision: 'APPROVED' | 'CHANGES_REQUESTED', comment: string | null) {
  const d = await findDeliverable(ctx.scope, id);
  if (d.status !== 'PENDING_APPROVAL') throw Errors.conflict('NOT_PENDING', 'This deliverable is not waiting for approval.');
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const res = await tx.deliverable.updateMany({
      where: { id, status: 'PENDING_APPROVAL', version: d.version },
      data:
        decision === 'APPROVED'
          ? { status: 'APPROVED', approvedAt: now, clientComment: comment }
          : { status: 'CHANGES_REQUESTED', approvedAt: null, clientComment: comment },
    });
    if (res.count !== 1) throw Errors.conflict('NOT_PENDING', 'This deliverable is not waiting for approval.');
    await tx.approval.create({
      data: {
        deliverableId: id,
        clientId: d.clientId, // from the record, never from the request
        userId: ctx.user.id, // from the session
        decision,
        comment,
        version: d.version,
        submittedAt: d.submittedAt,
        decidedAt: now,
      },
    });
  });

  const action = decision === 'APPROVED' ? 'DELIVERABLE_APPROVED' : 'CHANGES_REQUESTED';
  await audit(ctx, action, 'deliverable', id, { version: d.version, name: d.name });
  await notify(
    await staffRecipients(d.clientId, d.campaignId),
    { type: action, entity: 'deliverable', entityId: id, data: { name: d.name, version: d.version, client: d.client.companyName } },
    ctx.user.id,
  );
  return prisma.deliverable.findUniqueOrThrow({ where: { id } });
}

/** What the current user may do with a deliverable right now (drives the UI buttons). */
export function deliverablePermissions(role: Ctx['user']['role'], status: string) {
  const staff = role !== 'CLIENT';
  return {
    canEdit: staff && status === 'DRAFT',
    canSubmit: staff && status === 'DRAFT',
    canStartNewVersion: staff && status === 'CHANGES_REQUESTED',
    canPublish: staff && status === 'APPROVED',
    canDecide: role === 'CLIENT' && status === 'PENDING_APPROVAL',
    canUploadFiles: staff && status === 'DRAFT',
  };
}
