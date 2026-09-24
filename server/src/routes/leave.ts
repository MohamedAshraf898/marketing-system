// Owner: Attendance group.  leaveRouter -> /leave
//
// Everybody who tracks attendance can request leave for THEMSELVES (the requester always comes from the session).
// `leave.approve` (ADMIN always) decides requests; a non-admin approver can never decide their own request.
// Approval marks the covered working days ON_LEAVE in attendance; cancelling an approved leave removes those marks.
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { LEAVE_STATUSES, LEAVE_TYPES } from '../../../shared/src/enums';
import { authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { prisma } from '../db';
import { ctxOf, type Ctx } from '../lib/context';
import { isDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { addDaysKey, dateOnly, eachDayKey, keyOf } from '../lib/zoned';
import { applyLeave, loadSchedules, scheduleOf, todayKeyFor, unapplyLeave, workingDaysBetween } from '../services/attendance';
import { audit } from '../services/audit';
import { notify, permissionRecipients } from '../services/notifications';

export const leaveRouter = Router();
leaveRouter.use(authenticate);

const MAX_LEAVE_DAYS = 90;
const MAX_BACKDATE_DAYS = 30;

const dateKey = z.string().refine(isDateOnly, { message: 'invalid_date' });
const createSchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    startDate: dateKey,
    endDate: dateKey,
    reason: z.string().trim().max(1000).transform((v) => (v === '' ? null : v)).nullish(),
  })
  .strict();
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

const include = {
  user: { select: { id: true, name: true, avatar: true, jobTitle: true } },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.LeaveRequestInclude;
type Row = Prisma.LeaveRequestGetPayload<{ include: typeof include }>;

const canApprove = (ctx: Ctx) => ctx.scope.permissions.has('leave.approve');
const canSeeAll = (ctx: Ctx) => canApprove(ctx) || ctx.scope.permissions.has('attendance.view_all');

function dto(r: Row, ctx: Ctx) {
  const own = r.userId === ctx.user.id;
  return {
    id: r.id, userId: r.userId, user: r.user, type: r.type, status: r.status,
    startDate: keyOf(r.startDate), endDate: keyOf(r.endDate), days: r.days, reason: r.reason,
    reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, rejectionReason: r.rejectionReason, createdAt: r.createdAt,
    permissions: {
      canDecide: r.status === 'PENDING' && canApprove(ctx) && (!own || ctx.user.role === 'ADMIN'),
      canCancel: (r.status === 'PENDING' || r.status === 'APPROVED') && (own || canApprove(ctx)),
    },
  };
}

/** Own request, or anybody's for approvers / attendance.view_all. Everything else is a 404. */
async function findLeave(ctx: Ctx, id: string) {
  const r = await prisma.leaveRequest.findUnique({ where: { id }, include });
  if (!r || (r.userId !== ctx.user.id && !canSeeAll(ctx))) throw Errors.notFound();
  return r;
}

leaveRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    if (!ctx.scope.permissions.has('attendance.track') && !canSeeAll(ctx)) throw Errors.forbidden();
    const p = paging(req.query, 20);
    const status = qsEnum(req.query, 'status', LEAVE_STATUSES);
    const wanted = qs(req.query, 'userId');
    const mine = qs(req.query, 'mine') === '1' || !canSeeAll(ctx);
    const from = qs(req.query, 'from');
    const to = qs(req.query, 'to');
    if (from && !isDateOnly(from)) throw Errors.validation({ from: 'invalid_date' });
    if (to && !isDateOnly(to)) throw Errors.validation({ to: 'invalid_date' });
    const where: Prisma.LeaveRequestWhereInput = {
      ...(mine ? { userId: ctx.user.id } : wanted ? { userId: wanted } : {}),
      ...(status ? { status } : {}),
      ...(from ? { endDate: { gte: dateOnly(from) } } : {}),
      ...(to ? { startDate: { lte: dateOnly(to) } } : {}),
    };
    const [total, rows, pending] = await Promise.all([
      prisma.leaveRequest.count({ where }),
      prisma.leaveRequest.findMany({ where, include, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], skip: p.skip, take: p.take }),
      canApprove(ctx) ? prisma.leaveRequest.count({ where: { status: 'PENDING' } }) : Promise.resolve(null),
    ]);
    res.json({ items: rows.map((r) => dto(r, ctx)), meta: pageMeta(p, total), pendingCount: pending });
  }),
);

