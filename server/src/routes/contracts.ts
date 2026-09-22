// Owner: Finance group.  contractsRouter -> /contracts
// Contracts are agency documents. STAFF need contracts.view / contracts.manage; a CLIENT user only ever sees the rows that
// were explicitly shared with them (visibleToClient) and are not drafts - contractWhere(scope) enforces that in the query,
// and the whitelist DTO (services/finance.ts) removes every internal field (notes ...).
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CONTRACT_STATUSES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm, requirePermOrClient } from '../authz/permissions';
import { contractWhere, fileWhere } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { isDateOnly, parseDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { audit } from '../services/audit';
import {
  addDays, contractDtoFor, contractInclude, createWithNumber, parseSort, removeAttachedFiles, round2, syncFileVisibility, todayUtc,
} from '../services/finance';
import { and, fileSelect } from '../services/serializers';

export const contractsRouter = Router();
contractsRouter.use(authenticate);

const dateStr = z.string().refine(isDateOnly, { message: 'invalid_date' }).transform(parseDateOnly);
const money = z.number().min(0).max(1_000_000_000);

const createSchema = z
  .object({
    clientId: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    startDate: dateStr.nullish(),
    endDate: dateStr.nullish(),
    renewalDate: dateStr.nullish(),
    value: money.default(0),
    status: z.enum(CONTRACT_STATUSES).default('DRAFT'),
    notes: z.string().trim().max(4000).nullish(),
    visibleToClient: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) c.addIssue({ code: 'custom', path: ['endDate'], message: 'end_before_start' });
  });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    startDate: dateStr.nullable(),
    endDate: dateStr.nullable(),
    renewalDate: dateStr.nullable(),
    value: money,
    status: z.enum(CONTRACT_STATUSES),
    notes: z.string().trim().max(4000).nullable(),
    visibleToClient: z.boolean(),
  })
  .partial()
  .strict();

const SORTS = ['createdAt', 'endDate', 'startDate', 'value', 'name', 'contractNumber'] as const;

/** Audit rows that may reach the client's timeline only describe shared, non-draft contracts and carry no internal text. */
async function auditContract(
  ctx: Ctx, action: 'CONTRACT_CREATED' | 'CONTRACT_UPDATED' | 'CONTRACT_STATUS_CHANGED' | 'CONTRACT_DELETED',
  c: { id: string; clientId: string; contractNumber: string; name: string; visibleToClient: boolean; status: string },
  extra: Record<string, unknown> = {},
) {
  const clientVisible = c.visibleToClient && c.status !== 'DRAFT';
  await audit(ctx, action, 'contract', c.id, { number: c.contractNumber, ...(clientVisible ? {} : { name: c.name }), ...extra }, { clientId: c.clientId, clientVisible });
}

contractsRouter.get(
  '/',
  requirePermOrClient('contracts.view'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const p = paging(req.query, 20);
    const q = qs(req.query, 'q');
    const clientId = qs(req.query, 'clientId');
    const status = qsEnum(req.query, 'status', CONTRACT_STATUSES);
    const within = parseInt(qs(req.query, 'expiringWithinDays') ?? '', 10);
    const sort = parseSort(qs(req.query, 'sort'), SORTS, { key: 'createdAt', dir: 'desc' });
    const today = todayUtc();
    const where = and<Prisma.ContractWhereInput>(
      contractWhere(scope),
      clientId ? { clientId } : undefined,
      status ? { status } : undefined,
      q ? { OR: [{ name: { contains: q } }, { contractNumber: { contains: q } }] } : undefined,
      Number.isFinite(within) && within > 0
        ? { status: { in: ['ACTIVE', 'EXPIRING'] }, endDate: { gte: today, lte: addDays(today, Math.min(within, 730)) } }
        : undefined,
    );
    const [total, rows] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.findMany({
        where,
        orderBy: [{ [sort.key]: sort.dir }, { id: 'asc' }],
        skip: p.skip,
        take: p.take,
        include: contractInclude,
      }),
    ]);
    res.json({ items: rows.map((c) => contractDtoFor(user.role, c)), meta: pageMeta(p, total) });
  }),
);

