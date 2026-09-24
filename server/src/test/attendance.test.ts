import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db';
import { DEFAULT_TEAM_PERMISSIONS } from '../../../shared/src/permissions';
import { computeDay, closePastDays, FALLBACK_SCHEDULE, type Schedule } from '../services/attendance';
import { zonedToUtc } from '../lib/zoned';
import { buildWorld, loginAs, type Agent, type World } from './helpers';

let w: World;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;
let alice: Agent;

// 2026-03-02 is a Monday. The default schedule (from the migration) is Mon-Fri 09:00-17:00 UTC, 60 min break, 10 min grace.
const at = (iso: string) => vi.setSystemTime(new Date(iso));

async function setPerms(userId: string, perms: string[] | null) {
  await prisma.user.update({ where: { id: userId }, data: { permissions: perms ? JSON.stringify(perms) : null } });
}

beforeAll(async () => {
  w = await buildWorld();
  // everybody "joined" long ago so the nightly close may judge past days
  await prisma.user.updateMany({ data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
  [admin, teamA, teamB, alice] = await Promise.all(['admin@t.test', 'teama@t.test', 'teamb@t.test', 'alice@alpha.test'].map((e) => loginAs(e)));
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => at('2026-03-02T12:00:00Z'));
afterAll(() => vi.useRealTimers());

// ───────────────────────── pure calculation ─────────────────────────

describe('computeDay (pure)', () => {
  const s: Schedule = { ...FALLBACK_SCHEDULE }; // Mon-Fri 09:00-17:00 UTC, 60 min break, grace 10, minimum 240
  const d = (hm: string) => new Date(`2026-03-02T${hm}:00Z`);
  const base = { dateKey: '2026-03-02', remote: false, breaks: [], onLeave: false, holiday: false };

  it('on time within the grace period; expected = 8h - 1h break', () => {
    const r = computeDay({ ...base, checkInAt: d('09:08'), checkOutAt: d('17:00') }, s);
    expect(r).toMatchObject({ status: 'PRESENT', lateMinutes: 0, workedMinutes: 472, expectedMinutes: 420, overtimeMinutes: 52, earlyLeaveMinutes: 0, open: false });
  });

  it('late after the grace period counts from the start time', () => {
    const r = computeDay({ ...base, checkInAt: d('09:25'), checkOutAt: d('17:30') }, s);
    expect(r).toMatchObject({ status: 'LATE', lateMinutes: 25 });
  });

  it('breaks are subtracted; early leave and half day', () => {
    const r = computeDay({ ...base, checkInAt: d('09:00'), checkOutAt: d('12:00'), breaks: [{ startAt: d('10:00'), endAt: d('10:30') }] }, s);
    expect(r).toMatchObject({ breakMinutes: 30, workedMinutes: 150, earlyLeaveMinutes: 300, status: 'HALF_DAY', overtimeMinutes: 0 });
  });

  it('remote work is WFH (lateness still recorded)', () => {
    const r = computeDay({ ...base, remote: true, checkInAt: d('09:40'), checkOutAt: d('17:00') }, s);
    expect(r).toMatchObject({ status: 'WFH', lateMinutes: 40 });
  });

  it('no check-in: absent on a working day, day off on a weekend, holiday, leave', () => {
    expect(computeDay({ ...base, checkInAt: null, checkOutAt: null }, s)).toMatchObject({ status: 'ABSENT', expectedMinutes: 420 });
    expect(computeDay({ ...base, dateKey: '2026-03-01', checkInAt: null, checkOutAt: null }, s).status).toBe('DAY_OFF');
    expect(computeDay({ ...base, holiday: true, checkInAt: null, checkOutAt: null }, s)).toMatchObject({ status: 'HOLIDAY', expectedMinutes: 0 });
    expect(computeDay({ ...base, onLeave: true, checkInAt: null, checkOutAt: null }, s)).toMatchObject({ status: 'ON_LEAVE', expectedMinutes: 0 });
  });

  it('work on a day off is all overtime and never late', () => {
    const r = computeDay({ ...base, dateKey: '2026-03-01', checkInAt: new Date('2026-03-01T11:00:00Z'), checkOutAt: new Date('2026-03-01T13:00:00Z') }, s);
    expect(r).toMatchObject({ status: 'PRESENT', lateMinutes: 0, workedMinutes: 120, overtimeMinutes: 120, expectedMinutes: 0 });
  });

  it('an open day counts until now, an open break marks "on break", a forgotten check-out is capped and flagged', () => {
    const now = d('11:00');
    const open = computeDay({ ...base, checkInAt: d('09:00'), checkOutAt: null, breaks: [{ startAt: d('10:30'), endAt: null }] }, s, now);
    expect(open).toMatchObject({ open: true, onBreak: true, workedMinutes: 90, breakMinutes: 30 });
    const forgotten = computeDay({ ...base, checkInAt: d('09:00'), checkOutAt: null }, s, new Date('2026-03-05T12:00:00Z'));
    expect(forgotten.missingCheckout).toBe(true);
    expect(forgotten.workedMinutes).toBe(21 * 60); // capped at 06:00 the next morning
  });

  it('uses the schedule time zone (09:00 in Cairo is 07:00 UTC in March)', () => {
    const cairo: Schedule = { ...s, timezone: 'Africa/Cairo' };
    expect(zonedToUtc('2026-03-02', 9 * 60, 'Africa/Cairo').toISOString()).toBe('2026-03-02T07:00:00.000Z');
    expect(computeDay({ ...base, checkInAt: new Date('2026-03-02T07:05:00Z'), checkOutAt: new Date('2026-03-02T15:00:00Z') }, cairo).status).toBe('PRESENT');
    expect(computeDay({ ...base, checkInAt: new Date('2026-03-02T07:30:00Z'), checkOutAt: new Date('2026-03-02T15:00:00Z') }, cairo)).toMatchObject({ status: 'LATE', lateMinutes: 30 });
  });
});

// ───────────────────────── self service ─────────────────────────

describe('check in / breaks / check out', () => {
  it('CLIENT users can never reach attendance', async () => {
    for (const path of ['/api/attendance/today', '/api/attendance/me', '/api/attendance/summary', '/api/attendance/records', '/api/attendance/calendar', '/api/attendance/report', '/api/leave', '/api/work-schedules', '/api/holidays']) {
      expect((await alice.get(path)).status, path).toBe(403);
    }
    expect((await alice.post('/api/attendance/check-in').send({})).status).toBe(403);
    expect((await alice.post('/api/leave').send({ type: 'SICK', startDate: '2026-03-03', endDate: '2026-03-03' })).status).toBe(403);
  });

  it('check-in uses the server clock; ids and timestamps in the body are rejected', async () => {
    at('2026-03-02T09:25:00Z');
    expect((await teamA.post('/api/attendance/check-in').send({ userId: w.teamB.id })).status).toBe(400);
    expect((await teamA.post('/api/attendance/check-in').send({ checkInAt: '2026-03-02T08:00:00Z' })).status).toBe(400);
    const res = await teamA.post('/api/attendance/check-in').send({});
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ userId: w.teamA.id, date: '2026-03-02', checkInAt: '2026-03-02T09:25:00.000Z', status: 'LATE', lateMinutes: 25, open: true, presence: 'WORKING' });
    expect(await prisma.auditLog.count({ where: { action: 'ATTENDANCE_CHECK_IN', userId: w.teamA.id } })).toBe(1);
  });

  it('duplicate check-in is refused', async () => {
    at('2026-03-02T09:40:00Z');
    const res = await teamA.post('/api/attendance/check-in').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_CHECKED_IN');
    expect(await prisma.attendance.count({ where: { userId: w.teamA.id } })).toBe(1);
  });

  it('breaks: start, no double start, end; worked excludes the break', async () => {
    at('2026-03-02T12:00:00Z');
    expect((await teamA.post('/api/attendance/break/start').send({})).status).toBe(201);
    at('2026-03-02T12:05:00Z');
    expect((await teamA.post('/api/attendance/break/start').send({})).body.error.code).toBe('BREAK_ALREADY_STARTED');
    const today = await teamA.get('/api/attendance/today');
    expect(today.body.item).toMatchObject({ onBreak: true, presence: 'ON_BREAK' });
    at('2026-03-02T12:45:00Z');
    expect((await teamA.post('/api/attendance/break/end').send({})).body.item).toMatchObject({ breakMinutes: 45, onBreak: false });
    expect((await teamA.post('/api/attendance/break/end').send({})).body.error.code).toBe('NO_BREAK_RUNNING');
  });

  it('check-out closes the day with worked / overtime / early-leave numbers', async () => {
    at('2026-03-02T18:25:00Z');
    const res = await teamA.post('/api/attendance/check-out').send({});
    expect(res.status).toBe(200);
    // 09:25 -> 18:25 = 540 min - 45 break = 495 worked; expected 420 -> 75 overtime; late 25
    expect(res.body.item).toMatchObject({ checkOutAt: '2026-03-02T18:25:00.000Z', workedMinutes: 495, breakMinutes: 45, overtimeMinutes: 75, lateMinutes: 25, earlyLeaveMinutes: 0, status: 'LATE', open: false, presence: 'CHECKED_OUT' });
    expect((await teamA.post('/api/attendance/check-out').send({})).body.error.code).toBe('NOT_CHECKED_IN');
    expect((await teamA.post('/api/attendance/check-in').send({})).body.error.code).toBe('ALREADY_CHECKED_IN');
  });

  it('my history shows my own days only', async () => {
    const res = await teamA.get('/api/attendance/me?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.totals.workedMinutes).toBe(495);
    expect(res.body.statusCounts.LATE).toBe(1);
  });
});

// ───────────────────────── team board / isolation ─────────────────────────

describe('team board and isolation', () => {
  it('a TEAM member without attendance.view_all cannot read the board, the report or other people', async () => {
    expect((await teamB.get('/api/attendance/summary')).status).toBe(403);
    expect((await teamB.get('/api/attendance/records')).status).toBe(403);
    expect((await teamB.get('/api/attendance/report')).status).toBe(403);
    expect((await teamB.get(`/api/attendance/calendar?userId=${w.teamA.id}`)).status).toBe(403);
    const rec = await prisma.attendance.findFirstOrThrow({ where: { userId: w.teamA.id } });
    expect((await teamB.get(`/api/attendance/${rec.id}`)).status).toBe(404);
    expect((await teamA.get(`/api/attendance/${rec.id}`)).status).toBe(200); // own record
  });

  it('TEAM members can never change attendance records, not even their own', async () => {
    const rec = await prisma.attendance.findFirstOrThrow({ where: { userId: w.teamA.id } });
    expect((await teamA.patch(`/api/attendance/${rec.id}`).send({ checkInAt: '2026-03-02T09:00:00Z', reason: 'fix my lateness' })).status).toBe(403);
    expect((await teamA.post('/api/attendance').send({ userId: w.teamA.id, date: '2026-03-02', reason: 'x'.repeat(5) })).status).toBe(403);
    expect((await teamA.patch(`/api/attendance/members/${w.teamA.id}`).send({ trackAttendance: false })).status).toBe(403);
  });

  it('ADMIN sees a single day with virtual rows for people without a record', async () => {
    at('2026-03-02T12:00:00Z');
    const res = await admin.get('/api/attendance/records?from=2026-03-02&to=2026-03-02');
    expect(res.status).toBe(200);
    const byUser = new Map(res.body.items.map((r: { userId: string }) => [r.userId, r]));
    expect(byUser.get(w.teamA.id)).toMatchObject({ status: 'LATE' });
    expect(byUser.get(w.teamB.id)).toMatchObject({ id: null, status: 'ABSENT', presence: 'ABSENT' });
    expect(byUser.has(w.userA.id)).toBe(false); // clients are never on the roster
    const summary = await admin.get('/api/attendance/summary?from=2026-03-02&to=2026-03-02');
    expect(summary.body.presence.CHECKED_OUT).toBe(1);
    expect(summary.body.statusCounts.LATE).toBe(1);
    expect(summary.body.members).toBe(res.body.items.length);
    const filtered = await admin.get('/api/attendance/records?from=2026-03-02&to=2026-03-02&status=LATE');
    expect(filtered.body.items.map((r: { userId: string }) => r.userId)).toEqual([w.teamA.id]);
  });

  it('before start + grace a person is "not checked in" rather than absent', async () => {
    at('2026-03-03T08:30:00Z');
    const res = await admin.get('/api/attendance/records?from=2026-03-03&to=2026-03-03');
    expect(res.body.items.find((r: { userId: string }) => r.userId === w.teamB.id).presence).toBe('NOT_CHECKED_IN');
  });

  it('calendar: own month for the employee, anybody for view_all', async () => {
    const own = await teamA.get('/api/attendance/calendar?month=2026-03');
    expect(own.status).toBe(200);
    expect(own.body.days).toHaveLength(31);
    expect(own.body.days[1]).toMatchObject({ date: '2026-03-02', status: 'LATE' });
    expect(own.body.days[0]).toMatchObject({ date: '2026-03-01', status: 'DAY_OFF' });
    await setPerms(w.teamB.id, [...DEFAULT_TEAM_PERMISSIONS, 'attendance.view_all']);
    expect((await teamB.get(`/api/attendance/calendar?userId=${w.teamA.id}&month=2026-03`)).status).toBe(200);
    expect((await teamB.get('/api/attendance/summary')).status).toBe(200);
    await setPerms(w.teamB.id, null);
  });
});

// ───────────────────────── corrections ─────────────────────────

describe('manual corrections', () => {
  it('needs a reason; creates an audit row with old and new values; flags the record; notifies the employee', async () => {
    at('2026-03-03T12:00:00Z');
    const rec = await prisma.attendance.findFirstOrThrow({ where: { userId: w.teamA.id } });
    expect((await admin.patch(`/api/attendance/${rec.id}`).send({ checkInAt: '2026-03-02T09:05:00Z' })).status).toBe(400);
    const res = await admin.patch(`/api/attendance/${rec.id}`).send({ checkInAt: '2026-03-02T09:05:00Z', checkOutAt: '2026-03-02T17:12:00Z', breaks: [], reason: 'Badge reader was down' });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ isManual: true, status: 'PRESENT', lateMinutes: 0, workedMinutes: 487, correctedBy: { id: w.admin.id } });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ATTENDANCE_CORRECTED', entityId: rec.id } });
    const meta = JSON.parse(log.metadata!);
    expect(log.userId).toBe(w.admin.id);
    expect(meta.reason).toBe('Badge reader was down');
    expect(meta.changes.checkInAt).toEqual({ from: '2026-03-02T09:25:00.000Z', to: '2026-03-02T09:05:00.000Z' });
    expect(meta.changes.status).toEqual({ from: 'LATE', to: 'PRESENT' });
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'ATTENDANCE_CORRECTED' } })).toBe(1);
    const detail = await teamA.get(`/api/attendance/${rec.id}`);
    expect(detail.body.corrections[0].metadata.reason).toBe('Badge reader was down');
  });

  it('rejects incoherent times', async () => {
    at('2026-03-03T12:00:00Z');
    const rec = await prisma.attendance.findFirstOrThrow({ where: { userId: w.teamA.id } });
    expect((await admin.patch(`/api/attendance/${rec.id}`).send({ checkOutAt: '2026-03-02T08:00:00Z', reason: 'bad' })).body.error.fields.checkOutAt).toBe('end_before_start');
    expect((await admin.patch(`/api/attendance/${rec.id}`).send({ checkInAt: '2026-02-20T09:00:00Z', reason: 'bad' })).body.error.fields.checkInAt).toBe('invalid_date');
    const brk = await admin.patch(`/api/attendance/${rec.id}`).send({ breaks: [{ startAt: '2026-03-02T18:00:00Z', endAt: '2026-03-02T18:30:00Z' }], reason: 'bad' });
    expect(brk.body.error.fields.breaks).toBe('invalid');
  });

  it('a manager can create a forgotten day for someone else but never correct their own', async () => {
    await setPerms(w.teamB.id, [...DEFAULT_TEAM_PERMISSIONS, 'attendance.manage', 'attendance.view_all']);
    const created = await teamB.post('/api/attendance').send({ userId: w.teamA.id, date: '2026-02-27', checkInAt: '2026-02-27T09:00:00Z', checkOutAt: '2026-02-27T17:00:00Z', reason: 'Forgot to check in' });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ date: '2026-02-27', isManual: true, workedMinutes: 480, status: 'PRESENT' });
    expect((await teamB.post('/api/attendance').send({ userId: w.teamA.id, date: '2026-02-27', reason: 'again' })).body.error.code).toBe('ATTENDANCE_EXISTS');
    expect((await teamB.post('/api/attendance').send({ userId: w.teamB.id, date: '2026-02-27', reason: 'my own day' })).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'ATTENDANCE_CREATED', userId: w.teamB.id } })).toBe(1);
    await setPerms(w.teamB.id, null);
  });

  it('a locked status wins over the calculation until unlocked', async () => {
    const rec = await prisma.attendance.findFirstOrThrow({ where: { userId: w.teamA.id, date: new Date('2026-02-27T00:00:00Z') } });
    expect((await admin.patch(`/api/attendance/${rec.id}`).send({ status: 'WFH', reason: 'Approved remote day' })).body.item).toMatchObject({ status: 'WFH', statusLocked: true });
    expect((await admin.patch(`/api/attendance/${rec.id}`).send({ status: null, reason: 'Back to normal' })).body.item).toMatchObject({ status: 'PRESENT', statusLocked: false });
  });
});

