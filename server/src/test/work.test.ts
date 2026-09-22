import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { hashPassword } from '../auth/password';
import { DEFAULT_TEAM_PERMISSIONS } from '../../../shared/src/permissions';
import { PASSWORD, buildWorld, loginAs, tinyPng, type Agent, type World } from './helpers';

let w: World;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;
let teamC: Agent;
let alice: Agent; // CLIENT of Alpha
let bob: Agent; // CLIENT of Beta
let teamA2: Agent; // second TEAM member on client A (not creator / assignee of anything)
let teamA2Id: string;
let inactiveId: string;

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ids = (body: { items: Array<{ id: string }> }) => body.items.map((i) => i.id);

async function setPerms(userId: string, perms: string[] | null) {
  await prisma.user.update({ where: { id: userId }, data: { permissions: perms ? JSON.stringify(perms) : null } });
}

beforeAll(async () => {
  w = await buildWorld();
  const hash = await hashPassword(PASSWORD);
  const a2 = await prisma.user.create({ data: { name: 'Team A2', email: 'teama2@t.test', role: 'TEAM', passwordHash: hash } });
  teamA2Id = a2.id;
  await prisma.clientAssignment.create({ data: { userId: a2.id, clientId: w.clientA.id } });
  const off = await prisma.user.create({ data: { name: 'Gone', email: 'gone@t.test', role: 'TEAM', passwordHash: hash, status: 'INACTIVE' } });
  await prisma.clientAssignment.create({ data: { userId: off.id, clientId: w.clientA.id } });
  inactiveId = off.id;
  [admin, teamA, teamB, teamC, alice, bob, teamA2] = await Promise.all(
    ['admin@t.test', 'teama@t.test', 'teamb@t.test', 'teamc@t.test', 'alice@alpha.test', 'bob@beta.test', 'teama2@t.test'].map((e) => loginAs(e)),
  );
});

// ───────────────────────── projects ─────────────────────────

describe('projects: create / scope / client DTO', () => {
  let pid: string; // visible project of client A
  let internalId: string; // internal-only project of client A
  let bProject: string;

  it('ADMIN creates a project; the manager defaults to the caller; budget is returned to staff', async () => {
    const res = await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Alpha Rebrand', budget: 5000, dueDate: day(30), status: 'IN_PROGRESS', priority: 'HIGH' });
    expect(res.status).toBe(201);
    pid = res.body.item.id;
    expect(res.body.item).toMatchObject({ clientId: w.clientA.id, status: 'IN_PROGRESS', budget: 5000, progress: 0, overdue: false, visibleToClient: true, projectManagerId: w.admin.id });
    expect(await prisma.auditLog.count({ where: { action: 'PROJECT_CREATED', entityId: pid, clientId: w.clientA.id, clientVisible: false } })).toBe(1);

    const internal = await teamA.post('/api/projects').send({ clientId: w.clientA.id, name: 'Alpha internal margin review', visibleToClient: false, budget: 900 });
    expect(internal.status).toBe(201);
    internalId = internal.body.item.id;
    bProject = (await teamB.post('/api/projects').send({ clientId: w.clientB.id, name: 'Beta Site' })).body.item.id;
  });

  it('validates input and never trusts clientId / manager', async () => {
    expect((await admin.post('/api/projects').send({ clientId: w.clientA.id, name: '' })).body.error.fields).toMatchObject({ name: 'required' });
    expect((await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'x', budget: -1 })).status).toBe(400);
    expect((await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'x', startDate: '2026-05-10', dueDate: '2026-05-01' })).body.error.fields).toMatchObject({ dueDate: 'end_before_start' });
    expect((await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'x', createdById: w.teamB.id })).status).toBe(400); // strict
    // TEAM A cannot create for client B
    const bad = await teamA.post('/api/projects').send({ clientId: w.clientB.id, name: 'Sneaky' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.clientId).toBe('invalid_choice');
    // manager must be staff who can access the client
    const badMgr = await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'x', projectManagerId: w.teamB.id });
    expect(badMgr.body.error.fields.projectManagerId).toBe('invalid_choice');
    expect((await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'x', projectManagerId: w.userA.id })).status).toBe(400);
  });

  it('CLIENT cannot create / edit / delete projects or milestones (403)', async () => {
    expect((await alice.post('/api/projects').send({ clientId: w.clientA.id, name: 'Mine' })).status).toBe(403);
    expect((await alice.patch(`/api/projects/${pid}`).send({ name: 'Hacked' })).status).toBe(403);
    expect((await alice.delete(`/api/projects/${pid}`)).status).toBe(403);
    expect((await alice.post(`/api/projects/${pid}/milestones`).send({ title: 'Hack' })).status).toBe(403);
  });

  it('CLIENT sees the visible project through a whitelist DTO: no budget, manager, task data or internal fields', async () => {
    const t = await admin.post('/api/tasks').send({ title: 'SECRET-TASK-TITLE', projectId: pid, description: 'internal words' });
    expect(t.status).toBe(201);
    await prisma.internalNote.create({ data: { clientId: w.clientA.id, projectId: pid, authorId: w.admin.id, body: 'SECRET-NOTE' } });

    const list = await alice.get('/api/projects');
    expect(list.status).toBe(200);
    expect(ids(list.body)).toContain(pid);
    const detail = await alice.get(`/api/projects/${pid}`);
    expect(detail.status).toBe(200);
    for (const body of [list.body, detail.body]) {
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('SECRET-TASK-TITLE');
      expect(raw).not.toContain('SECRET-NOTE');
      expect(raw).not.toContain('5000');
    }
    const row = detail.body.item;
    for (const k of ['budget', 'projectManager', 'projectManagerId', 'createdById', 'visibleToClient', 'taskCounts', 'taskCountsByStatus', 'tasks', 'permissions', 'internalNotes']) {
      expect(row, k).not.toHaveProperty(k);
    }
    expect(typeof row.progress).toBe('number');
    expect(row.client).toEqual({ id: w.clientA.id, companyName: 'Alpha Co' });
    const dash = await alice.get(`/api/projects/${pid}/dashboard`);
    expect(dash.status).toBe(200);
    expect(Object.keys(dash.body.item).sort()).toEqual(['deliverables', 'milestoneCounts', 'milestones', 'progress', 'upcomingMilestones']);
    expect(JSON.stringify(dash.body)).not.toContain('SECRET');
  });

  it('an internal-only project does not exist for the client (list, detail, milestones, dashboard)', async () => {
    expect(ids((await alice.get('/api/projects')).body)).not.toContain(internalId);
    expect((await alice.get(`/api/projects/${internalId}`)).status).toBe(404);
    expect((await alice.get(`/api/projects/${internalId}/milestones`)).status).toBe(404);
    expect((await alice.get(`/api/projects/${internalId}/dashboard`)).status).toBe(404);
    expect((await admin.get(`/api/projects/${internalId}`)).status).toBe(200);
  });

  it('another company never sees the project; TEAM on another client gets 404 / empty', async () => {
    expect((await bob.get(`/api/projects/${pid}`)).status).toBe(404);
    expect(ids((await bob.get('/api/projects')).body)).not.toContain(pid);
    expect((await teamB.get(`/api/projects/${pid}`)).status).toBe(404);
    expect((await teamB.patch(`/api/projects/${pid}`).send({ name: 'Nope' })).status).toBe(404);
    expect((await teamB.delete(`/api/projects/${pid}`)).status).toBe(403); // no projects.delete by default
    await setPerms(w.teamB.id, [...DEFAULT_TEAM_PERMISSIONS, 'projects.delete']);
    expect((await teamB.delete(`/api/projects/${pid}`)).status).toBe(404); // ...and with it the project still does not exist for them
    await setPerms(w.teamB.id, null);
    expect(ids((await teamB.get('/api/projects')).body)).not.toContain(pid);
    expect((await teamB.get('/api/projects?clientId=' + w.clientA.id)).body.items).toHaveLength(0);
    expect((await teamB.post(`/api/projects/${pid}/milestones`).send({ title: 'x' })).status).toBe(404);
    expect((await teamB.get(`/api/projects/${bProject}`)).status).toBe(200);
  });

  it('ADMIN sees every project; budget is hidden from TEAM without projects.edit', async () => {
    const all = ids((await admin.get('/api/projects?pageSize=100')).body);
    expect(all).toEqual(expect.arrayContaining([pid, internalId, bProject]));
    expect((await teamA.get(`/api/projects/${pid}`)).body.item.budget).toBe(5000); // default TEAM has projects.edit
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'projects.edit'));
    const noEdit = await teamA.get(`/api/projects/${pid}`);
    expect(noEdit.status).toBe(200);
    expect(noEdit.body.item).not.toHaveProperty('budget');
    expect((await teamA.patch(`/api/projects/${pid}`).send({ name: 'X' })).status).toBe(403);
    await setPerms(w.teamA.id, null);
  });

  it('filters: q, status, priority, mine, overdue', async () => {
    const overdue = await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Late one', dueDate: day(-5), status: 'IN_PROGRESS', projectManagerId: w.teamA.id });
    expect((await admin.get('/api/projects?q=rebrand')).body.items.map((i: { name: string }) => i.name)).toEqual(['Alpha Rebrand']);
    expect(ids((await admin.get('/api/projects?overdue=1')).body)).toEqual([overdue.body.item.id]);
    expect(overdue.body.item.overdue).toBe(true);
    expect((await admin.get('/api/projects?status=IN_PROGRESS&priority=HIGH')).body.items.map((i: { id: string }) => i.id)).toEqual([pid]);
    const mine = ids((await teamA.get('/api/projects?mine=1')).body);
    expect(mine).toContain(overdue.body.item.id);
    expect(mine).not.toContain(pid);
    // a client cannot use staffing filters (they are ignored, not honoured)
    expect(ids((await alice.get('/api/projects?mine=1')).body).length).toBeGreaterThan(0);
    // a project that is COMPLETED is not overdue
    await admin.patch(`/api/projects/${overdue.body.item.id}`).send({ status: 'COMPLETED' });
    expect((await admin.get('/api/projects?overdue=1')).body.items).toHaveLength(0);
  });
});

