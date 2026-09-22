import type {
  ClientType, OnboardingStatus,
  ApprovalDecision, CampaignStatus, ClientStatus, DeliverableStatus, DeliverableType, Objective, Platform,
  RequestPriority, RequestStatus, RequestType, Role, UserStatus,
} from '@shared/enums';

export interface Meta { page: number; pageSize: number; total: number; totalPages: number }
export interface Paged<T> { items: T[]; meta: Meta }

export interface Me {
  id: string; name: string; email: string; role: Role; clientId: string | null; avatar: string | null; locale: 'en' | 'ar';
  jobTitle?: string | null;
  /** effective permissions (ADMIN: all, TEAM: role defaults or the saved list, CLIENT: none). The API enforces them; the UI only hides buttons. */
  permissions: string[];
  client: { id: string; name: string; companyName: string; status: ClientStatus; hasLogo: boolean } | null;
}
export interface AppConfig { currency: string; maxUploadMb: number }
export interface MeResponse { user: Me; config: AppConfig }

export interface ClientLite { id: string; companyName: string }
export interface Client {
  id: string; name: string; companyName: string; email: string; phone: string | null; status: ClientStatus; hasLogo: boolean; createdAt: string;
  // CRM (phase 2). Fields marked "staff" are NOT sent to CLIENT users.
  industry?: string | null; website?: string | null; address?: string | null; country?: string | null; city?: string | null;
  notes?: string | null; // client-visible
  leadSource?: string | null; accountManagerId?: string | null; clientType?: ClientType; tags?: string[]; // staff
  onboardingStatus?: OnboardingStatus; clientSince?: string | null; contractStart?: string | null; contractEnd?: string | null; // staff
  monthlyRetainer?: number | null; internalNotes?: string | null; // staff
  accountManager?: { id: string; name: string } | null; // staff
  _count?: { campaigns: number; users?: number; requests?: number; deliverables?: number; files?: number };
  users?: Array<{ id: string; name: string; email: string; status: UserStatus; lastLoginAt: string | null }>;
  team?: Array<{ id: string; name: string; email: string }>;
}

export interface UserRow {
  id: string; name: string; email: string; role: Role; clientId: string | null; status: UserStatus; locale: string; lastLoginAt: string | null; createdAt: string;
  client: ClientLite | null;
  clients?: ClientLite[];
  campaigns?: Array<{ id: string; name: string; client: ClientLite }>;
}

export interface Metrics { spend: number; reach: number; impressions: number; clicks: number; ctr: number; cpc: number; cpm: number; conversions: number; conversionValue: number; roas: number }

export interface Campaign {
  id: string; name: string; clientId: string; platform: Platform; objective: Objective; status: CampaignStatus;
  startDate: string | null; endDate: string | null; budget: number; spent: number; description: string | null; campaignExternalId: string | null;
  createdAt: string; updatedAt: string; client?: ClientLite;
  metrics?: Metrics; counts?: { deliverables: number; requests: number; files: number; reports: number };
}

export interface Deliverable {
  id: string; name: string; clientId: string; campaignId: string | null; type: DeliverableType; previewUrl: string | null; description: string | null;
  status: DeliverableStatus; version: number; dueDate: string | null; submittedAt: string | null; approvedAt: string | null; clientComment: string | null;
  createdAt: string; updatedAt: string; previewFileId: string | null;
  campaign?: { id: string; name: string } | null; client?: ClientLite;
  files?: FileRow[];
  permissions?: { canEdit: boolean; canSubmit: boolean; canStartNewVersion: boolean; canPublish: boolean; canDecide: boolean; canUploadFiles: boolean };
}

export interface UserMini { id: string; name: string; role: Role; avatar: string | null }
export interface Approval {
  id: string; deliverableId: string; clientId: string; userId: string; decision: ApprovalDecision; comment: string | null; version: number;
  submittedAt: string | null; decidedAt: string | null; createdAt: string; user: UserMini;
  client?: ClientLite; deliverable?: { id: string; name: string; type: DeliverableType; status: DeliverableStatus; version: number; campaign: { id: string; name: string } | null };
}
export interface CommentRow { id: string; comment: string; authorType: 'CLIENT' | 'TEAM'; createdAt: string; user: UserMini }

export interface RequestRow {
  id: string; title: string; description: string; type: RequestType; priority: RequestPriority; status: RequestStatus;
  clientId: string; userId: string; campaignId: string | null; assignedToId: string | null; dueDate: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
  client?: ClientLite; campaign?: { id: string; name: string } | null; assignedTo?: { id: string; name: string } | null; user?: { id: string; name: string; role?: Role };
  files?: FileRow[];
}

export interface ReportRow extends Metrics {
  id: string; clientId: string; campaignId: string; date: string; notes: string | null; createdAt: string;
  campaign?: { id: string; name: string; platform: Platform }; client?: ClientLite;
}
export interface SeriesPoint extends Metrics { date: string }
export interface ReportsResponse { summary: Metrics; series: SeriesPoint[]; items: ReportRow[]; meta: Meta }

export interface FileRow {
  id: string; fileName: string; fileType: string; size: number; clientId: string; campaignId: string | null; deliverableId: string | null; requestId: string | null;
  projectId?: string | null; contentItemId?: string | null; taskId?: string | null; onboardingItemId?: string | null; contractId?: string | null; invoiceId?: string | null;
  version: number; visibleToClient: boolean; createdAt: string; uploadedBy: { id: string; name: string; role: Role };
  campaign: { id: string; name: string } | null; deliverable: { id: string; name: string } | null; request: { id: string; title: string } | null;
}

export interface NotificationRow { id: string; type: string; entity: string | null; entityId: string | null; data: Record<string, string | number>; readAt: string | null; createdAt: string }
export interface NotificationsResponse { items: NotificationRow[]; unreadCount: number; meta: Meta }

export interface AuditRow { id: string; action: string; entity: string; entityId: string | null; metadata: Record<string, unknown> | null; ip: string | null; createdAt: string; user: { id: string; name: string; role: Role } | null }

export interface DashboardResponse {
  role: Role;
  kpis: Record<string, number>;
  client?: { id: string; name: string; companyName: string; hasLogo: boolean } | null;
  activeCampaigns: Campaign[];
  recentCampaigns: Campaign[];
  pendingApprovals: Deliverable[];
  requests: RequestRow[];
  recentReports: ReportRow[];
  recentFeedback?: Array<{ id: string; kind: 'COMMENT' | 'CHANGES_REQUESTED'; text: string; at: string; user: { id: string; name: string }; deliverable: { id: string; name: string }; company: string }>;
}
