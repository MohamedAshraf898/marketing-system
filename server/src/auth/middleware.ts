import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../../shared/src/enums';
import { config } from '../config';
import { Errors } from '../lib/errors';
import { asyncHandler } from '../lib/http';
import { loadScope } from '../authz/scope';
import { findSessionByToken } from './sessions';

/**
 * Step 1 of authorisation on every protected route:
 *   valid session -> active user -> (for clients) non-archived company -> load data scope.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[config.cookieName];
  if (typeof token !== 'string' || !token) throw Errors.unauthenticated();

  const session = await findSessionByToken(token);
  if (!session || session.expiresAt.getTime() < Date.now()) throw Errors.unauthenticated();

  const u = session.user;
  if (u.status !== 'ACTIVE') throw Errors.accountDisabled();
  if (u.role === 'CLIENT' && (!u.clientId || u.client?.status === 'ARCHIVED')) throw Errors.accountDisabled();

  req.user = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    clientId: u.clientId,
    avatar: u.avatar,
    locale: u.locale,
    sessionId: session.id,
  };
  req.scope = await loadScope({ ...req.user, permissions: u.permissions });
  next();
});

/** Step 2: role gate. Usage: router.post('/', requireRole('ADMIN'), ...) */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Errors.unauthenticated());
    if (!roles.includes(req.user.role)) return next(Errors.forbidden());
    next();
  };

export const staffOnly = requireRole('ADMIN', 'TEAM');
export const adminOnly = requireRole('ADMIN');
export const clientOnly = requireRole('CLIENT');

/** Same-site protection for state-changing calls: a browser always sends Origin on cross-site POSTs. */
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser client (curl, tests, server-to-server)
  try {
    const o = new URL(origin);
    const sameHost = o.host === req.get('host');
    if (sameHost || config.clientOrigins.includes(o.origin)) return next();
  } catch {
    /* fallthrough */
  }
  next(Errors.forbidden());
}