describe('projects: status, completedAt, milestones, progress, delete', () => {
  let pid: string;
  let hidden: string;

  it('status changes write PROJECT_STATUS_CHANGED (client-visible only for visible projects); COMPLETED sets completedAt', async () => {
    pid = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Status project' })).body.item.id;
    hidden = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Hidden status project', visibleToClient: false })).body.item.id;
    const r1 = await admin.patch(`/api/projects/${pid}`).send({ status: 'IN_PROGRESS' });
    expect(r1.body.item.status).toBe('IN_PROGRESS');
    expect(r1.body.item.completedAt).toBeNull();
    const done = await admin.patch(`/api/projects/${pid}`).send({ status: 'COMPLETED' });
    expect(done.body.item.completedAt).toBeTruthy();
    expect(done.body.item.progress).toBe(100);
    const reopened = await admin.patch(`/api/projects/${pid}`).send({ status: 'REVIEW' });
    expect(reopened.body.item.completedAt).toBeNull();
    const rows = await prisma.auditLog.findMany({ where: { action: 'PROJECT_STATUS_CHANGED', entityId: pid } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.clientVisible && r.clientId === w.clientA.id && r.projectId === pid)).toBe(true);
    await admin.patch(`/api/projects/${hidden}`).send({ status: 'ON_HOLD' });
    const h = await prisma.auditLog.findMany({ where: { action: 'PROJECT_STATUS_CHANGED', entityId: hidden } });
    expect(h).toHaveLength(1);
    expect(h[0].clientVisible).toBe(false);
    // no-op status is not an event
    await admin.patch(`/api/projects/${pid}`).send({ status: 'REVIEW' });
    expect(await prisma.auditLog.count({ where: { action: 'PROJECT_STATUS_CHANGED', entityId: pid } })).toBe(3);
    // strict update schema: clientId / unknown fields rejected
    expect((await admin.patch(`/api/projects/${pid}`).send({ clientId: w.clientB.id })).status).toBe(400);
    expect((await admin.patch(`/api/projects/${pid}`).send({ status: 'NOPE' })).body.error.fields.status).toBe('invalid_choice');
  });

  it('turning a project internal removes its earlier client-visible activity rows', async () => {
    expect(await prisma.auditLog.count({ where: { projectId: pid, clientVisible: true } })).toBeGreaterThan(0);
    const res = await admin.patch(`/api/projects/${pid}`).send({ visibleToClient: false });
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { projectId: pid, clientVisible: true } })).toBe(0);
    expect((await alice.get(`/api/projects/${pid}`)).status).toBe(404);
    await admin.patch(`/api/projects/${pid}`).send({ visibleToClient: true });
  });

  it('milestones: create, update, reorder, complete / uncomplete, delete + audit; client sees them read-only', async () => {
    const m1 = (await admin.post(`/api/projects/${pid}/milestones`).send({ title: 'Kickoff', dueDate: day(3) })).body.item;
    const m2 = (await admin.post(`/api/projects/${pid}/milestones`).send({ title: 'Design', description: 'Round one' })).body.item;
    const m3 = (await admin.post(`/api/projects/${pid}/milestones`).send({ title: 'Launch', dueDate: day(20) })).body.item;
    expect([m1.position, m2.position, m3.position]).toEqual([0, 1, 2]);
    expect((await admin.post(`/api/projects/${pid}/milestones`).send({ title: '' })).status).toBe(400);
    expect((await admin.post(`/api/projects/${pid}/milestones`).send({ title: 'x', projectId: 'other' })).status).toBe(400);

    const up = await admin.patch(`/api/projects/${pid}/milestones/${m2.id}`).send({ title: 'Design v1', dueDate: day(10) });
    expect(up.body.item).toMatchObject({ title: 'Design v1' });

    // reorder: must list every milestone exactly once
    expect((await admin.put(`/api/projects/${pid}/milestones/reorder`).send({ ids: [m1.id, m2.id] })).status).toBe(400);
    const re = await admin.put(`/api/projects/${pid}/milestones/reorder`).send({ ids: [m3.id, m1.id, m2.id] });
    expect(re.status).toBe(200);
    expect(re.body.items.map((m: { id: string }) => m.id)).toEqual([m3.id, m1.id, m2.id]);

    const done = await admin.post(`/api/projects/${pid}/milestones/${m1.id}/complete`);
    expect(done.body.item.completedAt).toBeTruthy();
    const detail = await admin.get(`/api/projects/${pid}`);
    expect(detail.body.item.milestoneCounts).toEqual({ total: 3, done: 1 });
    expect(detail.body.item.nextMilestone.id).toBe(m2.id); // earliest open due date
    const back = await admin.post(`/api/projects/${pid}/milestones/${m1.id}/uncomplete`);
    expect(back.body.item.completedAt).toBeNull();
    await admin.patch(`/api/projects/${pid}/milestones/${m1.id}`).send({ completed: true });

    const clientView = await alice.get(`/api/projects/${pid}/milestones`);
    expect(clientView.status).toBe(200);
    expect(clientView.body.items).toHaveLength(3);
    expect(Object.keys(clientView.body.items[0]).sort()).toEqual(['completedAt', 'description', 'dueDate', 'id', 'position', 'title']);
    expect((await bob.get(`/api/projects/${pid}/milestones`)).status).toBe(404);
    expect((await admin.patch(`/api/projects/${pid}/milestones/nonexistent1`).send({ title: 'x' })).status).toBe(404);

    const del = await admin.delete(`/api/projects/${pid}/milestones/${m3.id}`);
    expect(del.body).toEqual({ ok: true });
    for (const action of ['MILESTONE_CREATED', 'MILESTONE_UPDATED', 'MILESTONE_DELETED']) {
      const rows = (await prisma.auditLog.findMany({ where: { action, projectId: pid } })).filter((r) => !r.metadata?.includes('reordered'));
      expect(rows.length, action).toBeGreaterThan(0);
      expect(rows.every((r) => r.clientVisible && r.clientId === w.clientA.id)).toBe(true);
    }
  });

  it('milestones of an internal project are never client-visible in the audit trail', async () => {
    await admin.post(`/api/projects/${hidden}/milestones`).send({ title: 'Internal ms' });
    const rows = await prisma.auditLog.findMany({ where: { action: 'MILESTONE_CREATED', projectId: hidden } });
    expect(rows).toHaveLength(1);
    expect(rows[0].clientVisible).toBe(false);
  });

  it('progress = done tasks / all tasks (falls back to milestones); one number for the client', async () => {
    const p = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Progress project' })).body.item.id;
    expect((await alice.get(`/api/projects/${p}`)).body.item.progress).toBe(0);
    // milestone fallback: 1 of 2
    const [a, b] = [(await admin.post(`/api/projects/${p}/milestones`).send({ title: 'A' })).body.item, (await admin.post(`/api/projects/${p}/milestones`).send({ title: 'B' })).body.item];
    void b;
    await admin.post(`/api/projects/${p}/milestones/${a.id}/complete`);
    expect((await admin.get(`/api/projects/${p}`)).body.item.progress).toBe(50);
    // task based: 1 of 4
    const tasks: string[] = [];
    for (const title of ['T1', 'T2', 'T3', 'T4']) tasks.push((await admin.post('/api/tasks').send({ title, projectId: p })).body.item.id);
    await admin.patch(`/api/tasks/${tasks[0]}`).send({ status: 'DONE' });
    let d = await admin.get(`/api/projects/${p}`);
    expect(d.body.item.progress).toBe(25);
    expect(d.body.item.taskCounts).toEqual({ total: 4, done: 1, overdue: 0 });
    expect(d.body.item.taskCountsByStatus).toMatchObject({ TODO: 3, DONE: 1 });
    await admin.patch(`/api/tasks/${tasks[1]}`).send({ status: 'DONE' });
    d = await admin.get(`/api/projects/${p}`);
    expect(d.body.item.progress).toBe(50);
    expect((await alice.get(`/api/projects/${p}`)).body.item.progress).toBe(50);
    expect((await admin.get('/api/projects?q=Progress')).body.items[0].progress).toBe(50);
    // overdue open task counts
    await admin.patch(`/api/tasks/${tasks[2]}`).send({ dueDate: day(-2) });
    expect((await admin.get(`/api/projects/${p}`)).body.item.taskCounts.overdue).toBe(1);
  });

  it('dashboard: staff get task / milestone / deliverable numbers; time logged only with time.view_all', async () => {
    const p = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Dash project' })).body.item.id;
    await admin.post('/api/tasks').send({ title: 'D1', projectId: p, dueDate: day(-1) });
    await prisma.deliverable.create({ data: { name: 'Pending piece', clientId: w.clientA.id, type: 'DESIGN', status: 'PENDING_APPROVAL', submittedAt: new Date(), projectId: p } });
    await prisma.deliverable.create({ data: { name: 'Draft piece', clientId: w.clientA.id, type: 'DESIGN', status: 'DRAFT', projectId: p } });
    await prisma.timeEntry.create({ data: { userId: w.admin.id, projectId: p, clientId: w.clientA.id, startedAt: new Date(), endedAt: new Date(), durationSec: 5400 } });
    const dash = await admin.get(`/api/projects/${p}/dashboard`);
    expect(dash.status).toBe(200);
    expect(dash.body.item.tasks).toMatchObject({ total: 1, done: 0, overdue: 1 });
    expect(dash.body.item.deliverables.pendingApproval).toBe(1);
    expect(dash.body.item.timeLogged).toEqual({ totalHours: 1.5, last30DaysHours: 1.5 });
    const team = await teamA.get(`/api/projects/${p}/dashboard`);
    expect(team.status).toBe(200);
    expect(team.body.item).not.toHaveProperty('timeLogged');
    await setPerms(w.teamA.id, [...DEFAULT_TEAM_PERMISSIONS, 'time.view_all']);
    expect((await teamA.get(`/api/projects/${p}/dashboard`)).body.item.timeLogged.totalHours).toBe(1.5);
    await setPerms(w.teamA.id, null);
    // client: only sent deliverables are counted, and no task numbers
    const c = await alice.get(`/api/projects/${p}/dashboard`);
    expect(c.body.item.deliverables.total).toBe(1);
    expect(c.body.item).not.toHaveProperty('tasks');
    expect(c.body.item).not.toHaveProperty('timeLogged');
    const detail = await alice.get(`/api/projects/${p}`);
    expect(detail.body.item.deliverableCounts.total).toBe(1);
  });

  it('delete needs projects.delete, detaches (never destroys) linked work and is audited', async () => {
    const p = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Doomed project' })).body.item.id;
    const task = (await admin.post('/api/tasks').send({ title: 'Survivor task', projectId: p })).body.item.id;
    await prisma.campaign.update({ where: { id: w.campA1.id }, data: { projectId: p } });
    const del = await prisma.deliverable.create({ data: { name: 'Survivor deliverable', clientId: w.clientA.id, type: 'DESIGN', projectId: p } });
    expect((await teamA.delete(`/api/projects/${p}`)).status).toBe(403); // default TEAM: no projects.delete
    expect((await admin.delete(`/api/projects/${p}`)).body).toEqual({ ok: true });
    expect((await admin.get(`/api/projects/${p}`)).status).toBe(404);
    expect(await prisma.task.findUnique({ where: { id: task } })).toMatchObject({ projectId: null, clientId: w.clientA.id });
    expect((await prisma.campaign.findUnique({ where: { id: w.campA1.id } }))?.projectId).toBeNull();
    expect((await prisma.deliverable.findUnique({ where: { id: del.id } }))?.projectId).toBeNull();
    const rows = await prisma.auditLog.findMany({ where: { action: 'PROJECT_DELETED', entityId: p } });
    expect(rows).toHaveLength(1);
    expect(rows[0].clientVisible).toBe(false);
    expect(JSON.parse(rows[0].metadata!)).toMatchObject({ detachedTasks: 1, detachedCampaigns: 1, detachedDeliverables: 1 });
  });
});

