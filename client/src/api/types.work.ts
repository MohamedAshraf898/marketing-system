// Owner: Projects & tasks group. Client-side shapes for /projects and /tasks (see server/src/services/{projects,tasks}.ts).
import type { CustomFieldType, Priority, ProjectStatus, RecurrenceFrequency, Role, TaskStatus, TaskVisibility } from '@shared/enums';
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

export interface TaskListRef { id: string; name: string; spaceId: string; folderId: string | null; space: { id: string; name: string; color: string } }
export interface CustomStatusRef { id: string; name: string; color: string; category: TaskStatus }
export interface TagRef { id: string; name: string; color: string }
export interface TaskRecurrenceRef { id: string; frequency: RecurrenceFrequency; interval: number; weekdays: string | null; monthDay: number | null; nextDate: string; endDate: string | null; active: boolean }
export interface DependencyTask { id: string; title: string; status: TaskStatus; dueDate: string | null; assignedTo: { id: string; name: string } | null }
export interface TaskCustomFieldValue { id: string; name: string; type: CustomFieldType; options: string[]; spaceId: string | null; value: string | null }

export interface Task {
  id: string; title: string; description: string | null; projectId: string | null; clientId: string | null; campaignId: string | null;
  assignedToId: string | null; createdById: string | null; priority: Priority; status: TaskStatus; dueDate: string | null; completedAt: string | null;
  estimatedHours: number | null; actualHours: number; createdAt: string; updatedAt: string;
  assignedTo: TaskUserLite | null; createdBy: { id: string; name: string } | null;
  client: ClientLite | null; project: { id: string; name: string } | null; campaign: { id: string; name: string } | null;
  overdue: boolean; checklist: TaskChecklistProgress; commentCount: number; fileCount: number; permissions: TaskPermissions;
  // phase 3
  listId: string | null; parentId: string | null; depth: number; position: number; startDate: string | null; visibility: TaskVisibility;
  reviewerId: string | null; reviewer: TaskUserLite | null; deliverableId: string | null; deliverable: { id: string; name: string; status: string } | null;
  requestId: string | null; request: { id: string; title: string; status: string } | null; customStatusId: string | null; customStatus: CustomStatusRef | null;
  blockOnDependencies: boolean; archivedAt: string | null; recurrenceSourceId: string | null; occurrenceDate: string | null;
  list: TaskListRef | null; parent: { id: string; title: string } | null;
  assignees: TaskUserLite[]; tags: TagRef[]; recurrence: TaskRecurrenceRef | null; recurring: boolean;
  subtaskCounts: TaskChecklistProgress; subtaskCount: number; blocked: boolean; blockedByCount: number;
  // detail-only
  checklistItems?: TaskChecklistItem[];
  files?: FileRow[];
  subtasks?: Task[];
  ancestors?: Array<{ id: string; title: string }>;
  dependencies?: { blockedBy: Array<{ id: string; task: DependencyTask }>; blocking: Array<{ id: string; task: DependencyTask }>; related: Array<{ id: string; task: DependencyTask }> };
  customFields?: TaskCustomFieldValue[];
  time?: { trackedHours: number; estimatedHours: number | null; entries: number };
}

export interface TaskChecklistItem { id: string; taskId?: string; text: string; done: boolean; position: number; completedAt: string | null; createdAt?: string }
export interface TaskComment {
  id: string; taskId?: string; userId?: string; comment: string; createdAt: string; user: TaskUserLite;
  editedAt?: string | null; authorType?: 'CLIENT' | 'TEAM'; clientVisible?: boolean;
  mentions?: Array<{ id: string; name: string }>; attachments?: FileRow[]; permissions?: { canEdit: boolean; canDelete: boolean };
}

export interface TaskSummary { overdue: number; dueToday: number; dueThisWeek: number; open: number; byStatus: Record<TaskStatus, number> }
