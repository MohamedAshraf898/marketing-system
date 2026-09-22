// Owner: Finance group.  invoicesRouter -> /invoices
// INTERNAL agency invoicing only: no online payments, no payment links, no subscriptions. "Mark as paid" is a manual
// status change. STAFF need invoices.view / invoices.manage; a CLIENT user only sees their own shared, non-draft invoices
// (invoiceWhere(scope)) through the whitelist DTO in services/finance.ts (no notes, no creator).
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { INVOICE_STATUSES, OUTSTANDING_INVOICE_STATUSES, type InvoiceStatus } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm, requirePermOrClient } from '../authz/permissions';
import { fileWhere, invoiceWhere, projectWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { audit } from '../services/audit';
import {
  createWithNumber, invoiceDtoFor, invoiceInclude, notifyDedup, parseSort, removeAttachedFiles, round2, syncFileVisibility, todayUtc,
} from '../services/finance';
import { clientRecipients } from '../services/notifications';
import { and, fileSelect } from '../services/serializers';

export const invoicesRouter = Router();
invoicesRouter.use(authenticate);

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);
const money = z.number().min(0).max(1_000_000_000);
// A client-sent `total` is accepted (so old forms do not break) and IGNORED: the server always computes it.
const ignoredTotal = z.unknown().optional();

const createSchema = z
  .object({
    clientId: z.string().min(1),
    projectId: z.string().min(1).nullish(),
    issueDate: dateStr,
    dueDate: dateStr,
    amount: money,
    tax: money.default(0),
    total: ignoredTotal,
    status: z.enum(INVOICE_STATUSES).default('DRAFT'),
    paidAt: dateStr.nullish(),
    description: z.string().trim().max(2000).nullish(),
    notes: z.string().trim().max(4000).nullish(),
    visibleToClient: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (v.dueDate < v.issueDate) c.addIssue({ code: 'custom', path: ['dueDate'], message: 'due_before_issue' });
  });

const updateSchema = z
  .object({
    projectId: z.string().min(1).nullable(),
    issueDate: dateStr,
    dueDate: dateStr,
    amount: money,
    tax: money,
    total: ignoredTotal,
    status: z.enum(INVOICE_STATUSES),
    paidAt: dateStr.nullable(),
    description: z.string().trim().max(2000).nullable(),
    notes: z.string().trim().max(4000).nullable(),
    visibleToClient: z.boolean(),
  })
  .partial()
  .strict();

const SORTS = ['createdAt', 'issueDate', 'dueDate', 'total', 'invoiceNumber'] as const;
const LOCKED: InvoiceStatus[] = ['PAID', 'CANCELLED'];

/** The project (if any) must be in the caller's scope AND belong to the same client as the invoice. */
async function assertProject(scope: Scope, projectId: string | null | undefined, clientId: string) {
  if (!projectId) return;
  const p = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: projectId }, projectWhere(scope)), select: { clientId: true } });
  if (!p || p.clientId !== clientId) throw Errors.validation({ projectId: 'invalid_choice' });
}

const assertPaidAtNotFuture = (d: Date) => {
  if (d > todayUtc()) throw Errors.validation({ paidAt: 'date_in_future' });
};

/** Audit rows that may reach the client's timeline only describe shared, non-draft invoices and carry no internal text. */
async function auditInvoice(
  ctx: Ctx, action: 'INVOICE_CREATED' | 'INVOICE_UPDATED' | 'INVOICE_STATUS_CHANGED' | 'INVOICE_DELETED',
  i: { id: string; clientId: string; projectId: string | null; invoiceNumber: string; visibleToClient: boolean; status: string },
  extra: Record<string, unknown> = {},
) {
  const clientVisible = i.visibleToClient && i.status !== 'DRAFT';
  await audit(ctx, action, 'invoice', i.id, { number: i.invoiceNumber, ...extra }, { clientId: i.clientId, projectId: i.projectId, clientVisible });
}

