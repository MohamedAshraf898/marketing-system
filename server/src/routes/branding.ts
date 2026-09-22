// Owner: Admin group.  brandingRouter -> /branding (GET is PUBLIC: it only exposes agency name, colours and logo)
import crypto from 'node:crypto';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { adminOnly, authenticate } from '../auth/middleware';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { ApiError, Errors } from '../lib/errors';
import { asyncHandler, parse } from '../lib/http';
import { audit } from '../services/audit';
import { HEX_COLOR, MIME_BY_EXT, getSettings, looksLikeMarkup, publicBranding, sniffImage } from '../services/branding';
import { storage } from '../storage';
import { singleFile } from '../storage/uploadMiddleware';
import { sanitizeFileName } from '../storage/uploadRules';

export const brandingRouter = Router();

const IMAGE_MAX = 1024 * 1024; // 1 MB
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.ico'];

// ───────────── PUBLIC reads (the login page needs them before anyone is signed in) ─────────────
brandingRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(publicBranding(await getSettings()));
  }),
);

type Slot = 'logo' | 'favicon';
const KEY_FIELD = { logo: 'logoKey', favicon: 'faviconKey' } as const;

async function streamImage(slot: Slot, req: Request, res: Response) {
  const s = await getSettings();
  const key = s[KEY_FIELD[slot]];
  if (!key) throw Errors.notFound();
  const etag = `"${key}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.get('if-none-match') === etag) return void res.status(304).end();
  const { stream, size } = await storage.get(key);
  const ext = path.extname(key).slice(1).toLowerCase();
  res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  // extra hardening: even if a browser were to open the image directly it may not run anything
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  stream.pipe(res);
}

brandingRouter.get('/logo', asyncHandler((req, res) => streamImage('logo', req, res)));
brandingRouter.get('/favicon', asyncHandler((req, res) => streamImage('favicon', req, res)));

// ───────────── ADMIN writes ─────────────
const color = z.string().trim().refine((v) => HEX_COLOR.test(v), { message: 'invalid_color' }).transform((v) => v.toLowerCase());
const updateSchema = z
  .object({ agencyName: z.string().trim().min(1).max(60), primaryColor: color, secondaryColor: color })
  .partial()
  .strict();

brandingRouter.put(
  '/',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(updateSchema, req.body);
    const changes = Object.keys(body);
    if (changes.length === 0) throw Errors.validation({ _: 'required' });
    const s = await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: body, create: { id: 'singleton', ...body } });
    await audit(ctx, 'BRANDING_UPDATED', 'settings', 'singleton', { changes, ...(body.agencyName ? { name: body.agencyName } : {}) });
    res.json({ item: publicBranding(s) });
  }),
);

function uploadRoute(slot: Slot) {
  brandingRouter.post(
    `/${slot}`,
    authenticate,
    adminOnly,
    singleFile('file'),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const file = req.file;
      if (!file) throw Errors.badRequest('FILE_REQUIRED', 'Please choose a file.');
      if (file.size === 0) throw Errors.badRequest('FILE_EMPTY', 'The file is empty.');
      if (file.size > IMAGE_MAX) throw new ApiError(413, 'FILE_TOO_LARGE', 'The file is too large.');
      const name = sanitizeFileName(file.originalname);
      const declared = path.extname(name).toLowerCase();
      // SVG / HTML can carry script: refuse by name AND by content
      if (declared === '.svg' || looksLikeMarkup(file.buffer)) throw Errors.badRequest('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed.');
      if (!IMAGE_EXTS.includes(declared)) throw Errors.badRequest('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed.');
      const kind = sniffImage(file.buffer);
      const sameKind = kind && (declared === `.${kind.ext}` || (declared === '.jpeg' && kind.ext === 'jpg'));
      if (!kind || !sameKind) throw Errors.badRequest('FILE_CONTENT_MISMATCH', 'The file content does not match its type.');

      const key = `${crypto.randomUUID()}.${kind.ext}`; // derived by the server, never from the file name
      await storage.put(key, file.buffer, { contentType: kind.mime });
      const field = KEY_FIELD[slot];
      const before = await getSettings();
      const s = await prisma.appSettings.update({ where: { id: 'singleton' }, data: { [field]: key } });
      const old = before[field];
      if (old) await storage.delete(old).catch(() => undefined);
      await audit(ctx, 'BRANDING_UPDATED', 'settings', 'singleton', { changes: [slot] });
      res.json({ item: publicBranding(s) });
    }),
  );

  brandingRouter.delete(
    `/${slot}`,
    authenticate,
    adminOnly,
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const field = KEY_FIELD[slot];
      const before = await getSettings();
      const old = before[field];
      const s = await prisma.appSettings.update({ where: { id: 'singleton' }, data: { [field]: null } });
      if (old) await storage.delete(old).catch(() => undefined);
      await audit(ctx, 'BRANDING_UPDATED', 'settings', 'singleton', { changes: [`${slot}Removed`] });
      res.json({ item: publicBranding(s) });
    }),
  );
}
uploadRoute('logo');
uploadRoute('favicon');
