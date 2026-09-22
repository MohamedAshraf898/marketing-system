import type { Request } from 'express';
import type { AuthUser } from '../types';
import type { Scope } from '../authz/scope';
import { Errors } from './errors';
import { clientIp } from './http';

/** What every service call needs to know about who is acting. Built from the *session*, never the body. */
export interface Ctx {
  user: AuthUser;
  scope: Scope;
  ip: string | null;
}

export function ctxOf(req: Request): Ctx {
  if (!req.user || !req.scope) throw Errors.unauthenticated();
  return { user: req.user, scope: req.scope, ip: clientIp(req) };
}
