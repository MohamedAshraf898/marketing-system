// Client-side types of the time tracking + workload API (Group C). Time data is internal: CLIENT users never receive any of it.
import type { Meta } from './types';

export interface TimeEntry {
  id: string;
  userId: string;
  user: { id: string; name: string } | null;
  taskId: string | null;
  task: { id: string; title: string } | null;
  projectId: string | null;
  project: { id: string; name: string } | null;
  clientId: string | null;
  client: { id: string; companyName: string } | null;
  startedAt: string;
  endedAt: string | null;
  running: boolean;
  /** seconds; for a running entry the server-side elapsed time at response time */
  durationSec: number;
  notes: string | null;
  createdAt: string;
}

export interface TimerResponse { item: TimeEntry | null; elapsedSec: number; capped: boolean; serverNow: string }
export interface TimerStartResponse { item: TimeEntry; stopped: TimeEntry | null; stoppedCapped: boolean; serverNow: string }
export interface TimerStopResponse { item: TimeEntry; capped: boolean }
export interface TimerStartBody { taskId?: string; projectId?: string; clientId?: string; notes?: string }

export interface EntriesResponse { items: TimeEntry[]; meta: Meta; totals: { seconds: number; hours: number; count: number } }

export interface MyTimeDay { date: string; seconds: number; hours: number; entries: TimeEntry[] }
export interface MyTimeResponse {
  tz: number;
  serverNow: string;
  today: { date: string; seconds: number; hours: number };
  week: { start: string; end: string; seconds: number; hours: number };
  days: MyTimeDay[];
  running: TimeEntry | null;
}

export interface ReportTotals { seconds: number; hours: number; entries: number }
export interface ClientTimeReport {
  client: { id: string; companyName: string };
  range: { from: string | null; to: string | null };
  truncated: boolean;
  totals: ReportTotals;
  byProject: Array<{ projectId: string | null; name: string | null; seconds: number; hours: number; entries: number }>;
  byTask: Array<{ taskId: string | null; title: string | null; projectId: string | null; seconds: number; hours: number; entries: number }>;
  byUser: Array<{ userId: string | null; name: string | null; seconds: number; hours: number; entries: number }>;
  byDay: Array<{ date: string; seconds: number; hours: number; entries: number }>;
}

export type LoadIndicator = 'LOW' | 'BALANCED' | 'HIGH' | 'OVERLOADED';
export interface WorkloadRow {
  user: { id: string; name: string; role: string; jobTitle: string | null; avatar: string | null };
  openTasks: number;
  overdueTasks: number;
  dueInWindow: number;
  dueToday?: number;
  completedTasks?: number;
  unestimatedTasks: number;
  estimatedHours: number;
  loggedHours: number;
  loggedPartial: boolean;
  activeProjects: number;
  weeklyCapacityHours: number;
  capacityHours: number;
  utilization: number;
  indicator: LoadIndicator;
}
export interface WorkloadResponse {
  window: { from: string; to: string; days: number; weeks: number };
  thresholds: { low: number; balanced: number; high: number };
  items: WorkloadRow[];
}
export interface WorkloadTask {
  id: string; title: string; status: string; priority: string; dueDate: string | null; estimatedHours: number | null; actualHours: number; overdue: boolean;
  project: { id: string; name: string } | null; client: { id: string; companyName: string } | null;
}
export interface WorkloadTasksResponse { user: WorkloadRow['user']; items: WorkloadTask[] }

/** What the task picker needs from GET /tasks?mine=1 (owned by the work group; only these fields are used). */
export interface TaskLite { id: string; title: string; status?: string; project?: { id: string; name: string } | null; client?: { id: string; companyName: string } | null }
