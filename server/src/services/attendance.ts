// Attendance: schedules, the (pure) daily calculation, roster + leave / holiday lookups.  Routes: routes/attendance.ts,
// routes/leave.ts, routes/workSchedules.ts.
//
// Rules
//  - Every timestamp is taken from the SERVER clock. Nothing time-related is ever read from a request body for a
//    person's own check-in / check-out / break (only an administrator correction may set times, and it is audited).
//  - A day is decided in the zone of the person's work schedule: "late" means late on the local wall clock.
//  - Stored minute columns are refreshed on every change; open (still checked-in) days are recomputed live for display.
import type { AttendanceBreak, Prisma, WorkSchedule } from '@prisma/client';
import type { AttendanceStatus, PresenceState } from '../../../shared/src/enums';
import { prisma } from '../db';
import { addDaysKey, dateOnly, eachDayKey, keyOf, localDateKey, parseHm, weekdayOfKey, zonedToUtc } from '../lib/zoned';

type Db = Prisma.TransactionClient | typeof prisma;

// ───────────────────────── schedules ─────────────────────────

export interface Schedule {
  id: string | null;
  name: string;
  timezone: string;
  workDays: number[];
  startMin: number;
  endMin: number;
  breakMinutes: number;
  graceMinutes: number;
  minimumMinutes: number;
}

/** Used only when the database holds no schedule at all (the migration creates one). */
export const FALLBACK_SCHEDULE: Schedule = {
  id: null, name: 'Standard', timezone: 'UTC', workDays: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020, breakMinutes: 60, graceMinutes: 10, minimumMinutes: 240,
};

