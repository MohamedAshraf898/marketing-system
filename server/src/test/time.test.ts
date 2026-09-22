import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { hashPassword } from '../auth/password';
import { csvCell, indicatorFor } from '../services/time';
import { PASSWORD, buildWorld, loginAs, type Agent, type World } from './helpers';

let w: World;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;
let teamC: Agent;
let alice: Agent;
let viewer: Agent; // TEAM with time.view_all + workload.view, assigned to client A
let viewerId: string;
let taskA: { id: string; projectId: string | null };
let taskA2: { id: string };
let taskB: { id: string };
let projectA: { id: string };
let projectB: { id: string };

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const H = 3_600_000;

async function mkTeam(name: string, email: string, permissions: string[] | null, clientIds: string[] = [], extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({
    data: { name, email, role: 'TEAM', passwordHash: await hashPassword(PASSWORD), permissions: permissions ? JSON.stringify(permissions) : null, ...extra },
  });
  for (const clientId of clientIds) await prisma.clientAssignment.create({ data: { userId: u.id, clientId } });
  return u;
}

beforeAll(async () => {
  w = await buildWorld();
  const v = await mkTeam('Viewer', 'viewer@t.test', ['time.track', 'time.view_all', 'workload.view', 'tasks.view'], [w.clientA.id]);
  viewerId = v.id;
  projectA = await prisma.project.create({ data: { clientId: w.clientA.id, name: 'Site A', projectManagerId: w.teamA.id, status: 'IN_PROGRESS' } });
  projectB = await prisma.project.create({ data: { clientId: w.clientB.id, name: 'Site B', projectManagerId: w.teamB.id, status: 'IN_PROGRESS' } });
  taskA = await prisma.task.create({ data: { title: 'Design banner', clientId: w.clientA.id, projectId: projectA.id, assignedToId: w.teamA.id, estimatedHours: 4 } });
  taskA2 = await prisma.task.create({ data: { title: 'Write copy', clientId: w.clientA.id, projectId: projectA.id, assignedToId: w.teamA.id } });
  taskB = await prisma.task.create({ data: { title: 'B task', clientId: w.clientB.id, projectId: projectB.id, assignedToId: w.teamB.id } });
  [admin, teamA, teamB, teamC, alice, viewer] = await Promise.all(
    ['admin@t.test', 'teama@t.test', 'teamb@t.test', 'teamc@t.test', 'alice@alpha.test', 'viewer@t.test'].map((e) => loginAs(e)),
  );
});

const actual = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).actualHours;

