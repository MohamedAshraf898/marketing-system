// Client-side shapes for attendance, leave, schedules and holidays (see server/src/routes/{attendance,leave,workSchedules}.ts).
import type { AttendanceStatus, LeaveStatus, LeaveType, PresenceState, Role } from '@shared/enums';
import type { Meta } from './types';

export interface ScheduleRef { id: string | null; name: string; timezone: string; startTime: string; endTime: string }
export interface Schedule extends ScheduleRef {
  workDays: number[]; breakMinutes: number; graceMinutes: number; minimumMinutes: number; isDefault?: boolean; memberCount?: number;
}

export interface AttendanceRecord {
  id: string | null; userId: string; user: { id: string; name: string; avatar: string | null; jobTitle: string | null } | null; date: string;
  checkInAt: string | null; checkOutAt: string | null; remote: boolean; status: AttendanceStatus; statusLocked: boolean;
  breakMinutes: number; workedMinutes: number; expectedMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number;
  open: boolean; onBreak: boolean; missingCheckout: boolean; presence: PresenceState; notes: string | null; isManual: boolean;
  correctedBy: { id: string; name: string } | null; correctedAt: string | null; leaveRequestId: string | null;
  breaks: Array<{ id: string; startAt: string; endAt: string | null }>; schedule: ScheduleRef;
  // calendar only
  future?: boolean; holidayName?: string | null;
}

export interface TodayResponse {
  item: AttendanceRecord; carryOver: AttendanceRecord | null; schedule: Schedule; today: string; holiday: string | null;
  leave: { id: string; type: LeaveType; start: string; end: string } | null; tracked: boolean; serverNow: string;
}

export interface Totals { workedMinutes: number; overtimeMinutes: number; lateMinutes: number; daysWorked?: number; avgWorkedMinutes?: number; breakMinutes?: number; expectedMinutes?: number }

export interface MyHistory { items: AttendanceRecord[]; meta: Meta; range: { from: string; to: string }; totals: Totals; statusCounts: Record<AttendanceStatus, number> }

export interface AttendanceSummary {
  range: { from: string; to: string }; today: string; timezone: string; members: number;
  presence: Record<PresenceState, number>; statusCounts: Record<AttendanceStatus, number>;
  totals: Required<Pick<Totals, 'workedMinutes' | 'overtimeMinutes' | 'lateMinutes' | 'daysWorked' | 'avgWorkedMinutes'>>;
}
export interface RecordsResponse { items: AttendanceRecord[]; meta: Meta; range: { from: string; to: string }; today: string }

export interface CalendarResponse {
  user: { id: string; name: string; avatar: string | null; jobTitle: string | null }; month: string; today: string; schedule: Schedule;
  days: AttendanceRecord[]; statusCounts: Record<AttendanceStatus, number>; totals: Totals;
}

export interface Correction { id: string; action: string; user: { id: string; name: string } | null; createdAt: string; metadata: { reason?: string; changes?: Record<string, { from: unknown; to: unknown }> } | null }
export interface RecordDetail { item: AttendanceRecord; corrections: Correction[] }

export interface AttendanceMember { id: string; name: string; avatar: string | null; jobTitle: string | null; role: Role; trackAttendance: boolean; workScheduleId: string | null; schedule: Schedule }

export interface ReportRow {
  user: { id: string; name: string; avatar: string | null; jobTitle: string | null }; statusCounts: Record<AttendanceStatus, number>; daysWorked: number;
  workedMinutes: number; expectedMinutes: number; overtimeMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; breakMinutes: number;
}

export interface LeaveRow {
  id: string; userId: string; user: { id: string; name: string; avatar: string | null; jobTitle: string | null }; type: LeaveType; status: LeaveStatus;
  startDate: string; endDate: string; days: number; reason: string | null; reviewedBy: { id: string; name: string } | null; reviewedAt: string | null;
  rejectionReason: string | null; createdAt: string; permissions: { canDecide: boolean; canCancel: boolean };
}
export interface LeaveResponse { items: LeaveRow[]; meta: Meta; pendingCount: number | null }

export interface Holiday { id: string; date: string; name: string }
