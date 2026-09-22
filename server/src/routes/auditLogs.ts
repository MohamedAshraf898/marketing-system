import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { adminOnly, authenticate } from '../auth/middleware';
import { prisma } from '../db';
import { Errors } from '../lib/errors';
import { asyncHandler, pageMeta, paging, qs } from '../lib/http';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { and, parseJson } from '../services/serializers';

export const auditLogsRouter = Router();
auditLogsRouter.use(authenticate, adminOnly); // ADMIN only

auditLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = paging(req.query, 30, 100);
    const action = qs(req.query, 'action');
    const entity = qs(req.query, 'entity');
    const userId = qs(req.query, 'userId');
    const q = qs(req.query, 'q');
    const from = qs(req.query, 'from');
    const to = qs(req.query, 'to');
    if ((from && !isDateOnly(from)) || (to && !isDateOnly(to))) throw Errors.validation({ from: 'invalid_date' });
    const where = and<Prisma.AuditLogWhereInput>(
      action ? { action } : undefined,
      entity ? { entity } : undefined,
      userId ? { userId } : undefined,
      q ? { OR: [{ entityId: { contains: q } }, { metadata: { contains: q } }] } : undefined,
      from || to ? { createdAt: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lte: endOfDayUtc(to) } : {}) } } : undefined,
    );
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
    ]);
    res.json({ items: rows.map((r) => ({ ...r, metadata: parseJson(r.metadata) })), meta: pageMeta(p, total) });
  }),
);
