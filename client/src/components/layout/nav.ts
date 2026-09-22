import {
  BarChart3, CheckCircle2, FolderOpen, LayoutDashboard, LifeBuoy, Megaphone, Palette, ScrollText, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@shared/enums';
import type { TKey } from '@/i18n';

export interface NavItem { to: string; icon: LucideIcon; label: TKey; end?: boolean }

const dashboard: NavItem = { to: '/', icon: LayoutDashboard, label: 'nav.dashboard', end: true };
const clients: NavItem = { to: '/clients', icon: Users, label: 'nav.clients' };
const users: NavItem = { to: '/users', icon: UserCog, label: 'nav.users' };
const campaigns: NavItem = { to: '/campaigns', icon: Megaphone, label: 'nav.campaigns' };
const deliverables: NavItem = { to: '/deliverables', icon: Palette, label: 'nav.deliverables' };
const approvals: NavItem = { to: '/approvals', icon: CheckCircle2, label: 'nav.approvals' };
const requests: NavItem = { to: '/requests', icon: LifeBuoy, label: 'nav.requests' };
const reports: NavItem = { to: '/reports', icon: BarChart3, label: 'nav.reports' };
const files: NavItem = { to: '/files', icon: FolderOpen, label: 'nav.files' };
export const auditNav: NavItem = { to: '/audit-log', icon: ScrollText, label: 'nav.auditLog' };

export const NAV: Record<Role, NavItem[]> = {
  CLIENT: [dashboard, campaigns, approvals, requests, reports, files],
  TEAM: [dashboard, clients, campaigns, deliverables, approvals, requests, reports, files],
  ADMIN: [dashboard, clients, users, campaigns, deliverables, approvals, requests, reports, files, auditNav],
};

/** Items shown in the phone bottom bar (the rest live behind "More"). */
export const BOTTOM: Record<Role, string[]> = {
  CLIENT: ['/', '/campaigns', '/approvals', '/requests'],
  TEAM: ['/', '/campaigns', '/approvals', '/requests'],
  ADMIN: ['/', '/campaigns', '/approvals', '/requests'],
};
