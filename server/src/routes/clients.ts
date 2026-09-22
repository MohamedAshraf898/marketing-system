import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ACTIVE_TASK_STATUSES, CLIENT_STATUSES, CLIENT_TYPES, ONBOARDING_STATUSES, OPEN_REQUEST_STATUSES, OUTSTANDING_INVOICE_STATUSES } from '../../../shared/src/enums';
import { ALLOWED_UPLOADS } from '../../../shared/src/uploads';
import { authenticate } from '../auth/middleware';
import { requirePerm, requirePermOrClient } from '../authz/permissions';
import {
  campaignWhere, canWriteClient, clientWhere, contractWhere, deliverableWhere, fileWhere, invoiceWhere, isAdmin, projectWhere, requestWhere, taskWhere, type Scope,
} from '../authz/scope';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { ApiError, Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { storage } from '../storage';
import { sanitizeFileName, validateUpload } from '../storage/uploadRules';
import { singleFile } from '../storage/uploadMiddleware';
import { audit } from '../services/audit';
import { createDefaultChecklist, progressOf } from '../services/onboarding';
import { and } from '../services/serializers';
import { portalClientDto, staffClientDto } from '../services/clientDto';
import { findClient } from './helpers';

export const clientsRouter = Router();
clientsRouter.use(authenticate);

// ───────────────────────── validation ─────────────────────────

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);

/** Only http(s) links are accepted: the website is rendered as a clickable link in the web app. */
const websiteField = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, { message: 'invalid_url' });

const optText = (max: number) => z.string().trim().max(max).nullish();

const tagsField = z
  .array(z.string().trim().min(1).max(30))
  .max(20)
  .transform((a) => [...new Set(a)]);

const clientObject = z.object({
    name: z.string().trim().min(1).max(120),
    companyName: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().max(40).nullish(),
    status: z.enum(CLIENT_STATUSES).optional(),
    // CRM
    industry: optText(120),
    website: websiteField.nullish().or(z.literal('')),
    address: optText(300),
    country: optText(80),
    city: optText(80),
    leadSource: optText(120),
    accountManagerId: z.string().min(1).max(64).nullish(),
    clientType: z.enum(CLIENT_TYPES).optional(),
    tags: tagsField.optional(),
    notes: optText(4000), // client-visible
    onboardingStatus: z.enum(ONBOARDING_STATUSES).optional(),
    clientSince: dateStr.nullish(),
    contractStart: dateStr.nullish(),
    contractEnd: dateStr.nullish(),
    monthlyRetainer: z.number().min(0).max(1_000_000_000).nullish(),
    internalNotes: optText(8000),
});

const clientBody = clientObject.superRefine((v, c) => {
  if (v.contractStart && v.contractEnd && v.contractEnd < v.contractStart) c.addIssue({ code: 'custom', path: ['contractEnd'], message: 'end_before_start' });
});

type ClientBody = z.infer<typeof clientObject>;

const blank = (v: string | null | undefined) => (v ? v : null);

/** Body -> prisma data. Only keys that were actually sent are included (so PATCH never wipes other fields). */
function toData(body: Partial<ClientBody>): Prisma.ClientUncheckedUpdateInput {
  const d: Prisma.ClientUncheckedUpdateInput = {};
  if (body.name !== undefined) d.name = body.name;
  if (body.companyName !== undefined) d.companyName = body.companyName;
  if (body.email !== undefined) d.email = body.email;
  if (body.phone !== undefined) d.phone = blank(body.phone);
  if (body.status !== undefined) d.status = body.status;
  if (body.industry !== undefined) d.industry = blank(body.industry);
  if (body.website !== undefined) d.website = blank(body.website);
  if (body.address !== undefined) d.address = blank(body.address);
  if (body.country !== undefined) d.country = blank(body.country);
  if (body.city !== undefined) d.city = blank(body.city);
  if (body.leadSource !== undefined) d.leadSource = blank(body.leadSource);
  if (body.accountManagerId !== undefined) d.accountManagerId = body.accountManagerId || null;
  if (body.clientType !== undefined) d.clientType = body.clientType;
  if (body.tags !== undefined) d.tags = body.tags.length ? JSON.stringify(body.tags) : null;
  if (body.notes !== undefined) d.notes = blank(body.notes);
  if (body.clientSince !== undefined) d.clientSince = body.clientSince ?? null;
  if (body.contractStart !== undefined) d.contractStart = body.contractStart ?? null;
  if (body.contractEnd !== undefined) d.contractEnd = body.contractEnd ?? null;
  if (body.monthlyRetainer !== undefined) d.monthlyRetainer = body.monthlyRetainer === null ? null : Math.round(body.monthlyRetainer * 100) / 100;
  if (body.internalNotes !== undefined) d.internalNotes = blank(body.internalNotes);
  return d;
}

