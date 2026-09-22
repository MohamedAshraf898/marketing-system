import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { campaignWhere, clientWhere, type Scope } from '../authz/scope';
import { Errors } from '../lib/errors';
import { and } from '../services/serializers';

/** Scoped single-record lookups: out-of-scope == not found (404), never 403. */
export async function findClient(scope: Scope, id: string) {
  const c = await prisma.client.findFirst({ where: and<Prisma.ClientWhereInput>({ id }, clientWhere(scope)) });
  if (!c) throw Errors.notFound();
  return c;
}

export async function findCampaign(scope: Scope, id: string) {
  const c = await prisma.campaign.findFirst({
    where: and<Prisma.CampaignWhereInput>({ id }, campaignWhere(scope)),
    include: { client: { select: { id: true, name: true, companyName: true } } },
  });
  if (!c) throw Errors.notFound();
  return c;
}
