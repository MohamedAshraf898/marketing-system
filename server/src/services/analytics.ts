import type { Prisma } from '@prisma/client';
import { campaignWhere, clientWhere, reportWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { dayKey, endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { and } from './serializers';

/**
 * Analytics engine. Two rules:
 *  1. Ratios are ALWAYS recomputed from summed raw fields (never an average of ratios).
 *  2. Nothing is invented: a metric that cannot be computed is `null` (never 0 / NaN / Infinity) and the UI shows a dash.
 */

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export const MAX_RANGE_DAYS = 731; // two years
export const MAX_CAMPAIGN_ROWS = 500;

export interface Sums {
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

export interface MetricSet {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionValue: number | null;
  ctr: number | null; // clicks / impressions x 100
  cpc: number | null; // spend / clicks
  cpm: number | null; // spend / impressions x 1000
  cvr: number | null; // conversions / clicks x 100
  cpa: number | null; // spend / conversions
  roas: number | null; // conversionValue / spend
  dataPoints: number; // number of daily report rows behind the numbers
  hasData: boolean;
}

export const METRIC_KEYS = ['spend', 'impressions', 'reach', 'clicks', 'conversions', 'conversionValue', 'ctr', 'cpc', 'cpm', 'cvr', 'cpa', 'roas'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const emptySums = (): Sums => ({ spend: 0, reach: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 });

export const addSums = (a: Sums, b: Sums): Sums => ({
  spend: a.spend + b.spend,
  reach: a.reach + b.reach,
  impressions: a.impressions + b.impressions,
  clicks: a.clicks + b.clicks,
  conversions: a.conversions + b.conversions,
  conversionValue: a.conversionValue + b.conversionValue,
});

/** The single place where ratios are calculated. `dataPoints` = number of report rows that were summed. */
export function metricsFrom(s: Sums, dataPoints: number): MetricSet {
  if (dataPoints <= 0) {
    return { spend: null, impressions: null, reach: null, clicks: null, conversions: null, conversionValue: null, ctr: null, cpc: null, cpm: null, cvr: null, cpa: null, roas: null, dataPoints: 0, hasData: false };
  }
  return {
    spend: r4(s.spend),
    impressions: s.impressions,
    reach: s.reach,
    clicks: s.clicks,
    conversions: s.conversions,
    conversionValue: r4(s.conversionValue),
    ctr: s.impressions > 0 ? r4((s.clicks / s.impressions) * 100) : null,
    cpc: s.clicks > 0 ? r4(s.spend / s.clicks) : null,
    cpm: s.impressions > 0 ? r4((s.spend / s.impressions) * 1000) : null,
    cvr: s.clicks > 0 ? r4((s.conversions / s.clicks) * 100) : null,
    cpa: s.conversions > 0 ? r4(s.spend / s.conversions) : null,
    roas: s.spend > 0 ? r4(s.conversionValue / s.spend) : null,
    dataPoints,
    hasData: true,
  };
}

// ───────────────────────── dates ─────────────────────────

export interface Range {
  from?: string;
  to?: string;
}

const validDay = (s: string) => isDateOnly(s) && dayKey(parseDateOnly(s)) === s;

export const daysBetween = (from: string, to: string) => Math.round((parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / 86_400_000) + 1;

/** Validates ?from&to (both optional). When both are present: from <= to and at most two years. */
export function readRange(query: Record<string, unknown>, fromKey = 'from', toKey = 'to'): Range {
  const str = (k: string) => (typeof query[k] === 'string' && (query[k] as string).trim() ? (query[k] as string).trim() : undefined);
  const from = str(fromKey);
  const to = str(toKey);
  if (from && !validDay(from)) throw Errors.validation({ [fromKey]: 'invalid_date' });
  if (to && !validDay(to)) throw Errors.validation({ [toKey]: 'invalid_date' });
  if (from && to) {
    if (to < from) throw Errors.validation({ [toKey]: 'end_before_start' });
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw Errors.validation({ [toKey]: 'range_too_large' });
  }
  return { from, to };
}

export const dateFilter = (r: Range): Prisma.ReportWhereInput | undefined =>
  r.from || r.to ? { date: { ...(r.from ? { gte: parseDateOnly(r.from) } : {}), ...(r.to ? { lte: endOfDayUtc(r.to) } : {}) } } : undefined;

export const today = () => dayKey(new Date());

export const addDaysStr = (s: string, n: number) => dayKey(new Date(parseDateOnly(s).getTime() + n * 86_400_000));

/** Same calendar day one year earlier (29 Feb -> 28 Feb). */
export function minusYear(s: string): string {
  const d = parseDateOnly(s);
  const y = d.getUTCFullYear() - 1;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return dayKey(new Date(Date.UTC(y, m, Math.min(day, last))));
}

// ───────────────────────── aggregation (SQL group-by) ─────────────────────────

const SUM = { spend: true, reach: true, impressions: true, clicks: true, conversions: true, conversionValue: true } as const;

type SumRow = { _sum: { spend: number | null; reach: number | null; impressions: number | null; clicks: number | null; conversions: number | null; conversionValue: number | null }; _count: { _all: number } };

const sumsOf = (r: SumRow): Sums => ({
  spend: Number(r._sum.spend ?? 0),
  reach: Number(r._sum.reach ?? 0),
  impressions: Number(r._sum.impressions ?? 0),
  clicks: Number(r._sum.clicks ?? 0),
  conversions: Number(r._sum.conversions ?? 0),
  conversionValue: Number(r._sum.conversionValue ?? 0),
});

export interface Bucket {
  sums: Sums;
  n: number;
}

export async function totalsFor(where: Prisma.ReportWhereInput): Promise<MetricSet> {
  const r = await prisma.report.aggregate({ where, _sum: SUM, _count: { _all: true } });
  return metricsFrom(sumsOf(r as SumRow), r._count._all);
}

async function groupBy(by: 'campaignId' | 'clientId', where: Prisma.ReportWhereInput): Promise<Map<string, Bucket>> {
  const rows = await prisma.report.groupBy({ by: [by], where, _sum: SUM, _count: { _all: true } });
  return new Map(rows.map((r) => [r[by] as string, { sums: sumsOf(r as unknown as SumRow), n: r._count._all }]));
}

export const groupByCampaign = (where: Prisma.ReportWhereInput) => groupBy('campaignId', where);
export const groupByClient = (where: Prisma.ReportWhereInput) => groupBy('clientId', where);

export interface DailyPoint extends MetricSet {
  date: string;
}

/** One point per day, aggregated in SQL (group by date). */
export async function dailySeries(where: Prisma.ReportWhereInput): Promise<DailyPoint[]> {
  const rows = await prisma.report.groupBy({ by: ['date'], where, _sum: SUM, _count: { _all: true }, orderBy: { date: 'asc' } });
  return rows.map((r) => ({ date: dayKey(r.date), ...metricsFrom(sumsOf(r as unknown as SumRow), r._count._all) }));
}

const sumBuckets = (list: Iterable<Bucket>): Bucket => {
  let sums = emptySums();
  let n = 0;
  for (const b of list) {
    sums = addSums(sums, b.sums);
    n += b.n;
  }
  return { sums, n };
};

// ───────────────────────── campaign table ─────────────────────────

export interface CampaignFilters {
  clientId?: string;
  platform?: string;
  objective?: string;
  status?: string;
}

export const SORT_KEYS = ['name', 'client', 'spend', 'impressions', 'reach', 'clicks', 'conversions', 'conversionValue', 'ctr', 'cpc', 'cpm', 'cvr', 'cpa', 'roas'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface CampaignPerformance {
  campaign: {
    id: string;
    name: string;
    clientId: string;
    clientName: string;
    platform: string;
    objective: string;
    status: string;
    budget: number;
    startDate: string | null;
    endDate: string | null;
  };
  metrics: MetricSet;
}

export function sortRows(rows: CampaignPerformance[], key: SortKey, dir: 'asc' | 'desc'): CampaignPerformance[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name' || key === 'client') {
      const x = key === 'name' ? a.campaign.name : a.campaign.clientName;
      const y = key === 'name' ? b.campaign.name : b.campaign.clientName;
      return mul * x.localeCompare(y);
    }
    const x = a.metrics[key];
    const y = b.metrics[key];
    if (x === null && y === null) return a.campaign.name.localeCompare(b.campaign.name);
    if (x === null) return 1; // nulls always last
    if (y === null) return -1;
    return x === y ? a.campaign.name.localeCompare(b.campaign.name) : mul * (x - y);
  });
}

/** Per-campaign metrics + totals for everything the caller may see. */
export async function campaignTable(scope: Scope, filters: CampaignFilters, range: Range) {
  const campaigns = await prisma.campaign.findMany({
    where: and<Prisma.CampaignWhereInput>(
      campaignWhere(scope),
      filters.clientId ? { clientId: filters.clientId } : undefined,
      filters.platform ? { platform: filters.platform as never } : undefined,
      filters.objective ? { objective: filters.objective as never } : undefined,
      filters.status ? { status: filters.status as never } : undefined,
    ),
    orderBy: { name: 'asc' },
    take: MAX_CAMPAIGN_ROWS,
    select: { id: true, name: true, clientId: true, platform: true, objective: true, status: true, budget: true, startDate: true, endDate: true, client: { select: { companyName: true } } },
  });
  const ids = campaigns.map((c) => c.id);
  const buckets = ids.length ? await groupByCampaign(and<Prisma.ReportWhereInput>(reportWhere(scope), { campaignId: { in: ids } }, dateFilter(range))) : new Map<string, Bucket>();
  const items: CampaignPerformance[] = campaigns.map((c) => {
    const b = buckets.get(c.id);
    return {
      campaign: {
        id: c.id,
        name: c.name,
        clientId: c.clientId,
        clientName: c.client.companyName,
        platform: c.platform,
        objective: c.objective,
        status: c.status,
        budget: c.budget,
        startDate: c.startDate ? dayKey(c.startDate) : null,
        endDate: c.endDate ? dayKey(c.endDate) : null,
      },
      metrics: metricsFrom(b?.sums ?? emptySums(), b?.n ?? 0),
    };
  });
  const total = sumBuckets(buckets.values());
  return { items, totals: metricsFrom(total.sums, total.n), truncated: campaigns.length >= MAX_CAMPAIGN_ROWS };
}

// ───────────────────────── campaign performance ─────────────────────────

export type PacingStatus = 'over_budget' | 'fast' | 'on_track' | 'slow' | 'not_started' | null;

export function pacing(c: { budget: number; startDate: Date | null; endDate: Date | null }, spent: number, now = new Date()) {
  const budget = c.budget;
  const spentPct = budget > 0 ? r4((spent / budget) * 100) : null;
  let elapsedPct: number | null = null;
  let daysTotal: number | null = null;
  let daysElapsed: number | null = null;
  if (c.startDate && c.endDate && c.endDate >= c.startDate) {
    daysTotal = Math.round((c.endDate.getTime() - c.startDate.getTime()) / 86_400_000) + 1;
    const raw = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - c.startDate.getTime()) / 86_400_000) + 1;
    daysElapsed = Math.max(0, Math.min(daysTotal, raw));
    elapsedPct = r4((daysElapsed / daysTotal) * 100);
  }
  let status: PacingStatus = null;
  let ratio: number | null = null;
  if (budget > 0 && spent > budget) status = 'over_budget';
  else if (spentPct !== null && elapsedPct !== null) {
    if (elapsedPct === 0) status = 'not_started';
    else {
      ratio = r4(spentPct / elapsedPct);
      status = ratio > 1.15 ? 'fast' : ratio < 0.85 ? 'slow' : 'on_track';
    }
  }
  return { budget, spent: r4(spent), remaining: budget > 0 ? r4(Math.max(0, budget - spent)) : null, spentPct, elapsedPct, daysTotal, daysElapsed, ratio, status };
}

export async function campaignPerformance(scope: Scope, campaignId: string, range: Range) {
  const c = await prisma.campaign.findFirst({
    where: and<Prisma.CampaignWhereInput>({ id: campaignId }, campaignWhere(scope)),
    select: { id: true, name: true, clientId: true, platform: true, objective: true, status: true, budget: true, spent: true, startDate: true, endDate: true, client: { select: { companyName: true } } },
  });
  if (!c) throw Errors.notFound();
  const base = and<Prisma.ReportWhereInput>(reportWhere(scope), { campaignId });
  const where = and<Prisma.ReportWhereInput>(base, dateFilter(range));
  const [totals, series, lifetime] = await Promise.all([totalsFor(where), dailySeries(where), totalsFor(base)]);
  const spent = lifetime.hasData ? (lifetime.spend ?? 0) : c.spent;
  return {
    campaign: {
      id: c.id,
      name: c.name,
      clientId: c.clientId,
      clientName: c.client.companyName,
      platform: c.platform,
      objective: c.objective,
      status: c.status,
      budget: c.budget,
      startDate: c.startDate ? dayKey(c.startDate) : null,
      endDate: c.endDate ? dayKey(c.endDate) : null,
    },
    range,
    totals,
    series,
    budget: pacing(c, spent),
  };
}

// ───────────────────────── clients ─────────────────────────

export async function clientTable(scope: Scope, range: Range) {
  const clients = await prisma.client.findMany({
    where: and<Prisma.ClientWhereInput>(clientWhere(scope), { status: { not: 'ARCHIVED' } }),
    orderBy: { companyName: 'asc' },
    take: 300,
    select: { id: true, companyName: true, status: true },
  });
  const ids = clients.map((c) => c.id);
  const [buckets, counts] = await Promise.all([
    ids.length ? groupByClient(and<Prisma.ReportWhereInput>(reportWhere(scope), { clientId: { in: ids } }, dateFilter(range))) : Promise.resolve(new Map<string, Bucket>()),
    ids.length ? prisma.campaign.groupBy({ by: ['clientId'], where: and<Prisma.CampaignWhereInput>(campaignWhere(scope), { clientId: { in: ids } }), _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const countBy = new Map(counts.map((r) => [r.clientId, r._count._all]));
  const items = clients.map((c) => {
    const b = buckets.get(c.id);
    return { client: { id: c.id, companyName: c.companyName, status: c.status }, campaigns: countBy.get(c.id) ?? 0, metrics: metricsFrom(b?.sums ?? emptySums(), b?.n ?? 0) };
  });
  const total = sumBuckets(buckets.values());
  return { items, totals: metricsFrom(total.sums, total.n) };
}

export async function clientPerformance(scope: Scope, clientId: string, range: Range) {
  const client = await prisma.client.findFirst({ where: and<Prisma.ClientWhereInput>({ id: clientId }, clientWhere(scope)), select: { id: true, companyName: true, status: true } });
  if (!client) throw Errors.notFound();
  const where = and<Prisma.ReportWhereInput>(reportWhere(scope), { clientId }, dateFilter(range));
  const [campaigns, buckets, totals, series] = await Promise.all([
    prisma.campaign.findMany({
      where: and<Prisma.CampaignWhereInput>(campaignWhere(scope), { clientId }),
      take: MAX_CAMPAIGN_ROWS,
      select: { id: true, name: true, platform: true, objective: true, status: true },
    }),
    groupByCampaign(where),
    totalsFor(where),
    dailySeries(where),
  ]);

  const perCampaign = campaigns.map((c) => {
    const b = buckets.get(c.id);
    return { campaign: c, sums: b?.sums ?? emptySums(), metrics: metricsFrom(b?.sums ?? emptySums(), b?.n ?? 0) };
  });

  const byPlatformMap = new Map<string, Bucket & { campaigns: number }>();
  for (const p of perCampaign) {
    const cur = byPlatformMap.get(p.campaign.platform) ?? { sums: emptySums(), n: 0, campaigns: 0 };
    cur.sums = addSums(cur.sums, p.sums);
    cur.n += p.metrics.dataPoints;
    cur.campaigns += 1;
    byPlatformMap.set(p.campaign.platform, cur);
  }
  const byPlatform = [...byPlatformMap.entries()]
    .map(([platform, b]) => ({ platform, campaigns: b.campaigns, metrics: metricsFrom(b.sums, b.n) }))
    .sort((a, b) => (b.metrics.spend ?? -1) - (a.metrics.spend ?? -1));

  // best / worst by ROAS - only campaigns that actually have a ROAS (spend > 0). Lists never overlap.
  const ranked = perCampaign.filter((p) => p.metrics.roas !== null).sort((a, b) => (b.metrics.roas as number) - (a.metrics.roas as number));
  const shape = (p: (typeof ranked)[number]) => ({ id: p.campaign.id, name: p.campaign.name, platform: p.campaign.platform, status: p.campaign.status, metrics: p.metrics });
  const topN = Math.min(5, Math.ceil(ranked.length / 2));
  const bottomN = Math.min(5, Math.floor(ranked.length / 2));
  const top = ranked.slice(0, topN).map(shape);
  const bottom = ranked.slice(ranked.length - bottomN).reverse().map(shape);

  return { client, range, totals, byPlatform, series, topCampaigns: top, bottomCampaigns: bottom, campaignsWithData: ranked.length };
}

// ───────────────────────── compare ─────────────────────────

export interface Delta {
  abs: number | null;
  pct: number | null; // null when the previous value is 0 / null (never Infinity)
}

export function deltaOf(cur: number | null, prev: number | null): Delta {
  if (cur === null || prev === null) return { abs: null, pct: null };
  return { abs: r4(cur - prev), pct: prev === 0 ? null : r4(((cur - prev) / Math.abs(prev)) * 100) };
}

export function deltasOf(cur: MetricSet, prev: MetricSet): Record<MetricKey, Delta> {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, deltaOf(cur[k], prev[k])])) as Record<MetricKey, Delta>;
}

export const COMPARE_MODES = ['previous_period', 'previous_year', 'custom'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/** Resolves the comparison window from the mode (or explicit compareFrom / compareTo). */
export function comparisonRange(cur: { from: string; to: string }, mode: CompareMode, custom?: Range): { from: string; to: string } {
  if (mode === 'previous_year') return { from: minusYear(cur.from), to: minusYear(cur.to) };
  if (mode === 'previous_period') {
    const len = daysBetween(cur.from, cur.to);
    return { from: addDaysStr(cur.from, -len), to: addDaysStr(cur.from, -1) };
  }
  if (!custom?.from || !custom.to) {
    const fields: Record<string, string> = {};
    if (!custom?.from) fields.compareFrom = 'required';
    if (!custom?.to) fields.compareTo = 'required';
    throw Errors.validation(fields);
  }
  return { from: custom.from, to: custom.to };
}

export async function comparePeriods(
  scope: Scope,
  opts: { kind: 'client' | 'campaign' | 'all'; id?: string; current: { from: string; to: string }; previous: { from: string; to: string } },
) {
  let extra: Prisma.ReportWhereInput | undefined;
  if (opts.kind === 'client') {
    const c = await prisma.client.findFirst({ where: and<Prisma.ClientWhereInput>({ id: opts.id }, clientWhere(scope)), select: { id: true } });
    if (!c) throw Errors.notFound();
    extra = { clientId: c.id };
  } else if (opts.kind === 'campaign') {
    const c = await prisma.campaign.findFirst({ where: and<Prisma.CampaignWhereInput>({ id: opts.id }, campaignWhere(scope)), select: { id: true } });
    if (!c) throw Errors.notFound();
    extra = { campaignId: c.id };
  }
  const build = (r: { from: string; to: string }) => and<Prisma.ReportWhereInput>(reportWhere(scope), extra, dateFilter(r));
  const [cur, prev, curSeries, prevSeries] = await Promise.all([
    totalsFor(build(opts.current)),
    totalsFor(build(opts.previous)),
    dailySeries(build(opts.current)),
    dailySeries(build(opts.previous)),
  ]);
  return {
    scope: opts.kind,
    id: opts.id ?? null,
    current: { ...opts.current, metrics: cur, series: curSeries },
    previous: { ...opts.previous, metrics: prev, series: prevSeries },
    deltas: deltasOf(cur, prev),
  };
}

// ───────────────────────── summary ─────────────────────────

export async function summary(scope: Scope, range?: Range) {
  const to = range?.to ?? today();
  const from = range?.from ?? addDaysStr(to, -29);
  if (from > to) throw Errors.validation({ from: 'end_before_start' });
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw Errors.validation({ to: 'range_too_large' });
  const previous = comparisonRange({ from, to }, 'previous_period');
  const cmp = await comparePeriods(scope, { kind: 'all', current: { from, to }, previous });
  const [byStatus, clientCount] = await Promise.all([
    prisma.campaign.groupBy({ by: ['status'], where: campaignWhere(scope), _count: { _all: true } }),
    scope.role === 'CLIENT' ? Promise.resolve(1) : prisma.client.count({ where: and<Prisma.ClientWhereInput>(clientWhere(scope), { status: { not: 'ARCHIVED' } }) }),
  ]);
  const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  return {
    range: { from, to },
    previousRange: previous,
    metrics: cmp.current.metrics,
    previous: cmp.previous.metrics,
    deltas: cmp.deltas,
    series: cmp.current.series,
    campaigns: { total: byStatus.reduce((n, r) => n + r._count._all, 0), running: count('RUNNING') },
    clients: clientCount,
  };
}
