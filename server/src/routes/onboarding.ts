// Owner: CRM group.  clientOnboardingRouter -> /clients/:clientId/onboarding   onboardingRouter -> /onboarding
// The onboarding checklist is INTERNAL agency work: CLIENT users never reach these routes (no permissions) and
// every lookup goes through staffClientWhere, which matches nothing for them.
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { isAdmin, staffClientWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs } from '../lib/http';
import { audit } from '../services/audit';
import { notify } from '../services/notifications';
import { createDefaultChecklist, progressOf, startOfTodayUtc, syncOnboardingStatus } from '../services/onboarding';
import { and } from '../services/serializers';
import { findClient } from './helpers';

export const clientOnboardingRouter = Router({ mergeParams: true });
export const onboardingRouter = Router();
clientOnboardingRouter.use(authenticate);
onboardingRouter.use(authenticate);

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);

const itemSelect = {
  id: true, clientId: true, title: true, description: true, position: true, done: true, completedAt: true, completedById: true,
  assignedToId: true, dueDate: true, notes: true, createdAt: true, updatedAt: true,
  assignedTo: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
} satisfies Prisma.OnboardingItemSelect;

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
  assignedToId: z.string().min(1).max(64).nullish(),
  dueDate: dateStr.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).nullable(),
    done: z.boolean(),
    assignedToId: z.string().min(1).max(64).nullable(),
    dueDate: dateStr.nullable(),
    notes: z.string().trim().max(2000).nullable(),
    position: z.number().int().min(0).max(10_000),
  })
  .partial()
  .strict();

/** Staff-only client lookup: in scope AND (for team members) assigned to the whole client. */
async function findStaffClient(scope: Scope, id: string) {
  const c = await findClient(scope, id);
  if (!isAdmin(scope) && !scope.fullClientIds.includes(c.id)) throw Errors.notFound();
  return c;
}

/** An assignee must be an ACTIVE admin, or a team member who is assigned to this client. */
async function assertAssignee(userId: string, clientId: string) {
  const u = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', OR: [{ role: 'ADMIN' }, { role: 'TEAM', clientAssignments: { some: { clientId } } }] },
    select: { id: true },
  });
  if (!u) throw Errors.validation({ assignedToId: 'invalid_choice' });
}

const blank = (v: string | null | undefined) => (v ? v : null);

async function overview(clientId: string) {
  const [client, items] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, companyName: true, status: true, onboardingStatus: true } }),
    prisma.onboardingItem.findMany({ where: { clientId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: itemSelect }),
  ]);
  return { client, items, progress: progressOf(items) };
}

// ───────────────────────── /clients/:clientId/onboarding ─────────────────────────

clientOnboardingRouter.get(
  '/',
  requirePerm('clients.view'),
  asyncHandler(async (req, res) => {
    const client = await findStaffClient(ctxOf(req).scope, idParam(req, 'clientId'));
    const o = await overview(client.id);
    res.json({ items: o.items, progress: o.progress, onboardingStatus: o.client.onboardingStatus, meta: { total: o.items.length } });
  }),
);

clientOnboardingRouter.post(
  '/',
  requirePerm('onboarding.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const client = await findStaffClient(ctx.scope, idParam(req, 'clientId'));
    const body = parse(createSchema, req.body);
    if (body.assignedToId) await assertAssignee(body.assignedToId, client.id);
    const last = await prisma.onboardingItem.aggregate({ where: { clientId: client.id }, _max: { position: true } });
    const item = await prisma.onboardingItem.create({
      data: {
        clientId: client.id, // from the parent, never the body
        title: body.title,
        description: blank(body.description),
        assignedToId: body.assignedToId ?? null,
        dueDate: body.dueDate ?? null,
        notes: blank(body.notes),
        position: (last._max.position ?? -1) + 1,
      },
      select: itemSelect,
    });
    await syncOnboardingStatus(client.id);
    await audit(ctx, 'ONBOARDING_ITEM_ADDED', 'onboarding_item', item.id, { title: item.title }, { clientId: client.id });
    if (item.assignedToId) {
      await notify([item.assignedToId], { type: 'ONBOARDING_ITEM_ASSIGNED', entity: 'client', entityId: client.id, data: { title: item.title, client: client.companyName } }, ctx.user.id);
    }
    res.status(201).json({ item });
  }),
);

/** Creates the default checklist when the client has none (idempotent: an existing checklist is left untouched). */
clientOnboardingRouter.post(
  '/start',
  requirePerm('onboarding.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const client = await findStaffClient(ctx.scope, idParam(req, 'clientId'));
    const created = await prisma.$transaction(async (tx) => {
      const n = await createDefaultChecklist(client.id, tx);
      if (n > 0) await syncOnboardingStatus(client.id, tx);
      return n;
    });
    if (created > 0) await audit(ctx, 'ONBOARDING_STARTED', 'onboarding_item', null, { items: created }, { clientId: client.id });
    const o = await overview(client.id);
    res.status(created > 0 ? 201 : 200).json({ items: o.items, progress: o.progress, onboardingStatus: o.client.onboardingStatus, created: created > 0, meta: { total: o.items.length } });
  }),
);

// ───────────────────────── /onboarding ─────────────────────────