async function notifySent(ctx: Ctx, i: { id: string; clientId: string; invoiceNumber: string }) {
  const recipients = await clientRecipients(i.clientId);
  await notifyDedup(recipients, { type: 'INVOICE_SENT', entity: 'invoice', entityId: i.id, data: { number: i.invoiceNumber } }, ctx.user.id);
}

// ───────────────────────── list + summary ─────────────────────────

/** Filters shared by the list and the summary. */
function listFilters(scope: Scope, query: Record<string, unknown>) {
  const q = query as Parameters<typeof qs>[0];
  const clientId = qs(q, 'clientId');
  const projectId = qs(q, 'projectId');
  const status = qsEnum(q, 'status', INVOICE_STATUSES);
  const text = qs(q, 'q');
  const from = qs(q, 'from');
  const to = qs(q, 'to');
  const today = todayUtc();
  const overdue: Prisma.InvoiceWhereInput | undefined =
    qs(q, 'overdue') === '1'
      ? { OR: [{ status: 'OVERDUE' }, { status: { in: ['SENT', 'PENDING'] }, dueDate: { lt: today } }] }
      : undefined;
  return and<Prisma.InvoiceWhereInput>(
    invoiceWhere(scope),
    clientId ? { clientId } : undefined,
    projectId ? { projectId } : undefined,
    status ? { status } : undefined,
    overdue,
    from && isDateOnly(from) ? { issueDate: { gte: parseDateOnly(from) } } : undefined,
    to && isDateOnly(to) ? { issueDate: { lte: endOfDayUtc(to) } } : undefined,
    text ? { OR: [{ invoiceNumber: { contains: text } }, { description: { contains: text } }] } : undefined,
  );
}

invoicesRouter.get(
  '/',
  requirePermOrClient('invoices.view'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const p = paging(req.query, 20);
    const where = listFilters(scope, req.query);
    const sort = parseSort(qs(req.query, 'sort'), SORTS, { key: 'issueDate', dir: 'desc' });
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({ where, orderBy: [{ [sort.key]: sort.dir }, { id: 'asc' }], skip: p.skip, take: p.take, include: invoiceInclude }),
    ]);
    res.json({ items: rows.map((i) => invoiceDtoFor(user.role, i)), meta: pageMeta(p, total) });
  }),
);

/**
 * Totals for dashboards (single currency). Scoped exactly like the list. "overdue" counts invoices already flagged OVERDUE
 * plus SENT / PENDING ones whose due date has passed (the maintenance job flips them within hours).
 */
invoicesRouter.get(
  '/summary',
  requirePermOrClient('invoices.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const clientId = qs(req.query, 'clientId');
    const base = and<Prisma.InvoiceWhereInput>(invoiceWhere(scope), clientId ? { clientId } : undefined);
    const today = todayUtc();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const [groups, lateUnflagged, paidMonth] = await Promise.all([
      prisma.invoice.groupBy({ by: ['status'], where: base, _count: { _all: true }, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: and<Prisma.InvoiceWhereInput>(base, { status: { in: ['SENT', 'PENDING'] }, dueDate: { lt: today } }), _count: { _all: true }, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: and<Prisma.InvoiceWhereInput>(base, { status: 'PAID', paidAt: { gte: monthStart } }), _count: { _all: true }, _sum: { total: true } }),
    ]);
    const byStatus = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, { count: 0, total: 0 }])) as Record<InvoiceStatus, { count: number; total: number }>;
    for (const g of groups) byStatus[g.status as InvoiceStatus] = { count: g._count._all, total: round2(g._sum.total ?? 0) };
    const sum = (list: InvoiceStatus[]) => ({
      count: list.reduce((n, s) => n + byStatus[s].count, 0),
      total: round2(list.reduce((n, s) => n + byStatus[s].total, 0)),
    });
    res.json({
      item: {
        byStatus,
        outstanding: sum(OUTSTANDING_INVOICE_STATUSES),
        overdue: {
          count: byStatus.OVERDUE.count + lateUnflagged._count._all,
          total: round2(byStatus.OVERDUE.total + (lateUnflagged._sum.total ?? 0)),
        },
        paidThisMonth: { count: paidMonth._count._all, total: round2(paidMonth._sum.total ?? 0) },
        paid: sum(['PAID']),
      },
    });
  }),
);

