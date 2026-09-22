import type { CampaignPerformance, MetricSet } from './analytics';
import { CSV_MAX_ROWS, toCsv, type CsvCell } from './csv';

export { CSV_MAX_ROWS };
export type Lang = 'en' | 'ar';

const H = {
  en: {
    date: 'Date', client: 'Client', campaign: 'Campaign', platform: 'Platform', objective: 'Objective', status: 'Status', budget: 'Budget',
    spend: 'Spend', reach: 'Reach', impressions: 'Impressions', clicks: 'Clicks', ctr: 'CTR %', cpc: 'CPC', cpm: 'CPM', conversions: 'Conversions',
    conversionValue: 'Conversion value', cvr: 'CVR %', cpa: 'CPA', roas: 'ROAS', days: 'Days with data', total: 'Total',
  },
  ar: {
    date: 'التاريخ', client: 'العميل', campaign: 'الحملة', platform: 'المنصة', objective: 'الهدف', status: 'الحالة', budget: 'الميزانية',
    spend: 'الإنفاق', reach: 'الوصول', impressions: 'مرات الظهور', clicks: 'النقرات', ctr: 'نسبة النقر %', cpc: 'تكلفة النقرة', cpm: 'تكلفة الألف ظهور', conversions: 'التحويلات',
    conversionValue: 'قيمة التحويلات', cvr: 'نسبة التحويل %', cpa: 'تكلفة التحويل', roas: 'عائد الإنفاق الإعلاني', days: 'أيام البيانات', total: 'الإجمالي',
  },
} as const;

/** Campaign metrics table (one row per campaign + a totals row). Metrics that cannot be computed are empty cells. */
export function campaignCsv(items: CampaignPerformance[], totals: MetricSet, lang: Lang = 'en'): string {
  const h = H[lang];
  const header = [h.client, h.campaign, h.platform, h.objective, h.status, h.budget, h.spend, h.reach, h.impressions, h.clicks, h.ctr, h.cpc, h.cpm, h.conversions, h.conversionValue, h.cvr, h.cpa, h.roas, h.days];
  const m = (x: MetricSet): CsvCell[] => [x.spend, x.reach, x.impressions, x.clicks, x.ctr, x.cpc, x.cpm, x.conversions, x.conversionValue, x.cvr, x.cpa, x.roas, x.dataPoints];
  const rows: CsvCell[][] = items.map((i) => [i.campaign.clientName, i.campaign.name, i.campaign.platform, i.campaign.objective, i.campaign.status, i.campaign.budget, ...m(i.metrics)]);
  rows.push([h.total, '', '', '', '', '', ...m(totals)]);
  return toCsv(header, rows);
}

export interface DailyRow {
  date: Date;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  client: { companyName: string };
  campaign: { name: string; platform: string };
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Raw daily rows. Ratios are recomputed from the raw numbers; `notes` and other internal fields are never exported. */
export function dailyCsv(rows: DailyRow[], lang: Lang = 'en'): string {
  const h = H[lang];
  const header = [h.date, h.client, h.campaign, h.platform, h.spend, h.reach, h.impressions, h.clicks, h.ctr, h.cpc, h.cpm, h.conversions, h.conversionValue, h.cvr, h.cpa, h.roas];
  const body: CsvCell[][] = rows.map((r) => [
    r.date.toISOString().slice(0, 10),
    r.client.companyName,
    r.campaign.name,
    r.campaign.platform,
    r.spend,
    r.reach,
    r.impressions,
    r.clicks,
    r.impressions > 0 ? r4((r.clicks / r.impressions) * 100) : null,
    r.clicks > 0 ? r4(r.spend / r.clicks) : null,
    r.impressions > 0 ? r4((r.spend / r.impressions) * 1000) : null,
    r.conversions,
    r.conversionValue,
    r.clicks > 0 ? r4((r.conversions / r.clicks) * 100) : null,
    r.conversions > 0 ? r4(r.spend / r.conversions) : null,
    r.spend > 0 ? r4(r.conversionValue / r.spend) : null,
  ]);
  return toCsv(header, body);
}