export const parseWorkDays = (raw: string): number[] =>
  [...new Set(raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();

export function toSchedule(row: WorkSchedule): Schedule {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    workDays: parseWorkDays(row.workDays),
    startMin: parseHm(row.startTime) ?? FALLBACK_SCHEDULE.startMin,
    endMin: parseHm(row.endTime) ?? FALLBACK_SCHEDULE.endMin,
    breakMinutes: row.breakMinutes,
    graceMinutes: row.graceMinutes,
    minimumMinutes: row.minimumMinutes,
  };
}

export interface ScheduleBook { byId: Map<string, Schedule>; def: Schedule }

/** All schedules (a handful of rows) + the default one. */
export async function loadSchedules(db: Db = prisma): Promise<ScheduleBook> {
  const rows = await db.workSchedule.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  const byId = new Map(rows.map((r) => [r.id, toSchedule(r)]));
  return { byId, def: rows[0] ? toSchedule(rows[0]) : FALLBACK_SCHEDULE };
}

export const scheduleOf = (book: ScheduleBook, scheduleId: string | null | undefined): Schedule =>
  (scheduleId ? book.byId.get(scheduleId) : undefined) ?? book.def;

export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const scheduleDto = (s: Schedule) => ({
  id: s.id, name: s.name, timezone: s.timezone, workDays: s.workDays, startTime: hm(s.startMin), endTime: hm(s.endMin),
  breakMinutes: s.breakMinutes, graceMinutes: s.graceMinutes, minimumMinutes: s.minimumMinutes,
});

export const isWorkDay = (s: Schedule, key: string) => s.workDays.includes(weekdayOfKey(key));

/** Planned working minutes of a day (0 on days off and holidays). */
export const plannedMinutes = (s: Schedule, key: string, holiday: boolean) =>
  !holiday && isWorkDay(s, key) ? Math.max(0, s.endMin - s.startMin - s.breakMinutes) : 0;

/** "Today" for a schedule (its local calendar date). */
export const todayKeyFor = (s: Schedule, now = new Date()) => localDateKey(now, s.timezone);

// ───────────────────────── the calculation (pure) ─────────────────────────

export interface DayInput {
  dateKey: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  remote: boolean;
  breaks: Array<Pick<AttendanceBreak, 'startAt' | 'endAt'>>;
  onLeave: boolean;
  holiday: boolean;
  /** an administrator's fixed status (statusLocked) */
  lockedStatus?: AttendanceStatus | null;
}

export interface DayResult {
  status: AttendanceStatus;
  breakMinutes: number;
  workedMinutes: number;
  expectedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  /** checked in, not yet checked out */
  open: boolean;
  /** still open long after the day ended: somebody forgot to check out */
  missingCheckout: boolean;
  onBreak: boolean;
}

/** An open day is counted until "now", but never past 06:00 the next local morning (forgotten check-outs stay bounded). */
export const openDayCap = (s: Schedule, key: string) => zonedToUtc(addDaysKey(key, 1), 6 * 60, s.timezone);

export function computeDay(input: DayInput, s: Schedule, now = new Date()): DayResult {
  const workDay = isWorkDay(s, input.dateKey);
  const planned = plannedMinutes(s, input.dateKey, input.holiday);

  if (!input.checkInAt) {
    const status: AttendanceStatus = input.onLeave ? 'ON_LEAVE' : input.holiday ? 'HOLIDAY' : workDay ? 'ABSENT' : 'DAY_OFF';
    return {
      status: input.lockedStatus ?? status,
      breakMinutes: 0, workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0,
      expectedMinutes: status === 'ABSENT' ? planned : 0,
      open: false, missingCheckout: false, onBreak: false,
    };
  }

  const inMs = input.checkInAt.getTime();
  const cap = openDayCap(s, input.dateKey).getTime();
  const open = !input.checkOutAt;
  const endMs = input.checkOutAt ? input.checkOutAt.getTime() : Math.max(inMs, Math.min(now.getTime(), cap));

  let breakMs = 0;
  let onBreak = false;
  for (const b of input.breaks) {
    if (!b.endAt && open) onBreak = true;
    const from = Math.max(b.startAt.getTime(), inMs);
    const to = Math.min(b.endAt ? b.endAt.getTime() : endMs, endMs);
    if (to > from) breakMs += to - from;
  }
  const workedMinutes = Math.max(0, Math.floor((endMs - inMs - breakMs) / 60_000));
  const counts = workDay && !input.holiday;
  const start = zonedToUtc(input.dateKey, s.startMin, s.timezone).getTime();
  const end = zonedToUtc(input.dateKey, s.endMin, s.timezone).getTime();
  const lateMinutes = counts && inMs > start + s.graceMinutes * 60_000 ? Math.floor((inMs - start) / 60_000) : 0;
  const earlyLeaveMinutes = counts && input.checkOutAt && input.checkOutAt.getTime() < end ? Math.floor((end - input.checkOutAt.getTime()) / 60_000) : 0;
  const overtimeMinutes = planned > 0 ? Math.max(0, workedMinutes - planned) : workedMinutes;

  let status: AttendanceStatus;
  if (!open && planned > 0 && workedMinutes < s.minimumMinutes) status = 'HALF_DAY';
  else if (input.remote) status = 'WFH';
  else if (lateMinutes > 0) status = 'LATE';
  else status = 'PRESENT';

  return {
    status: input.lockedStatus ?? status,
    breakMinutes: Math.round(breakMs / 60_000),
    workedMinutes,
    expectedMinutes: planned,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    open,
    missingCheckout: open && now.getTime() > cap,
    onBreak,
  };
}

/** Live state for the daily board. Before start + grace a person without a check-in is "not checked in yet", after it "absent". */
export function presenceOf(r: DayResult, hasCheckIn: boolean, s: Schedule, key: string, now = new Date()): PresenceState {
  if (hasCheckIn) return r.open ? (r.onBreak ? 'ON_BREAK' : 'WORKING') : 'CHECKED_OUT';
  if (r.status === 'ON_LEAVE') return 'ON_LEAVE';
  if (r.status === 'HOLIDAY') return 'HOLIDAY';
  if (r.status === 'DAY_OFF') return 'DAY_OFF';
  if (key === todayKeyFor(s, now) && now.getTime() <= zonedToUtc(key, s.startMin + s.graceMinutes, s.timezone).getTime()) return 'NOT_CHECKED_IN';
  if (key > todayKeyFor(s, now)) return 'NOT_CHECKED_IN';
  return 'ABSENT';
}

// ───────────────────────── lookups ─────────────────────────

export const memberSelect = { id: true, name: true, avatar: true, jobTitle: true, role: true, workScheduleId: true, createdAt: true } satisfies Prisma.UserSelect;
export type Member = Prisma.UserGetPayload<{ select: typeof memberSelect }>;

/** People on the attendance roster: active staff with attendance tracking switched on. */
export function rosterMembers(extra?: Prisma.UserWhereInput): Promise<Member[]> {
  return prisma.user.findMany({
    where: { AND: [{ status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] }, trackAttendance: true }, extra ?? {}] },
    select: memberSelect,
    orderBy: { name: 'asc' },
  });
}

