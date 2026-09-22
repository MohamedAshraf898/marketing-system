import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { DELIVERABLE_STATUSES, DELIVERABLE_TYPES } from '../../../shared/src/enums';
import { authenticate, clientOnly, staffOnly } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { contentWhere, deliverableWhere, fileWhere, isClient, projectWhere, type Scope } from '../authz/scope';
import { resolveTarget } from '../authz/targets';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { audit } from '../services/audit';
import {
  attachPreviews, decideDeliverable, deliverablePermissions, findDeliverable, publishDeliverable, startNewVersion, submitDeliverable,
} from '../services/deliverables';
import { clientRecipients, notify, staffRecipients } from '../services/notifications';
import { and, fileSelect, userMini } from '../services/serializers';
import { proofingRouter } from './proofing';

export const deliverablesRouter = Router();
deliverablesRouter.use(authenticate);

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, { message: 'invalid_url' });

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  clientId: z.string().optional(),
  campaignId: z.string().nullish(),
  projectId: z.string().min(1).nullish(),
  type: z.enum(DELIVERABLE_TYPES),
  previewUrl: httpUrl.nullish().or(z.literal('')),
  description: z.string().trim().max(5000).nullish(),
  dueDate: dateStr.nullish(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    type: z.enum(DELIVERABLE_TYPES),
    previewUrl: httpUrl.nullable().or(z.literal('')),
    description: z.string().trim().max(5000).nullable(),
    dueDate: dateStr.nullable(),
    projectId: z.string().min(1).nullable(),
  })
  .partial()
  .strict();

/** A deliverable may only be linked to a project the caller can see AND that belongs to the same client. */
async function assertProjectLink(scope: Scope, projectId: string | null | undefined, clientId: string) {
  if (!projectId) return;
  const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: projectId }, projectWhere(scope)), select: { clientId: true } });
  if (!p || p.clientId !== clientId) throw Errors.validation({ projectId: 'invalid_choice' });
}

/** Clients never learn about internal (not client-visible) projects through a deliverable. */
function shapeProject<T extends { projectId: string | null; project?: { id: string; name: string; visibleToClient: boolean } | null }>(scope: Scope, row: T) {
  const { project, ...rest } = row;
  if (isClient(scope)) {
    const visible = !!project && project.visibleToClient;
    return { ...rest, projectId: visible ? row.projectId : null, project: visible ? { id: project!.id, name: project!.name } : null };
  }
  return { ...rest, project: project ? { id: project.id, name: project.name } : null };
}

const includeLists = {
  campaign: { select: { id: true, name: true } },
  client: { select: { id: true, companyName: true } },
  project: { select: { id: true, name: true, visibleToClient: true } },
} satisfies Prisma.DeliverableInclude;

deliverablesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const status = qsEnum(req.query, 'status', DELIVERABLE_STATUSES);
    const type = qsEnum(req.query, 'type', DELIVERABLE_TYPES);
    const campaignId = qs(req.query, 'campaignId');
    const clientId = qs(req.query, 'clientId');
    const projectId = qs(req.query, 'projectId');
    const where = and<Prisma.DeliverableWhereInput>(
      deliverableWhere(scope),
      status ? { status } : undefined,
      type ? { type } : undefined,
      campaignId ? { campaignId } : undefined,
      clientId ? { clientId } : undefined,
      projectId ? (isClient(scope) ? { projectId, project: { is: { visibleToClient: true } } } : { projectId }) : undefined,
      q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : undefined,
    );
    const [total, rows] = await Promise.all([
      prisma.deliverable.count({ where }),
      prisma.deliverable.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: p.skip, take: p.take, include: includeLists }),
    ]);
    res.json({ items: (await attachPreviews(scope, rows)).map((r) => shapeProject(scope, r)), meta: pageMeta(p, total) });
  }),
);

deliverablesRouter.post(
  '/',
  staffOnly,
  requirePerm('deliverables.create'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    const target = await resolveTarget(ctx.scope, { clientId: body.clientId, campaignId: body.campaignId });
    await assertProjectLink(ctx.scope, body.projectId, target.clientId);
    const d = await prisma.deliverable.create({
      data: {
        name: body.name,
        type: body.type,
        clientId: target.clientId,
        campaignId: target.campaign?.id ?? null,
        projectId: body.projectId ?? null,
        previewUrl: body.previewUrl || null,
        description: body.description || null,
        dueDate: body.dueDate ?? null,
        createdById: ctx.user.id,
      },
    });
    await audit(ctx, 'DELIVERABLE_CREATED', 'deliverable', d.id, { name: d.name, type: d.type }, { clientId: d.clientId, projectId: d.projectId });
    res.status(201).json({ item: d });
  }),
);

deliverablesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const d = await findDeliverable(scope, idParam(req));
    const files = await prisma.file.findMany({
      where: and<Prisma.FileWhereInput>(fileWhere(scope), { deliverableId: d.id }),
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      select: fileSelect,
    });
    const { _count, ...rest } = d;
    void _count;
    const [withPreview] = await attachPreviews(scope, [rest]);
    // staff only: the content calendar item this deliverable was created from (never sent to clients)
    const contentItem = isClient(scope)
      ? undefined
      : await prisma.contentItem.findFirst({
          where: and<Prisma.ContentItemWhereInput>({ deliverableId: d.id }, contentWhere(scope)),
          select: { id: true, title: true, status: true, platform: true, contentType: true, publishDate: true },
        });
    res.json({ item: { ...shapeProject(scope, withPreview), files, permissions: deliverablePermissions(user.role, d.status), ...(contentItem ? { contentItem } : {}) } });
  }),
);

deliverablesRouter.patch(
  '/:id',
  staffOnly,
  requirePerm('deliverables.create'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const d = await findDeliverable(ctx.scope, idParam(req));
    const body = parse(updateSchema, req.body);
    if (d.status !== 'DRAFT') throw Errors.conflict('DELIVERABLE_LOCKED', 'Only drafts can be edited. Start a new version first.');
    if (body.projectId !== undefined) await assertProjectLink(ctx.scope, body.projectId, d.clientId);
    const updated = await prisma.deliverable.update({
      where: { id: d.id },
      data: { ...body, ...('previewUrl' in body ? { previewUrl: body.previewUrl || null } : {}) },
    });
    await audit(ctx, 'DELIVERABLE_UPDATED', 'deliverable', d.id, { fields: Object.keys(body), name: d.name }, { clientId: d.clientId });
    res.json({ item: updated });
  }),
);

// ── workflow ──
deliverablesRouter.post(
  '/:id/submit',
  staffOnly,
  requirePerm('deliverables.create'),
  asyncHandler(async (req, res) => {
    res.json({ item: await submitDeliverable(ctxOf(req), idParam(req)) });
  }),
);

deliverablesRouter.post(
  '/:id/new-version',
  staffOnly,
  requirePerm('deliverables.create'),
  asyncHandler(async (req, res) => {
    res.json({ item: await startNewVersion(ctxOf(req), idParam(req)) });
  }),
);

deliverablesRouter.post(
  '/:id/publish',
  staffOnly,
  requirePerm('deliverables.approve'),
  asyncHandler(async (req, res) => {
    res.json({ item: await publishDeliverable(ctxOf(req), idParam(req)) });
  }),
);

const approveSchema = z.object({ comment: z.string().trim().max(2000).nullish() }).strict();
const changesSchema = z.object({ comment: z.string().trim().min(3).max(2000) }).strict();

// Only CLIENT users may decide - admins/team cannot approve on the client's behalf.
deliverablesRouter.post(
  '/:id/approve',
  clientOnly,
  asyncHandler(async (req, res) => {
    const body = parse(approveSchema, req.body ?? {});
    res.json({ item: await decideDeliverable(ctxOf(req), idParam(req), 'APPROVED', body.comment || null) });
  }),
);

deliverablesRouter.post(
  '/:id/request-changes',
  clientOnly,
  asyncHandler(async (req, res) => {
    const body = parse(changesSchema, req.body ?? {});
    res.json({ item: await decideDeliverable(ctxOf(req), idParam(req), 'CHANGES_REQUESTED', body.comment) });
  }),
);

// ── proofing (pins / timestamps on the files; never changes an approval record) ──
deliverablesRouter.use('/:id/proofing', proofingRouter);

// ── history & comments ──
deliverablesRouter.get(
  '/:id/approvals',
  asyncHandler(async (req, res) => {
    const d = await findDeliverable(ctxOf(req).scope, idParam(req));
    const items = await prisma.approval.findMany({
      where: { deliverableId: d.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: userMini } },
    });
    res.json({ items });
  }),
);

deliverablesRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const d = await findDeliverable(ctxOf(req).scope, idParam(req));
    const items = await prisma.comment.findMany({
      where: { deliverableId: d.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: userMini } },
    });
    res.json({ items });
  }),
);

const commentSchema = z.object({ comment: z.string().trim().min(1).max(2000) }).strict();

deliverablesRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const d = await findDeliverable(ctx.scope, idParam(req));
    const body = parse(commentSchema, req.body);
    // clientId / userId / authorType are derived on the server - anything in the body is ignored/rejected
    const isClient = ctx.user.role === 'CLIENT';
    const c = await prisma.comment.create({
      data: { deliverableId: d.id, clientId: d.clientId, userId: ctx.user.id, authorType: isClient ? 'CLIENT' : 'TEAM', comment: body.comment },
      include: { user: { select: userMini } },
    });
    await audit(ctx, 'COMMENT_CREATED', 'deliverable', d.id, { commentId: c.id, name: d.name }, { clientId: d.clientId, clientVisible: d.submittedAt !== null });
    const recipients = isClient ? await staffRecipients(d.clientId, d.campaignId) : d.submittedAt ? await clientRecipients(d.clientId) : [];
    await notify(recipients, { type: 'NEW_COMMENT', entity: 'deliverable', entityId: d.id, data: { name: d.name, by: ctx.user.name } }, ctx.user.id);
    res.status(201).json({ item: c });
  }),
);
