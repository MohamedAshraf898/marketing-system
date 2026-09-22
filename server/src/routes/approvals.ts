import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { APPROVAL_DECISIONS } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { approvalWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { asyncHandler, pageMeta, paging, qs, qsEnum } from '../lib/http';
import { and, userMini } from '../services/serializers';

export const approvalsRouter = Router();
approvalsRouter.use(authenticate);

/** Read-only, scope-filtered view of the append-only approval history. */
approvalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const p = paging(req.query, 25);
    const decision = qsEnum(req.query, 'decision', APPROVAL_DECISIONS);
    const clientId = qs(req.query, 'clientId');
    const deliverableId = qs(req.query, 'deliverableId');
    const where = and<Prisma.ApprovalWhereInput>(
      approvalWhere(scope),
      decision ? { decision } : { decision: { not: 'PENDING' } }, // PENDING rows are "submitted" markers
      clientId ? { clientId } : undefined,
      deliverableId ? { deliverableId } : undefined,
    );
    const [total, items] = await Promise.all([
      prisma.approval.count({ where }),
      prisma.approval.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: {
          user: { select: userMini },
          client: { select: { id: true, companyName: true } },
          deliverable: { select: { id: true, name: true, type: true, status: true, version: true, campaign: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    res.json({ items, meta: pageMeta(p, total) });
  }),
);