contractsRouter.post(
  '/',
  requirePerm('contracts.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    // the caller must be allowed to write to this client (ADMIN, or a TEAM member assigned to the whole client)
    const client = await prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true } });
    if (!client || (ctx.user.role !== 'ADMIN' && !ctx.scope.fullClientIds.includes(body.clientId))) throw Errors.validation({ clientId: 'invalid_choice' });

    const created = await createWithNumber('contract', (contractNumber) =>
      prisma.contract.create({
        data: {
          clientId: body.clientId,
          name: body.name,
          contractNumber,
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          renewalDate: body.renewalDate ?? null,
          value: round2(body.value),
          status: body.status,
          notes: body.notes || null,
          visibleToClient: body.visibleToClient,
          createdById: ctx.user.id,
        },
        include: contractInclude,
      }),
    );
    await auditContract(ctx, 'CONTRACT_CREATED', created, { status: created.status });
    res.status(201).json({ item: contractDtoFor(ctx.user.role, created) });
  }),
);

contractsRouter.get(
  '/:id',
  requirePermOrClient('contracts.view'),
  asyncHandler(async (req, res) => {
    const { scope, user } = ctxOf(req);
    const c = await prisma.contract.findFirst({ where: and<Prisma.ContractWhereInput>({ id: idParam(req) }, contractWhere(scope)), include: contractInclude });
    if (!c) throw Errors.notFound();
    // attachments come through the normal files rules (fileWhere hides unshared ones from clients)
    const files = await prisma.file.findMany({
      where: and<Prisma.FileWhereInput>(fileWhere(scope), { contractId: c.id }),
      orderBy: { createdAt: 'desc' },
      select: fileSelect,
    });
    res.json({ item: { ...contractDtoFor(user.role, c), files } });
  }),
);

contractsRouter.patch(
  '/:id',
  requirePerm('contracts.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.contract.findFirst({ where: and<Prisma.ContractWhereInput>({ id: idParam(req) }, contractWhere(ctx.scope)) });
    if (!existing) throw Errors.notFound();
    const body = parse(updateSchema, req.body);

    const start = body.startDate !== undefined ? body.startDate : existing.startDate;
    const end = body.endDate !== undefined ? body.endDate : existing.endDate;
    if (start && end && end < start) throw Errors.validation({ endDate: 'end_before_start' });

    const data: Prisma.ContractUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.startDate !== undefined) data.startDate = body.startDate;
    if (body.endDate !== undefined) data.endDate = body.endDate;
    if (body.renewalDate !== undefined) data.renewalDate = body.renewalDate;
    if (body.value !== undefined) data.value = round2(body.value);
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.visibleToClient !== undefined) data.visibleToClient = body.visibleToClient;

    // Renewal convenience: moving the end date of an expiring / expired contract far into the future re-activates it
    // (only when the caller did not choose a status explicitly).
    let nextStatus = body.status ?? existing.status;
    let autoStatus = false;
    if (body.status === undefined && body.endDate !== undefined && body.endDate && (existing.status === 'EXPIRING' || existing.status === 'EXPIRED')) {
      const today = todayUtc();
      if (body.endDate > addDays(today, 30)) nextStatus = 'ACTIVE';
      else if (body.endDate >= today) nextStatus = 'EXPIRING';
      autoStatus = nextStatus !== existing.status;
    }
    if (nextStatus !== existing.status) data.status = nextStatus;

    const updated = await prisma.contract.update({ where: { id: existing.id }, data, include: contractInclude });
    if (body.visibleToClient !== undefined && body.visibleToClient !== existing.visibleToClient) {
      await syncFileVisibility({ contractId: existing.id }, body.visibleToClient);
    }
    const fields = Object.keys(data).filter((k) => k !== 'status');
    if (fields.length) await auditContract(ctx, 'CONTRACT_UPDATED', updated, { fields });
    if (nextStatus !== existing.status) await auditContract(ctx, 'CONTRACT_STATUS_CHANGED', updated, { from: existing.status, to: nextStatus, ...(autoStatus ? { auto: true } : {}) });
    res.json({ item: contractDtoFor(ctx.user.role, updated) });
  }),
);

// Only drafts can be deleted; everything else is ended by setting the status to TERMINATED (kept for the records).
contractsRouter.delete(
  '/:id',
  requirePerm('contracts.manage'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const existing = await prisma.contract.findFirst({ where: and<Prisma.ContractWhereInput>({ id: idParam(req) }, contractWhere(ctx.scope)) });
    if (!existing) throw Errors.notFound();
    if (existing.status !== 'DRAFT') throw Errors.conflict('ONLY_DRAFT_DELETABLE', 'Only draft items can be deleted. Terminate the contract instead.');
    const removed = await removeAttachedFiles({ contractId: existing.id });
    await prisma.contract.delete({ where: { id: existing.id } });
    await auditContract(ctx, 'CONTRACT_DELETED', existing, { removedFiles: removed });
    res.json({ ok: true });
  }),
);