export async function holidayKeys(fromKey: string, toKey: string, db: Db = prisma): Promise<Map<string, string>> {
  const rows = await db.holiday.findMany({ where: { date: { gte: dateOnly(fromKey), lte: dateOnly(toKey) } }, select: { date: true, name: true } });
  return new Map(rows.map((r) => [keyOf(r.date), r.name]));
}

export interface LeaveSpan { id: string; userId: string; type: string; start: string; end: string }

export async function approvedLeaves(userIds: string[], fromKey: string, toKey: string, db: Db = prisma): Promise<Map<string, LeaveSpan[]>> {
  const out = new Map<string, LeaveSpan[]>();
  if (userIds.length === 0) return out;
  const rows = await db.leaveRequest.findMany({
    where: { userId: { in: userIds }, status: 'APPROVED', startDate: { lte: dateOnly(toKey) }, endDate: { gte: dateOnly(fromKey) } },
    select: { id: true, userId: true, type: true, startDate: true, endDate: true },
  });
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push({ id: r.id, userId: r.userId, type: r.type, start: keyOf(r.startDate), end: keyOf(r.endDate) });
    out.set(r.userId, list);
  }
  return out;
}

export const leaveOn = (m: Map<string, LeaveSpan[]>, userId: string, key: string) => m.get(userId)?.find((l) => l.start <= key && l.end >= key) ?? null;

/** Working days (per schedule, minus holidays) inside a date range - the "days" of a leave request. */
export async function workingDaysBetween(s: Schedule, fromKey: string, toKey: string): Promise<string[]> {
  const holidays = await holidayKeys(fromKey, toKey);
  return eachDayKey(fromKey, toKey).filter((k) => isWorkDay(s, k) && !holidays.has(k));
}

// ───────────────────────── persistence ─────────────────────────

export const attendanceInclude = {
  breaks: { orderBy: { startAt: 'asc' } },
  user: { select: { id: true, name: true, avatar: true, jobTitle: true, workScheduleId: true } },
  correctedBy: { select: { id: true, name: true } },
} satisfies Prisma.AttendanceInclude;

export type AttendanceRow = Prisma.AttendanceGetPayload<{ include: typeof attendanceInclude }>;

/** Recomputes the stored minute columns + status of one record from its raw times (inside the caller's transaction). */
export async function recompute(db: Db, id: string, now = new Date()): Promise<void> {
  const row = await db.attendance.findUnique({ where: { id }, include: { breaks: true, user: { select: { workScheduleId: true } } } });
  if (!row) return;
  const book = await loadSchedules(db);
  const s = scheduleOf(book, row.scheduleId ?? row.user.workScheduleId);
  const key = keyOf(row.date);
  const [holidays, leaves] = await Promise.all([holidayKeys(key, key, db), approvedLeaves([row.userId], key, key, db)]);
  const r = computeDay(
    {
      dateKey: key, checkInAt: row.checkInAt, checkOutAt: row.checkOutAt, remote: row.remote, breaks: row.breaks,
      onLeave: !!row.leaveRequestId || !!leaveOn(leaves, row.userId, key), holiday: holidays.has(key),
      lockedStatus: row.statusLocked ? row.status : null,
    },
    s,
    now,
  );
  await db.attendance.update({
    where: { id },
    data: {
      status: r.status, breakMinutes: r.breakMinutes, workedMinutes: r.workedMinutes, expectedMinutes: r.expectedMinutes,
      lateMinutes: r.lateMinutes, earlyLeaveMinutes: r.earlyLeaveMinutes, overtimeMinutes: r.overtimeMinutes,
    },
  });
}

