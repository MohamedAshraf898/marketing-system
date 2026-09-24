// Client-side shapes for the task workspace: spaces / folders / lists, custom fields, tags, templates, automations,
// My Tasks, Team Tasks, timeline and the client portal's shared tasks (see server/src/routes/{tasks,taskSetup,taskTemplates,clientTasks}.ts).
import type { AutomationAction, AutomationTrigger, CustomFieldType, Priority, TaskStatus } from '@shared/enums';
import type { Meta } from './types';
import type { Task } from './types.work';

export interface StatusOption { id: string; name: string; color: string; category: TaskStatus; position: number }
export interface ListNode {
  id: string; name: string; description: string | null; color: string | null; folderId: string | null; spaceId: string; projectId: string | null;
  project: { id: string; name: string } | null; position: number; archivedAt: string | null; openTasks: number;
}
export interface FolderNode { id: string; name: string; projectId: string | null; project: { id: string; name: string } | null; position: number; archivedAt: string | null; lists: ListNode[] }
export interface SpaceNode {
  id: string; name: string; description: string | null; color: string; clientId: string | null; client: { id: string; companyName: string } | null;
  position: number; archivedAt: string | null; statuses: StatusOption[]; folders: FolderNode[]; lists: ListNode[]; canManage: boolean;
}
export interface SpaceTree { items: SpaceNode[]; canCreate: boolean }

export interface CustomField { id: string; name: string; type: CustomFieldType; options: string[]; spaceId: string | null; position: number }
export interface TagRow { id: string; name: string; color: string; count: number }

export interface TemplateItem { id: string; title: string; description: string | null; position: number; estimatedHours: number | null; dueOffsetDays: number | null }
export interface TaskTemplate {
  id: string; name: string; description: string | null; taskTitle: string; taskDescription: string | null; priority: Priority;
  estimatedHours: number | null; checklist: string[]; tags: string[]; items: TemplateItem[]; createdAt: string;
}

export interface AutomationConfig { userId?: string; priority?: Priority; title?: string; description?: string; dueInDays?: number; assign?: 'same' | 'none' | 'user'; asSubtask?: boolean; message?: string }
export interface Automation {
  id: string; name: string; enabled: boolean; spaceId: string | null; listId: string | null; trigger: AutomationTrigger; triggerStatus: TaskStatus | null;
  action: AutomationAction; config: AutomationConfig; runCount: number; lastRunAt: string | null; createdAt: string;
}

export interface MyOverview {
  counts: { assigned: number; completedThisWeek: number; overdue: number; dueToday: number; upcoming: number; highPriority: number; urgent: number; noDueDate: number };
  lists: { overdue: Task[]; dueToday: Task[]; upcoming: Task[]; highPriority: Task[]; urgent: Task[]; noDueDate: Task[]; completed: Task[] };
  weekStart: string;
}

export interface TaskGroup { key: string | null; label: string | null; total: number; open: number; overdue: number; done: number }
export interface GroupedTasks { by: 'assignee' | 'project' | 'client' | 'status' | 'list'; groups: TaskGroup[] }

export interface TimelineResponse { range: { from: string; to: string }; items: Task[]; dependencies: Array<{ id: string; taskId: string; dependsOnId: string }>; truncated: boolean }

export interface ActivityRow { id: string; action: string; user: { id: string; name: string; avatar: string | null } | null; createdAt: string; metadata: Record<string, unknown> | null }

export interface BulkResult { updated: number; skipped: Array<{ id: string; reason: string }> }

// ── client portal ──
export interface SharedTask {
  id: string; title: string; description: string | null; status: TaskStatus; priority: Priority; startDate: string | null; dueDate: string | null;
  completedAt: string | null; createdAt: string; updatedAt: string; project: { id: string; name: string } | null; parentId: string | null;
  overdue: boolean; subtasks: { done: number; total: number }; commentCount: number;
}
export interface SharedTaskDetail extends Omit<SharedTask, 'subtasks'> {
  subtasks: SharedTask[];
  comments: Array<{ id: string; comment: string; createdAt: string; editedAt: string | null; authorType: 'CLIENT' | 'TEAM'; user: { id: string; name: string; avatar: string | null } }>;
}
export interface SharedTasksResponse { items: SharedTask[]; meta: Meta; counts: Record<TaskStatus, number> }

// ── reports ──
export interface TaskReportRow {
  key: string | null; label: string | null; created: number; completed: number; completedOnTime: number; open: number; overdue: number;
  estimatedHours: number; trackedOnCompleted: number; trackedInPeriod: number;
}
export interface TaskReport { by: 'assignee' | 'client' | 'project'; range: { from: string; to: string }; items: TaskReportRow[]; totals: Omit<TaskReportRow, 'key' | 'label'>; truncated: boolean }