// ───────────────────────── tasks ─────────────────────────

describe('tasks: CLIENT is locked out of every endpoint', () => {
  let taskId: string;
  beforeAll(async () => {
    taskId = (await admin.post('/api/tasks').send({ title: 'Client must never see this', clientId: w.clientA.id })).body.item.id;
  });

  it('403 on every task route', async () => {
    const calls: Array<[string, string, object?]> = [
      ['get', '/api/tasks'], ['get', '/api/tasks/my'], ['get', '/api/tasks/summary'], ['get', `/api/tasks/${taskId}`],
      ['post', '/api/tasks', { title: 'x', clientId: w.clientA.id }], ['patch', `/api/tasks/${taskId}`, { status: 'DONE' }], ['delete', `/api/tasks/${taskId}`],
      ['post', `/api/tasks/${taskId}/checklist`, { text: 'x' }], ['patch', `/api/tasks/${taskId}/checklist/abcdef`, { done: true }], ['delete', `/api/tasks/${taskId}/checklist/abcdef`],
      ['put', `/api/tasks/${taskId}/checklist/reorder`, { ids: ['abcdef'] }],
      ['get', `/api/tasks/${taskId}/comments`], ['post', `/api/tasks/${taskId}/comments`, { comment: 'hi' }],
    ];
    for (const [method, url, body] of calls) {
      const res = await (alice as unknown as Record<string, (u: string) => { send: (b?: object) => Promise<{ status: number }> }>)[method](url).send(body);
      expect(res.status, `${method} ${url}`).toBe(403);
    }
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.status).toBe('TODO');
  });

  it('client cannot attach or download task files, and task files never show in the file list', async () => {
    const up = await admin.post('/api/files').field('taskId', taskId).attach('file', tinyPng(), 'task.png');
    expect(up.status).toBe(201);
    expect(up.body.item).toMatchObject({ taskId, visibleToClient: false, clientId: w.clientA.id });
    expect((await alice.get(`/api/files/${up.body.item.id}/download`)).status).toBe(404);
    expect(ids((await alice.get('/api/files')).body)).not.toContain(up.body.item.id);
    const cUp = await alice.post('/api/files').field('taskId', taskId).attach('file', tinyPng(), 'x.png');
    expect(cUp.status).toBe(403);
    // staff see it on the task detail
    const detail = await admin.get(`/api/tasks/${taskId}`);
    expect(detail.body.item.files.map((f: { id: string }) => f.id)).toContain(up.body.item.id);
    expect(detail.body.item.files[0]).not.toHaveProperty('filePath');
    // TEAM of another client cannot attach
    expect((await teamB.post('/api/files').field('taskId', taskId).attach('file', tinyPng(), 'y.png')).status).toBe(404);
  });
});

