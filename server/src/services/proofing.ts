import type { Prisma } from '@prisma/client';
import { fileWhere } from '../authz/scope';
import { prisma } from '../db';
import type { Ctx } from '../lib/context';
import { Errors } from '../lib/errors';
import { audit } from './audit';
import { findDeliverable } from './deliverables';
import { clientRecipients, notify, staffRecipients } from './notifications';
import { and, userMini } from './serializers';

/**
 * Proofing = pinned / timestamped review comments on a deliverable's files. They never touch the approval records:
 * the approval decision (append-only history) stays exclusively in services/deliverables.ts.
 */

const proofingInclude = {
  user: { select: userMini },
  file: { select: { id: true, fileName: true, fileType: true, version: true, visibleToClient: true } },
} satisfies Prisma.ProofingCommentInclude;

type Row = Prisma.ProofingCommentGetPayload<{ include: typeof proofingInclude }>;

/** Whole-deliverable facts the rules need. */
type Deliv = Awaited<ReturnType<typeof findDeliverable>>;

/** Highest version that was actually sent to the client (a new draft version is invisible to them until submitted). */
export function clientVisibleMaxVersion(d: Pick<Deliv, 'status' | 'version' | 'submittedAt'>): number {
  if (!d.submittedAt) return 0;
  return d.status === 'DRAFT' ? d.version - 1 : d.version;
}

/** CLIENT users can add pins only while the deliverable is open for feedback; staff can always comment. */
export function canCommentNow(role: Ctx['user']['role'], status: string): boolean {
  return role !== 'CLIENT' || status === 'PENDING_APPROVAL' || status === 'CHANGES_REQUESTED';
}

/** Comments of versions the client never received are internal working notes. */
function visibleFilter(ctx: Ctx, d: Deliv): Prisma.ProofingCommentWhereInput {
  const base: Prisma.ProofingCommentWhereInput = { deliverableId: d.id };
  return ctx.user.role === 'CLIENT' ? { ...base, version: { lte: clientVisibleMaxVersion(d) } } : base;
}

const shape = (r: Row, role: Ctx['user']['role']) => ({
  id: r.id,
  deliverableId: r.deliverableId,
  fileId: r.fileId,
  version: r.version,
  x: r.x,
  y: r.y,
  timestampSec: r.timestampSec,
  comment: r.comment,
  authorType: r.authorType,
  userId: r.userId,
  resolved: r.resolved,
  resolvedAt: r.resolvedAt,
  createdAt: r.createdAt,
  user: r.user,
  file: r.file && (role !== 'CLIENT' || r.file.visibleToClient) ? { id: r.file.id, fileName: r.file.fileName, fileType: r.file.fileType, version: r.file.version } : null,
});

export interface ProofingListQuery { version?: number; fileId?: string }

export async function listProofing(ctx: Ctx, deliverableId: string, q: ProofingListQuery) {
  const d = await findDeliverable(ctx.scope, deliverableId);
  const where = and<Prisma.ProofingCommentWhereInput>(
    visibleFilter(ctx, d),
    q.version !== undefined ? { version: q.version } : undefined,
    q.fileId ? { fileId: q.fileId } : undefined,
  );
  const [rows, unresolved] = await Promise.all([
    prisma.proofingComment.findMany({ where, orderBy: { createdAt: 'asc' }, take: 500, include: proofingInclude }),
    prisma.proofingComment.count({ where: and<Prisma.ProofingCommentWhereInput>(where, { resolved: false }) }),
  ]);
  const maxVersion = ctx.user.role === 'CLIENT' ? clientVisibleMaxVersion(d) : d.version;
  return {
    items: rows.map((r) => shape(r, ctx.user.role)),
    counts: { total: rows.length, unresolved },
    canComment: canCommentNow(ctx.user.role, d.status),
    currentVersion: d.version,
    versions: Array.from({ length: Math.max(0, maxVersion) }, (_, i) => i + 1),
  };
}

export interface ProofingInput {
  fileId?: string | null;
  version?: number | null;
  x?: number | null;
  y?: number | null;
  timestampSec?: number | null;
  comment: string;
}