// ───────────────────────── permissions & presentation ─────────────────────────

const canSeeMoney = (s: Scope) => s.permissions.has('invoices.view') || s.permissions.has('contracts.view');
const canWriteMoney = (s: Scope) => s.permissions.has('invoices.manage') || s.permissions.has('contracts.manage');

/** Fields that need their own permission on top of clients.create / clients.edit. */
function assertFieldPermissions(scope: Scope, body: Partial<ClientBody>) {
  if (body.monthlyRetainer !== undefined && !canWriteMoney(scope)) throw Errors.forbidden();
  if (body.internalNotes !== undefined && !scope.permissions.has('notes.internal')) throw Errors.forbidden();
}

/**
 * The client as the caller may see it. CLIENT users get the explicit whitelist (portalClientDto); staff get every
 * field except the ones guarded by a permission they do not hold (internal notes, retainer).
 */
function present<T extends Parameters<typeof staffClientDto>[0]>(ctx: Pick<Ctx, 'user' | 'scope'>, c: T) {
  if (ctx.user.role === 'CLIENT') return portalClientDto(c);
  const { internalNotes, monthlyRetainer, ...rest } = staffClientDto(c);
  return {
    ...rest,
    ...(ctx.scope.permissions.has('notes.internal') ? { internalNotes } : {}),
    ...(canSeeMoney(ctx.scope) ? { monthlyRetainer } : {}),
  };
}

/** The account manager must be an ACTIVE admin / team member. */
async function assertAccountManager(ctx: Ctx, managerId: string, clientId: string | null, creatorAssigned = false) {
  const m = await prisma.user.findFirst({
    where: { id: managerId, status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] } },
    select: { id: true, role: true, clientAssignments: clientId ? { where: { clientId }, select: { id: true } } : false },
  });
  if (!m) throw Errors.validation({ accountManagerId: 'invalid_choice' });
  if (m.role === 'ADMIN') return { needsAssignment: false };
  const alreadyAssigned = (m.clientAssignments?.length ?? 0) > 0 || (creatorAssigned && m.id === ctx.user.id);
  if (alreadyAssigned) return { needsAssignment: false };
  // Making someone the manager of a client gives them access to it: only an administrator may grant that.
  if (ctx.user.role !== 'ADMIN') throw Errors.validation({ accountManagerId: 'invalid_choice' });
  return { needsAssignment: true };
}

async function assignIfMissing(tx: Prisma.TransactionClient, userId: string, clientId: string) {
  const has = await tx.clientAssignment.findUnique({ where: { userId_clientId: { userId, clientId } }, select: { id: true } });
  if (!has) await tx.clientAssignment.create({ data: { userId, clientId } });
}

const writableClient = async (scope: Scope, id: string) => {
  const c = await findClient(scope, id);
  if (!canWriteClient(scope, c.id) || scope.role === 'CLIENT') throw Errors.forbidden();
  return c;
};

const startsOnboarding = (from: string | null, to: string | undefined) =>
  !!to && (to === 'ONBOARDING' || to === 'ACTIVE') && from !== to;

// ───────────────────────── list ─────────────────────────

