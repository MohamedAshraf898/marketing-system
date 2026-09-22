import type { Platform } from '../../../shared/src/enums';
import type { AdPlatformConnector, AnalyticsConnector, OutboundChannel, OutboundMessage } from './types';

const adConnectors = new Map<Platform, AdPlatformConnector>();
const analytics: AnalyticsConnector[] = [];
const channels: OutboundChannel[] = [];

export const registerAdConnector = (c: AdPlatformConnector) => void adConnectors.set(c.platform, c);
export const getAdConnector = (p: Platform) => adConnectors.get(p);
export const registerAnalyticsConnector = (c: AnalyticsConnector) => void analytics.push(c);
export const listAnalyticsConnectors = () => [...analytics];
export const registerChannel = (c: OutboundChannel) => void channels.push(c);

/** Called for every in-app notification. With no channels registered this does nothing. */
export async function dispatchToChannels(message: OutboundMessage): Promise<void> {
  await Promise.allSettled(channels.filter((c) => c.isConfigured()).map((c) => c.send(message)));
}