export async function createProofing(ctx: Ctx, deliverableId: string, input: ProofingInput) {
  const d = await findDeliverable(ctx.scope, deliverableId);
  const isClient = ctx.user.role === 'CLIENT';
  if (!canCommentNow(ctx.user.role, d.status)) throw Errors.conflict('PROOFING_CLOSED', 'This deliverable is not open for comments.');

  const maxVersion = isClient ? clientVisibleMaxVersion(d) : d.version;
  let version = input.version ?? d.version;
  let fileType: string | null = null;
  if (input.fileId) {
    // the file must belong to THIS deliverable and be visible to the caller
    const f = await prisma.file.findFirst({
      where: and<Prisma.FileWhereInput>({ id: input.fileId, deliverableId: d.id }, fileWhere(ctx.scope)),
      select: { id: true, fileType: true, version: true },
    });
    if (!f) throw Errors.validation({ fileId: 'invalid_choice' });
    if (input.version != null && input.version !== f.version) throw Errors.validation({ version: 'invalid_choice' });
    version = f.version;
    fileType = f.fileType;
  }
  if (version < 1 || version > maxVersion) throw Errors.validation({ version: 'invalid_choice' });

  const hasPin = input.x != null && input.y != null;
  if (input.timestampSec != null && !(fileType && fileType.startsWith('video/'))) throw Errors.validation({ timestampSec: 'not_allowed' });

  const created = await prisma.proofingComment.create({
    data: {
      deliverableId: d.id,
      fileId: input.fileId ?? null,
      version,
      x: hasPin ? input.x! : null,
      y: hasPin ? input.y! : null,
      timestampSec: input.timestampSec ?? null,
      comment: input.comment,
      userId: ctx.user.id, // from the session
      authorType: isClient ? 'CLIENT' : 'TEAM', // from the session, never from the body
    },
    include: proofingInclude,
  });

  // A team note on a version the client has not received yet stays internal (no client feed row, no notification).
  const clientCanSee = isClient || version <= clientVisibleMaxVersion(d);
  await audit(ctx, 'PROOFING_COMMENT_CREATED', 'proofing', created.id, { deliverableId: d.id, name: d.name, version, pin: hasPin, timestamp: input.timestampSec != null }, { clientId: d.clientId, clientVisible: clientCanSee });
  const recipients = isClient ? await staffRecipients(d.clientId, d.campaignId) : clientCanSee ? await clientRecipients(d.clientId) : [];
  await notify(recipients, { type: 'PROOFING_COMMENT', entity: 'deliverable', entityId: d.id, data: { name: d.name, by: ctx.user.name, version } }, ctx.user.id);
  return shape(created, ctx.user.role);
}

async function findVisibleComment(ctx: Ctx, d: Deliv, commentId: string) {
  const c = await prisma.proofingComment.findFirst({ where: and<Prisma.ProofingCommentWhereInput>({ id: commentId }, visibleFilter(ctx, d)), include: proofingInclude });
  if (!c) throw Errors.notFound();
  return c;
}

/** Staff can resolve any pin of a deliverable in their scope; a client only their own. */
export async function setProofingResolved(ctx: Ctx, deliverableId: string, commentId: string, resolved: boolean) {
  const d = await findDeliverable(ctx.scope, deliverableId);
  const c = await findVisibleComment(ctx, d, commentId);
  if (ctx.user.role === 'CLIENT' && c.userId !== ctx.user.id) throw Errors.forbidden();
  if (c.resolved === resolved) return shape(c, ctx.user.role);
  const now = new Date();
  const res = await prisma.proofingComment.updateMany({
    where: { id: c.id, resolved: c.resolved },
    data: resolved ? { resolved: true, resolvedAt: now, resolvedById: ctx.user.id } : { resolved: false, resolvedAt: null, resolvedById: null },
  });
  if (res.count !== 1) throw Errors.conflict('CONFLICT', 'The comment changed. Please refresh.');
  const clientCanSee = ctx.user.role === 'CLIENT' || c.version <= clientVisibleMaxVersion(d);
  await audit(ctx, 'PROOFING_COMMENT_RESOLVED', 'proofing', c.id, { deliverableId: d.id, name: d.name, version: c.version, resolved }, { clientId: d.clientId, clientVisible: clientCanSee });
  return shape(await prisma.proofingComment.findUniqueOrThrow({ where: { id: c.id }, include: proofingInclude }), ctx.user.role);
}

/** Only the author (or an ADMIN) can delete a comment, and only while it is still open. */
export async function deleteProofing(ctx: Ctx, deliverableId: string, commentId: string) {
  const d = await findDeliverable(ctx.scope, deliverableId);
  const c = await findVisibleComment(ctx, d, commentId);
  if (c.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden();
  if (c.resolved) throw Errors.conflict('PROOFING_RESOLVED', 'Resolved comments cannot be deleted.');
  const res = await prisma.proofingComment.deleteMany({ where: { id: c.id, resolved: false } });
  if (res.count !== 1) throw Errors.conflict('PROOFING_RESOLVED', 'Resolved comments cannot be deleted.');
  await audit(ctx, 'PROOFING_COMMENT_DELETED', 'proofing', c.id, { deliverableId: d.id, name: d.name, version: c.version }, { clientId: d.clientId, clientVisible: false });
}
