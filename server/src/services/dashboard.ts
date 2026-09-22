import type { Prisma } from '@prisma/client';
import { OPEN_REQUEST_STATUSES } from '../../../shared/src/enums';
import { prisma } from '../db';
import { campaignWhere, clientWhere, deliverableWhere, reportWhere, requestWhere } from '../authz/scope';
import type { Ctx } from '../lib/context';
import { attachPreviews } from './deliverables';
import { and } from './serializers';

/** One implementation for all three roles - the scope decides what each role can count. */
export async function buildDashboard(ctx: Ctx) {
  const s = ctx.scope;
  const cw = (extra?: Prisma.CampaignWhereInput) => and<Prisma.CampaignWhereInput>(campaignWhere(s), extra);
  const dw = (extra?: Prisma.DeliverableWhereInput) => and<Prisma.DeliverableWhereInput>(deliverableWhere(s), extra);
  const rw = (extra?: Prisma.RequestWhereInput) => and<Prisma.RequestWhereInput>(requestWhere(s), extra);

  const [
    activeCampaignCount,
    pendingApprovalCount,
    openRequestCount,
    spend,
    activeCampaigns,
    recentCampaigns,
    pendingApprovals,
    openRequests,
    recentReports,
  ] = await Promise.all([
    prisma.campaign.count({ where: cw({ status: 'RUNNING' }) }),
    prisma.deliverable.count({ where: dw({ status: 'PENDING_APPROVAL' }) }),
    prisma.request.count({ where: rw({ status: { in: OPEN_REQUEST_STATUSES } }) }),
    prisma.campaign.aggregate({ where: cw(), _sum: { spent: true } }),
    prisma.campaign.findMany({
      where: cw({ status: 'RUNNING' }),
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: { client: { select: { id: true, companyName: true } } },
    }),
    prisma.campaign.findMany({
      where: cw(),
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { client: { select: { id: true, companyName: true } } },
    }),
    prisma.deliverable.findMany({
      where: dw({ status: 'PENDING_APPROVAL' }),
      orderBy: { submittedAt: 'desc' },
      take: 5,
      include: { campaign: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
    }),
    prisma.request.findMany({
      // clients see their most recent requests (any status); staff see what is still open
      where: ctx.user.role === 'CLIENT' ? rw() : rw({ status: { in: OPEN_REQUEST_STATUSES } }),
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { client: { select: { id: true, companyName: true } }, assignedTo: { select: { id: true, name: true } } },
    }),
    prisma.report.findMany({
      where: reportWhere(s),
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      include: { campaign: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
    }),
  ]);

  const base = {
    role: ctx.user.role,
    activeCampaigns,
    recentCampaigns,
    pendingApprovals: await attachPreviews(s, pendingApprovals),
    requests: openRequests,
    recentReports,
  };
  const totalSpend = spend._sum.spent ?? 0;

  if (ctx.user.role === 'CLIENT') {
    const client = s.clientId
      ? await prisma.client.findUnique({ where: { id: s.clientId }, select: { id: true, name: true, companyName: true, logo: true } })
      : null;
    return {
      ...base,
      client: client && { id: client.id, name: client.name, companyName: client.companyName, hasLogo: !!client.logo },
      kpis: { activeCampaigns: activeCampaignCount, pendingApprovals: pendingApprovalCount, openRequests: openRequestCount, totalSpend },
    };
  }

  if (ctx.user.role === 'ADMIN') {
    const [totalClients, activeClients] = await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { status: 'ACTIVE' } }),
    ]);
    return {
      ...base,
      kpis: { totalClients, activeClients, activeCampaigns: activeCampaignCount, pendingApprovals: pendingApprovalCount, openRequests: openRequestCount, totalSpend },
    };
  }

  // TEAM
  const [assignedClients, assignedCampaigns, pendingDeliverables, clientComments, changeRequests] = await Promise.all([
    prisma.client.count({ where: clientWhere(s) }),
    prisma.campaign.count({ where: cw() }),
    prisma.deliverable.count({ where: dw({ status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } }) }),
    prisma.comment.findMany({
      where: { authorType: 'CLIENT', deliverable: { is: deliverableWhere(s) } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { user: { select: { id: true, name: true } }, deliverable: { select: { id: true, name: true } }, client: { select: { companyName: true } } },
    }),
    prisma.approval.findMany({
      where: { decision: 'CHANGES_REQUESTED', deliverable: { is: deliverableWhere(s) } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { user: { select: { id: true, name: true } }, deliverable: { select: { id: true, name: true } }, client: { select: { companyName: true } } },
    }),
  ]);

  const recentFeedback = [
    ...clientComments.map((c) => ({
      id: `c-${c.id}`, kind: 'COMMENT' as const, text: c.comment, at: c.createdAt,
      user: c.user, deliverable: c.deliverable, company: c.client.companyName,
    })),
    ...changeRequests.map((a) => ({
      id: `a-${a.id}`, kind: 'CHANGES_REQUESTED' as const, text: a.comment ?? '', at: a.decidedAt ?? a.createdAt,
      user: a.user, deliverable: a.deliverable, company: a.client.companyName,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 6);

  return {
    ...base,
    kpis: {
      assignedClients,
      assignedCampaigns,
      pendingDeliverables,
      pendingApprovals: pendingApprovalCount,
      openRequests: openRequestCount,
    },
    recentFeedback,
  };
}
