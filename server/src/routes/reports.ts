import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticate, staffOnly } from '../auth/middleware';
import { reportWhere } from '../authz/scope';
import { resolveTarget } from '../authz/targets';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs } from '../lib/http';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { audit } from '../services/audit';
import { buildSeries, deriveRatios, summarize, syncCampaignSpent } from '../services/reports';
import { and } from '../services/serializers';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' });
const count = z.number().int().min(0).max(2_000_000_000);
const money = z.number().min(0).max(1_000_000_000);

// Only raw numbers are accepted. ctr/cpc/cpm/roas are calculated here, so they can never be forged.
const createSchema = z
  .object({
    campaignId: z.string().min(1),
    date: dateStr,
    spend: money,
    reach: count,
    impressions: count,
    clicks: count,
    conversions: count,
    conversionValue: money.default(0),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.clicks > v.impressions) c.addIssue({ code: 'custom', path: ['clicks'], message: 'clicks_exceed_impressions' });
    if (v.reach > v.impressions) c.addIssue({ code: 'custom', path: ['reach'], message: 'reach_exceeds_impressions' });
  });

reportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const campaignId = qs(req.query, 'campaignId');
    const clientId = qs(req.query, 'clientId');
    const from = qs(req.query, 'from');
    const to = qs(req.query, 'to');
    if ((from && !isDateOnly(from)) || (to && !isDateOnly(to))) throw Errors.validation({ from: 'invalid_date' });

    const where = and<Prisma.ReportWhereInput>(
      reportWhere(scope),
      campaignId ? { campaignId } : undefined,
      clientId ? { clientId } : undefined,
      from || to ? { date: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lte: endOfDayUtc(to) } : {}) } } : undefined,
    );

    // MVP scale: an agency has thousands of rows, not millions - aggregate in memory (capped).
    const rows = await prisma.report.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 20_000,
      include: { campaign: { select: { id: true, name: true, platform: true } }, client: { select: { id: true, companyName: true } } },
    });
    const p = paging(req.query, 25, 100);
    res.json({
      summary: summarize(rows),
      series: buildSeries(rows),
      items: rows.slice(p.skip, p.skip + p.take),
      meta: pageMeta(p, rows.length),
    });
  }),
);

reportsRouter.post(
  '/',
  staffOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    const date = parseDateOnly(body.date);
    if (date.getTime() > Date.now() + 86_400_000) throw Errors.validation({ date: 'date_in_future' });

    const target = await resolveTarget(ctx.scope, { campaignId: body.campaignId });
    const dup = await prisma.report.findUnique({ where: { campaignId_date: { campaignId: body.campaignId, date } }, select: { id: true } });
    if (dup) throw Errors.conflict('REPORT_EXISTS', 'A report for this campaign and date already exists.');

    const report = await prisma.$transaction(async (tx) => {
      const r = await tx.report.create({
        data: {
          clientId: target.clientId,
          campaignId: body.campaignId,
          date,
          spend: body.spend,
          reach: body.reach,
          impressions: body.impressions,
          clicks: body.clicks,
          conversions: body.conversions,
          conversionValue: body.conversionValue,
          notes: body.notes || null,
          ...deriveRatios(body),
        },
      });
      await syncCampaignSpent(tx, body.campaignId);
      return r;
    });
    await audit(ctx, 'REPORT_CREATED', 'report', report.id, { campaignId: report.campaignId, date: body.date });
    res.status(201).json({ item: report });
  }),
);

reportsRouter.delete(
  '/:id',
  staffOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.report.findFirst({ where: and<Prisma.ReportWhereInput>({ id: idParam(req) }, reportWhere(ctx.scope)) });
    if (!existing) throw Errors.notFound();
    await prisma.$transaction(async (tx) => {
      await tx.report.delete({ where: { id: existing.id } });
      await syncCampaignSpent(tx, existing.campaignId);
    });
    await audit(ctx, 'REPORT_DELETED', 'report', existing.id, { campaignId: existing.campaignId, date: existing.date.toISOString().slice(0, 10) });
    res.json({ ok: true });
  }),
);