clientsRouter.get(
  '/',
  requirePermOrClient('clients.view'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { scope, user } = ctx;
    const staff = user.role !== 'CLIENT';
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const status = qsEnum(req.query, 'status', CLIENT_STATUSES);
    const industry = qs(req.query, 'industry');
    // staff-only filters (a client user filtering on internal fields would be an oracle) are ignored for CLIENT
    const clientType = staff ? qsEnum(req.query, 'clientType', CLIENT_TYPES) : undefined;
    const accountManagerId = staff ? qs(req.query, 'accountManagerId') : undefined;
    const tag = staff ? qs(req.query, 'tag') : undefined;
    const where = and<Prisma.ClientWhereInput>(
      clientWhere(scope),
      status ? { status } : undefined,
      clientType ? { clientType } : undefined,
      accountManagerId ? { accountManagerId } : undefined,
      industry ? { industry: { contains: industry } } : undefined,
      tag ? { tags: { contains: JSON.stringify(tag) } } : undefined,
      q ? { OR: [{ name: { contains: q } }, { companyName: { contains: q } }, { email: { contains: q } }, { industry: { contains: q } }] } : undefined,
    );
    const [total, rows] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: { companyName: 'asc' },
        skip: p.skip,
        take: p.take,
        include: {
          _count: { select: { campaigns: true, users: true, requests: true } },
          ...(staff
            ? {
                accountManager: { select: { id: true, name: true } },
                contacts: { where: { isPrimary: true }, take: 1, select: { name: true, jobTitle: true } },
              }
            : {}),
        },
      }),
    ]);
    const items = rows.map((row) => {
      const { contacts, ...c } = row as typeof row & { contacts?: Array<{ name: string; jobTitle: string | null }> };
      return { ...present(ctx, c), ...(staff ? { primaryContact: contacts?.[0] ?? null } : {}) };
    });
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

// ───────────────────────── create ─────────────────────────

clientsRouter.post(
  '/',
  requirePerm('clients.create'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(clientBody, req.body);
    assertFieldPermissions(ctx.scope, body);
    const manager = body.accountManagerId ? await assertAccountManager(ctx, body.accountManagerId, null, true) : null;
    const status = body.status ?? 'ACTIVE';

    const client = await prisma.$transaction(async (tx) => {
      const data = toData(body) as Prisma.ClientUncheckedCreateInput;
      const created = await tx.client.create({ data: { ...data, name: body.name, companyName: body.companyName, email: body.email, status } });
      // a team member who creates a client must keep access to it
      if (ctx.user.role === 'TEAM') await assignIfMissing(tx, ctx.user.id, created.id);
      if (manager && body.accountManagerId && body.accountManagerId !== ctx.user.id) {
        const m = await tx.user.findUnique({ where: { id: body.accountManagerId }, select: { role: true } });
        if (m?.role === 'TEAM') await assignIfMissing(tx, body.accountManagerId, created.id);
      }
      if (startsOnboarding(null, status)) {
        await createDefaultChecklist(created.id, tx);
        return tx.client.update({ where: { id: created.id }, data: { onboardingStatus: 'IN_PROGRESS' } });
      }
      return created;
    });
    await audit(ctx, 'CLIENT_CREATED', 'client', client.id, { companyName: client.companyName, status: client.status }, { clientId: client.id });
    res.status(201).json({ item: present(ctx, client) });
  }),
);

// ───────────────────────── detail ─────────────────────────

