// Owner: Content & proofing group.  contentRouter -> /content
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CONTENT_APPROVAL_STATUSES, CONTENT_STATUSES, CONTENT_TYPES, SOCIAL_PLATFORMS, type ContentStatus } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm, requirePermOrClient } from '../authz/permissions';
import { canWriteClient, contentWhere, isClient } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { audit } from '../services/audit';
import {
  CREATE_STATUSES, assertAssignee, assertCreativeUnlocked, assertLinks, assertStaffTransition, clientDto, contentDetail, deleteContent,
  findContent, findContentForWrite, sendContentForApproval, staffDto,
} from '../services/content';
import { and } from '../services/serializers';

export const contentRouter = Router();
contentRouter.use(authenticate);

const MAX_CALENDAR_ITEMS = 500;
const MAX_CALENDAR_DAYS = 100;
const DAY_MS = 86_400_000;

/** date-only (YYYY-MM-DD) or full ISO datetime; years 2000-2100 */
const isoMoment = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return false;
  const t = Date.parse(isDateOnly(s) ? `${s}T00:00:00Z` : s);
  return !Number.isNaN(t) && t >= Date.UTC(2000, 0, 1) && t < Date.UTC(2101, 0, 1);
};
const moment = z.string().refine(isoMoment, { message: 'invalid_date' }).transform((s) => (isDateOnly(s) ? parseDateOnly(s) : new Date(s)));

const text = (max: number) => z.string().trim().max(max);

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  clientId: z.string().min(1),
  campaignId: z.string().min(1).nullish(),
  projectId: z.string().min(1).nullish(),
  platform: z.enum(SOCIAL_PLATFORMS).default('INSTAGRAM'),
  contentType: z.enum(CONTENT_TYPES).default('POST'),
  caption: text(5000).nullish(),
  status: z.enum(CREATE_STATUSES).default('IDEA'), // APPROVED / CLIENT_APPROVAL / ... are workflow-controlled
  publishDate: moment.nullish(),
  assignedToId: z.string().min(1).nullish(),
  notes: text(5000).nullish(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    campaignId: z.string().min(1).nullable(),
    projectId: z.string().min(1).nullable(),
    platform: z.enum(SOCIAL_PLATFORMS),
    contentType: z.enum(CONTENT_TYPES),
    caption: text(5000).nullable(),
    status: z.enum(CONTENT_STATUSES),
    publishDate: moment.nullable(),
    assignedToId: z.string().min(1).nullable(),
    notes: text(5000).nullable(),
  })
  .partial()
  .strict();

const flag = (v: string | undefined) => v === '1' || v === 'true';

/** Parses ?from / ?to (date-only = whole UTC day, or an ISO datetime). */
function range(query: Parameters<typeof qs>[0]) {
  const parse1 = (key: 'from' | 'to'): Date | undefined => {
    const v = qs(query, key);
    if (v === undefined) return undefined;
    if (!isoMoment(v)) throw Errors.validation({ [key]: 'invalid_date' });
    if (isDateOnly(v)) return key === 'from' ? parseDateOnly(v) : endOfDayUtc(v);
    return new Date(v);
  };
  return { from: parse1('from'), to: parse1('to') };
}

/** approvalStatus filter -> where on the linked deliverable (the only source of truth for approval state). */
function approvalFilter(v: (typeof CONTENT_APPROVAL_STATUSES)[number]): Prisma.ContentItemWhereInput {
  switch (v) {
    case 'PENDING': return { deliverable: { is: { status: 'PENDING_APPROVAL' } } };
    case 'APPROVED': return { deliverable: { is: { status: { in: ['APPROVED', 'PUBLISHED'] } } } };
    case 'CHANGES_REQUESTED': return { OR: [{ deliverable: { is: { status: 'CHANGES_REQUESTED' } } }, { deliverable: { is: { status: 'DRAFT', submittedAt: { not: null } } } }] };
    default: return { OR: [{ deliverableId: null }, { deliverable: { is: { status: 'DRAFT', submittedAt: null } } }] };
  }
}