// ───────────────────────── create ─────────────────────────

invoicesRouter.post(
  '/',
  requirePerm('invoices.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    const client = await prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true } });
    if (!client || (ctx.user.role !== 'ADMIN' && !ctx.scope.fullClientIds.includes(body.clientId))) throw Errors.validation({ clientId: 'invalid_choice' });
    await assertProject(ctx.scope, body.projectId, body.clientId);
    if (body.paidAt && body.status !== 'PAID') throw Errors.validation({ paidAt: 'not_allowed' });
    if (body.paidAt) assertPaidAtNotFuture(body.paidAt);

    const amount = round2(body.amount);
    const tax = round2(body.tax);
    const created = await createWithNumber('invoice', (invoiceNumber) =>
      prisma.invoice.create({
        data: {
          clientId: body.clientId,
          projectId: body.projectId ?? null,
          invoiceNumber,
          issueDate: body.issueDate,
          dueDate: body.dueDate,
          amount,
          tax,
          total: round2(amount + tax), // ALWAYS computed here
          status: body.status,
          paidAt: body.status === 'PAID' ? (body.paidAt ?? new Date()) : null,
          description: body.description || null,
          notes: body.notes || null,
          visibleToClient: body.visibleToClient,
          createdById: ctx.user.id,
        },
        include: invoiceInclude,
      }),
    );
    await auditInvoice(ctx, 'INVOICE_CREATED', created, { status: created.status });
    if (created.status === 'SENT' && created.visibleToClient) await notifySent(ctx, created);
    res.status(201).json({ item: invoiceDtoFor(ctx.user.role, created) });
  }),
);

// ───────────────────────── read ─────────────────────────

invoicesRouter.get(
  '/:id',
  requirePermOrClient('invoices.view'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const i = await prisma.invoice.findFirst({ where: and<Prisma.InvoiceWhereInput>({ id: idParam(req) }, invoiceWhere(scope)), include: invoiceInclude });
    if (!i) throw Errors.notFound();
    const files = await prisma.file.findMany({
      where: and<Prisma.FileWhereInput>(fileWhere(scope), { invoiceId: i.id }),
      orderBy: { createdAt: 'desc' },
      select: fileSelect,
    });
    res.json({ item: { ...invoiceDtoFor(user.role, i), files } });
  }),
);

// ───────────────────────── update ─────────────────────────

/**
 * Immutability rule: a PAID or CANCELLED invoice is a closed financial record. Its fields can no longer be edited by
 * anybody, and the ONLY allowed change is a status reversal (e.g. PAID -> SENT, CANCELLED -> DRAFT) performed by an ADMIN.
 * Leaving PAID clears paidAt; entering PAID sets it (server time, or an explicit date that is not in the future).
 */
