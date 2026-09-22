// Single source of truth for enum values shared by the API and the web app.
// These MUST stay in sync with prisma/schema.prisma (a server test checks it).

export const CLIENT_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export const ROLES = ['ADMIN', 'TEAM', 'CLIENT'] as const;
export const USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const PLATFORMS = ['META', 'GOOGLE', 'TIKTOK', 'SNAPCHAT', 'OTHER'] as const;
export const OBJECTIVES = ['SALES', 'LEADS', 'TRAFFIC', 'AWARENESS', 'ENGAGEMENT'] as const;
export const CAMPAIGN_STATUSES = ['PLANNING', 'PENDING_APPROVAL', 'RUNNING', 'PAUSED', 'COMPLETED'] as const;
export const DELIVERABLE_TYPES = ['DESIGN', 'VIDEO', 'REEL', 'STORY', 'COPY', 'BANNER', 'OTHER'] as const;
export const DELIVERABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CHANGES_REQUESTED', 'PUBLISHED'] as const;
export const APPROVAL_DECISIONS = ['PENDING', 'APPROVED', 'CHANGES_REQUESTED'] as const;
export const REQUEST_TYPES = ['DESIGN', 'VIDEO', 'COPY', 'CAMPAIGN', 'OTHER'] as const;
export const REQUEST_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const REQUEST_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'COMPLETED', 'CANCELLED'] as const;
export const AUTHOR_TYPES = ['CLIENT', 'TEAM'] as const;
export const LOCALES = ['en', 'ar'] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export type Role = (typeof ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type Platform = (typeof PLATFORMS)[number];
export type Objective = (typeof OBJECTIVES)[number];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export type RequestType = (typeof REQUEST_TYPES)[number];
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type AuthorType = (typeof AUTHOR_TYPES)[number];
export type Locale = (typeof LOCALES)[number];

/** Request statuses that count as "open" on dashboards. */
export const OPEN_REQUEST_STATUSES: RequestStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'];