contentRouter.get(
  '/',
  requirePermOrClient('content.view'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const client = isClient(scope);
    const q = qs(req.query, 'q');
    const { from, to } = range(req.query);
    const calendar = from !== undefined && to !== undefined;
    if (calendar) {
      if (to.getTime() < from.getTime()) throw Errors.validation({ to: 'end_before_start' });
      if (to.getTime() - from.getTime() > MAX_CALENDAR_DAYS * DAY_MS + DAY_MS) throw Errors.validation({ to: 'content_range_too_large' });
    }
    const platform = qsEnum(req.query, 'platform', SOCIAL_PLATFORMS);
    const contentType = qsEnum(req.query, 'contentType', CONTENT_TYPES);
    const status = qsEnum(req.query, 'status', CONTENT_STATUSES);
    const approvalStatus = qsEnum(req.query, 'approvalStatus', CONTENT_APPROVAL_STATUSES);
    const clientId = qs(req.query, 'clientId');
    const campaignId = qs(req.query, 'campaignId');
    const projectId = qs(req.query, 'projectId');
    const assignedToId = qs(req.query, 'assignedToId');

    const where = and<Prisma.ContentItemWhereInput>(
      contentWhere(scope),
      clientId ? { clientId } : undefined,
      campaignId ? { campaignId } : undefined,
      projectId && !client ? { projectId } : undefined,
      platform ? { platform } : undefined,
      contentType ? { contentType } : undefined,
      // the stored status is an internal workflow status: clients filter by approval state instead
      status && !client ? { status } : undefined,
      approvalStatus ? approvalFilter(approvalStatus) : undefined,
      !client && assignedToId ? { assignedToId } : undefined,
      !client && flag(qs(req.query, 'mine')) ? { assignedToId: user.id } : undefined,
      from ? { publishDate: { gte: from } } : undefined,
      to ? { publishDate: { lte: to } } : undefined,
      // internal notes are searchable by staff only
      q ? { OR: [{ title: { contains: q } }, { caption: { contains: q } }, ...(client ? [] : [{ notes: { contains: q } }])] } : undefined,
    );
    const orderBy: Prisma.ContentItemOrderByWithRelationInput[] = calendar ? [{ publishDate: 'asc' }, { createdAt: 'asc' }] : [{ publishDate: 'desc' }, { createdAt: 'desc' }];
    const p = calendar ? { page: 1, pageSize: MAX_CALENDAR_ITEMS, skip: 0, take: MAX_CALENDAR_ITEMS } : paging(req.query, 20);

    const total = await prisma.contentItem.count({ where });
    let items;
    if (client) {
      const rows = await prisma.contentItem.findMany({
        where, orderBy, skip: p.skip, take: p.take,
        select: { id: true, title: true, platform: true, contentType: true, caption: true, publishDate: true, status: true, deliverableId: true, deliverable: { select: { id: true, status: true, version: true, submittedAt: true } } },
      });
      items = rows.map(clientDto);
    } else {
      const rows = await prisma.contentItem.findMany({
        where, orderBy, skip: p.skip, take: p.take,
        include: {
          client: { select: { id: true, companyName: true } },
          campaign: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          deliverable: { select: { id: true, status: true, version: true, submittedAt: true } },
        },
      });
      items = rows.map(staffDto);
    }
    const meta = calendar
      ? { page: 1, pageSize: items.length, total, totalPages: 1, truncated: total > items.length }
      : pageMeta(p, total);
    res.json({ items, meta });
  }),
);

