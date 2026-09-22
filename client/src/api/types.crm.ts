import type { OnboardingStatus, Role } from '@shared/enums';
import type { Client, Meta } from './types';

/** Fields marked "staff" are never sent to CLIENT users (the server uses an explicit whitelist for them). */

export interface ContactRow {
  id: string; clientId: string; name: string; jobTitle: string | null; email: string | null; phone: string | null; whatsapp: string | null;
  isPrimary: boolean;
  visibleToClient?: boolean; // staff
  notes?: string | null; // staff, internal
  hasAvatar?: boolean; createdAt?: string; updatedAt?: string;
}

export interface OnboardingItemRow {
  id: string; clientId: string; title: string; description: string | null; position: number; done: boolean;
  completedAt: string | null; completedById: string | null; assignedToId: string | null; dueDate: string | null; notes: string | null;
  createdAt: string; updatedAt: string;
  assignedTo: { id: string; name: string } | null; completedBy: { id: string; name: string } | null;
}

export interface OnboardingProgress { total: number; done: number; percent: number; overdue: number }

export interface OnboardingResponse { items: OnboardingItemRow[]; progress: OnboardingProgress; onboardingStatus: OnboardingStatus; meta: { total: number } }

export interface OnboardingDashboardRow {
  id: string; companyName: string; name: string; status: Client['status']; onboardingStatus: OnboardingStatus; hasLogo: boolean;
  accountManager: { id: string; name: string } | null;
  progress: OnboardingProgress;
  nextItem: { id: string; title: string; dueDate: string | null; assignedTo: { id: string; name: string } | null } | null;
  overdueItems: Array<{ id: string; title: string; dueDate: string | null; assignedTo: { id: string; name: string } | null }>;
  myOpenItems: number;
}
export interface OnboardingDashboard { items: OnboardingDashboardRow[]; summary: { myOpenItems: number; overdueItems: number }; meta: Meta }

export interface InternalNoteRow {
  id: string; clientId: string; projectId: string | null; authorId: string; body: string; pinned: boolean; createdAt: string; updatedAt: string;
  author: { id: string; name: string }; project: { id: string; name: string } | null;
}

export interface ActivitySummary { name?: string; title?: string; status?: string; from?: string; to?: string; version?: number }
export interface ActivityRow {
  id: string; action: string; entity: string; entityId: string | null; clientId: string | null; projectId: string | null; createdAt: string;
  actor: { id?: string; name: string; role: Role } | null;
  summary: ActivitySummary;
}

export interface ClientSummary {
  projects: number; campaigns: number; deliverables: number; deliverablesPending: number; requests: number; openRequests: number; files: number;
  openTasks?: number; // staff with tasks.view
  unpaidInvoices?: number; // invoices.view / CLIENT
  contractEndsAt?: string | null; // contracts.view / CLIENT (shared contracts only)
}

export interface ClientListItem extends Client { primaryContact?: { name: string; jobTitle: string | null } | null }

export interface ClientDetail extends Client {
  summary: ClientSummary;
  primaryContact?: { id: string; name: string; jobTitle: string | null; email: string | null; phone: string | null } | null; // staff
  onboarding?: OnboardingProgress; // staff with full access
  access?: { fullAccess: boolean }; // staff
}

export interface TeamMemberOption { id: string; name: string; role: string }
