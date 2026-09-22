import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { LOCALES } from '../../../shared/src/enums';
import { config } from '../config';
import { prisma } from '../db';
import { Errors } from '../lib/errors';
import { asyncHandler, parse } from '../lib/http';
import { ctxOf } from '../lib/context';
import { audit } from '../services/audit';
import { effectivePermissions } from '../authz/permissions';
import { authenticate } from './middleware';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from './password';
import { clearSessionCookie, createSession, deleteSessionByToken, deleteUserSessions } from './sessions';

export const authRouter = Router();
export const meRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Please try again in a few minutes.' } }),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

async function publicUser(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, role: true, clientId: true, avatar: true, locale: true, lastLoginAt: true, jobTitle: true, permissions: true,
      client: { select: { id: true, name: true, companyName: true, logo: true, status: true } },
    },
  });
  const { client, permissions, ...rest } = u;
  return {
    ...rest,
    // effective permissions (the web app only uses them to hide buttons; the API enforces them)
    permissions: [...effectivePermissions({ role: u.role, permissions })],
    client: client ? { id: client.id, name: client.name, companyName: client.companyName, status: client.status, hasLogo: !!client.logo } : null,
  };
}

const appConfig = () => ({ currency: config.currency, maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024) });

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email }, include: { client: { select: { status: true } } } });
    // always run bcrypt so timing does not reveal whether the email exists
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw Errors.invalidCredentials();
    if (user.status !== 'ACTIVE') throw Errors.accountDisabled();
    if (user.role === 'CLIENT' && (!user.clientId || user.client?.status === 'ARCHIVED')) throw Errors.accountDisabled();

    await createSession(req, res, user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ user, ip: req.ip ?? null }, 'USER_LOGIN', 'user', user.id, { role: user.role });
    res.json({ user: await publicUser(user.id), config: appConfig() });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[config.cookieName];
    if (typeof token === 'string' && token) await deleteSessionByToken(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

meRouter.use(authenticate);

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ user: await publicUser(ctxOf(req).user.id), config: appConfig() });
  }),
);

const patchMeSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    locale: z.enum(LOCALES).optional(),
    currentPassword: z.string().max(200).optional(),
    newPassword: z
      .string()
      .superRefine((v, c) => {
        const p = passwordProblem(v);
        if (p) c.addIssue({ code: 'custom', message: p });
      })
      .optional(),
  })
  .strict();

meRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = parse(patchMeSchema, req.body);
    const data: { name?: string; locale?: string; passwordHash?: string } = {};
    if (body.name) data.name = body.name;
    if (body.locale) data.locale = body.locale;

    if (body.newPassword) {
      if (!body.currentPassword) throw Errors.validation({ currentPassword: 'required' });
      const me = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      if (!(await verifyPassword(body.currentPassword, me.passwordHash))) throw Errors.validation({ currentPassword: 'wrong_password' });
      data.passwordHash = await hashPassword(body.newPassword);
    }
    if (Object.keys(data).length) await prisma.user.update({ where: { id: ctx.user.id }, data });
    if (data.passwordHash) {
      await deleteUserSessions(ctx.user.id, ctx.user.sessionId); // sign out other devices
      await audit(ctx, 'PASSWORD_CHANGED', 'user', ctx.user.id);
    }
    res.json({ user: await publicUser(ctx.user.id), config: appConfig() });
  }),
);
