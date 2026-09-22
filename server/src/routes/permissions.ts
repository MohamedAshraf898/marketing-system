// Owner: Admin group.  permissionsRouter -> /permissions   (ADMIN only)
import { Router } from 'express';
import { ADMIN_ONLY_PERMISSIONS, DEFAULT_TEAM_PERMISSIONS, PERMISSION_GROUPS } from '../../../shared/src/permissions';
import { adminOnly, authenticate } from '../auth/middleware';

export const permissionsRouter = Router();
permissionsRouter.use(authenticate, adminOnly);

/** Everything the permission editor needs: the grouped keys, what a TEAM member gets by default, and the admin-only keys. */
permissionsRouter.get('/catalog', (_req, res) => {
  res.json({
    groups: PERMISSION_GROUPS.map((g) => ({ id: g.id, permissions: [...g.permissions] })),
    defaults: [...DEFAULT_TEAM_PERMISSIONS],
    adminOnly: [...ADMIN_ONLY_PERMISSIONS],
  });
});