describe('tasks: create / scope / permissions', () => {
  it('creates a task; creator comes from the session; client derives from the project; audit written', async () => {
    const p = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Task host' })).body.item.id;
    const res = await teamA.post('/api/tasks').send({ title: '  Write brief  ', projectId: p, priority: 'HIGH', dueDate: day(5), estimatedHours: 3.5, assignedToId: w.teamA.id });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ title: 'Write brief', projectId: p, clientId: w.clientA.id, createdById: w.teamA.id, assignedToId: w.teamA.id, status: 'TODO', priority: 'HIGH', estimatedHours: 3.5, actualHours: 0, overdue: false });
    expect(res.body.item.checklist).toEqual({ done: 0, total: 0 });
    expect(res.body.item.client.companyName).toBe('Alpha Co');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'TASK_CREATED', entityId: res.body.item.id } });
    expect(audit).toMatchObject({ clientId: w.clientA.id, projectId: p, clientVisible: false, entity: 'task' });
    expect(JSON.parse(audit!.metadata!)).toEqual({ title: 'Write brief', status: 'TODO' });
  });

  it('validation: title, enums, dates, hours; body cannot set actualHours / createdById / completedAt', async () => {
    const base = { clientId: w.clientA.id };
    expect((await teamA.post('/api/tasks').send({ ...base, title: '' })).body.error.fields.title).toBe('required');
    expect((await teamA.post('/api/tasks').send({ ...base, title: 'x', priority: 'MEGA' })).body.error.fields.priority).toBe('invalid_choice');
    expect((await teamA.post('/api/tasks').send({ ...base, title: 'x', dueDate: '31/12/2026' })).body.error.fields.dueDate).toBe('invalid_date');
    expect((await teamA.post('/api/tasks').send({ ...base, title: 'x', estimatedHours: -2 })).status).toBe(400);
    for (const extra of [{ actualHours: 99 }, { createdById: w.teamB.id }, { completedAt: new Date().toISOString() }]) {
      expect((await teamA.post('/api/tasks').send({ ...base, title: 'x', ...extra })).status).toBe(400);
    }
  });

  it('TEAM cannot use a client / project / campaign outside their scope; ids must be consistent', async () => {
    const pB = (await teamB.post('/api/projects').send({ clientId: w.clientB.id, name: 'B only' })).body.item.id;
    expect((await teamA.post('/api/tasks').send({ title: 'x', clientId: w.clientB.id })).body.error.fields.clientId).toBe('invalid_choice');
    expect((await teamA.post('/api/tasks').send({ title: 'x', projectId: pB })).body.error.fields.projectId).toBe('invalid_choice');
    expect((await teamA.post('/api/tasks').send({ title: 'x', campaignId: w.campB1.id })).body.error.fields.campaignId).toBe('invalid_choice');
    // campaign of client A + client B in the body: mismatch
    expect((await admin.post('/api/tasks').send({ title: 'x', campaignId: w.campA1.id, clientId: w.clientB.id })).status).toBe(400);
    // project of B with campaign of A
    expect((await admin.post('/api/tasks').send({ title: 'x', projectId: pB, campaignId: w.campA1.id })).status).toBe(400);
    // project derives the client; a mismatching body clientId is refused
    expect((await admin.post('/api/tasks').send({ title: 'x', projectId: pB, clientId: w.clientA.id })).status).toBe(400);
    const ok = await admin.post('/api/tasks').send({ title: 'derived', projectId: pB });
    expect(ok.body.item.clientId).toBe(w.clientB.id);
    // campaign-only TEAM member (teamC) can use their campaign (client derived) but not a whole-client id
    expect((await teamC.post('/api/tasks').send({ title: 'via campaign', campaignId: w.campA2.id })).body.item.clientId).toBe(w.clientA.id);
    expect((await teamC.post('/api/tasks').send({ title: 'via client', clientId: w.clientA.id })).status).toBe(400);
    // personal task (no client) is allowed and only visible to the creator / admin
    const personal = await teamA.post('/api/tasks').send({ title: 'Personal reminder' });
    expect(personal.status).toBe(201);
    expect(personal.body.item.clientId).toBeNull();
    expect((await teamB.get(`/api/tasks/${personal.body.item.id}`)).status).toBe(404);
  });

  it('TEAM without tasks.create gets 403; without tasks.view gets 403 everywhere', async () => {
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'tasks.create'));
    expect((await teamA.post('/api/tasks').send({ title: 'x', clientId: w.clientA.id })).status).toBe(403);
    expect((await teamA.get('/api/tasks')).status).toBe(200);
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'tasks.view'));
    expect((await teamA.get('/api/tasks')).status).toBe(403);
    expect((await teamA.get('/api/tasks/my')).status).toBe(403);
    await setPerms(w.teamA.id, null);
  });

  it('TEAM sees only tasks of assigned clients (+ their own); unassigned client task is 404; ADMIN sees all', async () => {
    const tA = (await admin.post('/api/tasks').send({ title: 'Scope A', clientId: w.clientA.id })).body.item.id;
    const tB = (await admin.post('/api/tasks').send({ title: 'Scope B', clientId: w.clientB.id })).body.item.id;
    expect((await teamA.get(`/api/tasks/${tA}`)).status).toBe(200);
    expect((await teamA.get(`/api/tasks/${tB}`)).status).toBe(404);
    expect((await teamA.patch(`/api/tasks/${tB}`).send({ status: 'DONE' })).status).toBe(404);
    expect((await teamA.get(`/api/tasks/${tB}/comments`)).status).toBe(404);
    expect((await teamA.post(`/api/tasks/${tB}/comments`).send({ comment: 'x' })).status).toBe(404);
    expect((await teamA.post(`/api/tasks/${tB}/checklist`).send({ text: 'x' })).status).toBe(404);
    await setPerms(w.teamA.id, [...DEFAULT_TEAM_PERMISSIONS, 'tasks.delete']);
    expect((await teamA.delete(`/api/tasks/${tB}`)).status).toBe(404);
    await setPerms(w.teamA.id, null);
    const a = await teamA.get('/api/tasks?pageSize=100');
    expect(ids(a.body)).toContain(tA);
    expect(ids(a.body)).not.toContain(tB);
    expect(ids((await teamA.get(`/api/tasks?clientId=${w.clientB.id}`)).body)).toHaveLength(0);
    const all = ids((await admin.get('/api/tasks?pageSize=100')).body);
    expect(all).toEqual(expect.arrayContaining([tA, tB]));
    expect(ids((await teamB.get('/api/tasks?pageSize=100')).body)).toContain(tB);
    // campaign-only member sees campaign tasks only
    const c = await teamC.get('/api/tasks?pageSize=100');
    expect(ids(c.body)).not.toContain(tA);
  });

  it('assignee validation: staff who can access the client only; assigning others needs tasks.assign', async () => {
    const mk = (assignedToId: string) => teamA.post('/api/tasks').send({ title: 'assign me', clientId: w.clientA.id, assignedToId });
    const other = await mk(w.teamB.id); // cannot access client A
    expect(other.status).toBe(400);
    expect(other.body.error.fields.assignedToId).toBe('invalid_choice');
    expect((await mk(w.userA.id)).status).toBe(400); // a client user
    expect((await mk(inactiveId)).status).toBe(400); // inactive
    expect((await mk('doesnotexist123')).status).toBe(400);
    expect((await mk(w.admin.id)).status).toBe(201); // admins are always assignable
    expect((await mk(teamA2Id)).status).toBe(201); // team member of the same client
    expect((await mk(w.teamA.id)).status).toBe(201); // yourself
    // ADMIN cannot assign a TEAM member of another client either
    expect((await admin.post('/api/tasks').send({ title: 'x', clientId: w.clientA.id, assignedToId: w.teamB.id })).status).toBe(400);
    // no tasks.assign: only self-assignment
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'tasks.assign'));
    expect((await mk(teamA2Id)).status).toBe(403);
    expect((await mk(w.teamA.id)).status).toBe(201);
    await setPerms(w.teamA.id, null);
    // on update too
    const t = (await teamA.post('/api/tasks').send({ title: 'reassign', clientId: w.clientA.id })).body.item.id;
    expect((await teamA.patch(`/api/tasks/${t}`).send({ assignedToId: w.teamB.id })).body.error.fields.assignedToId).toBe('invalid_choice');
    expect((await teamA.patch(`/api/tasks/${t}`).send({ assignedToId: teamA2Id })).body.item.assignedToId).toBe(teamA2Id);
  });

  it('assignment notifies the new assignee (not the actor); comments notify assignee + creator (not the author)', async () => {
    const t = (await teamA.post('/api/tasks').send({ title: 'Notify me', clientId: w.clientA.id, assignedToId: teamA2Id })).body.item.id;
    expect(await prisma.notification.count({ where: { userId: teamA2Id, type: 'TASK_ASSIGNED', entityId: t, entity: 'task' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'TASK_ASSIGNED', entityId: t } })).toBe(0);
    const n = await prisma.notification.findFirst({ where: { userId: teamA2Id, type: 'TASK_ASSIGNED', entityId: t } });
    expect(JSON.parse(n!.data!)).toMatchObject({ title: 'Notify me', by: 'Team A' });
    // self assignment: no notification
    const self = (await teamA.post('/api/tasks').send({ title: 'Mine', clientId: w.clientA.id, assignedToId: w.teamA.id })).body.item.id;
    expect(await prisma.notification.count({ where: { entityId: self } })).toBe(0);
    // reassign to admin
    await teamA.patch(`/api/tasks/${t}`).send({ assignedToId: w.admin.id });
    expect(await prisma.notification.count({ where: { userId: w.admin.id, type: 'TASK_ASSIGNED', entityId: t } })).toBe(1);
    // comment by teamA2 -> assignee (admin) + creator (teamA) notified, author not
    const c = await teamA2.post(`/api/tasks/${t}/comments`).send({ comment: 'Looks good' });
    expect(c.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: w.admin.id, type: 'TASK_COMMENT', entityId: t } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'TASK_COMMENT', entityId: t } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: teamA2Id, type: 'TASK_COMMENT', entityId: t } })).toBe(0);
    // comment by the creator -> only the assignee
    await teamA.post(`/api/tasks/${t}/comments`).send({ comment: 'thanks' });
    expect(await prisma.notification.count({ where: { userId: w.admin.id, type: 'TASK_COMMENT', entityId: t } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'TASK_COMMENT', entityId: t } })).toBe(1);
  });
});

