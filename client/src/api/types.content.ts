// Owner: Content & proofing group. Client-side API types for /content and /deliverables/:id/proofing.
import type { ContentApprovalStatus, ContentStatus, ContentType, SocialPlatform } from '@shared/enums';
import type { ClientLite, FileRow, UserMini } from '@/api/types';

/** What the API returns for staff (ADMIN / TEAM) - the full row + workflow hints computed on the server. */
export interface ContentItem {
  id: string;
  clientId: string;
  campaignId: string | null;
  projectId: string | null;
  title: string;
  platform: SocialPlatform;
  contentType: ContentType;
  caption: string | null;
  status: ContentStatus;
  publishDate: string | null;
  assignedToId: string | null;
  deliverableId: string | null;
  notes: string | null; // internal, staff only
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  client?: ClientLite;
  campaign?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  assignedTo?: { id: string; name: string } | null;
  deliverable?: { id: string; status: string; version: number; submittedAt: string | null } | null;
  approvalStatus: ContentApprovalStatus;
  /** statuses this item may be moved to BY HAND (never includes CLIENT_APPROVAL / APPROVED / REJECTED - those are workflow-only). */
  allowedStatuses: ContentStatus[];
  canSendForApproval: boolean;
  /** true once the client is involved: title / caption / type / platform can no longer be edited. */
  creativeLocked: boolean;
  files?: FileRow[];
}

/** What a CLIENT user gets: an explicit whitelist, status already translated into the client's own view of the workflow. */
export interface ClientContentItem {
  id: string;
  title: string;
  platform: SocialPlatform;
  contentType: ContentType;
  caption: string | null;
  publishDate: string | null;
  status: ContentStatus;
  deliverableId: string | null;
  deliverableVersion: number | null;
  approvalStatus: ContentApprovalStatus;
}

export interface ProofingFileRef { id: string; fileName: string; fileType: string; version: number }
export interface ProofingComment {
  id: string;
  deliverableId: string;
  fileId: string | null;
  version: number;
  x: number | null;
  y: number | null;
  timestampSec: number | null;
  comment: string;
  authorType: 'CLIENT' | 'TEAM';
  userId: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  user: UserMini;
  file: ProofingFileRef | null;
}

export interface ProofingListResponse {
  items: ProofingComment[];
  counts: { total: number; unresolved: number };
  canComment: boolean;
  currentVersion: number;
  versions: number[];
}

export type ContentView = 'calendar' | 'kanban' | 'list';

/** Type guard: only the staff DTO carries `allowedStatuses` (the client whitelist DTO never does). */
export function isStaffContentItem(item: ContentItem | ClientContentItem): item is ContentItem {
  return 'allowedStatuses' in item;
}