invoicesRouter.patch(
  '/:id',
  requirePerm('invoices.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.invoice.findFirst({ where: and<Prisma.InvoiceWhereInput>({ id: idParam(req) }, invoiceWhere(ctx.scope)) });
    if (!existing) throw Errors.notFound();
    const { total: _ignored, ...body } = parse(updateSchema, req.body);
    void _ignored;

    const keys = Object.keys(body);
    if (LOCKED.includes(existing.status as InvoiceStatus) && keys.length > 0) {
      const onlyStatus = keys.every((k) => k === 'status' || k === 'paidAt');
      if (!(ctx.user.role === 'ADMIN' && onlyStatus)) throw Errors.conflict('INVOICE_LOCKED', 'Paid and cancelled invoices cannot be edited. An administrator can reverse the status.');
    }

    const nextStatus = (body.status ?? existing.status) as InvoiceStatus;
    const amount = round2(body.amount ?? existing.amount);
    const tax = round2(body.tax ?? existing.tax);
    const issueDate = body.issueDate ?? existing.issueDate;
    const dueDate = body.dueDate ?? existing.dueDate;
    if (dueDate < issueDate) throw Errors.validation({ dueDate: 'due_before_issue' });
    if (body.projectId !== undefined) await assertProject(ctx.scope, body.projectId, existing.clientId);
    if (body.paidAt !== undefined && nextStatus !== 'PAID') throw Errors.validation({ paidAt: 'not_allowed' });
    if (body.paidAt) assertPaidAtNotFuture(body.paidAt);

    const data: Prisma.InvoiceUncheckedUpdateInput = {};
    if (body.projectId !== undefined) data.projectId = body.projectId;
    if (body.issueDate !== undefined) data.issueDate = body.issueDate;
    if (body.dueDate !== undefined) data.dueDate = body.dueDate;
    if (body.amount !== undefined) data.amount = amount;
    if (body.tax !== undefined) data.tax = tax;
    if (body.amount !== undefined || body.tax !== undefined) data.total = round2(amount + tax); // ALWAYS computed here
    if (body.description !== undefined) data.description = body.description || null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.visibleToClient !== undefined) data.visibleToClient = body.visibleToClient;
    if (nextStatus !== existing.status) data.status = nextStatus;
    if (nextStatus === 'PAID' && (existing.status !== 'PAID' || body.paidAt)) data.paidAt = body.paidAt ?? new Date();
    else if (nextStatus !== 'PAID' && existing.status === 'PAID') data.paidAt = null;

    const updated = await prisma.invoice.update({ where: { id: existing.id }, data, include: invoiceInclude });
    if (body.visibleToClient !== undefined && body.visibleToClient !== existing.visibleToClient) {
      await syncFileVisibility({ invoiceId: existing.id }, body.visibleToClient);
    }

    const fields = Object.keys(data).filter((k) => k !== 'status' && k !== 'paidAt' && k !== 'total');
    const shared = updated.visibleToClient && updated.status !== 'DRAFT';
    if (fields.length) await auditInvoice(ctx, 'INVOICE_UPDATED', updated, { fields: shared ? fields.filter((f) => f !== 'notes' && f !== 'visibleToClient') : fields });
    if (nextStatus !== existing.status) await auditInvoice(ctx, 'INVOICE_STATUS_CHANGED', updated, { from: existing.status, to: nextStatus });

    // sending an invoice (or sharing an already sent one) tells the client's users
    const becameSent = updated.status === 'SENT' && existing.status !== 'SENT';
    const becameShared = updated.status === 'SENT' && updated.visibleToClient && !existing.visibleToClient;
    if (updated.visibleToClient && (becameSent || becameShared)) await notifySent(ctx, updated);

    res.json({ item: invoiceDtoFor(ctx.user.role, updated) });
  }),
);

// Only drafts can be deleted; anything that was sent is cancelled instead (kept for the records).
invoicesRouter.delete(
  '/:id',
  requirePerm('invoices.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.invoice.findFirst({ where: and<Prisma.InvoiceWhereInput>({ id: idParam(req) }, invoiceWhere(ctx.scope)) });
    if (!existing) throw Errors.notFound();
    if (existing.status !== 'DRAFT') throw Errors.conflict('ONLY_DRAFT_DELETABLE', 'Only draft items can be deleted. Cancel the invoice instead.');
    const removed = await removeAttachedFiles({ invoiceId: existing.id });
    await prisma.invoice.delete({ where: { id: existing.id } });
    await auditInvoice(ctx, 'INVOICE_DELETED', existing, { removedFiles: removed });
    res.json({ ok: true });
  }),
);
