import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CAMPAIGN_STATUSES, OBJECTIVES, PLATFORMS } from '../../../shared/src/enums';
import { adminOnly, authenticate, staffOnly } from '../auth/middleware';
import { campaignWhere, fileWhere, reportWhere, requestWhere, deliverableWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { storage } from '../storage';
import { audit } from '../services/audit';
import { summarize } from '../services/reports';
import { and } from '../services/serializers';
import { findCampaign } from './helpers';

export const campaignsRouter = Router();
campaignsRouter.use(authenticate);

const dateStr = z
  .string()
  .refine(isDateOnly, { message: 'invalid_date' })
  .transform(parseDateOnly);

const money = z.number().min(0).max(1_000_000_000);

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    clientId: z.string().min(1),
    platform: z.enum(PLATFORMS),
    objective: z.enum(OBJECTIVES),
    status: z.enum(CAMPAIGN_STATUSES).default('PLANNING'),
    startDate: dateStr.nullish(),
    endDate: dateStr.nullish(),
    budget: money.default(0),
    spent: money.default(0),
    description: z.string().trim().max(4000).nullish(),
    campaignExternalId: z.string().trim().max(120).nullish(),
  })
  .superRefine((v, c) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) c.addIssue({ code: 'custom', path: ['endDate'], message: 'end_before_start' });
  });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    clientId: z.string().min(1),
    platform: z.enum(PLATFORMS),
    objective: z.enum(OBJECTIVES),
    status: z.enum(CAMPAIGN_STATUSES),
    startDate: dateStr.nullable(),
    endDate: dateStr.nullable(),
    budget: money,
    spent: money,
    description: z.string().trim().max(4000).nullable(),
    campaignExternalId: z.string().trim().max(120).nullable(),
  })
  .partial()
  .strict();

// TEAM members may only move a campaign through its statuses
const teamUpdateSchema = z.object({ status: z.enum(CAMPAIGN_STATUSES) }).strict();

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const status = qsEnum(req.query, 'status', CAMPAIGN_STATUSES);
    const platform = qsEnum(req.query, 'platform', PLATFORMS);
    const objective = qsEnum(req.query, 'objective', OBJECTIVES);
    const clientId = qs(req.query, 'clientId');
    const where = and<Prisma.CampaignWhereInput>(
      campaignWhere(scope),
      status ? { status } : undefined,
      platform ? { platform } : undefined,
      objective ? { objective } : undefined,
      clientId ? { clientId } : undefined,
      q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : undefined,
    );
    const [total, items] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { client: { select: { id: true, companyName: true } } },
      }),
    ]);
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

campaignsRouter.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    const client = await prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true, status: true } });
    if (!client) throw Errors.validation({ clientId: 'invalid_choice' });
    const campaign = await prisma.campaign.create({
      data: { ...body, description: body.description || null, campaignExternalId: body.campaignExternalId || null },
    });
    await audit(ctx, 'CAMPAIGN_CREATED', 'campaign', campaign.id, { name: campaign.name, clientId: campaign.clientId });
    res.status(201).json({ item: campaign });
  }),
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const campaign = await findCampaign(scope, idParam(req));
    const id = campaign.id;
    const [reports, deliverables, requests, files, reportCount] = await Promise.all([
      prisma.report.findMany({ where: and<Prisma.ReportWhereInput>(reportWhere(scope), { campaignId: id }) }),
      prisma.deliverable.count({ where: and<Prisma.DeliverableWhereInput>(deliverableWhere(scope), { campaignId: id }) }),
      prisma.request.count({ where: and<Prisma.RequestWhereInput>(requestWhere(scope), { campaignId: id }) }),
      prisma.file.count({ where: and<Prisma.FileWhereInput>(fileWhere(scope), { campaignId: id }) }),
      prisma.report.count({ where: and<Prisma.ReportWhereInput>(reportWhere(scope), { campaignId: id }) }),
    ]);
    res.json({
      item: { ...campaign, metrics: summarize(reports), counts: { deliverables, requests, files, reports: reportCount } },
    });
  }),
);

campaignsRouter.patch(
  '/:id',
  staffOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findCampaign(ctx.scope, idParam(req));
    const body = ctx.user.role === 'ADMIN' ? parse(updateSchema, req.body) : parse(teamUpdateSchema, req.body);

    if ('clientId' in body && body.clientId && body.clientId !== existing.clientId) {
      const target = await prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true } });
      if (!target) throw Errors.validation({ clientId: 'invalid_choice' });
      // moving a campaign to another client would strand its reports/deliverables under the wrong owner
      throw Errors.badRequest('CLIENT_CHANGE_NOT_ALLOWED', 'A campaign cannot be moved to another client.');
    }
    const start = 'startDate' in body && body.startDate !== undefined ? body.startDate : existing.startDate;
    const end = 'endDate' in body && body.endDate !== undefined ? body.endDate : existing.endDate;
    if (start && end && end < start) throw Errors.validation({ endDate: 'end_before_start' });

    const { clientId: _ignored, ...data } = body as typeof body & { clientId?: string };
    void _ignored;
    const updated = await prisma.campaign.update({ where: { id: existing.id }, data });
    const changes: Record<string, unknown> = {};
    if (data.status && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };
    await audit(ctx, 'CAMPAIGN_UPDATED', 'campaign', existing.id, { fields: Object.keys(data), ...changes });
    res.json({ item: updated });
  }),
);

campaignsRouter.delete(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findCampaign(ctx.scope, idParam(req));
    const id = existing.id;
    const [approvalCount, files] = await Promise.all([
      prisma.approval.count({ where: { deliverable: { is: { campaignId: id } } } }),
      prisma.file.findMany({ where: { campaignId: id, deliverableId: null, requestId: null }, select: { id: true, filePath: true } }),
    ]);
    // Deliverables (and their approval history) are kept and simply detached from the campaign.
    await prisma.$transaction([
      prisma.report.deleteMany({ where: { campaignId: id } }),
      prisma.campaignAssignment.deleteMany({ where: { campaignId: id } }),
      prisma.deliverable.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
      prisma.request.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
      prisma.file.deleteMany({ where: { id: { in: files.map((f) => f.id) } } }),
      prisma.file.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
      prisma.campaign.delete({ where: { id } }),
    ]);
    await Promise.all(files.map((f) => storage.delete(f.filePath).catch(() => undefined)));
    await audit(ctx, 'CAMPAIGN_DELETED', 'campaign', id, { name: existing.name, keptApprovalRecords: approvalCount });
    res.json({ ok: true });
  }),
);
