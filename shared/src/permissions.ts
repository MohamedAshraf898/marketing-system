// Granular permissions for ADMIN / TEAM users. Shared by the API (enforcement) and the web app (hide what is not allowed).
//
//  ADMIN  -> always has every permission (cannot be reduced).
//  TEAM   -> gets DEFAULT_TEAM_PERMISSIONS unless an administrator saved a custom list for that user.
//  CLIENT -> never has any internal permission (the API ignores anything stored for a client).
//
// The API is the only place these are ENFORCED; the web app only uses them to avoid dead-end buttons.

export const PERMISSION_GROUPS = [
  { id: 'clients', permissions: ['clients.view', 'clients.create', 'clients.edit', 'clients.delete', 'contacts.manage', 'notes.internal', 'onboarding.manage'] },
  { id: 'projects', permissions: ['projects.view', 'projects.create', 'projects.edit', 'projects.delete'] },
  { id: 'tasks', permissions: ['tasks.view', 'tasks.create', 'tasks.assign', 'tasks.edit_all', 'tasks.delete'] },
  { id: 'campaigns', permissions: ['campaigns.view', 'campaigns.create', 'campaigns.edit', 'campaigns.delete'] },
  { id: 'content', permissions: ['content.view', 'content.manage'] },
  { id: 'deliverables', permissions: ['deliverables.create', 'deliverables.approve'] },
  { id: 'reports', permissions: ['reports.view', 'reports.create', 'reports.export'] },
  { id: 'finance', permissions: ['invoices.view', 'invoices.manage', 'contracts.view', 'contracts.manage'] },
  { id: 'files', permissions: ['files.upload', 'files.delete'] },
  { id: 'time', permissions: ['time.track', 'time.view_all', 'workload.view'] },
  { id: 'system', permissions: ['audit_logs.view'] },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]['permissions'][number];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => [...g.permissions]) as Permission[];

/**
 * What a TEAM member can do out of the box. This equals what team members could do before phase 2
 * (view assigned clients / campaigns, create deliverables, upload files, add reports ...) plus everyday work tools.
 * Money (invoices, contracts), people-cost data (time.view_all, workload) and destructive actions are opt-in.
 */
export const DEFAULT_TEAM_PERMISSIONS: Permission[] = [
  'clients.view', 'contacts.manage', 'notes.internal', 'onboarding.manage',
  'projects.view', 'projects.create', 'projects.edit',
  'tasks.view', 'tasks.create', 'tasks.assign',
  'campaigns.view',
  'content.view', 'content.manage',
  'deliverables.create', 'deliverables.approve',
  'reports.view', 'reports.create', 'reports.export',
  'files.upload', 'files.delete',
  'time.track',
];

/**
 * Permissions that only ever apply to ADMIN. The audit log is administrator-only by design, so this key cannot be
 * granted to a TEAM member (the API strips it from any custom list).
 */
export const ADMIN_ONLY_PERMISSIONS: Permission[] = ['audit_logs.view'];

export const isPermission = (v: unknown): v is Permission => typeof v === 'string' && (ALL_PERMISSIONS as string[]).includes(v);