// ───────────────────────── leave ─────────────────────────

describe('leave requests', () => {
  let leaveId: string;

  it('a team member requests leave; approvers are notified; overlaps are refused', async () => {
    at('2026-03-02T12:00:00Z');
    expect((await teamB.post('/api/leave').send({ type: 'VACATION', startDate: '2026-03-06', endDate: '2026-03-04' })).body.error.fields.endDate).toBe('end_before_start');
    expect((await teamB.post('/api/leave').send({ type: 'VACATION', startDate: '2026-03-07', endDate: '2026-03-08' })).body.error.fields.endDate).toBe('no_working_days');
    expect((await teamB.post('/api/leave').send({ type: 'VACATION', startDate: '2026-03-04', endDate: '2026-03-06', userId: w.teamA.id })).status).toBe(400);
    const res = await teamB.post('/api/leave').send({ type: 'VACATION', startDate: '2026-03-04', endDate: '2026-03-09', reason: 'Family trip' });
    expect(res.status).toBe(201);
    leaveId = res.body.item.id;
    expect(res.body.item).toMatchObject({ userId: w.teamB.id, status: 'PENDING', days: 4 }); // Wed, Thu, Fri, Mon
    expect(await prisma.notification.count({ where: { userId: w.admin.id, type: 'LEAVE_REQUESTED', entityId: leaveId } })).toBe(1);
    expect((await teamB.post('/api/leave').send({ type: 'SICK', startDate: '2026-03-05', endDate: '2026-03-05' })).body.error.code).toBe('LEAVE_OVERLAP');
  });

  it('only approvers decide, never their own request; others cannot see it', async () => {
    expect((await teamB.post(`/api/leave/${leaveId}/approve`).send({})).status).toBe(403);
    expect((await teamA.get(`/api/leave/${leaveId}`)).status).toBe(404);
    expect((await teamA.get('/api/leave')).body.items).toHaveLength(0);
  });

  it('approval marks the working days ON_LEAVE and notifies the requester', async () => {
    const res = await admin.post(`/api/leave/${leaveId}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ status: 'APPROVED', reviewedBy: { id: w.admin.id } });
    const rows = await prisma.attendance.findMany({ where: { userId: w.teamB.id, leaveRequestId: leaveId }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.status])).toEqual([
      ['2026-03-04', 'ON_LEAVE'], ['2026-03-05', 'ON_LEAVE'], ['2026-03-06', 'ON_LEAVE'], ['2026-03-09', 'ON_LEAVE'],
    ]);
    expect(await prisma.notification.count({ where: { userId: w.teamB.id, type: 'LEAVE_APPROVED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LEAVE_APPROVED', entityId: leaveId } })).toBe(1);
    expect((await admin.post(`/api/leave/${leaveId}/approve`).send({})).body.error.code).toBe('INVALID_STATE');
    at('2026-03-05T12:00:00Z');
    const board = await admin.get('/api/attendance/records?from=2026-03-05&to=2026-03-05');
    expect(board.body.items.find((r: { userId: string }) => r.userId === w.teamB.id)).toMatchObject({ status: 'ON_LEAVE', presence: 'ON_LEAVE' });
  });

  it('rejection needs a reason; cancelling an approved leave removes the leave days', async () => {
    const other = await teamB.post('/api/leave').send({ type: 'SICK', startDate: '2026-03-12', endDate: '2026-03-12' });
    expect((await admin.post(`/api/leave/${other.body.item.id}/reject`).send({})).status).toBe(400);
    const rej = await admin.post(`/api/leave/${other.body.item.id}/reject`).send({ reason: 'Busy week' });
    expect(rej.body.item).toMatchObject({ status: 'REJECTED', rejectionReason: 'Busy week' });
    expect(await prisma.notification.count({ where: { userId: w.teamB.id, type: 'LEAVE_REJECTED' } })).toBe(1);

    expect((await teamB.post(`/api/leave/${leaveId}/cancel`).send({})).body.item.status).toBe('CANCELLED');
    expect(await prisma.attendance.count({ where: { userId: w.teamB.id, status: 'ON_LEAVE' } })).toBe(0);
  });
});

// ───────────────────────── schedules, holidays, nightly close, report ─────────────────────────

describe('schedules / holidays / nightly close / report', () => {
  it('schedules are validated and admin-only to change', async () => {
    expect((await teamA.post('/api/work-schedules').send({ name: 'x', timezone: 'UTC', workDays: [1], startTime: '09:00', endTime: '17:00', breakMinutes: 0, graceMinutes: 0, minimumMinutes: 0 })).status).toBe(403);
    expect((await teamA.get('/api/work-schedules')).status).toBe(200);
    const bad = { name: 'Night', timezone: 'Mars/Olympus', workDays: [1], startTime: '09:00', endTime: '17:00', breakMinutes: 0, graceMinutes: 0, minimumMinutes: 0 };
    expect((await admin.post('/api/work-schedules').send(bad)).body.error.fields.timezone).toBe('invalid_choice');
    expect((await admin.post('/api/work-schedules').send({ ...bad, timezone: 'UTC', endTime: '08:00' })).body.error.fields.endTime).toBe('end_before_start');
    const ok = await admin.post('/api/work-schedules').send({ name: 'Sun-Thu Cairo', timezone: 'Africa/Cairo', workDays: [0, 1, 2, 3, 4], startTime: '10:00', endTime: '18:00', breakMinutes: 30, graceMinutes: 15, minimumMinutes: 240 });
    expect(ok.status).toBe(201);
    expect(ok.body.item).toMatchObject({ timezone: 'Africa/Cairo', workDays: [0, 1, 2, 3, 4], isDefault: false });
    expect((await admin.patch(`/api/attendance/members/${w.teamC.id}`).send({ workScheduleId: ok.body.item.id })).status).toBe(200);
    expect((await admin.patch(`/api/attendance/members/${w.teamC.id}`).send({ workScheduleId: 'nope-nope' })).status).toBe(400);
    const defaultId = (await prisma.workSchedule.findFirstOrThrow({ where: { isDefault: true } })).id;
    expect((await admin.delete(`/api/work-schedules/${defaultId}`)).body.error.code).toBe('DEFAULT_SCHEDULE');
  });

  it('the nightly close persists past days as ABSENT / HOLIDAY exactly once', async () => {
    await admin.post('/api/holidays').send({ date: '2026-03-10', name: 'Founders day' });
    expect((await admin.post('/api/holidays').send({ date: '2026-03-10', name: 'dup' })).status).toBe(400);
    at('2026-03-12T12:00:00Z');
    const created = await closePastDays(new Date());
    expect(created).toBeGreaterThan(0);
    expect(await closePastDays(new Date())).toBe(0); // idempotent
    const b = await prisma.attendance.findMany({ where: { userId: w.teamB.id, date: { gte: new Date('2026-03-09T00:00:00Z'), lte: new Date('2026-03-11T00:00:00Z') } }, orderBy: { date: 'asc' } });
    expect(b.map((r) => [r.date.toISOString().slice(0, 10), r.status])).toEqual([['2026-03-09', 'ABSENT'], ['2026-03-10', 'HOLIDAY'], ['2026-03-11', 'ABSENT']]);
    // Cairo schedule (Sun-Thu): Friday 2026-03-06 and Saturday 2026-03-07 are days off for Team C
    expect(await prisma.attendance.count({ where: { userId: w.teamC.id, date: { in: [new Date('2026-03-06T00:00:00Z'), new Date('2026-03-07T00:00:00Z')] } } })).toBe(0);
    expect(await prisma.attendance.count({ where: { userId: w.teamC.id, date: new Date('2026-03-08T00:00:00Z') } })).toBe(1); // Sunday
  });

  it('report: per-person totals and CSV export', async () => {
    const res = await admin.get('/api/attendance/report?from=2026-02-01&to=2026-03-31');
    expect(res.status).toBe(200);
    const a = res.body.items.find((i: { user: { id: string } }) => i.user.id === w.teamA.id);
    expect(a.daysWorked).toBe(2);
    expect(a.workedMinutes).toBe(487 + 480);
    const csv = await admin.get('/api/attendance/report?from=2026-02-01&to=2026-03-31&format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Employee,Days worked');
    expect(csv.text).toContain('Team A,2');
  });
});