/** Dashboard: clients that are being onboarded (or still have unfinished checklist items), with progress. */
onboardingRouter.get(
  '/',
  requirePerm('clients.view'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const assigneeParam = qs(req.query, 'assignedToId');
    const assigneeId = mine ? user.id : assigneeParam;
    const onlyOverdue = req.query.overdue === '1' || req.query.overdue === 'true';
    const today = startOfTodayUtc();

    const unfinished: Prisma.OnboardingItemWhereInput = { done: false };
    const clientScope: Prisma.ClientWhereInput = isAdmin(scope) ? {} : { id: { in: scope.fullClientIds } };
    const where = and<Prisma.ClientWhereInput>(
      clientScope,
      { status: { not: 'ARCHIVED' } },
      { OR: [{ status: 'ONBOARDING' }, { onboardingItems: { some: unfinished } }] },
      assigneeId ? { onboardingItems: { some: { ...unfinished, assignedToId: assigneeId } } } : undefined,
      onlyOverdue ? { onboardingItems: { some: { ...unfinished, dueDate: { lt: today } } } } : undefined,
      q ? { OR: [{ companyName: { contains: q } }, { name: { contains: q } }] } : undefined,
    );
    const itemScope = staffClientWhere(scope);
    const [total, rows, myOpen, overdueAll] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: { companyName: 'asc' },
        skip: p.skip,
        take: p.take,
        select: {
          id: true, companyName: true, name: true, status: true, onboardingStatus: true, logo: true,
          accountManager: { select: { id: true, name: true } },
          onboardingItems: {
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, title: true, done: true, dueDate: true, assignedToId: true, assignedTo: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.onboardingItem.count({ where: and<Prisma.OnboardingItemWhereInput>(itemScope, unfinished, { assignedToId: user.id }) }),
      prisma.onboardingItem.count({ where: and<Prisma.OnboardingItemWhereInput>(itemScope, unfinished, { dueDate: { lt: today } }) }),
    ]);
    const items = rows.map(({ onboardingItems, logo, ...c }) => {
      const pending = onboardingItems.filter((i) => !i.done);
      const next = pending[0] ?? null;
      return {
        ...c,
        hasLogo: !!logo,
        progress: progressOf(onboardingItems),
        nextItem: next ? { id: next.id, title: next.title, dueDate: next.dueDate, assignedTo: next.assignedTo } : null,
        overdueItems: pending
          .filter((i) => i.dueDate && i.dueDate < today)
          .slice(0, 5)
          .map((i) => ({ id: i.id, title: i.title, dueDate: i.dueDate, assignedTo: i.assignedTo })),
        myOpenItems: pending.filter((i) => i.assignedToId === user.id).length,
      };
    });
    res.json({ items, summary: { myOpenItems: myOpen, overdueItems: overdueAll }, meta: pageMeta(p, total) });
  }),
);

async function findItem(scope: Scope, id: string) {
  const item = await prisma.onboardingItem.findFirst({
    where: and<Prisma.OnboardingItemWhereInput>({ id }, staffClientWhere(scope)),
    include: { client: { select: { id: true, companyName: true } } },
  });
  if (!item) throw Errors.notFound();
  return item;
}

onboardingRouter.patch(
  '/:id',
  requirePerm('onboarding.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findItem(ctx.scope, idParam(req));
    const body = parse(updateSchema, req.body);
    if (body.assignedToId) await assertAssignee(body.assignedToId, existing.clientId);

    const data: Prisma.OnboardingItemUncheckedUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = blank(body.description);
    if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId;
    if (body.dueDate !== undefined) data.dueDate = body.dueDate;
    if (body.notes !== undefined) data.notes = blank(body.notes);
    if (body.position !== undefined) data.position = body.position;
    const doneChanged = body.done !== undefined && body.done !== existing.done;
    if (doneChanged) {
      // who / when comes from the session, never from the request
      data.done = body.done;
      data.completedAt = body.done ? new Date() : null;
      data.completedById = body.done ? ctx.user.id : null;
    }
    const item = await prisma.onboardingItem.update({ where: { id: existing.id }, data, select: itemSelect });
    const status = await syncOnboardingStatus(existing.clientId);
    const fields = Object.keys(body).filter((k) => k !== 'done');
    await audit(ctx, 'ONBOARDING_ITEM_UPDATED', 'onboarding_item', item.id, { title: item.title, ...(doneChanged ? { done: item.done } : {}), ...(fields.length ? { changes: fields } : {}), onboardingStatus: status }, { clientId: existing.clientId });
    if (body.assignedToId && body.assignedToId !== existing.assignedToId) {
      await notify([body.assignedToId], { type: 'ONBOARDING_ITEM_ASSIGNED', entity: 'client', entityId: existing.clientId, data: { title: item.title, client: existing.client.companyName } }, ctx.user.id);
    }
    res.json({ item, onboardingStatus: status });
  }),
);

onboardingRouter.delete(
  '/:id',
  requirePerm('onboarding.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await findItem(ctx.scope, idParam(req));
    await prisma.$transaction(async (tx) => {
      // files attached to an internal item must stay internal once the item is gone (the FK is set to NULL)
      await tx.file.updateMany({ where: { onboardingItemId: existing.id }, data: { visibleToClient: false } });
      await tx.onboardingItem.delete({ where: { id: existing.id } });
      await syncOnboardingStatus(existing.clientId, tx);
    });
    await audit(ctx, 'ONBOARDING_ITEM_DELETED', 'onboarding_item', existing.id, { title: existing.title }, { clientId: existing.clientId });
    res.json({ ok: true });
  }),
);
