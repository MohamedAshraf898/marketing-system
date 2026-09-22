// Owner: CRM group.  clientContactsRouter -> /clients/:clientId/contacts   contactsRouter -> /contacts
import { Router } from 'express';
import { z } from 'zod';
import type { ClientContact, Prisma } from '@prisma/client';
import { authenticate } from '../auth/middleware';
import { requirePerm, requirePermOrClient } from '../authz/permissions';
import { canWriteClient, contactWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse } from '../lib/http';
import { audit } from '../services/audit';
import { and } from '../services/serializers';
import { findClient } from './helpers';

export const clientContactsRouter = Router({ mergeParams: true });
export const contactsRouter = Router();
clientContactsRouter.use(authenticate);
contactsRouter.use(authenticate);

/** empty string -> null so cleared inputs in the form do not fail validation */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optString = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullish());

const contactFields = {
  name: z.string().trim().min(1).max(120),
  jobTitle: optString(120),
  email: z.preprocess(emptyToNull, z.string().trim().toLowerCase().email().max(200).nullish()),
  phone: optString(40),
  whatsapp: optString(40),
  isPrimary: z.boolean(),
  visibleToClient: z.boolean(),
  notes: optString(4000), // internal
};

const createSchema = z.object({ ...contactFields, isPrimary: contactFields.isPrimary.default(false), visibleToClient: contactFields.visibleToClient.default(true) });
const updateSchema = z.object(contactFields).partial().strict();

/** What a CLIENT user may see of a contact: never `notes`, never the storage key of the avatar. */
const portalContact = (c: ClientContact) => ({
  id: c.id, clientId: c.clientId, name: c.name, jobTitle: c.jobTitle, email: c.email, phone: c.phone, whatsapp: c.whatsapp, isPrimary: c.isPrimary,
});
const staffContact = (c: ClientContact) => {
  const { avatar, ...rest } = c;
  return { ...rest, hasAvatar: !!avatar };
};

// ───────────────────────── /clients/:clientId/contacts ─────────────────────────

clientContactsRouter.get(
  '/',
  requirePermOrClient('clients.view'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const client = await findClient(scope, idParam(req, 'clientId'));
    const p = paging(req.query, 50);
    const where = and<Prisma.ClientContactWhereInput>(contactWhere(scope), { clientId: client.id });
    const [total, rows] = await Promise.all([
      prisma.clientContact.count({ where }),
      prisma.clientContact.findMany({ where, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }], skip: p.skip, take: p.take }),
    ]);
    res.json({ items: rows.map(user.role === 'CLIENT' ? portalContact : staffContact), meta: pageMeta(p, total) });
  }),
);

clientContactsRouter.post(
  '/',
  requirePerm('contacts.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const client = await findClient(ctx.scope, idParam(req, 'clientId'));
    if (!canWriteClient(ctx.scope, client.id)) throw Errors.notFound();
    const body = parse(createSchema, req.body);
    const contact = await prisma.$transaction(async (tx) => {
      const count = await tx.clientContact.count({ where: { clientId: client.id } });
      // the first contact of a company is its primary contact; asking for primary demotes the previous one
      const isPrimary = body.isPrimary || count === 0;
      if (isPrimary) await tx.clientContact.updateMany({ where: { clientId: client.id, isPrimary: true }, data: { isPrimary: false } });
      return tx.clientContact.create({
        data: {
          clientId: client.id, // from the parent looked up in scope, never from the body
          name: body.name,
          jobTitle: body.jobTitle ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          whatsapp: body.whatsapp ?? null,
          notes: body.notes ?? null,
          isPrimary,
          visibleToClient: body.visibleToClient,
        },
      });
    });
    await audit(ctx, 'CONTACT_CREATED', 'contact', contact.id, { name: contact.name, isPrimary: contact.isPrimary }, { clientId: client.id });
    res.status(201).json({ item: staffContact(contact) });
  }),
);

// ───────────────────────── /contacts/:id ─────────────────────────

async function findContact(scope: Parameters<typeof contactWhere>[0], id: string) {
  const c = await prisma.clientContact.findFirst({ where: and<Prisma.ClientContactWhereInput>({ id }, contactWhere(scope)) });
  if (!c) throw Errors.notFound();
  return c;
}

contactsRouter.patch(
  '/:id',
  requirePerm('contacts.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findContact(ctx.scope, idParam(req));
    const body = parse(updateSchema, req.body);
    const { isPrimary, ...rest } = body;
    const updated = await prisma.$transaction(async (tx) => {
      // exactly one primary contact per client: promoting this one demotes the others; the primary itself can only
      // be changed by promoting a different contact
      if (isPrimary === true) await tx.clientContact.updateMany({ where: { clientId: existing.clientId, isPrimary: true, id: { not: existing.id } }, data: { isPrimary: false } });
      return tx.clientContact.update({ where: { id: existing.id }, data: { ...rest, ...(isPrimary === true ? { isPrimary: true } : {}) } });
    });
    await audit(ctx, 'CONTACT_UPDATED', 'contact', existing.id, { name: updated.name, changes: Object.keys(body) }, { clientId: existing.clientId });
    res.json({ item: staffContact(updated) });
  }),
);

contactsRouter.delete(
  '/:id',
  requirePerm('contacts.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findContact(ctx.scope, idParam(req));
    await prisma.$transaction(async (tx) => {
      await tx.clientContact.delete({ where: { id: existing.id } });
      if (existing.isPrimary) {
        // keep the "one primary contact" invariant: promote the oldest remaining contact
        const next = await tx.clientContact.findFirst({ where: { clientId: existing.clientId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (next) await tx.clientContact.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
    await audit(ctx, 'CONTACT_DELETED', 'contact', existing.id, { name: existing.name }, { clientId: existing.clientId });
    res.json({ ok: true });
  }),
);