contentRouter.post(
  '/',
  requirePerm('content.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    // the client must be one the caller may write to (ADMIN: any existing client) - anything else is "invalid choice"
    if (!canWriteClient(ctx.scope, body.clientId)) throw Errors.validation({ clientId: 'invalid_choice' });
    const client = await prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true } });
    if (!client) throw Errors.validation({ clientId: 'invalid_choice' });
    await assertLinks(ctx.scope, body.clientId, body.campaignId, body.projectId);
    await assertAssignee(body.assignedToId, body.clientId);

    const item = await prisma.contentItem.create({
      data: {
        clientId: body.clientId,
        campaignId: body.campaignId ?? null,
        projectId: body.projectId ?? null,
        title: body.title,
        platform: body.platform,
        contentType: body.contentType,
        caption: body.caption || null,
        status: body.status,
        publishDate: body.publishDate ?? null,
        assignedToId: body.assignedToId ?? null,
        notes: body.notes || null,
        createdById: ctx.user.id, // from the session
      },
    });
    await audit(ctx, 'CONTENT_CREATED', 'content', item.id, { title: item.title, platform: item.platform, contentType: item.contentType }, { clientId: item.clientId, projectId: item.projectId, clientVisible: false });
    res.status(201).json({ item: await findContent(ctx.scope, item.id) });
  }),
);

contentRouter.get(
  '/:id',
  requirePermOrClient('content.view'),
  asyncHandler(async (req, res) => {
    res.json({ item: await contentDetail(ctxOf(req).scope, idParam(req)) });
  }),
);

contentRouter.patch(
  '/:id',
  requirePerm('content.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findContentForWrite(ctx.scope, idParam(req));
    const body = parse(updateSchema, req.body);
    const from = existing.status as ContentStatus;

    // approval workflow states are never set by hand (see STAFF_TRANSITIONS)
    if (body.status !== undefined) assertStaffTransition(from, body.status);
    const changed = (k: 'title' | 'platform' | 'contentType' | 'caption') => k in body && body[k] !== undefined && (body[k] ?? null) !== (existing[k] ?? null);
    if (changed('title') || changed('platform') || changed('contentType') || changed('caption')) assertCreativeUnlocked(from);

    const campaignId = 'campaignId' in body ? body.campaignId : existing.campaignId;
    const projectId = 'projectId' in body ? body.projectId : existing.projectId;
    if ('campaignId' in body || 'projectId' in body) await assertLinks(ctx.scope, existing.clientId, campaignId, projectId);
    if (body.assignedToId && body.assignedToId !== existing.assignedToId) await assertAssignee(body.assignedToId, existing.clientId);

    const { status, ...rest } = body;
    const data: Prisma.ContentItemUpdateInput | Prisma.ContentItemUncheckedUpdateManyInput = {
      ...rest,
      ...('caption' in rest ? { caption: rest.caption || null } : {}),
      ...('notes' in rest ? { notes: rest.notes || null } : {}),
      ...(status !== undefined && status !== from ? { status } : {}),
    };
    // conditional on the status we validated against, so a concurrent workflow move cannot be overwritten
    const res1 = await prisma.contentItem.updateMany({ where: { id: existing.id, status: existing.status }, data: data as Prisma.ContentItemUncheckedUpdateManyInput });
    if (res1.count !== 1) throw Errors.conflict('CONFLICT', 'The content item changed. Please refresh.');

    const fields = Object.keys(rest);
    if (fields.length) await audit(ctx, 'CONTENT_UPDATED', 'content', existing.id, { title: existing.title, fields }, { clientId: existing.clientId, projectId: existing.projectId, clientVisible: false });
    if (status !== undefined && status !== from) {
      await audit(ctx, 'CONTENT_STATUS_CHANGED', 'content', existing.id, { title: existing.title, from, to: status }, { clientId: existing.clientId, projectId: existing.projectId, clientVisible: false });
    }
    res.json({ item: await findContent(ctx.scope, existing.id) });
  }),
);

contentRouter.post(
  '/:id/send-for-approval',
  requirePerm('content.manage', 'deliverables.create'),
  asyncHandler(async (req, res) => {
    res.json({ item: await sendContentForApproval(ctxOf(req), idParam(req)) });
  }),
);

contentRouter.delete(
  '/:id',
  requirePerm('content.manage'),
  asyncHandler(async (req, res) => {
    await deleteContent(ctxOf(req), idParam(req));
    res.json({ ok: true });
  }),
);
