// Owner: CRM group.  clientNotesRouter -> /clients/:clientId/internal-notes   internalNotesRouter -> /internal-notes
// Internal notes are STAFF ONLY. CLIENT users hold no permissions, so requirePerm('notes.internal') rejects them
// before any query runs; every lookup additionally goes through staffClientWhere (matches nothing for a CLIENT).
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { isAdmin, projectWhere, staffClientWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs } from '../lib/http';
import { audit } from '../services/audit';
import { and } from '../services/serializers';
import { findClient } from './helpers';

export const clientNotesRouter = Router({ mergeParams: true });
export const internalNotesRouter = Router();
clientNotesRouter.use(authenticate, requirePerm('notes.internal'));
internalNotesRouter.use(authenticate, requirePerm('notes.internal'));

const noteSelect = {
  id: true, clientId: true, projectId: true, authorId: true, body: true, pinned: true, createdAt: true, updatedAt: true,
  author: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.InternalNoteSelect;

const createSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  projectId: z.string().min(1).max(64).nullish(),
  pinned: z.boolean().default(false),
});
const updateSchema = z.object({ body: z.string().trim().min(1).max(8000), pinned: z.boolean() }).partial().strict();

async function findStaffClient(scope: Scope, id: string) {
  const c = await findClient(scope, id);
  if (!isAdmin(scope) && !scope.fullClientIds.includes(c.id)) throw Errors.notFound();
  return c;
}

/** The project must belong to THIS client and be in the caller's scope (else 404, existence is never revealed). */
async function findProjectOfClient(scope: Scope, projectId: string, clientId: string) {
  const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: projectId, clientId }, projectWhere(scope)), select: { id: true } });
  return p;
}

clientNotesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const client = await findStaffClient(scope, idParam(req, 'clientId'));
    const projectId = qs(req.query, 'projectId');
    if (projectId && !(await findProjectOfClient(scope, projectId, client.id))) throw Errors.notFound();
    const p = paging(req.query, 50);
    const where = and<Prisma.InternalNoteWhereInput>(staffClientWhere(scope), { clientId: client.id }, projectId ? { projectId } : undefined);
    const [total, items] = await Promise.all([
      prisma.internalNote.count({ where }),
      prisma.internalNote.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], skip: p.skip, take: p.take, select: noteSelect }),
    ]);
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

clientNotesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const client = await findStaffClient(ctx.scope, idParam(req, 'clientId'));
    const body = parse(createSchema, req.body);
    if (body.projectId && !(await findProjectOfClient(ctx.scope, body.projectId, client.id))) throw Errors.validation({ projectId: 'invalid_choice' });
    const item = await prisma.internalNote.create({
      data: { clientId: client.id, projectId: body.projectId ?? null, authorId: ctx.user.id, body: body.body, pinned: body.pinned },
      select: noteSelect,
    });
    // never the note text, never visible to the client
    await audit(ctx, 'INTERNAL_NOTE_CREATED', 'internal_note', item.id, { pinned: item.pinned, project: !!item.projectId }, { clientId: client.id, projectId: item.projectId, clientVisible: false });
    res.status(201).json({ item });
  }),
);

async function findOwnNote(ctx: ReturnType<typeof ctxOf>, id: string) {
  const note = await prisma.internalNote.findFirst({ where: and<Prisma.InternalNoteWhereInput>({ id }, staffClientWhere(ctx.scope)), select: { id: true, clientId: true, projectId: true, authorId: true, pinned: true } });
  if (!note) throw Errors.notFound();
  // only the author or an administrator may change or remove a note
  if (note.authorId !== ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden();
  return note;
}

internalNotesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findOwnNote(ctx, idParam(req));
    const body = parse(updateSchema, req.body);
    const item = await prisma.internalNote.update({ where: { id: existing.id }, data: body, select: noteSelect });
    await audit(ctx, 'INTERNAL_NOTE_UPDATED', 'internal_note', existing.id, { changes: Object.keys(body), pinned: item.pinned }, { clientId: existing.clientId, projectId: existing.projectId, clientVisible: false });
    res.json({ item });
  }),
);

internalNotesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findOwnNote(ctx, idParam(req));
    await prisma.internalNote.delete({ where: { id: existing.id } });
    await audit(ctx, 'INTERNAL_NOTE_DELETED', 'internal_note', existing.id, {}, { clientId: existing.clientId, projectId: existing.projectId, clientVisible: false });
    res.json({ ok: true });
  }),
);
