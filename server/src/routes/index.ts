import { Router } from 'express';
import { authRouter, meRouter } from '../auth/routes';
import { approvalsRouter } from './approvals';
import { auditLogsRouter } from './auditLogs';
import { campaignsRouter } from './campaigns';
import { clientsRouter } from './clients';
import { dashboardRouter } from './dashboard';
import { deliverablesRouter } from './deliverables';
import { filesRouter } from './files';
import { notificationsRouter } from './notifications';
import { reportsRouter } from './reports';
import { requestsRouter } from './requests';
import { teamMembersRouter, usersRouter } from './users';

export const api = Router();

api.get('/health', (_req, res) => res.json({ ok: true }));
api.use('/auth', authRouter);
api.use('/me', meRouter);
api.use('/dashboard', dashboardRouter);
api.use('/clients', clientsRouter);
api.use('/users', usersRouter);
api.use('/team-members', teamMembersRouter);
api.use('/campaigns', campaignsRouter);
api.use('/deliverables', deliverablesRouter);
api.use('/approvals', approvalsRouter);
api.use('/requests', requestsRouter);
api.use('/reports', reportsRouter);
api.use('/files', filesRouter);
api.use('/notifications', notificationsRouter);
api.use('/audit-logs', auditLogsRouter);

// unknown API routes -> JSON 404 (never the SPA HTML)
api.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested item was not found.' } }));