describe('client users never touch time or workload data', () => {
  it('403 on every time and workload endpoint', async () => {
    const some = 'abcde12345';
    const cid = w.clientA.id;
    const calls: Array<[string, string, object?]> = [
      ['get', '/api/time/timer'], ['post', '/api/time/timer/start', {}], ['post', '/api/time/timer/stop', {}],
      ['get', '/api/time/entries'], ['get', '/api/time/my'],
      ['post', '/api/time/entries', { startedAt: iso(2 * H), durationMinutes: 30, clientId: cid }],
      ['patch', `/api/time/entries/${some}`, { notes: 'x' }], ['delete', `/api/time/entries/${some}`],
      ['get', `/api/time/report/client/${cid}`], ['get', `/api/time/report/client/${cid}.csv`], ['get', `/api/time/report/client/${cid}?format=csv`],
      ['get', '/api/workload'], ['get', `/api/workload/${w.teamA.id}`],
    ];
    for (const [method, path, body] of calls) {
      const req = (alice as unknown as Record<string, (p: string) => { send: (b: object) => Promise<{ status: number }> } & Promise<{ status: number }>>)[method](path);
      const res = await (body ? req.send(body) : req);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('requires a session', async () => {
    const { app } = await import('./helpers');
    const request = (await import('supertest')).default;
    expect((await request(app).get('/api/time/timer')).status).toBe(401);
    expect((await request(app).get('/api/workload')).status).toBe(401);
  });

  it('a TEAM member without the permission is refused', async () => {
    const noTrack = await mkTeam('No Track', 'notrack@t.test', ['tasks.view'], [w.clientA.id]);
    const a = await loginAs(noTrack.email);
    expect((await a.post('/api/time/timer/start').send({})).status).toBe(403);
    expect((await a.get('/api/time/entries')).status).toBe(403);
    expect((await a.get('/api/workload')).status).toBe(403);
    expect((await teamA.get('/api/workload')).status).toBe(403); // defaults do not include workload.view
    expect((await teamA.get(`/api/time/report/client/${w.clientA.id}`)).status).toBe(403); // nor time.view_all
  });
});

describe('timer', () => {
  it('starts a timer: user from the session, project + client derived from the task', async () => {
    const res = await teamA.post('/api/time/timer/start').send({ taskId: taskA.id, clientId: w.clientB.id, projectId: projectB.id, notes: '  banner  ' });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ userId: w.teamA.id, taskId: taskA.id, projectId: projectA.id, clientId: w.clientA.id, running: true, notes: 'banner' });
    expect(res.body.stopped).toBeNull();
    expect((await teamA.get('/api/time/timer')).body.item.id).toBe(res.body.item.id);
  });

  it('refuses body fields that could spoof the owner', async () => {
    const r = await teamA.post('/api/time/timer/start').send({ taskId: taskA.id, userId: w.teamB.id });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect((await teamA.post('/api/time/timer/start').send({ startedAt: iso(5 * H) })).status).toBe(400);
    expect((await teamA.post('/api/time/entries').send({ startedAt: iso(3 * H), durationMinutes: 30, clientId: w.clientA.id, userId: w.teamB.id })).status).toBe(400);
  });

  it('only one running timer: starting another stops and saves the first (server-computed duration)', async () => {
    await prisma.timeEntry.updateMany({ where: { userId: w.teamA.id, endedAt: null }, data: { startedAt: new Date(Date.now() - 90 * 60_000) } });
    const before = (await teamA.get('/api/time/timer')).body;
    expect(before.elapsedSec).toBeGreaterThanOrEqual(5399);
    const res = await teamA.post('/api/time/timer/start').send({ taskId: taskA2.id });
    expect(res.status).toBe(201);
    expect(res.body.stopped.running).toBe(false);
    expect(res.body.stopped.durationSec).toBeGreaterThanOrEqual(5400);
    expect(res.body.stopped.durationSec).toBeLessThan(5410);
    expect(await prisma.timeEntry.count({ where: { userId: w.teamA.id, endedAt: null } })).toBe(1);
    expect(await actual(taskA.id)).toBe(1.5); // synced from the DB
  });

  it('stop computes the duration from timestamps and caps forgotten timers at 16 h', async () => {
    await prisma.timeEntry.updateMany({ where: { userId: w.teamA.id, endedAt: null }, data: { startedAt: new Date(Date.now() - 20 * H) } });
    const res = await teamA.post('/api/time/timer/stop').send({ durationSec: 1 });
    expect(res.status).toBe(200);
    expect(res.body.capped).toBe(true);
    expect(res.body.item.durationSec).toBe(16 * 3600);
    expect(new Date(res.body.item.endedAt).getTime() - new Date(res.body.item.startedAt).getTime()).toBe(16 * H);
    expect(await actual(taskA2.id)).toBe(16);
    const again = await teamA.post('/api/time/timer/stop').send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NO_TIMER_RUNNING');
    expect((await teamA.get('/api/time/timer')).body.item).toBeNull();
  });

  it('timers of different people are independent', async () => {
    await teamA.post('/api/time/timer/start').send({ clientId: w.clientA.id });
    await teamB.post('/api/time/timer/start').send({ clientId: w.clientB.id });
    expect(await prisma.timeEntry.count({ where: { endedAt: null, userId: { in: [w.teamA.id, w.teamB.id] } } })).toBe(2);
    await teamA.post('/api/time/timer/stop').send({});
    await teamB.post('/api/time/timer/stop').send({});
  });
});

describe('scope of what time can be logged against', () => {
  it('TEAM cannot log on an unassigned client, project or task', async () => {
    for (const body of [{ taskId: taskB.id }, { projectId: projectB.id }, { clientId: w.clientB.id }]) {
      const r = await teamA.post('/api/time/timer/start').send(body);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      const m = await teamA.post('/api/time/entries').send({ ...body, startedAt: iso(3 * H), durationMinutes: 30 });
      expect(m.status).toBe(400);
    }
    expect(await prisma.timeEntry.count({ where: { userId: w.teamA.id, OR: [{ clientId: w.clientB.id }, { taskId: taskB.id }] } })).toBe(0);
    expect((await teamA.post('/api/time/timer/start').send({ taskId: 'does-not-exist' })).status).toBe(400);
  });

  it('a member assigned to a single campaign cannot log on the whole client, but can on a task assigned to them', async () => {
    expect((await teamC.post('/api/time/timer/start').send({ clientId: w.clientA.id })).status).toBe(400);
    const mine = await prisma.task.create({ data: { title: 'C task', clientId: w.clientA.id, assignedToId: w.teamC.id } });
    const ok = await teamC.post('/api/time/entries').send({ taskId: mine.id, startedAt: iso(3 * H), durationMinutes: 45 });
    expect(ok.status).toBe(201);
    expect(ok.body.item.clientId).toBe(w.clientA.id);
    expect(await actual(mine.id)).toBe(0.75);
  });

  it('ADMIN can log on any client', async () => {
    const r = await admin.post('/api/time/entries').send({ clientId: w.clientB.id, startedAt: iso(4 * H), durationMinutes: 15 });
    expect(r.status).toBe(201);
    expect(r.body.item.userId).toBe(w.admin.id);
    expect((await admin.post('/api/time/entries').send({ clientId: 'no-such-client', startedAt: iso(4 * H), durationMinutes: 15 })).status).toBe(400);
  });
});

describe('manual entries', () => {
  const base = { clientId: '' };
  beforeAll(() => { base.clientId = w.clientA.id; });

  it('creates an entry from start + duration or start + end; the server computes seconds', async () => {
    const a = await teamA.post('/api/time/entries').send({ ...base, startedAt: iso(10 * H), durationMinutes: 90, notes: 'calls' });
    expect(a.status).toBe(201);
    expect(a.body.item).toMatchObject({ durationSec: 5400, running: false, userId: w.teamA.id, clientId: w.clientA.id, projectId: null, notes: 'calls' });
    const b = await teamA.post('/api/time/entries').send({ ...base, startedAt: iso(9 * H), endedAt: iso(8 * H) });
    expect(b.body.item.durationSec).toBe(3600);
  });

  it('enforces sane bounds', async () => {
    const bad = async (body: Record<string, unknown>) => (await teamA.post('/api/time/entries').send({ ...base, ...body })).status;
    expect(await bad({ startedAt: iso(-2 * H), durationMinutes: 30 })).toBe(400); // future
    expect(await bad({ startedAt: iso(2 * H), endedAt: iso(-30 * 60_000) })).toBe(400); // ends >5 min ahead
    expect(await bad({ startedAt: iso(400 * 24 * H), durationMinutes: 30 })).toBe(400); // older than a year
    expect(await bad({ startedAt: iso(30 * H), durationMinutes: 1441 })).toBe(400); // > 24 h
    expect(await bad({ startedAt: iso(30 * H), endedAt: iso(30 * H - 30_000) })).toBe(400); // < 1 min
    expect(await bad({ startedAt: iso(3 * H), endedAt: iso(4 * H) })).toBe(400); // ends before it starts
    expect(await bad({ startedAt: iso(3 * H), durationMinutes: 0 })).toBe(400);
    expect(await bad({ startedAt: iso(3 * H), durationMinutes: 30, endedAt: iso(2 * H) })).toBe(400); // both
    expect(await bad({ startedAt: iso(3 * H) })).toBe(400); // neither
    expect(await bad({ startedAt: 'yesterday', durationMinutes: 30 })).toBe(400);
    expect(await bad({ startedAt: iso(3 * H), durationMinutes: 30, notes: 'x'.repeat(1001) })).toBe(400);
    expect(await bad({ startedAt: iso(3 * H), durationMinutes: 1440 })).toBe(400); // 24 h from 3 h ago ends in the future
    expect(await bad({ startedAt: iso(30 * H), durationMinutes: 1440 })).toBe(201); // exactly 24 h is allowed
  });

  it('keeps Task.actualHours in sync on create, update and delete', async () => {
    const t = await prisma.task.create({ data: { title: 'Sync me', clientId: w.clientA.id, assignedToId: w.teamA.id } });
    const mk = (min: number, hAgo: number) => teamA.post('/api/time/entries').send({ taskId: t.id, startedAt: iso(hAgo * H), durationMinutes: min });
    const e1 = (await mk(90, 20)).body.item;
    const e2 = (await mk(45, 10)).body.item;
    expect(await actual(t.id)).toBe(2.25);
    // change the length (only the end moves)
    expect((await teamA.patch(`/api/time/entries/${e1.id}`).send({ durationMinutes: 60 })).body.item.durationSec).toBe(3600);
    expect(await actual(t.id)).toBe(1.75);
    // move e2 to another task: both tasks are recomputed
    const other = await prisma.task.create({ data: { title: 'Other', clientId: w.clientA.id, assignedToId: w.teamA.id } });
    const moved = await teamA.patch(`/api/time/entries/${e2.id}`).send({ taskId: other.id });
    expect(moved.status).toBe(200);
    expect(moved.body.item.clientId).toBe(w.clientA.id);
    expect(await actual(t.id)).toBe(1);
    expect(await actual(other.id)).toBe(0.75);
    // detach from the task -> the task no longer counts it
    await teamA.patch(`/api/time/entries/${e2.id}`).send({ taskId: null, clientId: w.clientA.id });
    expect(await actual(other.id)).toBe(0);
    expect((await teamA.delete(`/api/time/entries/${e1.id}`)).body).toEqual({ ok: true });
    expect(await actual(t.id)).toBe(0);
    // a running timer does not count until it is stopped
    await teamA.post('/api/time/timer/start').send({ taskId: t.id });
    expect(await actual(t.id)).toBe(0);
    await teamA.post('/api/time/timer/stop').send({});
  });

  it('validates PATCH bodies (strict, no owner change, no editing a running timer length)', async () => {
    const e = (await teamA.post('/api/time/entries').send({ ...base, startedAt: iso(6 * H), durationMinutes: 30 })).body.item;
    expect((await teamA.patch(`/api/time/entries/${e.id}`).send({ userId: w.teamB.id })).status).toBe(400);
    expect((await teamA.patch(`/api/time/entries/${e.id}`).send({})).status).toBe(400);
    expect((await teamA.patch(`/api/time/entries/${e.id}`).send({ clientId: w.clientB.id })).status).toBe(400);
    expect((await teamA.patch(`/api/time/entries/${e.id}`).send({ startedAt: iso(6 * H), endedAt: iso(-H) })).status).toBe(400);
    const r = await teamA.post('/api/time/timer/start').send({ clientId: w.clientA.id });
    expect((await teamA.patch(`/api/time/entries/${r.body.item.id}`).send({ durationMinutes: 30 })).status).toBe(409);
    expect((await teamA.patch(`/api/time/entries/${r.body.item.id}`).send({ notes: 'still going' })).body.item.notes).toBe('still going');
    await teamA.post('/api/time/timer/stop').send({});
  });
});

describe('who sees which entries', () => {
  let entryA: string;
  let entryB: string;
  beforeAll(async () => {
    entryA = (await teamA.post('/api/time/entries').send({ clientId: w.clientA.id, startedAt: iso(5 * H), durationMinutes: 60, notes: 'A private' })).body.item.id;
    entryB = (await teamB.post('/api/time/entries').send({ clientId: w.clientB.id, startedAt: iso(5 * H), durationMinutes: 60 })).body.item.id;
  });

  it('TEAM without time.view_all sees only their own entries, whatever they ask for', async () => {
    const own = await teamA.get('/api/time/entries?pageSize=100');
    expect(own.status).toBe(200);
    expect(own.body.items.every((e: { userId: string }) => e.userId === w.teamA.id)).toBe(true);
    const spoof = await teamA.get(`/api/time/entries?userId=${w.teamB.id}&pageSize=100`);
    expect(spoof.body.items.every((e: { userId: string }) => e.userId === w.teamA.id)).toBe(true);
    const byClient = await teamA.get(`/api/time/entries?clientId=${w.clientB.id}`);
    expect(byClient.body.items).toHaveLength(0);
    expect(own.body.totals.seconds).toBeGreaterThan(0);
    expect(own.body.meta).toMatchObject({ page: 1 });
  });

  it("view_all adds the entries logged on the caller's clients only", async () => {
    const list = await viewer.get('/api/time/entries?pageSize=100');
    const ids = list.body.items.map((e: { id: string }) => e.id);
    expect(ids).toContain(entryA);
    expect(ids).not.toContain(entryB);
    expect(list.body.items.every((e: { clientId: string | null }) => e.clientId === w.clientA.id)).toBe(true);
    const filtered = await viewer.get(`/api/time/entries?userId=${w.teamA.id}&clientId=${w.clientA.id}&pageSize=100`);
    expect(filtered.body.items.length).toBeGreaterThan(0);
    expect(filtered.body.items.every((e: { userId: string }) => e.userId === w.teamA.id)).toBe(true);
    expect((await viewer.get(`/api/time/entries?clientId=${w.clientB.id}`)).body.items).toHaveLength(0);
  });

  it('ADMIN sees everything and can filter by user, client, date and running state', async () => {
    const all = await admin.get('/api/time/entries?pageSize=100');
    const ids = all.body.items.map((e: { id: string }) => e.id);
    expect(ids).toEqual(expect.arrayContaining([entryA, entryB]));
    expect((await admin.get(`/api/time/entries?userId=${w.teamB.id}`)).body.items.every((e: { userId: string }) => e.userId === w.teamB.id)).toBe(true);
    const day = new Date().toISOString().slice(0, 10);
    expect((await admin.get(`/api/time/entries?from=${day}&to=${day}&running=0`)).status).toBe(200);
    expect((await admin.get('/api/time/entries?from=nope')).status).toBe(400);
    expect((await admin.get('/api/time/entries?running=1')).body.items.every((e: { running: boolean }) => e.running)).toBe(true);
    expect((await admin.get('/api/time/entries?pageSize=2')).body.items.length).toBeLessThanOrEqual(2);
  });

  it('only the owner (or ADMIN) may change an entry; out-of-scope entries do not exist', async () => {
    expect((await teamB.patch(`/api/time/entries/${entryA}`).send({ notes: 'hack' })).status).toBe(404);
    expect((await teamB.delete(`/api/time/entries/${entryA}`)).status).toBe(404);
    expect((await viewer.patch(`/api/time/entries/${entryA}`).send({ notes: 'hack' })).status).toBe(403); // visible but not theirs
    expect((await viewer.delete(`/api/time/entries/${entryA}`)).status).toBe(403);
    expect((await teamA.patch(`/api/time/entries/${entryA}`).send({ notes: 'A private 2' })).status).toBe(200);
    expect((await admin.patch(`/api/time/entries/${entryA}`).send({ notes: 'A private 3' })).body.item.notes).toBe('A private 3');
    expect((await teamA.delete(`/api/time/entries/${entryB}`)).status).toBe(404);
    expect((await admin.delete(`/api/time/entries/${entryB}`)).status).toBe(200);
    expect((await admin.delete(`/api/time/entries/${entryB}`)).status).toBe(404);
  });
});

describe('my time', () => {
  it('returns today / this week totals and the entries grouped by day', async () => {
    const u = await mkTeam('My Time', 'mytime@t.test', null, [w.clientA.id]);
    const me = await loginAs(u.email);
    const now = new Date();
    const at = (h: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h));
    // two entries today (1 h and 30 min) and one from another person that must not be counted
    await prisma.timeEntry.createMany({
      data: [
        { userId: u.id, clientId: w.clientA.id, startedAt: at(0), endedAt: new Date(at(0).getTime() + H), durationSec: 3600 },
        { userId: u.id, clientId: w.clientA.id, startedAt: at(1), endedAt: new Date(at(1).getTime() + 1800_000), durationSec: 1800 },
        { userId: w.teamA.id, clientId: w.clientA.id, startedAt: at(1), endedAt: new Date(at(1).getTime() + 1800_000), durationSec: 1800 },
      ],
    });
    const res = await me.get('/api/time/my');
    expect(res.status).toBe(200);
    expect(res.body.today.seconds).toBe(5400);
    expect(res.body.week.seconds).toBe(5400);
    expect(res.body.days).toHaveLength(7);
    const today = res.body.days.find((d: { date: string }) => d.date === res.body.today.date);
    expect(today.entries).toHaveLength(2);
    expect(res.body.running).toBeNull();
    expect((await me.get('/api/time/my?week=2020-01-01')).body.week.seconds).toBe(0);
    expect((await me.get('/api/time/my?week=garbage')).status).toBe(400);
  });
});

