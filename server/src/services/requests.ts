import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requestWhere, type Scope } from '../authz/scope';
import { Errors } from '../lib/errors';
import { and } from './serializers';

export async function findRequest(scope: Scope, id: string) {
  const r = await prisma.request.findFirst({
    where: and<Prisma.RequestWhereInput>({ id }, requestWhere(scope)),
    include: {
      client: { select: { id: true, companyName: true, name: true } },
      campaign: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, role: true } },
    },
  });
  if (!r) throw Errors.notFound();
  return r;
}

/** An assignee must be an active ADMIN or a TEAM member who can actually see this client/campaign. */
export async function assertValidAssignee(userId: string, clientId: string, campaignId: string | null): Promise<void> {
  const u = await prisma.user.findFirst({
    where: {
      id: userId,
      status: 'ACTIVE',
      OR: [
        { role: 'ADMIN' },
        { role: 'TEAM', clientAssignments: { some: { clientId } } },
        ...(campaignId ? [{ role: 'TEAM' as const, campaignAssignments: { some: { campaignId } } }] : []),
      ],
    },
    select: { id: true },
  });
  if (!u) throw Errors.validation({ assignedToId: 'invalid_choice' });
}
