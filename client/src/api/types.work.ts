// Owner: Projects & tasks group. Client-side shapes for /projects and /tasks (see server/src/services/{projects,tasks}.ts).
import type { Priority, ProjectStatus, Role, TaskStatus } from '@shared/enums';
import type { ClientLite, FileRow } from './types';

export interface ProjectManagerLite { id: string; name: string; avatar: string | null; role: Role }

export interface ProjectTaskCounts { total: number; done: number; overdue: number }
export interface MilestoneCounts { total: number; done: number }
export interface NextMilestone { id: string; title: string; dueDate: string | null }
export interface ProjectPermissions { canEdit: boolean; canDelete: boolean }

export interface ProjectCampaignLite {
  id: string; name: string; status: string; platform: string; objective: string;
  startDate?: string | null; endDate?: string | null; budget?: number; spent?: number;
}

/** A project as the API returns it. Detail-only fields are optional (present on GET /projects/:id). */
export interface Project {
  id: string; clientId: string; name: string; description: string | null; status: ProjectStatus; priority: Priority;
  startDate: string | null; dueDate: string | null; completedAt: string | null; projectManagerId: string | null;
  budget?: number | null; visibleToClient: boolean; createdById: string | null; createdAt: string; updatedAt: string;
  client: ClientLite; projectManager: ProjectManagerLite | null;
  progress: number; overdue: boolean; taskCounts: ProjectTaskCounts; milestoneCounts: MilestoneCounts; nextMilestone: NextMilestone | null;
  permissions?: ProjectPermissions;
  // detail-only
  milestones?: Milestone[];
  taskCountsByStatus?: Record<TaskStatus, number>;
  campaigns?: ProjectCampaignLite[];
  deliverableCounts?: { total: number; byStatus: Record<string, number> };
  counts?: { files: number; deliverables: number; campaigns?: number; tasks?: number };
}

export interface Milestone {
  id: string; projectId?: string; title: string; description: string | null; dueDate: string | null; completedAt: string | null; position: number; createdAt?: string; updatedAt?: string;
}

export interface TaskUserLite { id: string; name: string; avatar: string | null; role: Role }
export interface TaskChecklistProgress { done: number; total: number }
export interface TaskPermissions { canWork: boolean; canEditFields: boolean; canDelete: boolean; canAssign: boolean }

export interface Task {
  id: string; title: string; description: string | null; projectId: string | null; clientId: string | null; campaignId: string | null;
  assignedToId: string | null; createdById: string | null; priority: Priority; status: TaskStatus; dueDate: string | null; completedAt: string | null;
  estimatedHours: number | null; actualHours: number; createdAt: string; updatedAt: string;
  assignedTo: TaskUserLite | null; createdBy: { id: string; name: string } | null;
  client: ClientLite | null; project: { id: string; name: string } | null; campaign: { id: string; name: string } | null;
  overdue: boolean; checklist: TaskChecklistProgress; commentCount: number; fileCount: number; permissions: TaskPermissions;
  // detail-only
  checklistItems?: TaskChecklistItem[];
  files?: FileRow[];
}

export interface TaskChecklistItem { id: string; taskId?: string; text: string; done: boolean; position: number; completedAt: string | null; createdAt?: string }
export interface TaskComment { id: string; taskId?: string; comment: string; createdAt: string; user: TaskUserLite }

export interface TaskSummary { overdue: number; dueToday: number; dueThisWeek: number; open: number; byStatus: Record<TaskStatus, number> }