describe('tasks: update rules, status flow, completedAt, audit', () => {
  let t: string; // created by admin, assigned to teamA, client A

  beforeAll(async () => {
    t = (await admin.post('/api/tasks').send({ title: 'Flow task', clientId: w.clientA.id, assignedToId: w.teamA.id, description: 'first' })).body.item.id;
  });

  it('assignee may change status / description but not title, priority, due date, assignee, estimate', async () => {
    const ok = await teamA.patch(`/api/tasks/${t}`).send({ status: 'IN_PROGRESS', description: 'second' });
    expect(ok.status).toBe(200);
    expect(ok.body.item).toMatchObject({ status: 'IN_PROGRESS', description: 'second' });
    for (const body of [{ title: 'Renamed' }, { priority: 'URGENT' }, { dueDate: day(2) }, { assignedToId: w.teamA.id }, { estimatedHours: 4 }, { projectId: null }]) {
      expect((await teamA.patch(`/api/tasks/${t}`).send(body)).status, JSON.stringify(body)).toBe(403);
    }
    // actualHours cannot be written directly by anybody
    expect((await teamA.patch(`/api/tasks/${t}`).send({ actualHours: 50 })).status).toBe(400);
    expect((await admin.patch(`/api/tasks/${t}`).send({ actualHours: 50 })).status).toBe(400);
    expect((await admin.patch(`/api/tasks/${t}`).send({ completedAt: new Date().toISOString() })).status).toBe(400);
    expect((await admin.patch(`/api/tasks/${t}`).send({ createdById: w.teamB.id })).status).toBe(400);
  });

  it('a team member who sees the task but is neither assignee nor creator (no tasks.edit_all) cannot change it', async () => {
    expect((await teamA2.get(`/api/tasks/${t}`)).status).toBe(200);
    expect((await teamA2.patch(`/api/tasks/${t}`).send({ status: 'DONE' })).status).toBe(403);
    expect((await teamA2.patch(`/api/tasks/${t}`).send({ title: 'x' })).status).toBe(403);
    expect((await teamA2.delete(`/api/tasks/${t}`)).status).toBe(403); // also lacks tasks.delete
    await setPerms(teamA2Id, [...DEFAULT_TEAM_PERMISSIONS, 'tasks.edit_all']);
    expect((await teamA2.patch(`/api/tasks/${t}`).send({ priority: 'LOW' })).status).toBe(200);
    await setPerms(teamA2Id, null);
    expect((await teamA2.patch(`/api/tasks/${t}`).send({ priority: 'HIGH' })).status).toBe(403);
    expect((await admin.patch(`/api/tasks/${t}`).send({ priority: 'NORMAL' })).body.item.priority).toBe('NORMAL');
  });

  it('the creator may change the planning fields', async () => {
    const mine = (await teamA.post('/api/tasks').send({ title: 'Mine to edit', clientId: w.clientA.id })).body.item.id;
    const res = await teamA.patch(`/api/tasks/${mine}`).send({ title: 'Edited', priority: 'URGENT', dueDate: day(4), estimatedHours: 2, assignedToId: w.teamA.id });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ title: 'Edited', priority: 'URGENT', estimatedHours: 2 });
    expect((await teamA.patch(`/api/tasks/${mine}`).send({ dueDate: null })).body.item.dueDate).toBeNull();
  });

  it('status transitions set / clear completedAt and write the right audit rows', async () => {
    const id = (await admin.post('/api/tasks').send({ title: 'Transitions', clientId: w.clientA.id, assignedToId: w.teamA.id })).body.item.id;
    expect((await teamA.patch(`/api/tasks/${id}`).send({ status: 'IN_PROGRESS' })).body.item.completedAt).toBeNull();
    expect((await teamA.patch(`/api/tasks/${id}`).send({ status: 'REVIEW' })).body.item.status).toBe('REVIEW');
    expect((await teamA.patch(`/api/tasks/${id}`).send({ status: 'BLOCKED' })).body.item.status).toBe('BLOCKED');
    const done = await teamA.patch(`/api/tasks/${id}`).send({ status: 'DONE' });
    expect(done.body.item.completedAt).toBeTruthy();
    const first = done.body.item.completedAt;
    // same status again: no new event, completedAt untouched
    expect((await teamA.patch(`/api/tasks/${id}`).send({ status: 'DONE' })).body.item.completedAt).toBe(first);
    const reopened = await teamA.patch(`/api/tasks/${id}`).send({ status: 'IN_PROGRESS' });
    expect(reopened.body.item.completedAt).toBeNull();
    expect((await teamA.patch(`/api/tasks/${id}`).send({ status: 'FINISHED' })).body.error.fields.status).toBe('invalid_choice');

    expect(await prisma.auditLog.count({ where: { action: 'TASK_STATUS_CHANGED', entityId: id } })).toBe(5);
    expect(await prisma.auditLog.count({ where: { action: 'TASK_COMPLETED', entityId: id } })).toBe(1);
    const rows = await prisma.auditLog.findMany({ where: { entityId: id, entity: 'task' } });
    expect(rows.every((r) => r.clientVisible === false && r.clientId === w.clientA.id)).toBe(true);
    const meta = JSON.parse(rows.find((r) => r.action === 'TASK_STATUS_CHANGED')!.metadata!);
    expect(meta).toMatchObject({ title: 'Transitions', from: 'TODO', to: 'IN_PROGRESS' });
    expect(Object.keys(meta).sort()).toEqual(['from', 'status', 'title', 'to']);
    // task activity is not part of what a client can read as activity
    expect(await prisma.auditLog.count({ where: { entity: 'task', clientVisible: true } })).toBe(0);
  });

  it('project / campaign changes stay inside the task\'s client; unassign works; TASK_UPDATED + TASK_ASSIGNED audited', async () => {
    const id = (await admin.post('/api/tasks').send({ title: 'Relink', clientId: w.clientA.id })).body.item.id;
    const pA = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Relink A' })).body.item.id;
    const pB = (await admin.post('/api/projects').send({ clientId: w.clientB.id, name: 'Relink B' })).body.item.id;
    expect((await admin.patch(`/api/tasks/${id}`).send({ projectId: pB })).status).toBe(400);
    expect((await admin.patch(`/api/tasks/${id}`).send({ campaignId: w.campB1.id })).status).toBe(400);
    const ok = await admin.patch(`/api/tasks/${id}`).send({ projectId: pA, campaignId: w.campA1.id, assignedToId: w.teamA.id });
    expect(ok.body.item).toMatchObject({ projectId: pA, campaignId: w.campA1.id, assignedToId: w.teamA.id });
    expect(ok.body.item.project.name).toBe('Relink A');
    expect((await admin.patch(`/api/tasks/${id}`).send({ projectId: null, assignedToId: null })).body.item).toMatchObject({ projectId: null, assignedToId: null });
    expect(await prisma.auditLog.count({ where: { action: 'TASK_UPDATED', entityId: id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'TASK_ASSIGNED', entityId: id } })).toBe(2);
    expect((await admin.get('/api/tasks?unassigned=1&pageSize=100')).body.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it('delete needs tasks.delete, removes children, keeps logged time, is audited', async () => {
    const id = (await admin.post('/api/tasks').send({ title: 'Delete me', clientId: w.clientA.id, assignedToId: w.teamA.id })).body.item.id;
    await admin.post(`/api/tasks/${id}/checklist`).send({ text: 'one' });
    await admin.post(`/api/tasks/${id}/comments`).send({ comment: 'bye' });
    const entry = await prisma.timeEntry.create({ data: { userId: w.teamA.id, taskId: id, clientId: w.clientA.id, startedAt: new Date(), endedAt: new Date(), durationSec: 60 } });
    expect((await teamA.delete(`/api/tasks/${id}`)).status).toBe(403); // assignee, but no tasks.delete
    await setPerms(w.teamA.id, [...DEFAULT_TEAM_PERMISSIONS, 'tasks.delete']);
    expect((await teamA.delete(`/api/tasks/${id}`)).body).toEqual({ ok: true });
    await setPerms(w.teamA.id, null);
    expect(await prisma.task.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.taskChecklistItem.count({ where: { taskId: id } })).toBe(0);
    expect(await prisma.taskComment.count({ where: { taskId: id } })).toBe(0);
    expect((await prisma.timeEntry.findUnique({ where: { id: entry.id } }))?.taskId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'TASK_DELETED', entityId: id, clientVisible: false } })).toBe(1);
    expect((await admin.get(`/api/tasks/${id}`)).status).toBe(404);
  });
});

