import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export interface RawMetrics {
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

/** Ratios are ALWAYS calculated by the server from the raw numbers - never trusted from the client. */
export function deriveRatios(m: Pick<RawMetrics, 'spend' | 'impressions' | 'clicks' | 'conversionValue'>) {
  return {
    ctr: m.impressions > 0 ? r4((m.clicks / m.impressions) * 100) : 0, // percent
    cpc: m.clicks > 0 ? r4(m.spend / m.clicks) : 0,
    cpm: m.impressions > 0 ? r4((m.spend / m.impressions) * 1000) : 0,
    roas: m.spend > 0 ? r4(m.conversionValue / m.spend) : 0,
  };
}

const emptyTotals = (): RawMetrics => ({ spend: 0, reach: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 });

const add = (a: RawMetrics, b: RawMetrics): RawMetrics => ({
  spend: a.spend + b.spend,
  reach: a.reach + b.reach,
  impressions: a.impressions + b.impressions,
  clicks: a.clicks + b.clicks,
  conversions: a.conversions + b.conversions,
  conversionValue: a.conversionValue + b.conversionValue,
});

/** Totals across rows; ratios are recomputed from the totals (not averaged). */
export function summarize(rows: RawMetrics[]) {
  const t = rows.reduce(add, emptyTotals());
  return { ...t, spend: r4(t.spend), conversionValue: r4(t.conversionValue), ...deriveRatios(t) };
}

/** One point per day (all campaigns combined) for the charts. */
export function buildSeries(rows: Array<RawMetrics & { date: Date }>) {
  const byDay = new Map<string, RawMetrics>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    byDay.set(key, add(byDay.get(key) ?? emptyTotals(), r));
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, ...t, spend: r4(t.spend), conversionValue: r4(t.conversionValue), ...deriveRatios(t) }));
}

/** Campaign.spent always mirrors the sum of its daily reports once reports exist. */
export async function syncCampaignSpent(tx: Tx, campaignId: string): Promise<void> {
  const agg = await tx.report.aggregate({ where: { campaignId }, _sum: { spend: true }, _count: true });
  if (agg._count > 0) await tx.campaign.update({ where: { id: campaignId }, data: { spent: r4(agg._sum.spend ?? 0) } });
}