/** API shape of a stored record. Open days are recomputed live so the numbers keep moving while someone works. */
export function attendanceDto(row: AttendanceRow, s: Schedule, holiday: boolean, now = new Date()) {
  const key = keyOf(row.date);
  const live = computeDay(
    { dateKey: key, checkInAt: row.checkInAt, checkOutAt: row.checkOutAt, remote: row.remote, breaks: row.breaks, onLeave: !!row.leaveRequestId, holiday, lockedStatus: row.statusLocked ? row.status : null },
    s,
    now,
  );
  const useLive = live.open;
  return {
    id: row.id as string | null,
    userId: row.userId,
    user: row.user ? { id: row.user.id, name: row.user.name, avatar: row.user.avatar, jobTitle: row.user.jobTitle } : null,
    date: key,
    checkInAt: row.checkInAt?.toISOString() ?? null,
    checkOutAt: row.checkOutAt?.toISOString() ?? null,
    remote: row.remote,
    status: useLive ? live.status : row.status,
    statusLocked: row.statusLocked,
    breakMinutes: useLive ? live.breakMinutes : row.breakMinutes,
    workedMinutes: useLive ? live.workedMinutes : row.workedMinutes,
    expectedMinutes: useLive ? live.expectedMinutes : row.expectedMinutes,
    lateMinutes: useLive ? live.lateMinutes : row.lateMinutes,
    earlyLeaveMinutes: useLive ? live.earlyLeaveMinutes : row.earlyLeaveMinutes,
    overtimeMinutes: useLive ? live.overtimeMinutes : row.overtimeMinutes,
    open: live.open,
    onBreak: live.onBreak,
    missingCheckout: live.missingCheckout,
    presence: presenceOf(live, !!row.checkInAt, s, key, now),
    notes: row.notes,
    isManual: row.isManual,
    correctedBy: row.correctedBy,
    correctedAt: row.correctedAt?.toISOString() ?? null,
    leaveRequestId: row.leaveRequestId,
    breaks: row.breaks.map((b) => ({ id: b.id, startAt: b.startAt.toISOString(), endAt: b.endAt?.toISOString() ?? null })),
    schedule: { id: s.id, name: s.name, timezone: s.timezone, startTime: hm(s.startMin), endTime: hm(s.endMin) },
  };
}

export type AttendanceDto = ReturnType<typeof attendanceDto>;

/** A day without a stored record (virtual row on the board / calendar). */
export function virtualDto(m: Pick<Member, 'id' | 'name' | 'avatar' | 'jobTitle'>, key: string, s: Schedule, holiday: boolean, leave: LeaveSpan | null, now = new Date()): AttendanceDto {
  const r = computeDay({ dateKey: key, checkInAt: null, checkOutAt: null, remote: false, breaks: [], onLeave: !!leave, holiday }, s, now);
  return {
    id: null, userId: m.id, user: { id: m.id, name: m.name, avatar: m.avatar, jobTitle: m.jobTitle }, date: key,
    checkInAt: null, checkOutAt: null, remote: false, status: r.status, statusLocked: false,
    breakMinutes: 0, workedMinutes: 0, expectedMinutes: r.expectedMinutes, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0,
    open: false, onBreak: false, missingCheckout: false, presence: presenceOf(r, false, s, key, now),
    notes: null, isManual: false, correctedBy: null, correctedAt: null, leaveRequestId: leave?.id ?? null, breaks: [],
    schedule: { id: s.id, name: s.name, timezone: s.timezone, startTime: hm(s.startMin), endTime: hm(s.endMin) },
  };
}

/**
 * One row per roster member for one day: the stored record, or a virtual one (absent / day off / leave / holiday / not in yet).
 * Queries: roster, records of the day, holidays, leaves - never one query per person.
 */
export async function dayBoard(key: string, book: ScheduleBook, now: Date, userId?: string, evenIfUntracked = false) {
  const members = evenIfUntracked && userId
    ? await prisma.user.findMany({ where: { id: userId, status: 'ACTIVE', role: { in: ['ADMIN', 'TEAM'] } }, select: memberSelect })
    : await rosterMembers(userId ? { id: userId } : undefined);
  const ids = members.map((m) => m.id);
  const [rows, holidays, leaves] = await Promise.all([
    prisma.attendance.findMany({ where: { date: dateOnly(key), userId: { in: ids } }, include: attendanceInclude }),
    holidayKeys(key, key),
    approvedLeaves(ids, key, key),
  ]);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  return members.map((m) => {
    const s = scheduleOf(book, m.workScheduleId);
    const r = byUser.get(m.id);
    return r ? attendanceDto(r, scheduleOf(book, r.scheduleId ?? m.workScheduleId), holidays.has(key), now) : virtualDto(m, key, s, holidays.has(key), leaveOn(leaves, m.id, key), now);
  });
}