describe('tasks: checklist and comments', () => {
  let t: string; // assigned to teamA, created by admin, client A

  beforeAll(async () => {
    t = (await admin.post('/api/tasks').send({ title: 'Checklist task', clientId: w.clientA.id, assignedToId: w.teamA.id })).body.item.id;
  });

  it('assignee manages the checklist; progress + completedAt follow; reorder needs the exact set', async () => {
    const a = (await teamA.post(`/api/tasks/${t}/checklist`).send({ text: '  First  ' })).body.item;
    const b = (await teamA.post(`/api/tasks/${t}/checklist`).send({ text: 'Second' })).body.item;
    const c = (await teamA.post(`/api/tasks/${t}/checklist`).send({ text: 'Third' })).body.item;
    expect(a).toMatchObject({ text: 'First', done: false, position: 0 });
    expect([b.position, c.position]).toEqual([1, 2]);
    expect((await teamA.post(`/api/tasks/${t}/checklist`).send({ text: '' })).status).toBe(400);
    expect((await teamA.post(`/api/tasks/${t}/checklist`).send({ text: 'x', done: true })).status).toBe(400);

    const done = await teamA.patch(`/api/tasks/${t}/checklist/${a.id}`).send({ done: true });
    expect(done.body.item.done).toBe(true);
    expect(done.body.item.completedAt).toBeTruthy();
    expect((await teamA.patch(`/api/tasks/${t}/checklist/${a.id}`).send({ text: 'First!' })).body.item).toMatchObject({ text: 'First!', done: true });
    const detail = await teamA.get(`/api/tasks/${t}`);
    expect(detail.body.item.checklist).toEqual({ done: 1, total: 3 });
    expect(detail.body.item.checklistItems.map((i: { id: string }) => i.id)).toEqual([a.id, b.id, c.id]);
    expect((await teamA.patch(`/api/tasks/${t}/checklist/${a.id}`).send({ done: false })).body.item.completedAt).toBeNull();

    expect((await teamA.put(`/api/tasks/${t}/checklist/reorder`).send({ ids: [c.id, a.id] })).status).toBe(400);
    const re = await teamA.put(`/api/tasks/${t}/checklist/reorder`).send({ ids: [c.id, a.id, b.id] });
    expect(re.body.items.map((i: { id: string }) => i.id)).toEqual([c.id, a.id, b.id]);
    expect((await teamA.delete(`/api/tasks/${t}/checklist/${b.id}`)).body).toEqual({ ok: true });
    expect((await teamA.get('/api/tasks?pageSize=100')).body.items.find((i: { id: string }) => i.id === t).checklist).toEqual({ done: 0, total: 2 });
    expect(await prisma.auditLog.count({ where: { action: 'TASK_UPDATED', entityId: t } })).toBeGreaterThanOrEqual(6);
  });

  it('checklist items are addressed through their task (no cross-task access)', async () => {
    const other = (await admin.post('/api/tasks').send({ title: 'Other task', clientId: w.clientA.id, assignedToId: w.teamA.id })).body.item.id;
    const item = (await admin.post(`/api/tasks/${other}/checklist`).send({ text: 'foreign' })).body.item;
    expect((await teamA.patch(`/api/tasks/${t}/checklist/${item.id}`).send({ done: true })).status).toBe(404);
    expect((await teamA.delete(`/api/tasks/${t}/checklist/${item.id}`)).status).toBe(404);
    expect((await admin.patch(`/api/tasks/${other}/checklist/${item.id}`).send({ taskId: t })).status).toBe(400); // cannot be moved to another task
  });

  it('a teammate who only sees the task can comment but cannot touch the checklist; other clients get 404', async () => {
    expect((await teamA2.post(`/api/tasks/${t}/checklist`).send({ text: 'nope' })).status).toBe(403);
    const item = (await teamA.get(`/api/tasks/${t}`)).body.item.checklistItems[0];
    expect((await teamA2.patch(`/api/tasks/${t}/checklist/${item.id}`).send({ done: true })).status).toBe(403);
    expect((await teamA2.delete(`/api/tasks/${t}/checklist/${item.id}`)).status).toBe(403);
    const c = await teamA2.post(`/api/tasks/${t}/comments`).send({ comment: '  Nice work  ' });
    expect(c.status).toBe(201);
    expect(c.body.item).toMatchObject({ comment: 'Nice work', userId: teamA2Id, user: { name: 'Team A2' } });
    expect((await teamB.post(`/api/tasks/${t}/checklist`).send({ text: 'x' })).status).toBe(404);
    expect((await teamB.post(`/api/tasks/${t}/comments`).send({ comment: 'x' })).status).toBe(404);
  });

  it('comments: author from the session (body cannot override), validated, listed oldest first, audited without text', async () => {
    expect((await teamA.post(`/api/tasks/${t}/comments`).send({ comment: '' })).status).toBe(400);
    expect((await teamA.post(`/api/tasks/${t}/comments`).send({ comment: 'x', userId: w.teamB.id })).status).toBe(400);
    expect((await teamA.post(`/api/tasks/${t}/comments`).send({ comment: 'x'.repeat(2001) })).status).toBe(400);
    await teamA.post(`/api/tasks/${t}/comments`).send({ comment: 'Second comment' });
    const list = await admin.get(`/api/tasks/${t}/comments`);
    expect(list.body.items.map((c: { comment: string }) => c.comment)).toEqual(['Nice work', 'Second comment']);
    const rows = await prisma.auditLog.findMany({ where: { action: 'COMMENT_CREATED', entityId: t } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => !r.clientVisible && !r.metadata!.includes('Nice work'))).toBe(true);
    // task comments never mix with deliverable / request comments
    expect(await prisma.comment.count({ where: { clientId: w.clientA.id, comment: 'Nice work' } })).toBe(0);
  });
});

