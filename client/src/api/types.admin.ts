// Client-side types of the admin group: dashboards, branding, permissions admin and the audit log.
import type { ClientStatus, ContentStatus, Role, TaskStatus } from '@shared/enums';
import type { AuditRow, DashboardResponse, Meta, UserRow } from './types';

export interface BrandingInfo {
  agencyName: string;
  primaryColor: string;
  secondaryColor: string;
  hasLogo: boolean;
  hasFavicon: boolean;
  /** false when white text on the primary colour is hard to read (warning only) */
  contrastOk: boolean;
  updatedAt: string;
}

export const DEFAULT_BRANDING = { agencyName: 'OG System', primaryColor: '#4f46e5', secondaryColor: '#0f172a' } as const;

// ── permissions admin ──
export interface PermissionCatalog { groups: Array<{ id: string; permissions: string[] }>; defaults: string[]; adminOnly: string[] }
export interface AdminUserRow extends UserRow { permissions?: string[]; permissionsCustom?: boolean }

// ── audit log ──
export interface AuditLogRow extends Omit<AuditRow, 'user'> {
  clientId: string | null; projectId: string | null; clientVisible: boolean;
  user: { id: string; name: string; email: string; role: Role } | null;
}
export type AuditPage = { items: AuditLogRow[]; meta: Meta };

// ── dashboard (phase-2 widgets: every one is optional - the API omits what the caller may not see) ──
export interface DashTask { id: string; title: string; dueDate: string | null; priority: string; status: TaskStatus; project: { id: string; name: string } | null; client: { id: string; companyName: string } | null }
export interface DashDeadline { kind: 'TASK' | 'PROJECT' | 'MILESTONE' | 'CONTENT'; id: string; title: string; date: string; projectId?: string | null; clientName?: string | null }
export interface DashActivity { id: string; action: string; entity: string; entityId: string | null; clientId: string | null; projectId: string | null; actorName: string | null; createdAt: string; summary: Record<string, string | number> | null }
export interface DashClientProject { id: string; name: string; status: string; dueDate: string | null; progress: number; milestoneCounts: { total: number; done: number } }

export interface DashboardExtras {
  myTasks?: { open: number; overdue: number; dueToday: number; next: DashTask[] };
  overdueTasks?: { total: number };
  projects?: { active: number; atRisk: number; atRiskItems: Array<{ id: string; name: string; status: string; dueDate: string | null; overdue: boolean; client: { id: string; companyName: string } }> } | DashClientProject[];
  upcomingDeadlines?: DashDeadline[];
  contentPipeline?: { byStatus: Record<ContentStatus, number>; total: number; next7Days: Array<{ date: string; count: number }> };
  approvalsWaiting?: { count: number; oldest: Array<{ id: string; name: string; type: string; submittedAt: string | null; client: { id: string; companyName: string } }> };
  clientsByStatus?: Record<ClientStatus, number>;
  onboarding?: { inProgress: number; lowest: Array<{ clientId: string; companyName: string; done: number; total: number; progress: number }> };
  contractsExpiring?: { count: number; items: Array<{ id: string; name: string; endDate: string | null; contractNumber?: string; client?: { id: string; companyName: string } }> };
  invoices?: { outstandingTotal: number; outstandingCount: number; overdueTotal: number; overdueCount: number; paidThisMonth?: number; paidThisMonthCount?: number };
  hours?: { weekStart: string; mineSec: number; teamSec?: number };
  recentActivity?: DashActivity[];
  // CLIENT only
  upcomingContent?: Array<{ id: string; title: string; platform: string; contentType: string; publishDate: string | null }>;
  reportSummary?: { days: number; until: string; reports: number; spend: number; impressions: number; clicks: number; conversions: number; ctr: number | null; roas: number | null };
}
export type DashboardData = DashboardResponse & DashboardExtras;
