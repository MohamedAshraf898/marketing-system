import {
  BarChart3, Building2, CalendarDays, CheckCircle2, ClipboardCheck, ClipboardList, Clock, FileSignature, FolderKanban, FolderOpen, Gauge, LayoutDashboard, LifeBuoy, Megaphone,
  Palette, Receipt, ScrollText, UserCog, Users, CalendarRange, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@shared/enums';
import type { TKey } from '@/i18n';

/** `perm`: staff need this permission to see the item (UI only - the API enforces it). CLIENT users ignore `perm`. */
export interface NavItem { to: string; icon: LucideIcon; label: TKey; end?: boolean; perm?: string; roles?: Role[] }
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
const users = I('/users', UserCog, 'nav.users', { roles: ['ADMIN'] });
export const auditNav = I('/audit-log', ScrollText, 'nav.auditLog', { roles: ['ADMIN'] });
void Building2;

/** Sidebar sections for a role; `can` filters staff items by permission. */
export function navSections(role: Role, can: (perm: string) => boolean): NavSection[] {
  const sections: NavSection[] =
    role === 'CLIENT'
      ? [{ items: [dashboard, projects, campaigns, content, approvals, requests, calendar, reports, files, contracts, invoices] }]
      : [
          { items: [dashboard, clients, projects, tasks, campaigns, content, deliverables, approvals, requests, calendar, reports, files] },
          { title: 'nav.section.finance', items: [contracts, invoices] },
          { title: 'nav.section.team', items: [time, workload, onboarding] },
          { title: 'shell.system', items: [users, auditNav] },
        ];
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => (!i.roles || i.roles.includes(role)) && (role === 'CLIENT' || !i.perm || can(i.perm))) }))
    .filter((s) => s.items.length > 0);
}

/** Items shown in the phone bottom bar (the rest live behind "More"). */
export const BOTTOM: Record<Role, string[]> = {
  CLIENT: ['/', '/campaigns', '/approvals', '/requests'],
  TEAM: ['/', '/tasks', '/approvals', '/requests'],
  ADMIN: ['/', '/tasks', '/approvals', '/requests'],
};