describe('tasks: filters, overdue, calendar range, summary', () => {
  let clientCId: string;
  const created: Record<string, string> = {};

  beforeAll(async () => {
    const mk = async (key: string, body: object) => {
      const res = await admin.post('/api/tasks').send({ clientId: w.clientA.id, ...body });
      expect(res.status, key).toBe(201);
      created[key] = res.body.item.id;
    };
    await mk('late', { title: 'Filter late', dueDate: day(-3), assignedToId: w.teamA.id, priority: 'URGENT' });
    await mk('lateDone', { title: 'Filter late but done', dueDate: day(-2), status: 'DONE', assignedToId: w.teamA.id });
    await mk('today', { title: 'Filter today', dueDate: day(0), assignedToId: w.teamA.id });
    await mk('soon', { title: 'Filter soon', dueDate: day(4), assignedToId: w.teamA.id, priority: 'LOW' });
    await mk('far', { title: 'Filter far', dueDate: day(60) });
    await mk('undated', { title: 'Filter undated' });
    clientCId = w.clientA.id;
  });

  const f = async (qs: string, agent: Agent = admin) => ids((await agent.get(`/api/tasks?pageSize=100&q=Filter&${qs}`)).body);

  it('overdue = due before today and not DONE (date-only, UTC)', async () => {
    expect(await f('overdue=1')).toEqual([created.late]);
    const row = (await admin.get(`/api/tasks?q=Filter late`)).body.items;
    expect(row.find((r: { id: string }) => r.id === created.late).overdue).toBe(true);
    expect(row.find((r: { id: string }) => r.id === created.lateDone).overdue).toBe(false);
    expect((await admin.get(`/api/tasks?q=Filter today`)).body.items[0].overdue).toBe(false); // due today is not overdue
  });

  it('filters: status, priority, mine, unassigned, assignedToId, client, project', async () => {
    expect(await f('status=DONE')).toEqual([created.lateDone]);
    expect(await f('priority=URGENT')).toEqual([created.late]);
    expect((await f('mine=1', teamA)).sort()).toEqual([created.late, created.lateDone, created.today, created.soon].sort());
    expect((await f('unassigned=1')).sort()).toEqual([created.far, created.undated].sort());
    expect((await f(`assignedToId=${w.teamA.id}`)).length).toBe(4);
    expect((await f(`clientId=${clientCId}`)).length).toBe(6);
    expect(await f(`clientId=${w.clientB.id}`)).toHaveLength(0);
    expect((await admin.get('/api/tasks?status=NOPE')).status).toBe(200); // invalid enum filter is ignored, not an error
  });

  it('default sort is due date ascending with undated tasks last; pagination is consistent', async () => {
    const all = await f('');
    expect(all.slice(0, 5)).toEqual([created.late, created.lateDone, created.today, created.soon, created.far]);
    expect(all[all.length - 1]).toBe(created.undated);
    const p1 = (await admin.get('/api/tasks?q=Filter&pageSize=4&page=1')).body;
    const p2 = (await admin.get('/api/tasks?q=Filter&pageSize=4&page=2')).body;
    expect(p1.meta).toMatchObject({ total: 6, totalPages: 2, page: 1 });
    expect([...ids(p1), ...ids(p2)]).toEqual(all);
    const desc = ids((await admin.get('/api/tasks?q=Filter&pageSize=100&sort=dueDate&dir=desc')).body);
    expect(desc[0]).toBe(created.far);
    expect((await admin.get('/api/tasks?q=Filter&pageSize=1000')).body.meta.pageSize).toBe(100);
  });

  it('calendar range: dueFrom / dueTo (inclusive), max 100 days, valid dates', async () => {
    const r = await f(`dueFrom=${day(-3)}&dueTo=${day(4)}`);
    expect(r.sort()).toEqual([created.late, created.lateDone, created.today, created.soon].sort());
    expect(await f(`dueFrom=${day(0)}&dueTo=${day(0)}`)).toEqual([created.today]);
    expect((await admin.get(`/api/tasks?dueFrom=${day(0)}&dueTo=${day(101)}`)).status).toBe(400);
    expect((await admin.get(`/api/tasks?dueFrom=${day(0)}&dueTo=${day(100)}`)).status).toBe(200);
    expect((await admin.get(`/api/tasks?dueFrom=${day(5)}&dueTo=${day(0)}`)).status).toBe(400);
    expect((await admin.get('/api/tasks?dueFrom=yesterday')).body.error.fields.dueFrom).toBe('invalid_date');
  });

  it('summary + /my: overdue, due today, this week, by status (respecting scope)', async () => {
    const mine = await teamA.get('/api/tasks/my');
    expect(mine.status).toBe(200);
    const s = mine.body.item;
    expect(s.overdue).toBeGreaterThanOrEqual(1);
    expect(s.dueToday).toBeGreaterThanOrEqual(1);
    expect(s.dueThisWeek).toBeGreaterThanOrEqual(s.dueToday + 1); // today + the task due in 4 days
    expect(Object.keys(s.byStatus).sort()).toEqual(['BLOCKED', 'DONE', 'IN_PROGRESS', 'REVIEW', 'TODO']);
    const total = Object.values(s.byStatus as Record<string, number>).reduce((a, b) => a + b, 0);
    const list = await teamA.get('/api/tasks?mine=1&pageSize=100');
    expect(total).toBe(list.body.meta.total);
    expect(s.open).toBe(total - s.byStatus.DONE);
    const all = await admin.get('/api/tasks/summary');
    expect(all.body.item.open).toBeGreaterThan(s.open - 1);
    // teamB has none of these
    const theirs = await teamB.get('/api/tasks/summary?clientId=' + w.clientA.id);
    expect(theirs.body.item.open).toBe(0);
  });
});
