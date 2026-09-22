import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { REQUEST_PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { fileWhere, requestWhere } from '../authz/scope';
import { resolveTarget } from '../authz/targets';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { audit } from '../services/audit';
import { clientRecipients, notify, staffRecipients } from '../services/notifications';
import { assertValidAssignee, findRequest } from '../services/requests';
import { and, fileSelect, userMini } from '../services/serializers';

export const requestsRouter = Router();
requestsRouter.use(authenticate);

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);

// What a CLIENT may send. `.strict()` => status/assignee/due date etc. are rejected, not silently accepted.
const clientCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    type: z.enum(REQUEST_TYPES),
    campaignId: z.string().nullish(),
    description: z.string().trim().min(3).max(5000),
    priority: z.enum(REQUEST_PRIORITIES).default('NORMAL'),
  })
  .strict();

const staffCreateSchema = clientCreateSchema
  .extend({
    clientId: z.string().optional(),
    assignedToId: z.string().nullish(),
    dueDate: dateStr.nullish(),
  })
  .strict();

const staffUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    type: z.enum(REQUEST_TYPES),
    description: z.string().trim().min(3).max(5000),
    priority: z.enum(REQUEST_PRIORITIES),
    status: z.enum(REQUEST_STATUSES),
    assignedToId: z.string().nullable(),
    dueDate: dateStr.nullable(),
  })
  .partial()
  .strict();

// A client can only cancel their own request while it has not been completed.
const clientUpdateSchema = z.object({ status: z.literal('CANCELLED') }).strict();

const listInclude = {
  client: { select: { id: true, companyName: true } },
  campaign: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.RequestInclude;

requestsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const status = qsEnum(req.query, 'status', REQUEST_STATUSES);
    const priority = qsEnum(req.query, 'priority', REQUEST_PRIORITIES);
    const type = qsEnum(req.query, 'type', REQUEST_TYPES);
    const campaignId = qs(req.query, 'campaignId');
    const clientId = qs(req.query, 'clientId');
    const openOnly = qs(req.query, 'open') === '1';
    const where = and<Prisma.RequestWhereInput>(
      requestWhere(scope),
      status ? { status } : undefined,
      openOnly ? { status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'] } } : undefined,
      priority ? { priority } : undefined,
      type ? { type } : undefined,
      campaignId ? { campaignId } : undefined,
      clientId ? { clientId } : undefined,
      q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : undefined,
    );
    const [total, items] = await Promise.all([
      prisma.request.count({ where }),
      prisma.request.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: listInclude }),
    ]);
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

requestsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const isClient = ctx.user.role === 'CLIENT';
    const body = isClient ? { ...parse(clientCreateSchema, req.body), clientId: undefined, assignedToId: null, dueDate: null } : parse(staffCreateSchema, req.body);

    // client is taken from the session (CLIENT) or authorised against the caller's scope (staff)
    const target = await resolveTarget(ctx.scope, { clientId: body.clientId, campaignId: body.campaignId });
    if (body.assignedToId) await assertValidAssignee(body.assignedToId, target.clientId, target.campaign?.id ?? null);

    const created = await prisma.request.create({
      data: {
        title: body.title,
        type: body.type,
        description: body.description,
        priority: body.priority,
        status: 'NEW', // always
        clientId: target.clientId,
        campaignId: target.campaign?.id ?? null,
        userId: ctx.user.id,
        assignedToId: body.assignedToId ?? null,
        dueDate: body.dueDate ?? null,
      },
    });
    await audit(ctx, 'REQUEST_CREATED', 'request', created.id, { title: created.title, priority: created.priority }, { clientId: created.clientId, clientVisible: true });

    const recipients = isClient ? await staffRecipients(target.clientId, created.campaignId) : await clientRecipients(target.clientId);
    await notify(recipients, { type: 'NEW_REQUEST', entity: 'request', entityId: created.id, data: { title: created.title, by: ctx.user.name } }, ctx.user.id);
    res.status(201).json({ item: created });
  }),
);

requestsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const r = await findRequest(scope, idParam(req));
    const files = await prisma.file.findMany({
      where: and<Prisma.FileWhereInput>(fileWhere(scope), { requestId: r.id }),
      orderBy: { createdAt: 'desc' },
      select: fileSelect,
    });
    res.json({ item: { ...r, files } });
  }),
);

requestsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const isClient = ctx.user.role === 'CLIENT';
    const existing = await findRequest(ctx.scope, idParam(req));
    const body = isClient ? parse(clientUpdateSchema, req.body) : parse(staffUpdateSchema, req.body);

    if (isClient && !['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'].includes(existing.status)) {
      throw Errors.conflict('INVALID_STATE', 'This request can no longer be cancelled.');
    }
    const staffBody = body as z.infer<typeof staffUpdateSchema>;
    if (staffBody.assignedToId) await assertValidAssignee(staffBody.assignedToId, existing.clientId, existing.campaignId);

    const data: Prisma.RequestUncheckedUpdateInput = { ...body };
    const statusChanged = body.status !== undefined && body.status !== existing.status;
    if (statusChanged) data.completedAt = body.status === 'COMPLETED' ? new Date() : null;

    const updated = await prisma.request.update({ where: { id: existing.id }, data });

    if (statusChanged) {
      await audit(ctx, 'REQUEST_STATUS_CHANGED', 'request', existing.id, { from: existing.status, to: body.status, title: existing.title }, { clientId: existing.clientId, clientVisible: true });
      const recipients = isClient
        ? await staffRecipients(existing.clientId, existing.campaignId)
        : [...(await clientRecipients(existing.clientId))];
      await notify(recipients, { type: 'REQUEST_STATUS_CHANGED', entity: 'request', entityId: existing.id, data: { title: existing.title, status: body.status } }, ctx.user.id);
    }
    const otherFields = Object.keys(body).filter((k) => k !== 'status');
    if (otherFields.length) await audit(ctx, 'REQUEST_UPDATED', 'request', existing.id, { fields: otherFields, title: existing.title }, { clientId: existing.clientId });
    if (staffBody.assignedToId && staffBody.assignedToId !== existing.assignedToId) {
      await notify([staffBody.assignedToId], { type: 'REQUEST_ASSIGNED', entity: 'request', entityId: existing.id, data: { title: existing.title } }, ctx.user.id);
    }
    res.json({ item: updated });
  }),
);

// ── comments on a request ──
requestsRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const r = await findRequest(ctxOf(req).scope, idParam(req));
    const items = await prisma.comment.findMany({ where: { requestId: r.id }, orderBy: { createdAt: 'asc' }, include: { user: { select: userMini } } });
    res.json({ items });
  }),
);

requestsRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const r = await findRequest(ctx.scope, idParam(req));
    const body = parse(z.object({ comment: z.string().trim().min(1).max(2000) }).strict(), req.body);
    const isClient = ctx.user.role === 'CLIENT';
    const c = await prisma.comment.create({
      data: { requestId: r.id, clientId: r.clientId, userId: ctx.user.id, authorType: isClient ? 'CLIENT' : 'TEAM', comment: body.comment },
      include: { user: { select: userMini } },
    });
    await audit(ctx, 'COMMENT_CREATED', 'request', r.id, { commentId: c.id, title: r.title }, { clientId: r.clientId, clientVisible: true });
    const recipients = isClient ? await staffRecipients(r.clientId, r.campaignId) : await clientRecipients(r.clientId);
    await notify(recipients, { type: 'NEW_COMMENT', entity: 'request', entityId: r.id, data: { name: r.title, by: ctx.user.name } }, ctx.user.id);
    res.status(201).json({ item: c });
  }),
);