// ───────────────────────── leave -> attendance ─────────────────────────

/**
 * Marks the working days of an approved leave as ON_LEAVE. Days somebody actually worked are left alone (their
 * check-in wins), days already holding a leave-less "absent" row are converted. Returns how many days were marked.
 */
export async function applyLeave(db: Db, leave: { id: string; userId: string; startDate: Date; endDate: Date }, s: Schedule): Promise<number> {
  const from = keyOf(leave.startDate);
  const to = keyOf(leave.endDate);
  const holidays = await holidayKeys(from, to, db);
  const days = eachDayKey(from, to).filter((k) => isWorkDay(s, k) && !holidays.has(k));
  if (days.length === 0) return 0;
  const existing = await db.attendance.findMany({ where: { userId: leave.userId, date: { in: days.map(dateOnly) } }, select: { id: true, date: true, checkInAt: true } });
  const byKey = new Map(existing.map((e) => [keyOf(e.date), e]));
  let n = 0;
  for (const k of days) {
    const e = byKey.get(k);
    if (e?.checkInAt) continue;
    if (e) await db.attendance.update({ where: { id: e.id }, data: { status: 'ON_LEAVE', leaveRequestId: leave.id, expectedMinutes: 0, statusLocked: false } });
    else await db.attendance.create({ data: { userId: leave.userId, date: dateOnly(k), scheduleId: s.id, status: 'ON_LEAVE', leaveRequestId: leave.id } });
    n++;
  }
  return n;
}

/** Undoes applyLeave: leave-only rows disappear (the day is judged again like any other day). */
export async function unapplyLeave(db: Db, leaveId: string): Promise<void> {
  await db.attendance.deleteMany({ where: { leaveRequestId: leaveId, checkInAt: null } });
  await db.attendance.updateMany({ where: { leaveRequestId: leaveId }, data: { leaveRequestId: null } });
}

// ───────────────────────── nightly close ─────────────────────────

/**
 * Persists the days that are over: every working day in the last `lookbackDays` (before each person's local today)
 * without a record becomes ABSENT, or ON_LEAVE / HOLIDAY when that applies. Idempotent - existing rows are never touched,
 * and the (userId, date) unique key makes a concurrent second run harmless.
 */
export async function closePastDays(now = new Date(), lookbackDays = 7): Promise<number> {
  const book = await loadSchedules();
  const members = await rosterMembers();
  if (members.length === 0) return 0;
  const globalFrom = addDaysKey(localDateKey(now, 'UTC'), -(lookbackDays + 1));
  const globalTo = addDaysKey(localDateKey(now, 'UTC'), 1);
  const [holidays, leaves, existing] = await Promise.all([
    holidayKeys(globalFrom, globalTo),
    approvedLeaves(members.map((m) => m.id), globalFrom, globalTo),
    prisma.attendance.findMany({ where: { userId: { in: members.map((m) => m.id) }, date: { gte: dateOnly(globalFrom) } }, select: { userId: true, date: true } }),
  ]);
  const have = new Set(existing.map((e) => `${e.userId}|${keyOf(e.date)}`));
  let created = 0;
  for (const m of members) {
    const s = scheduleOf(book, m.workScheduleId);
    const today = todayKeyFor(s, now);
    const joined = localDateKey(m.createdAt, s.timezone);
    for (let i = lookbackDays; i >= 1; i--) {
      const k = addDaysKey(today, -i);
      if (k < joined || have.has(`${m.id}|${k}`) || !isWorkDay(s, k)) continue;
      const leave = leaveOn(leaves, m.id, k);
      const status: AttendanceStatus = leave ? 'ON_LEAVE' : holidays.has(k) ? 'HOLIDAY' : 'ABSENT';
      try {
        await prisma.attendance.create({
          data: { userId: m.id, date: dateOnly(k), scheduleId: s.id, status, leaveRequestId: leave?.id ?? null, expectedMinutes: status === 'ABSENT' ? plannedMinutes(s, k, false) : 0 },
        });
        created++;
      } catch {
        /* created concurrently: fine */
      }
    }
  }
  return created;
}
