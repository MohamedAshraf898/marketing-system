import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { LOCALES, ROLES, USER_STATUSES } from '../../../shared/src/enums';
import { hashPassword, passwordProblem } from '../auth/password';
import { adminOnly, authenticate, staffOnly } from '../auth/middleware';
import { deleteUserSessions } from '../auth/sessions';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, pageMeta, paging, parse, qs, qsEnum } from '../lib/http';
import { audit } from '../services/audit';
import { and } from '../services/serializers';

export const usersRouter = Router();
export const teamMembersRouter = Router();

const userSelect = {
  id: true, name: true, email: true, role: true, clientId: true, avatar: true, locale: true, status: true,
  lastLoginAt: true, createdAt: true, updatedAt: true,
  client: { select: { id: true, companyName: true } },
} satisfies Prisma.UserSelect;

const passwordField = z.string().superRefine((v, c) => {
  const p = passwordProblem(v);
  if (p) c.addIssue({ code: 'custom', message: p });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: passwordField,
  role: z.enum(ROLES),
  clientId: z.string().nullish(),
  locale: z.enum(LOCALES).optional(),
  clientIds: z.array(z.string()).max(500).optional(),
  campaignIds: z.array(z.string()).max(1000).optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(200),
    password: passwordField,
    role: z.enum(ROLES),
    clientId: z.string().nullable(),
    status: z.enum(USER_STATUSES),
    locale: z.enum(LOCALES),
  })
  .partial()
  .strict();

/** A CLIENT user belongs to exactly one client; ADMIN/TEAM never do. */
async function assertRoleClientRule(role: string, clientId: string | null | undefined) {
  if (role === 'CLIENT') {
    if (!clientId) throw Errors.validation({ clientId: 'required' });
    const c = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!c) throw Errors.validation({ clientId: 'invalid_choice' });
  } else if (clientId) {
    throw Errors.validation({ clientId: 'not_allowed' });
  }
}

async function setAssignments(userId: string, clientIds: string[], campaignIds: string[]) {
  const [clients, campaigns] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true } }),
    prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true } }),
  ]);
  if (clients.length !== new Set(clientIds).size) throw Errors.validation({ clientIds: 'invalid_choice' });
  if (campaigns.length !== new Set(campaignIds).size) throw Errors.validation({ campaignIds: 'invalid_choice' });
  await prisma.$transaction([
    prisma.clientAssignment.deleteMany({ where: { userId } }),
    prisma.campaignAssignment.deleteMany({ where: { userId } }),
    ...(clients.length ? [prisma.clientAssignment.createMany({ data: clients.map((c) => ({ userId, clientId: c.id })) })] : []),
    ...(campaigns.length ? [prisma.campaignAssignment.createMany({ data: campaigns.map((c) => ({ userId, campaignId: c.id })) })] : []),
  ]);
}

// ───────────── ADMIN: user management ─────────────
usersRouter.use(authenticate, adminOnly);

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = paging(req.query, 25);
    const q = qs(req.query, 'q');
    const role = qsEnum(req.query, 'role', ROLES);
    const status = qsEnum(req.query, 'status', USER_STATUSES);
    const clientId = qs(req.query, 'clientId');
    const where = and<Prisma.UserWhereInput>(
      role ? { role } : undefined,
      status ? { status } : undefined,
      clientId ? { clientId } : undefined,
      q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : undefined,
    );
    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: [{ role: 'asc' }, { name: 'asc' }], skip: p.skip, take: p.take, select: userSelect }),
    ]);
    res.json({ items, meta: pageMeta(p, total) });
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(createSchema, req.body);
    await assertRoleClientRule(body.role, body.clientId);
    if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
      throw Errors.validation({ email: 'email_taken' });
    }
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        role: body.role,
        clientId: body.role === 'CLIENT' ? body.clientId! : null,
        locale: body.locale ?? 'en',
        passwordHash: await hashPassword(body.password),
      },
      select: userSelect,
    });
    if (body.role === 'TEAM' && (body.clientIds?.length || body.campaignIds?.length)) {
      await setAssignments(user.id, body.clientIds ?? [], body.campaignIds ?? []);
    }
    await audit(ctx, 'USER_CREATED', 'user', user.id, { role: user.role, email: user.email });
    res.status(201).json({ item: user });
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw Errors.notFound();
    const [clientAssignments, campaignAssignments] = await Promise.all([
      prisma.clientAssignment.findMany({ where: { userId: id }, select: { client: { select: { id: true, companyName: true } } } }),
      prisma.campaignAssignment.findMany({
        where: { userId: id },
        select: { campaign: { select: { id: true, name: true, client: { select: { id: true, companyName: true } } } } },
      }),
    ]);
    res.json({
      item: { ...user, clients: clientAssignments.map((a) => a.client), campaigns: campaignAssignments.map((a) => a.campaign) },
    });
  }),
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const id = idParam(req);
    const body = parse(updateSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound();

    if (id === ctx.user.id && ((body.role && body.role !== existing.role) || body.status === 'INACTIVE')) {
      throw Errors.badRequest('CANNOT_MODIFY_SELF', 'You cannot change your own role or deactivate yourself.');
    }
    const role = body.role ?? existing.role;
    const clientId = body.clientId !== undefined ? body.clientId : existing.clientId;
    await assertRoleClientRule(role, role === 'CLIENT' ? clientId : null);

    if (body.email && body.email !== existing.email) {
      const taken = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (taken) throw Errors.validation({ email: 'email_taken' });
    }

    const { password, ...rest } = body;
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...rest,
        clientId: role === 'CLIENT' ? clientId : null,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      },
      select: userSelect,
    });
    // leaving the TEAM role drops assignments; deactivation / password reset / role change ends all sessions
    if (role !== 'TEAM') {
      await prisma.$transaction([prisma.clientAssignment.deleteMany({ where: { userId: id } }), prisma.campaignAssignment.deleteMany({ where: { userId: id } })]);
    }
    if (password || body.status === 'INACTIVE' || (body.role && body.role !== existing.role)) await deleteUserSessions(id);

    await audit(ctx, 'USER_UPDATED', 'user', id, { changes: Object.keys(body).map((k) => (k === 'password' ? 'passwordReset' : k)) });
    res.json({ item: user });
  }),
);

usersRouter.put(
  '/:id/assignments',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const id = idParam(req);
    const body = parse(z.object({ clientIds: z.array(z.string()).max(500), campaignIds: z.array(z.string()).max(1000) }).strict(), req.body);
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw Errors.notFound();
    if (user.role !== 'TEAM') throw Errors.badRequest('ASSIGNMENTS_TEAM_ONLY', 'Only team members can be assigned to clients or campaigns.');
    await setAssignments(id, body.clientIds, body.campaignIds);
    await audit(ctx, 'USER_ASSIGNMENTS_UPDATED', 'user', id, { clients: body.clientIds.length, campaigns: body.campaignIds.length });
    res.json({ ok: true });
  }),
);

// ───────────── Staff: list of assignable team members ─────────────
teamMembersRouter.use(authenticate, staffOnly);
teamMembersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const clientId = qs(req.query, 'clientId');
    // ADMINs are always assignable; TEAM members only if they are assigned to that client
    const items = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { role: 'ADMIN' },
          clientId ? { role: 'TEAM', clientAssignments: { some: { clientId } } } : { role: 'TEAM' },
        ],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    });
    res.json({ items });
  }),
);
