import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../../shared/src/enums';
import {
  ADMIN_ONLY_PERMISSIONS, ALL_PERMISSIONS, DEFAULT_TEAM_PERMISSIONS, isPermission, type Permission,
} from '../../../shared/src/permissions';
import { Errors } from '../lib/errors';
import type { Scope } from './scope';

/**
 * Permissions the API enforces for one user.
 *  ADMIN  -> everything
 *  CLIENT -> nothing (clients never receive internal permissions, whatever is stored on the row)
 *  TEAM   -> the administrator's saved list (unknown keys and admin-only keys dropped) or the defaults
 */
export function effectivePermissions(user: { role: Role; permissions: string | null | undefined }): Set<Permission> {
  if (user.role === 'ADMIN') return new Set(ALL_PERMISSIONS);
  if (user.role === 'CLIENT') return new Set();
  const stored = parsePermissions(user.permissions);
  const list = stored ?? DEFAULT_TEAM_PERMISSIONS;
  return new Set(list.filter((p) => !ADMIN_ONLY_PERMISSIONS.includes(p)));
}

/** null = never customised (use defaults). */
export function parsePermissions(raw: string | null | undefined): Permission[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isPermission) : null;
  } catch {
    return null;
  }
}

/** Sanitises a list coming from the admin UI before it is stored (TEAM only). */
export const sanitizePermissionList = (list: unknown[]): Permission[] =>
  [...new Set(list.filter(isPermission))].filter((p) => !ADMIN_ONLY_PERMISSIONS.includes(p));

export const can = (scope: Pick<Scope, 'permissions'>, perm: Permission): boolean => scope.permissions.has(perm);

/** Route guard for staff features: the caller must hold EVERY listed permission (CLIENT users never do). */
export const requirePerm =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !req.scope) return next(Errors.unauthenticated());
    if (perms.every((p) => req.scope!.permissions.has(p))) return next();
    next(Errors.forbidden());
  };

/** Like requirePerm, but CLIENT users pass through (their data scope already limits what they can see). Read routes only. */
export const requirePermOrClient =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !req.scope) return next(Errors.unauthenticated());
    if (req.user.role === 'CLIENT') return next();
    if (perms.every((p) => req.scope!.permissions.has(p))) return next();
    next(Errors.forbidden());
  };