clientsRouter.get(
  '/:id',
  requirePermOrClient('clients.view'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { scope, user } = ctx;
    const base = await findClient(scope, idParam(req));
    const id = base.id;
    const staff = user.role !== 'CLIENT';
    const perms = scope.permissions;
    const seesTasks = staff && perms.has('tasks.view');
    const seesInvoices = !staff || perms.has('invoices.view');
    const seesContracts = !staff || perms.has('contracts.view');
    const now = new Date();

    const [
      client, users, team, campaigns, deliverables, deliverablesPending, requests, openRequests, files, projects, openTasks, unpaidInvoices, nextContract, onboardingItems, primary,
    ] = await Promise.all([
      prisma.client.findUniqueOrThrow({ where: { id }, include: staff ? { accountManager: { select: { id: true, name: true } } } : undefined }),
      staff ? prisma.user.findMany({ where: { clientId: id, role: 'CLIENT' }, select: { id: true, name: true, email: true, status: true, lastLoginAt: true } }) : undefined,
      user.role === 'ADMIN' ? prisma.clientAssignment.findMany({ where: { clientId: id }, select: { user: { select: { id: true, name: true, email: true } } } }) : undefined,
      prisma.campaign.count({ where: and<Prisma.CampaignWhereInput>(campaignWhere(scope), { clientId: id }) }),
      prisma.deliverable.count({ where: and<Prisma.DeliverableWhereInput>(deliverableWhere(scope), { clientId: id }) }),
      prisma.deliverable.count({ where: and<Prisma.DeliverableWhereInput>(deliverableWhere(scope), { clientId: id, status: 'PENDING_APPROVAL' }) }),
      prisma.request.count({ where: and<Prisma.RequestWhereInput>(requestWhere(scope), { clientId: id }) }),
      prisma.request.count({ where: and<Prisma.RequestWhereInput>(requestWhere(scope), { clientId: id, status: { in: OPEN_REQUEST_STATUSES } }) }),
      prisma.file.count({ where: and<Prisma.FileWhereInput>(fileWhere(scope), { clientId: id }) }),
      prisma.project.count({ where: and<Prisma.ProjectWhereInput>(projectWhere(scope), { clientId: id }) }),
      seesTasks ? prisma.task.count({ where: and<Prisma.TaskWhereInput>(taskWhere(scope), { clientId: id, status: { in: ACTIVE_TASK_STATUSES } }) }) : Promise.resolve(null),
      seesInvoices ? prisma.invoice.count({ where: and<Prisma.InvoiceWhereInput>(invoiceWhere(scope), { clientId: id, status: { in: OUTSTANDING_INVOICE_STATUSES } }) }) : Promise.resolve(null),
      seesContracts
        ? prisma.contract.findFirst({
            where: and<Prisma.ContractWhereInput>(contractWhere(scope), { clientId: id, status: { in: ['ACTIVE', 'EXPIRING'] }, endDate: { not: null } }),
            orderBy: { endDate: 'asc' },
            select: { endDate: true },
          })
        : Promise.resolve(null),
      // the onboarding checklist is internal: staff only, and only for clients the caller is assigned to
      staff && (isAdmin(scope) || scope.fullClientIds.includes(id))
        ? prisma.onboardingItem.findMany({ where: { clientId: id }, select: { done: true, dueDate: true } })
        : Promise.resolve(null),
      staff ? prisma.clientContact.findFirst({ where: { clientId: id, isPrimary: true }, select: { id: true, name: true, jobTitle: true, email: true, phone: true } }) : Promise.resolve(null),
    ]);

    const summary = {
      projects,
      campaigns,
      deliverables,
      deliverablesPending,
      requests,
      openRequests,
      files,
      ...(openTasks !== null ? { openTasks } : {}),
      ...(unpaidInvoices !== null ? { unpaidInvoices } : {}),
      ...(seesContracts ? { contractEndsAt: nextContract?.endDate ?? null } : {}),
    };
    const dto = present(ctx, client);
    res.json({
      item: {
        ...dto,
        // kept for backwards compatibility with the phase 1 client detail page (now scoped to what the caller may see)
        _count: { campaigns, deliverables, requests, files },
        summary,
        ...(users ? { users } : {}),
        ...(team ? { team: team.map((a) => a.user) } : {}),
        ...(staff ? { primaryContact: primary, access: { fullAccess: isAdmin(scope) || scope.fullClientIds.includes(id) } } : {}),
        ...(onboardingItems ? { onboarding: progressOf(onboardingItems, now) } : {}),
      },
    });
  }),
);

// ───────────────────────── update / archive ─────────────────────────

