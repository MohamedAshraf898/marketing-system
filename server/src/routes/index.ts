import { Router } from 'express';
import { authRouter, meRouter } from '../auth/routes';
import { activityRouter } from './activity';
import { analyticsRouter } from './analytics';
import { approvalsRouter } from './approvals';
import { attendanceRouter } from './attendance';
import { auditLogsRouter } from './auditLogs';
import { brandingRouter } from './branding';
import { calendarRouter } from './calendar';
import { campaignsRouter } from './campaigns';
import { clientsRouter } from './clients';
import { clientTasksRouter } from './clientTasks';
import { clientContactsRouter, contactsRouter } from './contacts';
import { contentRouter } from './content';
import { contractsRouter } from './contracts';
import { dashboardRouter } from './dashboard';
import { deliverablesRouter } from './deliverables';
import { filesRouter } from './files';
import { clientNotesRouter, internalNotesRouter } from './internalNotes';
import { invoicesRouter } from './invoices';
import { leaveRouter } from './leave';
import { notificationsRouter } from './notifications';
import { clientOnboardingRouter, onboardingRouter } from './onboarding';
import { permissionsRouter } from './permissions';
import { projectsRouter } from './projects';
import { reportsRouter } from './reports';
import { requestsRouter } from './requests';
import { searchRouter } from './search';
import { tasksRouter } from './tasks';
import { teamReportsRouter } from './teamReports';
import { spacesRouter, taskFieldsRouter, taskTagsRouter } from './taskSetup';
import { taskAutomationsRouter, taskTemplatesRouter } from './taskTemplates';
import { timeRouter } from './time';
import { teamMembersRouter, usersRouter } from './users';
import { workloadRouter } from './workload';
import { holidaysRouter, workSchedulesRouter } from './workSchedules';

export const api = Router();

api.get('/health', (_req, res) => res.json({ ok: true }));
api.use('/auth', authRouter);
api.use('/branding', brandingRouter); // GET is public (login page); write routes authenticate themselves
api.use('/me', meRouter);
api.use('/dashboard', dashboardRouter);

// CRM
api.use('/clients', clientsRouter);
api.use('/clients/:clientId/contacts', clientContactsRouter);
api.use('/clients/:clientId/onboarding', clientOnboardingRouter);
api.use('/clients/:clientId/internal-notes', clientNotesRouter);
api.use('/contacts', contactsRouter);
api.use('/onboarding', onboardingRouter);
api.use('/internal-notes', internalNotesRouter);
api.use('/activity', activityRouter);

// people
api.use('/users', usersRouter);
api.use('/team-members', teamMembersRouter);
api.use('/permissions', permissionsRouter);

// work
api.use('/projects', projectsRouter);
api.use('/tasks', tasksRouter);
api.use('/spaces', spacesRouter);
api.use('/task-fields', taskFieldsRouter);
api.use('/task-tags', taskTagsRouter);
api.use('/task-templates', taskTemplatesRouter);
api.use('/task-automations', taskAutomationsRouter);
api.use('/client-tasks', clientTasksRouter);
api.use('/time', timeRouter);
api.use('/workload', workloadRouter);
api.use('/team-reports', teamReportsRouter);
api.use('/campaigns', campaignsRouter);
api.use('/content', contentRouter);
api.use('/deliverables', deliverablesRouter);
api.use('/approvals', approvalsRouter);
api.use('/requests', requestsRouter);
api.use('/files', filesRouter);

// attendance
api.use('/attendance', attendanceRouter);
api.use('/leave', leaveRouter);
api.use('/work-schedules', workSchedulesRouter);
api.use('/holidays', holidaysRouter);

// money
api.use('/contracts', contractsRouter);
api.use('/invoices', invoicesRouter);

// insight
api.use('/reports', reportsRouter);
api.use('/analytics', analyticsRouter);
api.use('/search', searchRouter);
api.use('/calendar', calendarRouter);
api.use('/notifications', notificationsRouter);
api.use('/audit-logs', auditLogsRouter);

// unknown API routes -> JSON 404 (never the SPA HTML)
api.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested item was not found.' } }));
