import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CLIENT_STATUSES } from '../../../shared/src/enums';
import { ALLOWED_UPLOADS } from '../../../shared/src/uploads';
import { authenticate, adminOnly } from '../auth/middleware';
import { clientWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { ApiError, Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { storage } from '../storage';
import { sanitizeFileName, validateUpload } from '../storage/uploadRules';
import { singleFile } from '../storage/uploadMiddleware';
import { audit } from '../services/audit';
import { and } from '../services/serializers';
import { findClient } from './helpers';

export const clientsRouter = Router();
clientsRouter.use(authenticate);

const clientBody = z.object({
  name: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).nullish(),
  status: z.enum(CLIENT_STATUSES).optional(),
});

const toDto = <T extends { logo: string | null }>(c: T) => {
  const { logo, ...rest } = c;
  return { ...rest, hasLogo: !!logo };
};

clientsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const status = qsEnum(req.query, 'status', CLIENT_STATUSES);
    const where = and<Prisma.ClientWhereInput>(
      clientWhere(scope),
      status ? { status } : undefined,
      q ? { OR: [{ name: { contains: q } }, { companyName: { contains: q } }, { email: { contains: q } }] } : undefined,
    );
    const [total, items] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: { companyName: 'asc' },
        skip: p.skip,
        take: p.take,
        include: { _count: { select: { campaigns: true, users: true, requests: true } } },
      }),
    ]);
    res.json({ items: items.map(toDto), meta: pageMeta(p, total) });
  }),
);

clientsRouter.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(clientBody, req.body);
    const client = await prisma.client.create({ data: { ...body, phone: body.phone || null } });
    await audit(ctx, 'CLIENT_CREATED', 'client', client.id, { companyName: client.companyName });
    res.status(201).json({ item: toDto(client) });
  }),
);

clientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const base = await findClient(scope, idParam(req));
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: base.id },
      include: { _count: { select: { campaigns: true, deliverables: true, requests: true, files: true } } },
    });
    const staff = user.role !== 'CLIENT';
    const [users, team] = await Promise.all([
      staff
        ? prisma.user.findMany({ where: { clientId: base.id, role: 'CLIENT' }, select: { id: true, name: true, email: true, status: true, lastLoginAt: true } })
        : Promise.resolve(undefined),
      user.role === 'ADMIN'
        ? prisma.clientAssignment.findMany({ where: { clientId: base.id }, select: { user: { select: { id: true, name: true, email: true } } } })
        : Promise.resolve(undefined),
    ]);
    res.json({ item: { ...toDto(client), ...(users ? { users } : {}), ...(team ? { team: team.map((a) => a.user) } : {}) } });
  }),
);

clientsRouter.patch(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findClient(ctx.scope, idParam(req));
    const body = parse(clientBody.partial().strict(), req.body);
    const client = await prisma.client.update({
      where: { id: existing.id },
      data: { ...body, ...(body.phone !== undefined ? { phone: body.phone || null } : {}) },
    });
    const archived = body.status === 'ARCHIVED' && existing.status !== 'ARCHIVED';
    await audit(ctx, archived ? 'CLIENT_ARCHIVED' : 'CLIENT_UPDATED', 'client', client.id, { changes: Object.keys(body), status: client.status });
    res.json({ item: toDto(client) });
  }),
);

// ── logo ──
const LOGO_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const LOGO_MAX = 2 * 1024 * 1024;

clientsRouter.post(
  '/:id/logo',
  adminOnly,
  singleFile('file'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findClient(ctx.scope, idParam(req));
    if (!req.file) throw Errors.badRequest('FILE_REQUIRED', 'Please choose a file.');
    const v = validateUpload(req.file, LOGO_MAX);
    if (!LOGO_EXT.includes(v.ext) || !ALLOWED_UPLOADS[v.ext]?.[0].startsWith('image/')) {
      throw new ApiError(400, 'FILE_TYPE_NOT_ALLOWED', 'The logo must be an image.');
    }
    await storage.put(v.storageKey, req.file.buffer, { contentType: v.mime });
    const old = existing.logo;
    await prisma.client.update({ where: { id: existing.id }, data: { logo: v.storageKey } });
    if (old) await storage.delete(old).catch(() => undefined);
    await audit(ctx, 'CLIENT_UPDATED', 'client', existing.id, { changes: ['logo'], file: sanitizeFileName(req.file.originalname) });
    res.json({ ok: true });
  }),
);

clientsRouter.get(
  '/:id/logo',
  asyncHandler(async (req, res) => {
    const client = await findClient(ctxOf(req).scope, idParam(req));
    if (!client.logo) throw Errors.notFound();
    const { stream } = await storage.get(client.logo);
    const ext = client.logo.slice(client.logo.lastIndexOf('.')).toLowerCase();
    res.setHeader('Content-Type', ALLOWED_UPLOADS[ext]?.[0] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    stream.pipe(res);
  }),
);
