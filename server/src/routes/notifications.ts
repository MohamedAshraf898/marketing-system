import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, qs } from '../lib/http';
import { parseJson } from '../services/serializers';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

// A user only ever sees / touches their OWN notifications (userId comes from the session).
notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    const p = paging(req.query, 20, 50);
    const type = qs(req.query, 'type');
    const where = {
      userId: user.id,
      ...(qs(req.query, 'unread') === '1' ? { readAt: null } : {}),
      ...(type && /^[A-Z_]{1,60}$/.test(type) ? { type } : {}),
    };
    const [total, unreadCount, rows] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    ]);
    res.json({ items: rows.map((n) => ({ ...n, data: parseJson(n.data) ?? {} })), unreadCount, meta: pageMeta(p, total) });
  }),
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    res.json({ unreadCount: await prisma.notification.count({ where: { userId: user.id, readAt: null } }) });
  }),
);

notificationsRouter.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    const r = await prisma.notification.updateMany({ where: { id: idParam(req), userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0) {
      const exists = await prisma.notification.findFirst({ where: { id: idParam(req), userId: user.id }, select: { id: true } });
      if (!exists) throw Errors.notFound();
    }
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);

// Removing a notification only ever affects the caller's own row (someone else's id is a 404).
notificationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { user } = ctxOf(req);
    const r = await prisma.notification.deleteMany({ where: { id: idParam(req), userId: user.id } });
    if (r.count === 0) throw Errors.notFound();
    res.json({ ok: true });
  }),
);
