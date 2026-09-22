// Single source of truth for enum values shared by the API and the web app.
// These MUST stay in sync with prisma/schema.prisma (a server test checks it).

export const CLIENT_STATUSES = ['LEAD', 'PROSPECT', 'ONBOARDING', 'ACTIVE', 'PAUSED', 'CHURNED', 'ARCHIVED'] as const;
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

// ── phase 2 ──
export const CLIENT_TYPES = ['BUSINESS', 'STARTUP', 'ENTERPRISE', 'NONPROFIT', 'INDIVIDUAL'] as const;
export const ONBOARDING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const PROJECT_STATUSES = ['PLANNING', 'IN_PROGRESS', 'REVIEW', 'CLIENT_APPROVAL', 'COMPLETED', 'ON_HOLD', 'CANCELLED'] as const;
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE'] as const;
export const SOCIAL_PLATFORMS = ['INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'LINKEDIN', 'YOUTUBE', 'X', 'OTHER'] as const;
export const CONTENT_TYPES = ['POST', 'CAROUSEL', 'REEL', 'STORY', 'VIDEO', 'ARTICLE', 'AD', 'OTHER'] as const;
export const CONTENT_STATUSES = ['IDEA', 'DRAFT', 'IN_REVIEW', 'CLIENT_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'REJECTED'] as const;
export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED'] as const;
export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
/** Derived approval state of a content item (comes from its linked deliverable - there is no second approval system). */
export const CONTENT_APPROVAL_STATUSES = ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED'] as const;

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
export type ClientType = (typeof CLIENT_TYPES)[number];
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type ContentApprovalStatus = (typeof CONTENT_APPROVAL_STATUSES)[number];

/** Request statuses that count as "open" on dashboards. */
export const OPEN_REQUEST_STATUSES: RequestStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'];

/** Task statuses that count as "still to do". */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED'];
/** Project statuses that count as "active" on dashboards. */
export const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = ['PLANNING', 'IN_PROGRESS', 'REVIEW', 'CLIENT_APPROVAL'];
/** Invoices that still expect money. */
export const OUTSTANDING_INVOICE_STATUSES: InvoiceStatus[] = ['SENT', 'PENDING', 'OVERDUE'];