clientsRouter.patch(
  '/:id',
  requirePerm('clients.edit'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await writableClient(ctx.scope, idParam(req));
    const body = parse(clientObject.partial().strict(), req.body);
    assertFieldPermissions(ctx.scope, body);

    const statusChanged = body.status !== undefined && body.status !== existing.status;
    // archiving (or restoring an archived client) needs its own permission
    if (statusChanged && (body.status === 'ARCHIVED' || existing.status === 'ARCHIVED') && !ctx.scope.permissions.has('clients.delete')) throw Errors.forbidden();
    const managerChanged = !!body.accountManagerId && body.accountManagerId !== existing.accountManagerId;
    if (managerChanged && body.accountManagerId) await assertAccountManager(ctx, body.accountManagerId, existing.id);
    const start = body.contractStart !== undefined ? body.contractStart : existing.contractStart;
    const end = body.contractEnd !== undefined ? body.contractEnd : existing.contractEnd;
    if (start && end && end < start) throw Errors.validation({ contractEnd: 'end_before_start' });

    const data = toData(body);
    const changes = Object.keys(body).filter((k) => k !== 'status');
    const client = await prisma.$transaction(async (tx) => {
      if (managerChanged && body.accountManagerId) {
        const m = await tx.user.findUnique({ where: { id: body.accountManagerId }, select: { role: true } });
        if (m?.role === 'TEAM') await assignIfMissing(tx, body.accountManagerId, existing.id);
      }
      // onboardingStatus is derived from the checklist once there is one
      const itemCount = await tx.onboardingItem.count({ where: { clientId: existing.id } });
      if (itemCount > 0) delete data.onboardingStatus;
      let updated = await tx.client.update({ where: { id: existing.id }, data });
      if (startsOnboarding(existing.status, body.status) && itemCount === 0) {
        await createDefaultChecklist(existing.id, tx);
        updated = await tx.client.update({ where: { id: existing.id }, data: { onboardingStatus: 'IN_PROGRESS' } });
      }
      return updated;
    });

    const meta = { companyName: client.companyName };
    if (statusChanged) {
      const code = body.status === 'ARCHIVED' ? 'CLIENT_ARCHIVED' : 'CLIENT_STATUS_CHANGED';
      await audit(ctx, code, 'client', client.id, { ...meta, from: existing.status, to: client.status }, { clientId: client.id });
    }
    if (changes.length || !statusChanged) {
      await audit(ctx, 'CLIENT_UPDATED', 'client', client.id, { ...meta, changes, status: client.status }, { clientId: client.id });
    }
    res.json({ item: present(ctx, client) });
  }),
);

/** "Delete" never removes a client that has history: it archives it (status ARCHIVED, everything is kept). */
clientsRouter.delete(
  '/:id',
  requirePerm('clients.delete'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await writableClient(ctx.scope, idParam(req));
    if (existing.status !== 'ARCHIVED') {
      await prisma.client.update({ where: { id: existing.id }, data: { status: 'ARCHIVED' } });
      await audit(ctx, 'CLIENT_ARCHIVED', 'client', existing.id, { companyName: existing.companyName, from: existing.status, to: 'ARCHIVED' }, { clientId: existing.id });
    }
    res.json({ ok: true });
  }),
);

// ───────────────────────── logo ─────────────────────────

const LOGO_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const LOGO_MAX = 2 * 1024 * 1024;

clientsRouter.post(
  '/:id/logo',
  requirePerm('clients.edit'),
  singleFile('file'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await writableClient(ctx.scope, idParam(req));
    if (!req.file) throw Errors.badRequest('FILE_REQUIRED', 'Please choose a file.');
    const v = validateUpload(req.file, LOGO_MAX);
    if (!LOGO_EXT.includes(v.ext) || !ALLOWED_UPLOADS[v.ext]?.[0].startsWith('image/')) {
      throw new ApiError(400, 'FILE_TYPE_NOT_ALLOWED', 'The logo must be an image.');
    }
    await storage.put(v.storageKey, req.file.buffer, { contentType: v.mime });
    const old = existing.logo;
    await prisma.client.update({ where: { id: existing.id }, data: { logo: v.storageKey } });
    if (old) await storage.delete(old).catch(() => undefined);
    await audit(ctx, 'CLIENT_UPDATED', 'client', existing.id, { changes: ['logo'], file: sanitizeFileName(req.file.originalname), companyName: existing.companyName }, { clientId: existing.id });
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