describe('client time report', () => {
  let clientR: { id: string };
  let lead: Agent;
  beforeAll(async () => {
    clientR = await prisma.client.create({ data: { name: 'Report Person', companyName: 'Report, "Co"', email: 'r@report.test' } });
    const leadUser = await mkTeam('Lead', 'lead@t.test', ['time.track', 'time.view_all'], [clientR.id]);
    lead = await loginAs(leadUser.email);
    const other = await mkTeam('=Evil Name', 'evil@t.test', ['time.track'], [clientR.id]);
    const p = await prisma.project.create({ data: { clientId: clientR.id, name: 'Rebrand', status: 'IN_PROGRESS' } });
    const t = await prisma.task.create({ data: { title: '@SUM(1+1) task', clientId: clientR.id, projectId: p.id, assignedToId: other.id } });
    const d1 = new Date('2026-05-04T09:00:00Z');
    const d2 = new Date('2026-05-05T09:00:00Z');
    const mk = (userId: string, start: Date, sec: number, extra: Record<string, unknown>) =>
      prisma.timeEntry.create({ data: { userId, clientId: clientR.id, startedAt: start, endedAt: new Date(start.getTime() + sec * 1000), durationSec: sec, ...extra } });
    await mk(leadUser.id, d1, 3600, { projectId: p.id, notes: 'plain note' });
    await mk(other.id, d1, 5400, { projectId: p.id, taskId: t.id, notes: '=HYPERLINK("http://evil","x")' });
    await mk(other.id, d2, 1800, { notes: '+1, "quoted"\nline' });
    await mk(other.id, new Date('2026-06-20T09:00:00Z'), 7200, {}); // outside the range used below
    // a running timer is never part of a report
    await prisma.timeEntry.create({ data: { userId: other.id, clientId: clientR.id, startedAt: new Date(), endedAt: null, durationSec: 0 } });
  });

  it('totals + breakdowns (hours as decimals)', async () => {
    const res = await lead.get(`/api/time/report/client/${clientR.id}?from=2026-05-01&to=2026-05-31`);
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ seconds: 10800, hours: 3, entries: 3 });
    expect(res.body.byUser.map((u: { hours: number }) => u.hours)).toEqual([2, 1]);
    expect(res.body.byProject[0]).toMatchObject({ name: 'Rebrand', seconds: 9000, hours: 2.5 });
    expect(res.body.byProject.find((p: { projectId: string | null }) => p.projectId === null).hours).toBe(0.5);
    expect(res.body.byTask.find((t: { title: string | null }) => t.title === '@SUM(1+1) task').hours).toBe(1.5);
    expect(res.body.byDay).toEqual([
      { date: '2026-05-04', seconds: 9000, hours: 2.5, entries: 2 },
      { date: '2026-05-05', seconds: 1800, hours: 0.5, entries: 1 },
    ]);
    const all = await lead.get(`/api/time/report/client/${clientR.id}`);
    expect(all.body.totals.seconds).toBe(18000);
  });

  it('CSV export escapes quotes / commas / line breaks and neutralises spreadsheet formulas', async () => {
    const res = await lead.get(`/api/time/report/client/${clientR.id}.csv?from=2026-05-01&to=2026-05-31`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="time-.*\.csv"/);
    const csv = res.text;
    expect(csv.startsWith('﻿Date,Start,End,Hours,Minutes,User,Project,Task,Notes')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`); // quote prefix + doubled quotes
    expect(csv).toContain(`'=Evil Name`);
    expect(csv).toContain(`'@SUM(1+1) task`);
    expect(csv).toContain(`"'+1, ""quoted""\nline"`);
    expect(csv).toContain('2026-05-04,09:00,10:30,1.50,90');
    expect(csv).toContain('Total,,,3.00,180');
    // no cell may start with a formula character
    for (const line of csv.replace('﻿', '').split('\r\n')) expect(/(^|,)[=+@]/.test(line.replace(/"[^"]*"/g, '""'))).toBe(false);
    const q = await lead.get(`/api/time/report/client/${clientR.id}?format=csv`);
    expect(q.headers['content-type']).toMatch(/text\/csv/);
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_EXPORTED', clientId: clientR.id, clientVisible: false } })).toBe(2);
  });

  it('is limited to the caller’s clients; ADMIN can report on any client', async () => {
    expect((await viewer.get(`/api/time/report/client/${clientR.id}`)).status).toBe(404); // viewer is not on this client
    expect((await lead.get(`/api/time/report/client/${w.clientA.id}`)).status).toBe(404);
    expect((await lead.get(`/api/time/report/client/${w.clientA.id}.csv`)).status).toBe(404);
    expect((await admin.get(`/api/time/report/client/${clientR.id}`)).body.totals.entries).toBe(4);
    expect((await admin.get(`/api/time/report/client/${w.clientA.id}`)).status).toBe(200);
    expect((await admin.get(`/api/time/report/client/${clientR.id}?from=bad`)).status).toBe(400);
    expect((await admin.get('/api/time/report/client/nope')).status).toBe(404);
  });

  it('csvCell escaping helper', () => {
    expect(csvCell('=1+1')).toBe(`'=1+1`);
    expect(csvCell('-2')).toBe(`'-2`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell('safe')).toBe('safe');
  });
});

describe('workload', () => {
  const monday = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); // next Monday
    return d;
  })();
  const day = (offset: number) => new Date(monday.getTime() + offset * 86_400_000);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const q = `from=${key(monday)}&to=${key(day(6))}`; // exactly one week -> capacity 40 h

  it('indicator thresholds', () => {
    expect(indicatorFor(0)).toBe('LOW');
    expect(indicatorFor(0.499)).toBe('LOW');
    expect(indicatorFor(0.5)).toBe('BALANCED');
    expect(indicatorFor(0.899)).toBe('BALANCED');
    expect(indicatorFor(0.9)).toBe('HIGH');
    expect(indicatorFor(1.1)).toBe('HIGH');
    expect(indicatorFor(1.101)).toBe('OVERLOADED');
  });

  it('computes utilization + indicator per person from open tasks in the window (ADMIN sees all staff)', async () => {
    const cases = [{ n: 'low', hrs: 10, ind: 'LOW', u: 0.25 }, { n: 'bal', hrs: 30, ind: 'BALANCED', u: 0.75 }, { n: 'high', hrs: 38, ind: 'HIGH', u: 0.95 }, { n: 'over', hrs: 50, ind: 'OVERLOADED', u: 1.25 }];
    const ids: Record<string, string> = {};
    for (const c of cases) {
      const u = await mkTeam(`WL ${c.n}`, `wl-${c.n}@t.test`, null, [w.clientA.id]);
      ids[c.n] = u.id;
      await prisma.task.create({ data: { title: `${c.n} 1`, clientId: w.clientA.id, assignedToId: u.id, dueDate: day(2), estimatedHours: c.hrs / 2 } });
      await prisma.task.create({ data: { title: `${c.n} 2`, clientId: w.clientA.id, assignedToId: u.id, dueDate: day(3), estimatedHours: c.hrs / 2, status: 'IN_PROGRESS' } });
      // ignored: finished work, work due after the window, and a task with no due date
      await prisma.task.create({ data: { title: `${c.n} done`, clientId: w.clientA.id, assignedToId: u.id, dueDate: day(2), estimatedHours: 99, status: 'DONE' } });
      await prisma.task.create({ data: { title: `${c.n} later`, clientId: w.clientA.id, assignedToId: u.id, dueDate: day(20), estimatedHours: 99 } });
      await prisma.task.create({ data: { title: `${c.n} undated`, clientId: w.clientA.id, assignedToId: u.id, estimatedHours: 99 } });
    }
    const res = await admin.get(`/api/workload?${q}`);
    expect(res.status).toBe(200);
    expect(res.body.window).toMatchObject({ from: key(monday), to: key(day(6)), days: 7, weeks: 1 });
    for (const c of cases) {
      const row = res.body.items.find((i: { user: { id: string } }) => i.user.id === ids[c.n]);
      expect(row).toMatchObject({ indicator: c.ind, utilization: c.u, capacityHours: 40, estimatedHours: c.hrs, dueInWindow: 2, openTasks: 4, overdueTasks: 0, activeProjects: 0 });
    }
    // the admin sees every active staff member, sorted by name (not ranked)
    const names = res.body.items.map((i: { user: { name: string } }) => i.user.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    expect(res.body.items.map((i: { user: { id: string } }) => i.user.id)).toEqual(expect.arrayContaining([w.admin.id, w.teamA.id, w.teamB.id, w.teamC.id]));
  });

  it('a two-week window doubles the capacity; logged time subtracts from the estimate; overdue work is carried over', async () => {
    const u = await mkTeam('WL two', 'wl-two@t.test', null, [w.clientA.id], { weeklyCapacityHours: 20 });
    await prisma.task.create({ data: { title: 'two 1', clientId: w.clientA.id, assignedToId: u.id, dueDate: day(9), estimatedHours: 20, actualHours: 5 } });
    await prisma.task.create({ data: { title: 'two overdue', clientId: w.clientA.id, assignedToId: u.id, dueDate: new Date(Date.now() - 3 * 86_400_000), estimatedHours: 5 } });
    await prisma.task.create({ data: { title: 'two noestimate', clientId: w.clientA.id, assignedToId: u.id, dueDate: day(1) } });
    await prisma.timeEntry.create({ data: { userId: u.id, clientId: w.clientA.id, startedAt: new Date(day(1).getTime() + 9 * H), endedAt: new Date(day(1).getTime() + 12 * H), durationSec: 3 * 3600 } });
    const res = await admin.get(`/api/workload?from=${key(monday)}&to=${key(day(13))}`);
    const row = res.body.items.find((i: { user: { id: string } }) => i.user.id === u.id);
    expect(row).toMatchObject({ weeklyCapacityHours: 20, capacityHours: 40, estimatedHours: 20, utilization: 0.5, indicator: 'BALANCED', overdueTasks: 1, unestimatedTasks: 1, loggedHours: 3, openTasks: 3 });
  });

  it('defaults to this week + next week and rejects bad windows', async () => {
    const res = await admin.get('/api/workload');
    expect(res.status).toBe(200);
    expect(res.body.window).toMatchObject({ days: 14, weeks: 2 });
    expect((await admin.get('/api/workload?from=bad')).status).toBe(400);
    expect((await admin.get('/api/workload?from=2026-05-10&to=2026-05-01')).status).toBe(400);
    expect((await admin.get('/api/workload?from=2020-01-01&to=2026-01-01')).status).toBe(400);
  });

  it('counts active projects a person manages', async () => {
    const res = await admin.get(`/api/workload?${q}`);
    const a = res.body.items.find((i: { user: { id: string } }) => i.user.id === w.teamA.id);
    expect(a.activeProjects).toBe(1);
  });

  it('TEAM with workload.view only sees people who share one of their clients, and only work they may see', async () => {
    // a task of teamA on client B (viewer cannot see it) must not show up in the viewer's numbers
    await prisma.task.create({ data: { title: 'hidden from viewer', clientId: w.clientB.id, assignedToId: w.teamA.id, dueDate: day(2), estimatedHours: 12 } });
    const seen = await viewer.get(`/api/workload?${q}`);
    expect(seen.status).toBe(200);
    const idsSeen = seen.body.items.map((i: { user: { id: string } }) => i.user.id);
    expect(idsSeen).toContain(viewerId);
    expect(idsSeen).toContain(w.teamA.id);
    expect(idsSeen).not.toContain(w.teamB.id);
    expect(idsSeen).not.toContain(w.admin.id);
    expect(idsSeen).not.toContain(w.teamC.id); // only assigned to one campaign, shares no whole client
    const aAsViewer = seen.body.items.find((i: { user: { id: string } }) => i.user.id === w.teamA.id);
    const aAsAdmin = (await admin.get(`/api/workload?${q}`)).body.items.find((i: { user: { id: string } }) => i.user.id === w.teamA.id);
    expect(aAsAdmin.estimatedHours - aAsViewer.estimatedHours).toBe(12);
    expect(aAsAdmin.openTasks - aAsViewer.openTasks).toBe(1);
    expect(aAsViewer.loggedPartial).toBe(true);
    // with no shared client the viewer would only see themselves
    const loner = await mkTeam('Loner', 'loner@t.test', ['workload.view'], []);
    const l = await (await loginAs(loner.email)).get(`/api/workload?${q}`);
    expect(l.body.items.map((i: { user: { id: string } }) => i.user.id)).toEqual([loner.id]);
  });

  it('a person’s open tasks, by due date; out-of-scope people do not exist', async () => {
    const res = await admin.get(`/api/workload/${w.teamA.id}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(w.teamA.id);
    const dates = res.body.items.map((t: { dueDate: string | null }) => t.dueDate);
    const dated = dates.filter((d: string | null) => d);
    expect(dated).toEqual([...dated].sort());
    expect(dates.slice(dated.length).every((d: string | null) => d === null)).toBe(true); // undated last
    expect(res.body.items.every((t: { status: string }) => t.status !== 'DONE')).toBe(true);
    // the viewer gets the same person, minus the tasks they cannot see
    const asViewer = await viewer.get(`/api/workload/${w.teamA.id}`);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.items.find((t: { title: string }) => t.title === 'hidden from viewer')).toBeUndefined();
    expect(res.body.items.find((t: { title: string }) => t.title === 'hidden from viewer')).toBeDefined();
    expect((await viewer.get(`/api/workload/${w.teamB.id}`)).status).toBe(404);
    expect((await viewer.get(`/api/workload/${w.admin.id}`)).status).toBe(404);
    expect((await admin.get('/api/workload/does-not-exist')).status).toBe(404);
  });
});
