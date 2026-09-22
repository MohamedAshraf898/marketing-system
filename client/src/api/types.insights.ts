// Owner: Insights group. Client-side shapes for /search, /calendar and /analytics.
// Keep in sync with server/src/services/{search,calendar,analytics}.ts and server/src/routes/{search,calendar,analytics}.ts.
import type { Platform, Objective, CampaignStatus } from '@shared/enums';

// ───────────────────────── search ─────────────────────────

export const SEARCH_TYPES = ['client', 'contact', 'project', 'task', 'campaign', 'deliverable', 'content', 'request', 'file', 'invoice', 'contract'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  status?: string;
  clientName?: string;
  url: string;
}

export interface SearchResponse {
  query: string;
  items: SearchHit[];
  types: SearchType[]; // types this caller is allowed to search at all
}

// ───────────────────────── calendar ─────────────────────────

export const CALENDAR_TYPES = ['task', 'project', 'content', 'campaign', 'deliverable', 'invoice', 'contract', 'client'] as const;
export type CalendarSource = (typeof CALENDAR_TYPES)[number];

export type CalendarEventKind = 'due' | 'start' | 'end' | 'publish' | 'milestone' | 'renewal' | 'contract_end';

export interface CalendarEventDto {
  key: string;
  type: 'task' | 'project' | 'milestone' | 'content' | 'campaign' | 'deliverable' | 'invoice' | 'contract' | 'client';
  kind: CalendarEventKind;
  id: string;
  title: string;
  date: string; // date-only (YYYY-MM-DD) when allDay, ISO datetime otherwise
  allDay: boolean;
  status?: string;
  clientName?: string;
  url: string;
  colorKey: 'task' | 'project' | 'content' | 'campaign' | 'deliverable' | 'invoice' | 'contract';
}

export interface CalendarResponse {
  range: { from?: string; to?: string };
  items: CalendarEventDto[];
  truncated: boolean;
  types: CalendarSource[];
}

// ───────────────────────── analytics ─────────────────────────

/** Every ratio/measure can be null (never invented) when there is no underlying report data. */
export interface AnalyticsMetricSet {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionValue: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  dataPoints: number;
  hasData: boolean;
}

export const ANALYTICS_METRIC_KEYS = ['spend', 'impressions', 'reach', 'clicks', 'conversions', 'conversionValue', 'ctr', 'cpc', 'cpm', 'cvr', 'cpa', 'roas'] as const;
export type AnalyticsMetricKey = (typeof ANALYTICS_METRIC_KEYS)[number];

export interface AnalyticsRange { from?: string; to?: string }

export interface CampaignPerformanceRow {
  campaign: {
    id: string; name: string; clientId: string; clientName: string; platform: Platform; objective: Objective; status: CampaignStatus;
    budget: number; startDate: string | null; endDate: string | null;
  };
  metrics: AnalyticsMetricSet;
}

export type AnalyticsSortKey = 'name' | 'client' | 'spend' | 'impressions' | 'reach' | 'clicks' | 'conversions' | 'conversionValue' | 'ctr' | 'cpc' | 'cpm' | 'cvr' | 'cpa' | 'roas';

export interface CampaignTableResponse {
  items: CampaignPerformanceRow[];
  totals: AnalyticsMetricSet;
  range: AnalyticsRange;
  sort: { key: AnalyticsSortKey; dir: 'asc' | 'desc' };
  truncated: boolean;
}

export interface AnalyticsDailyPoint extends AnalyticsMetricSet { date: string }

export interface CampaignPerformanceResponse {
  campaign: CampaignPerformanceRow['campaign'];
  range: AnalyticsRange;
  totals: AnalyticsMetricSet;
  series: AnalyticsDailyPoint[];
  budget: {
    budget: number; spent: number; remaining: number | null; spentPct: number | null; elapsedPct: number | null;
    daysTotal: number | null; daysElapsed: number | null; ratio: number | null;
    status: 'over_budget' | 'fast' | 'on_track' | 'slow' | 'not_started' | null;
  };
}

export type CompareMode = 'previous_period' | 'previous_year' | 'custom';
export type CompareScope = 'client' | 'campaign' | 'all';

export interface ComparePeriodsResponse {
  mode: CompareMode;
  scope: CompareScope;
  id: string | null;
  current: { from: string; to: string; metrics: AnalyticsMetricSet; series: AnalyticsDailyPoint[] };
  previous: { from: string; to: string; metrics: AnalyticsMetricSet; series: AnalyticsDailyPoint[] };
  deltas: Record<AnalyticsMetricKey, { abs: number | null; pct: number | null }>;
}

export interface AnalyticsSummaryResponse {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  metrics: AnalyticsMetricSet;
  previous: AnalyticsMetricSet;
  deltas: Record<AnalyticsMetricKey, { abs: number | null; pct: number | null }>;
  series: AnalyticsDailyPoint[];
  campaigns: { total: number; running: number };
  clients: number;
}
