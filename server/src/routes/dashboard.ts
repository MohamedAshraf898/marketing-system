import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { ctxOf } from '../lib/context';
import { asyncHandler } from '../lib/http';
import { buildDashboard } from '../services/dashboard';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await buildDashboard(ctxOf(req)));
  }),
);