leaveRouter.post(
  '/',
  requirePerm('attendance.track'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    if (body.endDate < body.startDate) throw Errors.validation({ endDate: 'end_before_start' });
    if (eachDayKey(body.startDate, body.endDate, MAX_LEAVE_DAYS + 1).length > MAX_LEAVE_DAYS) throw Errors.validation({ endDate: 'too_big' });
    const book = await loadSchedules();
    const me = await prisma.user.findUnique({ where: { id: ctx.user.id }, select: { workScheduleId: true } });
    const s = scheduleOf(book, me?.workScheduleId);
    if (body.startDate < addDaysKey(todayKeyFor(s), -MAX_BACKDATE_DAYS)) throw Errors.validation({ startDate: 'invalid_date' });
    const overlap = await prisma.leaveRequest.findFirst({
      where: { userId: ctx.user.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: dateOnly(body.endDate) }, endDate: { gte: dateOnly(body.startDate) } },
      select: { id: true },
    });
    if (overlap) throw Errors.conflict('LEAVE_OVERLAP', 'You already have a leave request for these dates.');
    const days = (await workingDaysBetween(s, body.startDate, body.endDate)).length;
    if (days === 0) throw Errors.validation({ endDate: 'no_working_days' });

    const row = await prisma.leaveRequest.create({
      data: { userId: ctx.user.id, type: body.type, startDate: dateOnly(body.startDate), endDate: dateOnly(body.endDate), days, reason: body.reason ?? null },
      include,
    });
    await audit(ctx, 'LEAVE_REQUESTED', 'leave', row.id, { type: row.type, from: body.startDate, to: body.endDate, days });
    await notify(await permissionRecipients('leave.approve'), { type: 'LEAVE_REQUESTED', entity: 'leave', entityId: row.id, data: { by: ctx.user.name, from: body.startDate, to: body.endDate, days } }, ctx.user.id);
    res.status(201).json({ item: dto(row, ctx) });
  }),
);

leaveRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    res.json({ item: dto(await findLeave(ctx, idParam(req)), ctx) });
  }),
);

/** Approve: marks the working days ON_LEAVE (atomically with the status change). */
leaveRouter.post(
  '/:id/approve',
  requirePerm('leave.approve'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    parse(z.object({}).strict(), req.body);
    const r = await findLeave(ctx, idParam(req));
    if (r.userId === ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden();
    if (r.status !== 'PENDING') throw Errors.conflict('INVALID_STATE', 'Only pending requests can be decided.');
    const book = await loadSchedules();
    const owner = await prisma.user.findUnique({ where: { id: r.userId }, select: { workScheduleId: true } });
    const now = new Date();
    const marked = await prisma.$transaction(async (tx) => {
      const flipped = await tx.leaveRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: ctx.user.id, reviewedAt: now, rejectionReason: null } });
      if (flipped.count === 0) throw Errors.conflict('INVALID_STATE', 'Only pending requests can be decided.');
      return applyLeave(tx, r, scheduleOf(book, owner?.workScheduleId));
    });
    await audit(ctx, 'LEAVE_APPROVED', 'leave', r.id, { userId: r.userId, userName: r.user.name, type: r.type, from: keyOf(r.startDate), to: keyOf(r.endDate), daysMarked: marked, changes: { status: { from: 'PENDING', to: 'APPROVED' } } });
    await notify([r.userId], { type: 'LEAVE_APPROVED', entity: 'leave', entityId: r.id, data: { from: keyOf(r.startDate), to: keyOf(r.endDate), by: ctx.user.name } }, ctx.user.id);
    res.json({ item: dto(await findLeave(ctx, r.id), ctx) });
  }),
);

leaveRouter.post(
  '/:id/reject',
  requirePerm('leave.approve'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(rejectSchema, req.body);
    const r = await findLeave(ctx, idParam(req));
    if (r.userId === ctx.user.id && ctx.user.role !== 'ADMIN') throw Errors.forbidden();
    const flipped = await prisma.leaveRequest.updateMany({
      where: { id: r.id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: ctx.user.id, reviewedAt: new Date(), rejectionReason: body.reason },
    });
    if (flipped.count === 0) throw Errors.conflict('INVALID_STATE', 'Only pending requests can be decided.');
    await audit(ctx, 'LEAVE_REJECTED', 'leave', r.id, { userId: r.userId, userName: r.user.name, type: r.type, reason: body.reason, changes: { status: { from: 'PENDING', to: 'REJECTED' } } });
    await notify([r.userId], { type: 'LEAVE_REJECTED', entity: 'leave', entityId: r.id, data: { from: keyOf(r.startDate), to: keyOf(r.endDate), by: ctx.user.name, reason: body.reason } }, ctx.user.id);
    res.json({ item: dto(await findLeave(ctx, r.id), ctx) });
  }),
);

/** The requester (or an approver) withdraws a pending or approved leave; approved days go back to normal. */
leaveRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    parse(z.object({}).strict(), req.body);
    const r = await findLeave(ctx, idParam(req));
    if (r.userId !== ctx.user.id && !canApprove(ctx)) throw Errors.forbidden();
    if (r.status !== 'PENDING' && r.status !== 'APPROVED') throw Errors.conflict('INVALID_STATE', 'This request can no longer be cancelled.');
    await prisma.$transaction(async (tx) => {
      const flipped = await tx.leaveRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'CANCELLED' } });
      if (flipped.count === 0) throw Errors.conflict('INVALID_STATE', 'This request can no longer be cancelled.');
      if (r.status === 'APPROVED') await unapplyLeave(tx, r.id);
    });
    await audit(ctx, 'LEAVE_CANCELLED', 'leave', r.id, { userId: r.userId, userName: r.user.name, type: r.type, changes: { status: { from: r.status, to: 'CANCELLED' } } });
    res.json({ item: dto(await findLeave(ctx, r.id), ctx) });
  }),
);
