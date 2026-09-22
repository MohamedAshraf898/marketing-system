import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { buildWorld, loginAs, tinyPng, type Agent, type World } from './helpers';

let w: World;
let alice: Agent;
let admin: Agent;
let teamA: Agent;
let bob: Agent;

beforeAll(async () => {
  w = await buildWorld();
  [alice, admin, teamA, bob] = await Promise.all(['alice@alpha.test', 'admin@t.test', 'teama@t.test', 'bob@beta.test'].map((e) => loginAs(e)));
});

const upload = (agent: Agent, deliverableId: string) =>
  agent.post('/api/files').field('deliverableId', deliverableId).attach('file', tinyPng(), { filename: 'creative.png', contentType: 'image/png' });

describe('approval workflow, versioning and append-only history', () => {
  let id: string;

  it('team creates a draft that the client cannot see yet', async () => {
    const res = await teamA.post('/api/deliverables').send({ name: 'Spring Reel', type: 'REEL', campaignId: w.campA1.id, description: 'first cut' });
    expect(res.status).toBe(201);
    id = res.body.item.id;
    expect(res.body.item.status).toBe('DRAFT');
    expect(res.body.item.version).toBe(1);
    expect(res.body.item.clientId).toBe(w.clientA.id); // derived from the campaign
    expect((await alice.get(`/api/deliverables/${id}`)).status).toBe(404);
  });

  it('cannot be submitted empty', async () => {
    const empty = await teamA.post('/api/deliverables').send({ name: 'Empty', type: 'COPY', campaignId: w.campA1.id });
    const res = await teamA.post(`/api/deliverables/${empty.body.item.id}/submit`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DELIVERABLE_EMPTY');
  });

  it('files uploaded to a draft stay hidden until the version is submitted', async () => {
    const up = await upload(teamA, id);
    expect(up.status).toBe(201);
    expect(up.body.item.version).toBe(1);
    expect(up.body.item.visibleToClient).toBe(false);
  });

  it('VERSION 1: submit -> client requests changes (comment required)', async () => {
    const submit = await teamA.post(`/api/deliverables/${id}/submit`);
    expect(submit.status).toBe(200);
    expect(submit.body.item.status).toBe('PENDING_APPROVAL');
    expect(submit.body.item.submittedAt).toBeTruthy();

    const detail = await alice.get(`/api/deliverables/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.item.files).toHaveLength(1); // now visible
    expect(detail.body.item.permissions.canDecide).toBe(true);

    // comment is mandatory
    expect((await alice.post(`/api/deliverables/${id}/request-changes`).send({})).status).toBe(400);
    expect((await alice.post(`/api/deliverables/${id}/request-changes`).send({ comment: '  ' })).status).toBe(400);

    const res = await alice.post(`/api/deliverables/${id}/request-changes`).send({ comment: 'Make the logo bigger' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('CHANGES_REQUESTED');
    expect(res.body.item.clientComment).toBe('Make the logo bigger');
    expect(res.body.item.approvedAt).toBeNull();
  });

  it('a decided deliverable cannot be decided again (no double click / replay)', async () => {
    expect((await alice.post(`/api/deliverables/${id}/approve`).send({})).status).toBe(409);
    expect((await alice.post(`/api/deliverables/${id}/request-changes`).send({ comment: 'again' })).status).toBe(409);
  });

  it('cannot edit or upload to a deliverable that is not a draft; new version unlocks it', async () => {
    expect((await teamA.patch(`/api/deliverables/${id}`).send({ name: 'x' })).status).toBe(409);
    expect((await upload(teamA, id)).status).toBe(409);
    const nv = await teamA.post(`/api/deliverables/${id}/new-version`);
    expect(nv.status).toBe(200);
    expect(nv.body.item.version).toBe(2);
    expect(nv.body.item.status).toBe('DRAFT');
    // cannot start another version from a draft
    expect((await teamA.post(`/api/deliverables/${id}/new-version`)).status).toBe(409);
  });

  it('VERSION 2: revised, submitted and rejected again', async () => {
    const up = await upload(teamA, id);
    expect(up.body.item.version).toBe(2);
    expect((await teamA.post(`/api/deliverables/${id}/submit`)).status).toBe(200);
    expect((await alice.post(`/api/deliverables/${id}/request-changes`).send({ comment: 'Colours too dark' })).status).toBe(200);
    expect((await teamA.post(`/api/deliverables/${id}/new-version`)).body.item.version).toBe(3);
  });

  it('VERSION 3: approved', async () => {
    await upload(teamA, id);
    expect((await teamA.post(`/api/deliverables/${id}/submit`)).status).toBe(200);
    const res = await alice.post(`/api/deliverables/${id}/approve`).send({ comment: 'Perfect!' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('APPROVED');
    expect(res.body.item.approvedAt).toBeTruthy();
    expect(res.body.item.version).toBe(3);
  });

  it('keeps the COMPLETE history: nothing was overwritten or deleted', async () => {
    const res = await alice.get(`/api/deliverables/${id}/approvals`);
    expect(res.status).toBe(200);
    const rows = res.body.items as Array<{ decision: string; version: number; comment: string | null; userId: string; clientId: string; decidedAt: string | null; user: { role: string } }>;
    expect(rows.map((r) => `${r.version}:${r.decision}`)).toEqual([
      '1:PENDING', '1:CHANGES_REQUESTED',
      '2:PENDING', '2:CHANGES_REQUESTED',
      '3:PENDING', '3:APPROVED',
    ]);
    const decided = rows.filter((r) => r.decision !== 'PENDING');
    expect(decided.map((r) => r.comment)).toEqual(['Make the logo bigger', 'Colours too dark', 'Perfect!']);
    for (const r of decided) {
      expect(r.userId).toBe(w.userA.id); // recorded from the session
      expect(r.clientId).toBe(w.clientA.id);
      expect(r.decidedAt).toBeTruthy();
      expect(r.user.role).toBe('CLIENT');
    }
    // the same history is visible to staff, and in the global approvals list (decisions only)
    expect((await admin.get(`/api/deliverables/${id}/approvals`)).body.items).toHaveLength(6);
    const global = await alice.get(`/api/approvals?deliverableId=${id}`);
    expect(global.body.items).toHaveLength(3);
  });

  it('only the client\'s decision rows exist as decisions - no PENDING row was mutated', async () => {
    const pending = await prisma.approval.findMany({ where: { deliverableId: id, decision: 'PENDING' }, orderBy: { version: 'asc' } });
    expect(pending.map((p) => p.version)).toEqual([1, 2, 3]);
    expect(pending.every((p) => p.decidedAt === null && p.comment === null)).toBe(true);
  });

  it('files of every version stay downloadable for the client', async () => {
    const files = await alice.get(`/api/files?deliverableId=${id}`);
    expect((files.body.items as Array<{ version: number }>).map((f) => f.version).sort()).toEqual([1, 2, 3]);
  });

  it('team can then publish; nobody can approve an already-approved item', async () => {
    expect((await alice.post(`/api/deliverables/${id}/approve`).send({})).status).toBe(409);
    expect((await teamA.post(`/api/deliverables/${id}/publish`)).status).toBe(200);
    expect((await prisma.deliverable.findUniqueOrThrow({ where: { id } })).status).toBe('PUBLISHED');
    expect((await teamA.post(`/api/deliverables/${id}/publish`)).status).toBe(409);
  });

  it('created audit entries and notifications for the whole flow', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['DELIVERABLE_CREATED', 'DELIVERABLE_SUBMITTED', 'CHANGES_REQUESTED', 'DELIVERABLE_NEW_VERSION', 'DELIVERABLE_APPROVED', 'DELIVERABLE_PUBLISHED']));
    expect(actions.filter((a) => a === 'DELIVERABLE_SUBMITTED')).toHaveLength(3);

    const toClient = await prisma.notification.findMany({ where: { userId: w.userA.id, entityId: id } });
    expect(toClient.filter((n) => n.type === 'DELIVERABLE_SUBMITTED')).toHaveLength(3);
    const toStaff = await prisma.notification.findMany({ where: { userId: w.teamA.id, entityId: id } });
    expect(toStaff.map((n) => n.type)).toEqual(expect.arrayContaining(['CHANGES_REQUESTED', 'DELIVERABLE_APPROVED']));
    expect(await prisma.notification.count({ where: { userId: w.userB.id, entityId: id } })).toBe(0); // other company hears nothing
    expect(await prisma.notification.count({ where: { userId: w.teamB.id, entityId: id } })).toBe(0); // unassigned team neither
    // the actor is not notified about their own action
    expect(toClient.some((n) => n.type === 'DELIVERABLE_APPROVED')).toBe(false);

    const bell = await alice.get('/api/notifications');
    expect(bell.body.unreadCount).toBeGreaterThan(0);
    const first = bell.body.items[0];
    expect((await alice.patch(`/api/notifications/${first.id}/read`)).status).toBe(200);
    expect((await alice.get('/api/notifications')).body.unreadCount).toBe(bell.body.unreadCount - 1);
    await alice.post('/api/notifications/read-all');
    expect((await alice.get('/api/notifications')).body.unreadCount).toBe(0);
  });
});

describe('approve (simple path)', () => {
  it('records user, version, timestamp and sets approvedAt', async () => {
    const res = await alice.post(`/api/deliverables/${w.delA.id}/approve`).send({});
    expect(res.status).toBe(200);
    const rows = await prisma.approval.findMany({ where: { deliverableId: w.delA.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    const decision = rows[1];
    expect(decision.decision).toBe('APPROVED');
    expect(decision.userId).toBe(w.userA.id);
    expect(decision.version).toBe(1);
    expect(decision.decidedAt).toBeTruthy();
    expect((await prisma.deliverable.findUniqueOrThrow({ where: { id: w.delA.id } })).approvedAt).toBeTruthy();
  });

  it('concurrent decisions: exactly one wins', async () => {
    const d = await prisma.deliverable.create({
      data: { name: 'Race', clientId: w.clientA.id, campaignId: w.campA1.id, type: 'DESIGN', status: 'PENDING_APPROVAL', submittedAt: new Date(), description: 'r' },
    });
    const results = await Promise.all([
      alice.post(`/api/deliverables/${d.id}/approve`).send({}),
      alice.post(`/api/deliverables/${d.id}/request-changes`).send({ comment: 'race race' }),
      alice.post(`/api/deliverables/${d.id}/approve`).send({}),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.approval.count({ where: { deliverableId: d.id } })).toBe(1);
  });
});

describe('comments', () => {
  it('derives clientId / userId / authorType on the server and refuses forged values', async () => {
    const forged = await alice.post(`/api/deliverables/${w.delA.id}/comments`).send({ comment: 'hello', authorType: 'TEAM', userId: w.teamA.id, clientId: w.clientB.id });
    expect(forged.status).toBe(400); // unknown fields rejected outright

    const ok = await alice.post(`/api/deliverables/${w.delA.id}/comments`).send({ comment: 'Looks good' });
    expect(ok.status).toBe(201);
    expect(ok.body.item.authorType).toBe('CLIENT');
    expect(ok.body.item.userId).toBe(w.userA.id);
    expect(ok.body.item.clientId).toBe(w.clientA.id);
    expect(ok.body.item.user.role).toBe('CLIENT');

    const team = await teamA.post(`/api/deliverables/${w.delA.id}/comments`).send({ comment: 'Thanks!' });
    expect(team.status).toBe(201);
    expect(team.body.item.authorType).toBe('TEAM');
    expect(team.body.item.userId).toBe(w.teamA.id);
  });

  it('lists chronologically, notifies the other side, and rejects empty text', async () => {
    const list = await alice.get(`/api/deliverables/${w.delA.id}/comments`);
    const times = (list.body.items as Array<{ createdAt: string }>).map((c) => new Date(c.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(list.body.items.length).toBeGreaterThanOrEqual(2);
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'NEW_COMMENT', entityId: w.delA.id } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: w.userA.id, type: 'NEW_COMMENT', entityId: w.delA.id } })).toBeGreaterThan(0);
    expect((await alice.post(`/api/deliverables/${w.delA.id}/comments`).send({ comment: '   ' })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'COMMENT_CREATED', entityId: w.delA.id } })).toBeGreaterThanOrEqual(2);
  });

  it('other company cannot read the thread', async () => {
    expect((await bob.get(`/api/deliverables/${w.delA.id}/comments`)).status).toBe(404);
  });
});
