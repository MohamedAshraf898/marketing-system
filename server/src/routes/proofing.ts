import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, parse, qs } from '../lib/http';
import { createProofing, deleteProofing, listProofing, setProofingResolved } from '../services/proofing';

/** Mounted by routes/deliverables.ts at /deliverables/:id/proofing (scope is enforced through findDeliverable in the service). */
export const proofingRouter = Router({ mergeParams: true });
proofingRouter.use(authenticate);

const createSchema = z
  .object({
    fileId: z.string().trim().min(1).max(64).nullish(),
    version: z.number().int().min(1).max(10_000).nullish(),
    x: z.number().finite().min(0).max(1).nullish(),
    y: z.number().finite().min(0).max(1).nullish(),
    timestampSec: z.number().finite().min(0).max(86_400).nullish(),
    comment: z.string().trim().min(1).max(2000),
  })
  // authorType / userId / clientId in the body are NOT part of the schema: they are dropped and always derived from the session
  .superRefine((v, c) => {
    if ((v.x == null) !== (v.y == null)) c.addIssue({ code: 'custom', path: [v.x == null ? 'x' : 'y'], message: 'pin_needs_both' });
  });

const resolveSchema = z.object({ resolved: z.boolean() }).strict();

function intQuery(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d{1,5}$/.test(raw)) throw Errors.validation({ [field]: 'invalid' });
  return parseInt(raw, 10);
}

proofingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const version = intQuery(qs(req.query, 'version'), 'version');
    const fileId = qs(req.query, 'fileId');
    if (fileId && !/^[a-zA-Z0-9_-]{5,64}$/.test(fileId)) throw Errors.validation({ fileId: 'invalid' });
    res.json(await listProofing(ctxOf(req), idParam(req), { version, fileId }));
  }),
);

proofingRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const deliverableId = idParam(req);
    const body = parse(createSchema, req.body);
    res.status(201).json({ item: await createProofing(ctx, deliverableId, body) });
  }),
);

proofingRouter.patch(
  '/:commentId',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(resolveSchema, req.body);
    res.json({ item: await setProofingResolved(ctx, idParam(req), idParam(req, 'commentId'), body.resolved) });
  }),
);

proofingRouter.delete(
  '/:commentId',
  asyncHandler(async (req, res) => {
    await deleteProofing(ctxOf(req), idParam(req), idParam(req, 'commentId'));
    res.json({ ok: true });
  }),
);
