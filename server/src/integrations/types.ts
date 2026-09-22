import type { Platform } from '../../../shared/src/enums';

/**
 * FUTURE INTEGRATION POINTS  (nothing here is implemented or required today)
 *
 * Each external system gets a small interface. To add e.g. Meta Ads later:
 *   1. create integrations/meta/MetaAdsConnector.ts implementing AdPlatformConnector
 *   2. call registerAdConnector(new MetaAdsConnector()) in integrations/index.ts
 *   3. add a job/route that calls connector.fetchDailyMetrics(...) and writes Report rows
 * The rest of the app (reports, dashboards, permissions) keeps working unchanged because it
 * only ever reads Report rows.
 */

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

export interface MetricsQuery {
  campaignExternalId: string; // Campaign.campaignExternalId
  from: Date;
  to: Date;
}

/** Meta Ads, Google Ads, TikTok Ads, Snapchat Ads ... */
export interface AdPlatformConnector {
  readonly platform: Platform;
  isConfigured(): boolean;
  fetchDailyMetrics(query: MetricsQuery): Promise<DailyMetrics[]>;
}

/** Google Analytics or any other web-analytics source. */
export interface AnalyticsConnector {
  readonly name: string;
  isConfigured(): boolean;
  fetchSessions(query: { propertyId: string; from: Date; to: Date }): Promise<Array<{ date: string; sessions: number; conversions: number }>>;
}

export type ChannelName = 'EMAIL' | 'WHATSAPP' | 'SLACK';

export interface OutboundMessage {
  recipient: { id: string; name: string; email?: string; phone?: string };
  locale: string; // "en" | "ar"
  type: string; // notification type, e.g. DELIVERABLE_SUBMITTED
  data: Record<string, unknown>;
}

/** Email / WhatsApp / Slack delivery for notifications. */
export interface OutboundChannel {
  readonly channel: ChannelName;
  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<void>;
}
