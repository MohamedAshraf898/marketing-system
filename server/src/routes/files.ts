import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { INLINE_SAFE_MIME } from '../../../shared/src/uploads';
import { authenticate } from '../auth/middleware';
import { fileWhere, isClient } from '../authz/scope';
import { resolveTarget } from '../authz/targets';
import { config } from '../config';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs } from '../lib/http';
import { storage } from '../storage';
import { singleFile } from '../storage/uploadMiddleware';
import { validateUpload } from '../storage/uploadRules';
import { audit } from '../services/audit';
import { findDeliverable } from '../services/deliverables';
import { findRequest } from '../services/requests';
import { and, fileSelect } from '../services/serializers';

export const filesRouter = Router();
filesRouter.use(authenticate);

filesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const p = paging(req.query, 25);
    const q = qs(req.query, 'q');
    const kind = qs(req.query, 'kind'); // image | video | document
    const campaignId = qs(req.query, 'campaignId');
    const deliverableId = qs(req.query, 'deliverableId');
    const requestId = qs(req.query, 'requestId');
    const clientId = qs(req.query, 'clientId');
    const kindFilter: Prisma.FileWhereInput | undefined =
      kind === 'image' ? { fileType: { startsWith: 'image/' } }
      : kind === 'video' ? { fileType: { startsWith: 'video/' } }
      : kind === 'document' ? { NOT: [{ fileType: { startsWith: 'image/' } }, { fileType: { startsWith: 'video/' } }] }
      : undefined;
    const where = and<Prisma.FileWhereInput>(
      fileWhere(scope),
      campaignId ? { campaignId } : undefined,
      deliverableId ? { deliverableId } : undefined,
      requestId ? { requestId } : undefined,
      clientId ? { clientId } : undefined,
      q ? { fileName: { contains: q } } : undefined,
      kindFilter,
    );
    const [total, items] = await Promise.all([
      prisma.file.count({ where }),
      prisma.file.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, select: fileSelect }),
    ]);
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

const uploadFields = z
  .object({
    clientId: z.string().optional(),
    campaignId: z.string().optional(),
    deliverableId: z.string().optional(),
    requestId: z.string().optional(),
    visibleToClient: z.enum(['true', 'false']).optional(),
  })
  .strict();

/**
 * Upload rules
 *  CLIENT      -> only as an attachment of one of THEIR OWN open requests
 *  ADMIN/TEAM  -> to a client, campaign, deliverable (drafts only) or request inside their scope
 * The owning client is always derived from the parent record, never from the request body.
 */
filesRouter.post(
  '/',
  singleFile('file'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    if (!req.file) throw Errors.badRequest('FILE_REQUIRED', 'Please choose a file to upload.');
    const fields = parse(uploadFields, req.body ?? {});
    const client = isClient(ctx.scope);

    if (client && (!fields.requestId || fields.campaignId || fields.deliverableId || fields.clientId)) throw Errors.forbidden();

    let clientId: string;
    let campaignId: string | null = null;
    let deliverableId: string | null = null;
    let requestId: string | null = null;
    let version = 1;
    let visible = fields.visibleToClient ? fields.visibleToClient === 'true' : true;

    if (fields.deliverableId) {
      const d = await findDeliverable(ctx.scope, fields.deliverableId);
      if (d.status !== 'DRAFT') throw Errors.conflict('DELIVERABLE_LOCKED', 'Files can only be added while the deliverable is a draft.');
      clientId = d.clientId;
      campaignId = d.campaignId;
      deliverableId = d.id;
      version = d.version;
      visible = false; // becomes visible to the client when the version is submitted
    } else if (fields.requestId) {
      const r = await findRequest(ctx.scope, fields.requestId);
      if (client && !['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'].includes(r.status)) {
        throw Errors.conflict('INVALID_STATE', 'Attachments can no longer be added to this request.');
      }
      clientId = r.clientId;
      campaignId = r.campaignId;
      requestId = r.id;
      visible = true;
    } else {
      const target = await resolveTarget(ctx.scope, { clientId: fields.clientId, campaignId: fields.campaignId });
      clientId = target.clientId;
      campaignId = target.campaign?.id ?? null;
    }

    const v = validateUpload(req.file, config.maxUploadBytes);
    await storage.put(v.storageKey, req.file.buffer, { contentType: v.mime });
    try {
      const file = await prisma.file.create({
        data: {
          fileName: v.displayName,
          filePath: v.storageKey,
          fileType: v.mime,
          size: req.file.size,
          clientId,
          campaignId,
          deliverableId,
          requestId,
          version,
          visibleToClient: visible,
          uploadedById: ctx.user.id,
        },
        select: fileSelect,
      });
      await audit(ctx, 'FILE_UPLOADED', 'file', file.id, { fileName: file.fileName, size: file.size, deliverableId, requestId, campaignId });
      res.status(201).json({ item: file });
    } catch (err) {
      await storage.delete(v.storageKey).catch(() => undefined); // no orphan blobs
      throw err;
    }
  }),
);

filesRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    // Scope check happens in the query itself: files of other clients simply do not exist for this user.
    const file = await prisma.file.findFirst({ where: and<Prisma.FileWhereInput>({ id: idParam(req) }, fileWhere(scope)) });
    if (!file) throw Errors.notFound();
    const { stream, size } = await storage.get(file.filePath);

    const inline = req.query.inline === '1' && INLINE_SAFE_MIME.includes(file.fileType);
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', inline ? file.fileType : file.fileType || 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (inline && file.fileType.startsWith('image/')) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }),
);

filesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    if (ctx.user.role === 'CLIENT') throw Errors.forbidden();
    const file = await prisma.file.findFirst({
      where: and<Prisma.FileWhereInput>({ id: idParam(req) }, fileWhere(ctx.scope)),
      include: { deliverable: { select: { status: true } } },
    });
    if (!file) throw Errors.notFound();
    // team members may only remove their own uploads; admins can remove any
    if (ctx.user.role === 'TEAM' && file.uploadedById !== ctx.user.id) throw Errors.forbidden();
    // files that were part of a client review are evidence for the approval history
    if (file.deliverable && file.deliverable.status !== 'DRAFT') {
      throw Errors.conflict('DELIVERABLE_LOCKED', 'Files of a deliverable under or after review cannot be deleted.');
    }
    await prisma.file.delete({ where: { id: file.id } });
    await storage.delete(file.filePath).catch(() => undefined);
    await audit(ctx, 'FILE_DELETED', 'file', file.id, { fileName: file.fileName });
    res.json({ ok: true });
  }),
);
