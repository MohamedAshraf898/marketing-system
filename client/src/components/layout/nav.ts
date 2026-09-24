import {
  BarChart3, Building2, CalendarDays, CheckCircle2, ClipboardCheck, ClipboardList, Clock, FileSignature, FolderKanban, FolderOpen, Gauge, LayoutDashboard, LifeBuoy, Megaphone,
  Palette, Receipt, ScrollText, UserCog, Users, CalendarRange, CalendarCheck2, ListTodo, UsersRound, Radar, FileBarChart, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@shared/enums';
import type { TKey } from '@/i18n';

/** `perm`: staff need this permission to see the item (UI only - the API enforces it). CLIENT users ignore `perm`. */
export interface NavItem { to: string; icon: LucideIcon; label: TKey; end?: boolean; perm?: string; anyPerm?: string[]; roles?: Role[] }
export interface NavSection { title?: TKey; items: NavItem[] }

const I = (to: string, icon: LucideIcon, label: TKey, extra: Partial<NavItem> = {}): NavItem => ({ to, icon, label, ...extra });

const dashboard = I('/', LayoutDashboard, 'nav.dashboard', { end: true });
const clients = I('/clients', Users, 'nav.clients', { perm: 'clients.view' });
const projects = I('/projects', FolderKanban, 'nav.projects', { perm: 'projects.view' });
const tasks = I('/tasks', ClipboardList, 'nav.tasks', { perm: 'tasks.view' });
const campaigns = I('/campaigns', Megaphone, 'nav.campaigns', { perm: 'campaigns.view' });
const content = I('/content', CalendarRange, 'nav.content', { perm: 'content.view' });
const deliverables = I('/deliverables', Palette, 'nav.deliverables');
const approvals = I('/approvals', CheckCircle2, 'nav.approvals');
const requests = I('/requests', LifeBuoy, 'nav.requests');
const calendar = I('/calendar', CalendarDays, 'nav.calendar');
const reports = I('/reports', BarChart3, 'nav.reports', { perm: 'reports.view' });
const files = I('/files', FolderOpen, 'nav.files');
const contracts = I('/contracts', FileSignature, 'nav.contracts', { perm: 'contracts.view' });
const invoices = I('/invoices', Receipt, 'nav.invoices', { perm: 'invoices.view' });
const time = I('/time', Clock, 'nav.time', { perm: 'time.track' });
const workload = I('/workload', Gauge, 'nav.workload', { perm: 'workload.view' });
const onboarding = I('/onboarding', ClipboardCheck, 'nav.onboarding', { perm: 'clients.view' });
const myTasks = I('/my-tasks', ListTodo, 'nav.myTasks', { perm: 'tasks.view' });
const teamTasks = I('/team-tasks', UsersRound, 'nav.teamTasks', { perm: 'tasks.view_team' });
const attendance = I('/attendance', CalendarCheck2, 'nav.attendance', { anyPerm: ['attendance.track', 'attendance.view_all', 'leave.approve'] });
const teamOverview = I('/team-overview', Radar, 'nav.teamOverview', { anyPerm: ['attendance.view_all', 'workload.view', 'tasks.view_team'] });
const teamReports = I('/team-reports', FileBarChart, 'nav.teamReports', { anyPerm: ['attendance.view_all', 'tasks.view_team'] });
const clientTasks = I('/tasks', ClipboardList, 'nav.tasks');
const users = I('/users', UserCog, 'nav.users', { roles: ['ADMIN'] });
export const auditNav = I('/audit-log', ScrollText, 'nav.auditLog', { roles: ['ADMIN'] });
void Building2;

/** Sidebar sections for a role; `can` filters staff items by permission. */
export function navSections(role: Role, can: (perm: string) => boolean): NavSection[] {
  const sections: NavSection[] =
    role === 'CLIENT'
      ? [{ items: [dashboard, projects, clientTasks, campaigns, content, approvals, requests, calendar, reports, files, contracts, invoices] }]
      : [
          { items: [dashboard, clients, projects, campaigns, content, deliverables, approvals, requests, calendar, reports, files] },
          { title: 'nav.section.tasks', items: [myTasks, tasks, teamTasks] },
          { title: 'nav.section.team', items: [teamOverview, attendance, time, workload, teamReports, onboarding] },
          { title: 'nav.section.finance', items: [contracts, invoices] },
          { title: 'shell.system', items: [users, auditNav] },
        ];
  const allowed = (i: NavItem) => role === 'CLIENT' || ((!i.perm || can(i.perm)) && (!i.anyPerm || i.anyPerm.some((p) => can(p))));
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => (!i.roles || i.roles.includes(role)) && allowed(i)) }))
    .filter((s) => s.items.length > 0);
}

/** Items shown in the phone bottom bar (the rest live behind "More"). */
export const BOTTOM: Record<Role, string[]> = {
  CLIENT: ['/', '/tasks', '/approvals', '/requests'],
  TEAM: ['/', '/my-tasks', '/attendance', '/approvals'],
  ADMIN: ['/', '/tasks', '/team-overview', '/approvals'],
};
