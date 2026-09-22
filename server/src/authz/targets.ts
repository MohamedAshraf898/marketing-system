import { prisma } from '../db';
import { Errors } from '../lib/errors';
import { campaignWhere, isClient, type Scope } from './scope';

export interface Target {
  clientId: string;
  campaign: { id: string; name: string; clientId: string } | null;
}

/**
 * Resolves and AUTHORISES the client/campaign a new record will be attached to.
 * Client-supplied ids are never trusted: a CLIENT user is forced onto their own company, and a
 * campaign must be inside the caller's scope AND belong to the same client (no cross-client links).
 */
export async function resolveTarget(
  scope: Scope,
  input: { clientId?: string | null; campaignId?: string | null },
): Promise<Target> {
  const { clientId, campaignId } = input;

  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { AND: [{ id: campaignId }, campaignWhere(scope)] },
      select: { id: true, name: true, clientId: true },
    });
    if (!campaign) throw Errors.badRequest('VALIDATION_ERROR', 'Invalid campaign.', { campaignId: 'invalid_choice' });
    if (clientId && clientId !== campaign.clientId && !isClient(scope)) {
      throw Errors.validation({ campaignId: 'campaign_client_mismatch' });
    }
    return { clientId: campaign.clientId, campaign };
  }

  if (isClient(scope)) {
    if (!scope.clientId) throw Errors.forbidden();
    return { clientId: scope.clientId, campaign: null };
  }

  if (!clientId) throw Errors.validation({ clientId: 'required' });

  if (scope.role === 'TEAM' && !scope.fullClientIds.includes(clientId)) {
    throw Errors.validation({ clientId: 'invalid_choice' });
  }
  const exists = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!exists) throw Errors.validation({ clientId: 'invalid_choice' });
  return { clientId, campaign: null };
}
