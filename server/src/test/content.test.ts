import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password';
import { prisma } from '../db';
import { PASSWORD, buildWorld, loginAs, tinyPng, type Agent, type World } from './helpers';

let w: World;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;
let teamC: Agent;
let alice: Agent;
let bob: Agent;
let viewer: Agent; // TEAM assigned to client A but WITHOUT content.manage / deliverables.create
let noApprove: Agent; // TEAM with content.manage + deliverables.create but without deliverables.approve

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function mkTeam(email: string, permissions: string[]) {
  const u = await prisma.user.create({ data: { name: email, email, role: 'TEAM', passwordHash: await hashPassword(PASSWORD), permissions: JSON.stringify(permissions) } });
  await prisma.clientAssignment.create({ data: { userId: u.id, clientId: w.clientA.id } });
  return u;
}

beforeAll(async () => {
  w = await buildWorld();
  await mkTeam('viewer@t.test', ['content.view', 'clients.view']);
  await mkTeam('noapprove@t.test', ['content.view', 'content.manage', 'deliverables.create', 'files.upload']);
  [admin, teamA, teamB, teamC, alice, bob, viewer, noApprove] = await Promise.all(
    ['admin@t.test', 'teama@t.test', 'teamb@t.test', 'teamc@t.test', 'alice@alpha.test', 'bob@beta.test', 'viewer@t.test', 'noapprove@t.test'].map((e) => loginAs(e)),
  );
});

const mk = async (agent: Agent, over: Record<string, unknown> = {}) => {
  const res = await agent.post('/api/content').send({ title: 'Launch post', clientId: w.clientA.id, platform: 'INSTAGRAM', contentType: 'POST', caption: 'Hello world', ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.item as { id: string; status: string };
};

describe('content CRUD, validation and scoping', () => {
  let item: { id: string };

  it('team creates an item: status defaults to IDEA, createdBy comes from the session', async () => {
    item = await mk(teamA, { notes: 'internal: client is picky', publishDate: future(3), assignedToId: w.teamA.id, campaignId: w.campA1.id });
    const row = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.status).toBe('IDEA');
    expect(row.createdById).toBe(w.teamA.id);
    expect(row.clientId).toBe(w.clientA.id);
    expect(await prisma.auditLog.count({ where: { action: 'CONTENT_CREATED', entityId: item.id, clientVisible: false } })).toBe(1);
  });

  it('validation: bad enums, long title, forged createdById ignored, workflow statuses refused', async () => {
    const bad = await teamA.post('/api/content').send({ title: '', clientId: w.clientA.id });
    expect(bad.status).toBe(400);
    expect((await teamA.post('/api/content').send({ title: 'x', clientId: w.clientA.id, platform: 'MYSPACE' })).status).toBe(400);
    expect((await teamA.post('/api/content').send({ title: 'x'.repeat(161), clientId: w.clientA.id })).status).toBe(400);
    expect((await teamA.post('/api/content').send({ title: 'x', clientId: w.clientA.id, publishDate: 'tomorrow' })).status).toBe(400);
    // a staff member cannot create content that is "already approved"
    expect((await teamA.post('/api/content').send({ title: 'x', clientId: w.clientA.id, status: 'APPROVED' })).status).toBe(400);
    const forged = await teamA.post('/api/content').send({ title: 'forged', clientId: w.clientA.id, createdById: w.admin.id, deliverableId: w.delA.id });
    expect(forged.status).toBe(201);
    const row = await prisma.contentItem.findUniqueOrThrow({ where: { id: forged.body.item.id } });
    expect(row.createdById).toBe(w.teamA.id);
    expect(row.deliverableId).toBeNull();
  });

  it('client / campaign / assignee must be in scope and consistent', async () => {
    // unassigned client -> invalid choice
    const other = await teamA.post('/api/content').send({ title: 'x', clientId: w.clientB.id });
    expect(other.status).toBe(400);
    expect(other.body.error.fields.clientId).toBe('invalid_choice');
    expect((await teamC.post('/api/content').send({ title: 'x', clientId: w.clientA.id })).status).toBe(400); // campaign-only member cannot create client-wide content
    // campaign of another client
    const wrongCamp = await teamA.post('/api/content').send({ title: 'x', clientId: w.clientA.id, campaignId: w.campB1.id });
    expect(wrongCamp.status).toBe(400);
    expect(wrongCamp.body.error.fields.campaignId).toBe('invalid_choice');
    // assignee that has no access to the client
    const wrongUser = await teamA.post('/api/content').send({ title: 'x', clientId: w.clientA.id, assignedToId: w.teamB.id });
    expect(wrongUser.status).toBe(400);
    expect((await teamA.post('/api/content').send({ title: 'x', clientId: w.clientA.id, assignedToId: w.userA.id })).status).toBe(400); // a client user is never an assignee
    // admin may pick any existing client; unknown client is refused
    expect((await admin.post('/api/content').send({ title: 'admin item', clientId: w.clientB.id })).status).toBe(201);
    expect((await admin.post('/api/content').send({ title: 'x', clientId: 'nope-nope-nope' })).status).toBe(400);
  });

  it('project must be in scope and belong to the same client', async () => {
    const pB = await prisma.project.create({ data: { clientId: w.clientB.id, name: 'B project' } });
    const pA = await prisma.project.create({ data: { clientId: w.clientA.id, name: 'A project' } });
    expect((await teamA.post('/api/content').send({ title: 'x', clientId: w.clientA.id, projectId: pB.id })).status).toBe(400);
    const ok = await teamA.post('/api/content').send({ title: 'with project', clientId: w.clientA.id, projectId: pA.id });
    expect(ok.status).toBe(201);
    expect(ok.body.item.project.id).toBe(pA.id);
    // moving it to a project of another client is refused too
    expect((await teamA.patch(`/api/content/${ok.body.item.id}`).send({ projectId: pB.id })).status).toBe(400);
  });

  it('permissions: content.manage missing -> 403 on every write, but view works', async () => {
    expect((await viewer.get('/api/content')).status).toBe(200);
    expect((await viewer.get(`/api/content/${item.id}`)).status).toBe(200);
    expect((await viewer.post('/api/content').send({ title: 'x', clientId: w.clientA.id })).status).toBe(403);
    expect((await viewer.patch(`/api/content/${item.id}`).send({ title: 'y' })).status).toBe(403);
    expect((await viewer.delete(`/api/content/${item.id}`)).status).toBe(403);
    expect((await viewer.post(`/api/content/${item.id}/send-for-approval`)).status).toBe(403);
    // clients hold no internal permission at all
    expect((await alice.post('/api/content').send({ title: 'x', clientId: w.clientA.id })).status).toBe(403);
    expect((await alice.patch(`/api/content/${item.id}`).send({ title: 'y' })).status).toBe(403);
    expect((await alice.delete(`/api/content/${item.id}`)).status).toBe(403);
    expect((await alice.post(`/api/content/${item.id}/send-for-approval`)).status).toBe(403);
  });

  it('a team member without deliverables.create cannot send for approval', async () => {
    const own = await prisma.user.create({ data: { name: 'm', email: 'm@t.test', role: 'TEAM', passwordHash: await hashPassword(PASSWORD), permissions: JSON.stringify(['content.view', 'content.manage']) } });
    await prisma.clientAssignment.create({ data: { userId: own.id, clientId: w.clientA.id } });
    const m = await loginAs('m@t.test');
    expect((await m.post(`/api/content/${item.id}/send-for-approval`)).status).toBe(403);
    expect((await m.patch(`/api/content/${item.id}`).send({ title: 'still editable' })).status).toBe(200);
    await m.patch(`/api/content/${item.id}`).send({ title: 'Launch post' });
  });

  it('team scope: unassigned client -> 404 / empty list; admin sees all; campaign-only member sees its campaign items', async () => {
    expect((await teamB.get(`/api/content/${item.id}`)).status).toBe(404);
    expect((await teamB.patch(`/api/content/${item.id}`).send({ title: 'hijack' })).status).toBe(404);
    expect((await teamB.delete(`/api/content/${item.id}`)).status).toBe(404);
    expect((await teamB.post(`/api/content/${item.id}/send-for-approval`)).status).toBe(404);
    const listB = await teamB.get('/api/content?clientId=' + w.clientA.id);
    expect(listB.body.items).toHaveLength(0);
    const listAll = await admin.get('/api/content?pageSize=100');
    expect((listAll.body.items as Array<{ clientId: string }>).some((i) => i.clientId === w.clientA.id)).toBe(true);
    expect((listAll.body.items as Array<{ clientId: string }>).some((i) => i.clientId === w.clientB.id)).toBe(true);

    const a2 = await admin.post('/api/content').send({ title: 'A2 item', clientId: w.clientA.id, campaignId: w.campA2.id });
    const a1 = await admin.post('/api/content').send({ title: 'A1 item', clientId: w.clientA.id, campaignId: w.campA1.id });
    expect((await teamC.get(`/api/content/${a2.body.item.id}`)).status).toBe(200);
    expect((await teamC.get(`/api/content/${a1.body.item.id}`)).status).toBe(404);
    // ...and may work on it
    expect((await teamC.patch(`/api/content/${a2.body.item.id}`).send({ status: 'DRAFT' })).status).toBe(200);
  });

  it('filters, paging and the calendar mode', async () => {
    const q = await teamA.get('/api/content?q=picky'); // notes are searchable by staff
    expect(q.body.items.map((i: { id: string }) => i.id)).toContain(item.id);
    expect((await teamA.get('/api/content?platform=INSTAGRAM&contentType=POST&mine=1')).body.items.map((i: { id: string }) => i.id)).toContain(item.id);
    expect((await teamA.get('/api/content?platform=YOUTUBE&clientId=' + w.clientA.id)).body.items.map((i: { id: string }) => i.id)).not.toContain(item.id);
    const paged = await teamA.get('/api/content?pageSize=1');
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.meta.total).toBeGreaterThan(1);

    const from = new Date(Date.now()).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const cal = await teamA.get(`/api/content?from=${from}&to=${to}`);
    expect(cal.status).toBe(200);
    expect(cal.body.items.map((i: { id: string }) => i.id)).toContain(item.id);
    expect(cal.body.items.every((i: { publishDate: string | null }) => !!i.publishDate)).toBe(true);
    // a range longer than 100 days, an inverted range and garbage are refused
    const far = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    expect((await teamA.get(`/api/content?from=${from}&to=${far}`)).status).toBe(400);
    expect((await teamA.get(`/api/content?from=${to}&to=${from}`)).status).toBe(400);
    expect((await teamA.get('/api/content?from=abc&to=def')).status).toBe(400);
    // the calendar respects scope as well
    expect((await teamB.get(`/api/content?from=${from}&to=${to}`)).body.items.map((i: { id: string }) => i.id)).not.toContain(item.id);
  });

  it('status transitions: allowed set only; APPROVED / REJECTED / CLIENT_APPROVAL cannot be set manually', async () => {
    const it2 = await mk(teamA);
    for (const s of ['APPROVED', 'REJECTED', 'CLIENT_APPROVAL', 'PUBLISHED', 'SCHEDULED']) {
      const r = await teamA.patch(`/api/content/${it2.id}`).send({ status: s });
      expect(r.status, s).toBe(409);
      expect(r.body.error.code).toBe('CONTENT_INVALID_TRANSITION');
    }
    expect((await teamA.patch(`/api/content/${it2.id}`).send({ status: 'NOPE' })).status).toBe(400);
    const ok = await teamA.patch(`/api/content/${it2.id}`).send({ status: 'DRAFT' });
    expect(ok.status).toBe(200);
    expect(ok.body.item.status).toBe('DRAFT');
    expect(ok.body.item.allowedStatuses).toEqual(expect.arrayContaining(['IN_REVIEW', 'IDEA']));
    expect(await prisma.auditLog.count({ where: { action: 'CONTENT_STATUS_CHANGED', entityId: it2.id } })).toBe(1);
    // strict update schema: unknown / forbidden fields are rejected
    expect((await teamA.patch(`/api/content/${it2.id}`).send({ clientId: w.clientB.id })).status).toBe(400);
    expect((await teamA.patch(`/api/content/${it2.id}`).send({ deliverableId: w.delA.id })).status).toBe(400);
  });
});

describe('client view: only what was sent, whitelist fields', () => {
  let sent: string;
  let unsent: string;
  let bobs: string;

  beforeAll(async () => {
    unsent = (await mk(teamA, { title: 'Unsent secret draft', notes: 'DO NOT SHOW THIS', assignedToId: w.teamA.id })).id;
    sent = (await mk(teamA, { title: 'Sent to client', notes: 'internal remark', assignedToId: w.teamA.id, publishDate: future(2) })).id;
    expect((await teamA.post(`/api/content/${sent}/send-for-approval`)).status).toBe(200);
    bobs = (await mk(teamB, { title: 'Bob item', clientId: w.clientB.id, notes: 'b-notes' })).id;
    expect((await teamB.post(`/api/content/${bobs}/send-for-approval`)).status).toBe(200);
  });

  it('client lists only own, submitted items - without notes or internals', async () => {
    const res = await alice.get('/api/content?pageSize=100');
    expect(res.status).toBe(200);
    const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain(sent);
    expect(ids).not.toContain(unsent);
    expect(ids).not.toContain(bobs);
    for (const i of res.body.items as Array<Record<string, unknown>>) {
      expect(Object.keys(i).sort()).toEqual(['approvalStatus', 'caption', 'contentType', 'deliverableId', 'deliverableVersion', 'id', 'platform', 'publishDate', 'status', 'title']);
    }
    expect(JSON.stringify(res.body)).not.toContain('internal remark');
    expect(JSON.stringify(res.body)).not.toContain('DO NOT SHOW');
  });

  it('client detail: sent item OK (no notes), unsent / other client 404', async () => {
    const ok = await alice.get(`/api/content/${sent}`);
    expect(ok.status).toBe(200);
    expect(ok.body.item.notes).toBeUndefined();
    expect(ok.body.item.assignedTo).toBeUndefined();
    expect(ok.body.item.assignedToId).toBeUndefined();
    expect(ok.body.item.approvalStatus).toBe('PENDING');
    expect(ok.body.item.status).toBe('CLIENT_APPROVAL');
    expect((await alice.get(`/api/content/${unsent}`)).status).toBe(404);
    expect((await alice.get(`/api/content/${bobs}`)).status).toBe(404);
    expect((await bob.get(`/api/content/${sent}`)).status).toBe(404);
    expect((await bob.get(`/api/content/${bobs}`)).status).toBe(200);
  });

  it('client cannot use staff filters or search notes', async () => {
    const byNotes = await alice.get('/api/content?q=internal remark');
    expect(byNotes.body.items).toHaveLength(0);
    const mine = await alice.get(`/api/content?assignedToId=${w.teamA.id}&mine=1&status=IDEA`);
    expect((mine.body.items as Array<{ id: string }>).map((i) => i.id)).toContain(sent); // ignored, not an error
    expect((await alice.get('/api/content?approvalStatus=PENDING')).body.items.map((i: { id: string }) => i.id)).toContain(sent);
    expect((await alice.get('/api/content?approvalStatus=APPROVED')).body.items.map((i: { id: string }) => i.id)).not.toContain(sent);
    // the client cannot reach the other client's data through clientId / campaignId filters either
    expect((await alice.get(`/api/content?clientId=${w.clientB.id}`)).body.items).toHaveLength(0);
  });

  it('client calendar mode works and is still scoped', async () => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const cal = await alice.get(`/api/content?from=${from}&to=${to}`);
    expect(cal.status).toBe(200);
    expect(cal.body.items.map((i: { id: string }) => i.id)).toEqual([sent]);
  });

  it('client files: content files stay hidden until sent', async () => {
    const it3 = await mk(teamA, { title: 'Files item' });
    const up = await teamA.post('/api/files').field('contentItemId', it3.id).attach('file', tinyPng(), { filename: 'art.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.item.visibleToClient).toBe(false);
    expect((await alice.get(`/api/files/${up.body.item.id}/download`)).status).toBe(404);
    const send = await teamA.post(`/api/content/${it3.id}/send-for-approval`);
    expect(send.status).toBe(200);
    const row = await prisma.file.findUniqueOrThrow({ where: { id: up.body.item.id } });
    expect(row.deliverableId).toBe(send.body.item.deliverableId);
    expect(row.contentItemId).toBe(it3.id);
    expect(row.visibleToClient).toBe(true);
    expect(row.version).toBe(1);
    expect((await alice.get(`/api/files/${up.body.item.id}/download`)).status).toBe(200);
    expect((await bob.get(`/api/files/${up.body.item.id}/download`)).status).toBe(404);
  });
});

describe('send for approval -> client decision -> resubmission (one append-only approval system)', () => {
  let id: string;
  let delId: string;

  it('cannot send an item that has nothing to show', async () => {
    const empty = await mk(teamA, { title: 'Nothing here', caption: null });
    const res = await teamA.post(`/api/content/${empty.id}/send-for-approval`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DELIVERABLE_EMPTY');
    expect(await prisma.deliverable.count({ where: { name: 'Nothing here' } })).toBe(0);
  });

  it('creates the linked deliverable, the approval row, the notification and the audit entries', async () => {
    id = (await mk(teamA, { title: 'Reel for August', contentType: 'REEL', platform: 'TIKTOK', caption: 'Summer vibes', campaignId: w.campA1.id })).id;
    await teamA.patch(`/api/content/${id}`).send({ status: 'IN_REVIEW' });
    const res = await teamA.post(`/api/content/${id}/send-for-approval`);
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('CLIENT_APPROVAL');
    expect(res.body.item.approvalStatus).toBe('PENDING');
    delId = res.body.item.deliverableId;
    const d = await prisma.deliverable.findUniqueOrThrow({ where: { id: delId } });
    expect(d).toMatchObject({ name: 'Reel for August', type: 'REEL', description: 'Summer vibes', clientId: w.clientA.id, campaignId: w.campA1.id, status: 'PENDING_APPROVAL', version: 1 });
    expect(d.submittedAt).toBeTruthy();
    const rows = await prisma.approval.findMany({ where: { deliverableId: delId } });
    expect(rows.map((r) => r.decision)).toEqual(['PENDING']);
    expect(await prisma.notification.count({ where: { userId: w.userA.id, entityId: delId, type: 'DELIVERABLE_SUBMITTED' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: w.userB.id, entityId: delId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'CONTENT_SENT_FOR_APPROVAL', entityId: id, clientVisible: true, clientId: w.clientA.id } })).toBe(1);
    // the deliverable is visible to the client and shows the content link to staff only
    expect((await alice.get(`/api/deliverables/${delId}`)).body.item.contentItem).toBeUndefined();
    expect((await teamA.get(`/api/deliverables/${delId}`)).body.item.contentItem.id).toBe(id);
    expect((await bob.get(`/api/deliverables/${delId}`)).status).toBe(404);
  });

  it('cannot be sent twice, edited (creative) or deleted while with the client', async () => {
    const again = await teamA.post(`/api/content/${id}/send-for-approval`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONTENT_ALREADY_PENDING');
    const edit = await teamA.patch(`/api/content/${id}`).send({ caption: 'Changed behind the client back' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('CONTENT_LOCKED');
    // non-creative fields stay editable
    expect((await teamA.patch(`/api/content/${id}`).send({ notes: 'note', publishDate: future(9) })).status).toBe(200);
    const del = await teamA.delete(`/api/content/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('CONTENT_HAS_APPROVAL_HISTORY');
    expect(await prisma.contentItem.count({ where: { id } })).toBe(1);
  });

  it('the client requests changes: content goes back to DRAFT, history preserved', async () => {
    const res = await alice.post(`/api/deliverables/${delId}/request-changes`).send({ comment: 'Shorter caption please' });
    expect(res.status).toBe(200);
    const staff = await teamA.get(`/api/content/${id}`);
    expect(staff.body.item.status).toBe('DRAFT');
    expect(staff.body.item.approvalStatus).toBe('CHANGES_REQUESTED');
    expect(staff.body.item.canSendForApproval).toBe(true);
    const cl = await alice.get(`/api/content/${id}`);
    expect(cl.body.item.approvalStatus).toBe('CHANGES_REQUESTED');
    const hist = await prisma.approval.findMany({ where: { deliverableId: delId }, orderBy: { createdAt: 'asc' } });
    expect(hist.map((h) => `${h.version}:${h.decision}`)).toEqual(['1:PENDING', '1:CHANGES_REQUESTED']);
    expect(hist[1].comment).toBe('Shorter caption please');
  });

  it('resubmission creates version 2 of the SAME deliverable and keeps every v1 approval row', async () => {
    const before = await prisma.approval.findMany({ where: { deliverableId: delId }, orderBy: { createdAt: 'asc' } });
    expect((await teamA.patch(`/api/content/${id}`).send({ caption: 'Short caption' })).status).toBe(200);
    const res = await teamA.post(`/api/content/${id}/send-for-approval`);
    expect(res.status).toBe(200);
    expect(res.body.item.deliverableId).toBe(delId); // reused
    expect(res.body.item.status).toBe('CLIENT_APPROVAL');
    const d = await prisma.deliverable.findUniqueOrThrow({ where: { id: delId } });
    expect(d).toMatchObject({ version: 2, status: 'PENDING_APPROVAL', description: 'Short caption' });
    const after = await prisma.approval.findMany({ where: { deliverableId: delId }, orderBy: { createdAt: 'asc' } });
    expect(after.map((h) => `${h.version}:${h.decision}`)).toEqual(['1:PENDING', '1:CHANGES_REQUESTED', '2:PENDING']);
    // v1 rows are byte-for-byte untouched
    for (let i = 0; i < before.length; i++) expect(after[i]).toEqual(before[i]);
    expect(await prisma.deliverable.count({ where: { name: 'Reel for August' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: w.userA.id, entityId: delId, type: 'DELIVERABLE_SUBMITTED' } })).toBe(2);
  });

  it('the client approves: content becomes APPROVED and the history has both v2 rows; staff cannot approve', async () => {
    // staff (even admin) can never decide for the client
    expect((await admin.post(`/api/deliverables/${delId}/approve`).send({})).status).toBe(403);
    expect((await teamA.post(`/api/deliverables/${delId}/approve`).send({})).status).toBe(403);
    expect((await bob.post(`/api/deliverables/${delId}/approve`).send({})).status).toBe(404);
    const res = await alice.post(`/api/deliverables/${delId}/approve`).send({ comment: 'Perfect' });
    expect(res.status).toBe(200);
    const item = await teamA.get(`/api/content/${id}`);
    expect(item.body.item.status).toBe('APPROVED');
    expect(item.body.item.approvalStatus).toBe('APPROVED');
    expect(item.body.item.creativeLocked).toBe(true);
    const hist = await prisma.approval.findMany({ where: { deliverableId: delId }, orderBy: { createdAt: 'asc' } });
    expect(hist.map((h) => `${h.version}:${h.decision}`)).toEqual(['1:PENDING', '1:CHANGES_REQUESTED', '2:PENDING', '2:APPROVED']);
    expect(await prisma.auditLog.count({ where: { action: 'CONTENT_STATUS_CHANGED', entityId: id } })).toBeGreaterThanOrEqual(3);
    // cannot be sent again once approved
    expect((await teamA.post(`/api/content/${id}/send-for-approval`)).status).toBe(409);
  });

  it('after approval staff may only schedule / publish (never go back), and a deliverable publish is mirrored', async () => {
    expect((await teamA.patch(`/api/content/${id}`).send({ status: 'DRAFT' })).status).toBe(409);
    const sch = await teamA.patch(`/api/content/${id}`).send({ status: 'SCHEDULED' });
    expect(sch.status).toBe(200);
    expect(sch.body.item.status).toBe('SCHEDULED');
    // client sees the scheduled state
    expect((await alice.get(`/api/content/${id}`)).body.item.status).toBe('SCHEDULED');
    // publishing the deliverable needs deliverables.approve ...
    expect((await noApprove.post(`/api/deliverables/${delId}/publish`)).status).toBe(403);
    // ... and moves the scheduled content to PUBLISHED
    expect((await teamA.post(`/api/deliverables/${delId}/publish`)).status).toBe(200);
    expect((await teamA.get(`/api/content/${id}`)).body.item.status).toBe('PUBLISHED');
    expect((await teamA.patch(`/api/content/${id}`).send({ status: 'SCHEDULED' })).status).toBe(409);
  });

  it('deliverables that are NOT linked to content behave exactly as before', async () => {
    const d = await prisma.deliverable.create({ data: { name: 'Plain', clientId: w.clientA.id, type: 'DESIGN', description: 'x', createdById: w.teamA.id } });
    expect((await teamA.post(`/api/deliverables/${d.id}/submit`)).status).toBe(200);
    expect((await alice.post(`/api/deliverables/${d.id}/approve`).send({})).status).toBe(200);
    expect((await teamA.get(`/api/deliverables/${d.id}`)).body.item.contentItem).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { action: 'CONTENT_STATUS_CHANGED', clientId: w.clientA.id, metadata: { contains: d.id } } })).toBe(0);
  });

  it('deleting an item that was never sent works (and removes its own files)', async () => {
    const it4 = await mk(teamA, { title: 'Disposable' });
    const up = await teamA.post('/api/files').field('contentItemId', it4.id).attach('file', tinyPng(), { filename: 'tmp.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect((await teamA.get(`/api/content/${it4.id}`)).body.item.files).toHaveLength(1);
    expect((await teamA.delete(`/api/content/${it4.id}`)).status).toBe(200);
    expect(await prisma.contentItem.count({ where: { id: it4.id } })).toBe(0);
    expect(await prisma.file.count({ where: { id: up.body.item.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'CONTENT_DELETED', entityId: it4.id } })).toBe(1);
    expect((await teamA.delete(`/api/content/${it4.id}`)).status).toBe(404);
  });
});

describe('deliverables: projectId, filters and permissions', () => {
  it('projectId is scoped and must belong to the same client', async () => {
    const pA = await prisma.project.create({ data: { clientId: w.clientA.id, name: 'Visible A', visibleToClient: true } });
    const pAInternal = await prisma.project.create({ data: { clientId: w.clientA.id, name: 'Internal A', visibleToClient: false } });
    const pB = await prisma.project.create({ data: { clientId: w.clientB.id, name: 'Project B' } });

    const bad = await teamA.post('/api/deliverables').send({ name: 'x', type: 'DESIGN', campaignId: w.campA1.id, projectId: pB.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.projectId).toBe('invalid_choice');
    expect((await teamB.post('/api/deliverables').send({ name: 'x', type: 'DESIGN', clientId: w.clientB.id, projectId: pA.id })).status).toBe(400);

    const ok = await teamA.post('/api/deliverables').send({ name: 'Project deliverable', type: 'DESIGN', campaignId: w.campA1.id, projectId: pA.id, description: 'd' });
    expect(ok.status).toBe(201);
    expect(ok.body.item.projectId).toBe(pA.id);
    const internal = await teamA.post('/api/deliverables').send({ name: 'Internal project deliverable', type: 'DESIGN', campaignId: w.campA1.id, projectId: pAInternal.id, description: 'd' });
    expect(internal.status).toBe(201);
    // updating: same rules
    expect((await teamA.patch(`/api/deliverables/${ok.body.item.id}`).send({ projectId: pB.id })).status).toBe(400);
    expect((await teamA.patch(`/api/deliverables/${ok.body.item.id}`).send({ projectId: null })).status).toBe(200);
    expect((await teamA.patch(`/api/deliverables/${ok.body.item.id}`).send({ projectId: pA.id })).status).toBe(200);

    // list filter (staff)
    const list = await teamA.get(`/api/deliverables?projectId=${pA.id}&clientId=${w.clientA.id}`);
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([ok.body.item.id]);
    expect(list.body.items[0].project).toEqual({ id: pA.id, name: 'Visible A' });
    expect((await teamB.get(`/api/deliverables?projectId=${pA.id}`)).body.items).toHaveLength(0);

    // client: sees only submitted ones, and never an internal project
    await teamA.post(`/api/deliverables/${ok.body.item.id}/submit`);
    await teamA.post(`/api/deliverables/${internal.body.item.id}/submit`);
    const cl = await alice.get(`/api/deliverables?projectId=${pA.id}`);
    expect(cl.body.items.map((d: { id: string }) => d.id)).toEqual([ok.body.item.id]);
    expect((await alice.get(`/api/deliverables?projectId=${pAInternal.id}`)).body.items).toHaveLength(0);
    const detail = await alice.get(`/api/deliverables/${internal.body.item.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.item.project).toBeNull();
    expect(detail.body.item.projectId).toBeNull();
    expect(JSON.stringify(detail.body)).not.toContain('Internal A');
  });

  it('deliverables.create / deliverables.approve gate the team endpoints; clients keep approve / request-changes', async () => {
    expect((await viewer.post('/api/deliverables').send({ name: 'x', type: 'DESIGN', campaignId: w.campA1.id })).status).toBe(403);
    expect((await viewer.post(`/api/deliverables/${w.draftA.id}/submit`)).status).toBe(403);
    expect((await viewer.post(`/api/deliverables/${w.draftA.id}/new-version`)).status).toBe(403);
    expect((await viewer.patch(`/api/deliverables/${w.draftA.id}`).send({ name: 'y' })).status).toBe(403);
    expect((await noApprove.post('/api/deliverables').send({ name: 'ok', type: 'DESIGN', campaignId: w.campA1.id })).status).toBe(201);
    expect((await teamA.post(`/api/deliverables/${w.delB.id}/publish`)).status).toBe(404); // out of scope (other client)
    // clients can still decide on their own deliverable
    const d = await prisma.deliverable.create({ data: { name: 'Decide me', clientId: w.clientA.id, type: 'DESIGN', status: 'PENDING_APPROVAL', submittedAt: new Date(), description: 'x' } });
    expect((await alice.post(`/api/deliverables/${d.id}/approve`).send({})).status).toBe(200);
  });
});

describe('proofing (pins)', () => {
  let delId: string;
  let imgFile: string;
  let videoFile: string;
  let bobDel: string;
  let draftDel: string;
  let pinId: string;

  beforeAll(async () => {
    const d = await prisma.deliverable.create({ data: { name: 'Proof me', clientId: w.clientA.id, campaignId: w.campA1.id, type: 'VIDEO', status: 'DRAFT', description: 'x', createdById: w.teamA.id } });
    delId = d.id;
    const up = await teamA.post('/api/files').field('deliverableId', delId).attach('file', tinyPng(), { filename: 'proof.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    imgFile = up.body.item.id;
    const v = await prisma.file.create({ data: { fileName: 'clip.mp4', filePath: 'does-not-matter.mp4', fileType: 'video/mp4', size: 10, clientId: w.clientA.id, deliverableId: delId, version: 1, visibleToClient: false, uploadedById: w.teamA.id } });
    videoFile = v.id;
    expect((await teamA.post(`/api/deliverables/${delId}/submit`)).status).toBe(200);
    bobDel = w.delB.id;
    draftDel = w.draftA.id;
  });

  it('pin validation: x without y, y without x, out of range, bad comment, bad timestamp', async () => {
    const post = (body: Record<string, unknown>) => alice.post(`/api/deliverables/${delId}/proofing`).send({ comment: 'c', ...body });
    expect((await post({ x: 0.5 })).status).toBe(400);
    expect((await post({ y: 0.5 })).status).toBe(400);
    expect((await post({ x: 1.2, y: 0.5 })).status).toBe(400);
    expect((await post({ x: 0.5, y: -0.1 })).status).toBe(400);
    expect((await post({ x: 'a', y: 0.1 })).status).toBe(400);
    expect((await post({ comment: '   ' })).status).toBe(400);
    expect((await post({ comment: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post({ fileId: videoFile, timestampSec: -1 })).status).toBe(400);
    expect((await post({ fileId: imgFile, timestampSec: 3 })).status).toBe(400); // timestamps are for video files only
    expect((await post({ timestampSec: 3 })).status).toBe(400); // ... and need a file
    expect((await post({ version: 0 })).status).toBe(400);
    expect((await post({ version: 5 })).status).toBe(400);
    const err = await post({ x: 0.5 });
    expect(err.body.error.fields.y).toBe('pin_needs_both');
    expect(await prisma.proofingComment.count({ where: { deliverableId: delId } })).toBe(0);
  });

  it('client pins on their own submitted deliverable; authorType / userId / clientId spoofing is ignored', async () => {
    const res = await alice.post(`/api/deliverables/${delId}/proofing`).send({
      fileId: imgFile, x: 0.25, y: 0.75, comment: 'Move the logo here', authorType: 'TEAM', userId: w.teamA.id, clientId: w.clientB.id, resolved: true,
    });
    expect(res.status).toBe(201);
    pinId = res.body.item.id;
    expect(res.body.item).toMatchObject({ authorType: 'CLIENT', userId: w.userA.id, x: 0.25, y: 0.75, version: 1, fileId: imgFile, resolved: false });
    expect(res.body.item.user.role).toBe('CLIENT');
    const row = await prisma.proofingComment.findUniqueOrThrow({ where: { id: pinId } });
    expect(row.authorType).toBe('CLIENT');
    expect(row.userId).toBe(w.userA.id);
    // notifies the team of that client (not the actor, not the other side's company)
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'PROOFING_COMMENT', entityId: delId } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: w.userA.id, type: 'PROOFING_COMMENT' } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: w.teamB.id, type: 'PROOFING_COMMENT' } })).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { action: 'PROOFING_COMMENT_CREATED', entityId: pinId } });
    expect(log?.clientVisible).toBe(true);
    expect(log?.clientId).toBe(w.clientA.id);
    // the approval history was not touched
    expect(await prisma.approval.count({ where: { deliverableId: delId } })).toBe(1);
    expect((await prisma.deliverable.findUniqueOrThrow({ where: { id: delId } })).status).toBe('PENDING_APPROVAL');
  });

  it('a video comment stores the timestamp; a file of another deliverable is refused', async () => {
    const ok = await teamA.post(`/api/deliverables/${delId}/proofing`).send({ fileId: videoFile, timestampSec: 12.5, comment: 'Cut here' });
    expect(ok.status).toBe(201);
    expect(ok.body.item).toMatchObject({ timestampSec: 12.5, authorType: 'TEAM', userId: w.teamA.id, x: null, y: null });
    expect(await prisma.notification.count({ where: { userId: w.userA.id, type: 'PROOFING_COMMENT', entityId: delId } })).toBe(1);
    const other = await prisma.file.create({ data: { fileName: 'o.png', filePath: 'o.png', fileType: 'image/png', size: 1, clientId: w.clientA.id, deliverableId: w.delA.id, version: 1, visibleToClient: true, uploadedById: w.teamA.id } });
    const bad = await alice.post(`/api/deliverables/${delId}/proofing`).send({ fileId: other.id, comment: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.fileId).toBe('invalid_choice');
  });

  it('listing: filters by version / file, counts and open-for-comments flag; both sides see the thread', async () => {
    const all = await alice.get(`/api/deliverables/${delId}/proofing`);
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.counts).toEqual({ total: 2, unresolved: 2 });
    expect(all.body.canComment).toBe(true);
    expect(all.body.versions).toEqual([1]);
    expect((await alice.get(`/api/deliverables/${delId}/proofing?fileId=${imgFile}`)).body.items).toHaveLength(1);
    expect((await alice.get(`/api/deliverables/${delId}/proofing?version=2`)).body.items).toHaveLength(0);
    expect((await alice.get(`/api/deliverables/${delId}/proofing?version=abc`)).status).toBe(400);
    expect((await teamA.get(`/api/deliverables/${delId}/proofing`)).body.items).toHaveLength(2);
    expect((await admin.get(`/api/deliverables/${delId}/proofing`)).body.items).toHaveLength(2);
  });

  it('never on someone else\'s deliverable, nor on an unsent one (404 everywhere)', async () => {
    for (const agent of [bob, teamB]) {
      expect((await agent.get(`/api/deliverables/${delId}/proofing`)).status).toBe(404);
      expect((await agent.post(`/api/deliverables/${delId}/proofing`).send({ comment: 'hi' })).status).toBe(404);
      expect((await agent.patch(`/api/deliverables/${delId}/proofing/${pinId}`).send({ resolved: true })).status).toBe(404);
      expect((await agent.delete(`/api/deliverables/${delId}/proofing/${pinId}`)).status).toBe(404);
    }
    expect((await alice.post(`/api/deliverables/${bobDel}/proofing`).send({ comment: 'hi', x: 0.1, y: 0.1 })).status).toBe(404);
    expect((await alice.get(`/api/deliverables/${bobDel}/proofing`)).status).toBe(404);
    expect((await alice.post(`/api/deliverables/${draftDel}/proofing`).send({ comment: 'hi' })).status).toBe(404);
    expect((await alice.get(`/api/deliverables/${draftDel}/proofing`)).status).toBe(404);
    // a pin id of one deliverable cannot be used through another deliverable's URL
    expect((await alice.patch(`/api/deliverables/${w.delA.id}/proofing/${pinId}`).send({ resolved: true })).status).toBe(404);
    // staff of the client can pin on the draft (internal note) but the client never sees it
    expect((await teamA.post(`/api/deliverables/${draftDel}/proofing`).send({ comment: 'internal draft note' })).status).toBe(201);
    expect((await alice.get(`/api/deliverables/${draftDel}/proofing`)).status).toBe(404);
  });

  it('resolve rules: staff or the comment author; deleting only by author / admin and only while unresolved', async () => {
    // team member's comment: the client cannot resolve or delete it
    const teamPin = (await teamA.post(`/api/deliverables/${delId}/proofing`).send({ comment: 'team says' })).body.item.id as string;
    expect((await alice.patch(`/api/deliverables/${delId}/proofing/${teamPin}`).send({ resolved: true })).status).toBe(403);
    expect((await alice.delete(`/api/deliverables/${delId}/proofing/${teamPin}`)).status).toBe(403);
    // ... but staff can resolve the client's pin
    const res = await teamA.patch(`/api/deliverables/${delId}/proofing/${pinId}`).send({ resolved: true });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ resolved: true });
    expect(res.body.item.resolvedAt).toBeTruthy();
    expect((await prisma.proofingComment.findUniqueOrThrow({ where: { id: pinId } })).resolvedById).toBe(w.teamA.id);
    expect(await prisma.auditLog.count({ where: { action: 'PROOFING_COMMENT_RESOLVED', entityId: pinId, clientVisible: true } })).toBe(1);
    // resolved comments cannot be deleted - not even by their author or an admin
    expect((await alice.delete(`/api/deliverables/${delId}/proofing/${pinId}`)).status).toBe(409);
    expect((await admin.delete(`/api/deliverables/${delId}/proofing/${pinId}`)).status).toBe(409);
    // un-resolve, then the author may delete
    const re = await alice.patch(`/api/deliverables/${delId}/proofing/${pinId}`).send({ resolved: false });
    expect(re.status).toBe(200);
    expect(re.body.item.resolved).toBe(false);
    expect((await prisma.proofingComment.findUniqueOrThrow({ where: { id: pinId } })).resolvedAt).toBeNull();
    // resolve payload is strict
    expect((await alice.patch(`/api/deliverables/${delId}/proofing/${pinId}`).send({ resolved: true, comment: 'edited' })).status).toBe(400);
    expect((await alice.patch(`/api/deliverables/${delId}/proofing/${pinId}`).send({ resolved: 'yes' })).status).toBe(400);
    // another team member (not author, not admin) cannot delete; the admin can
    expect((await noApprove.delete(`/api/deliverables/${delId}/proofing/${pinId}`)).status).toBe(403);
    expect((await admin.delete(`/api/deliverables/${delId}/proofing/${teamPin}`)).status).toBe(200);
    expect((await alice.delete(`/api/deliverables/${delId}/proofing/${pinId}`)).status).toBe(200);
    expect(await prisma.proofingComment.count({ where: { id: pinId } })).toBe(0);
  });

  it('a client can only comment while the deliverable is open (pending / changes requested); reading stays possible', async () => {
    const d = await prisma.deliverable.create({ data: { name: 'Closed', clientId: w.clientA.id, type: 'DESIGN', status: 'PENDING_APPROVAL', submittedAt: new Date(), description: 'x' } });
    await prisma.approval.create({ data: { deliverableId: d.id, clientId: w.clientA.id, userId: w.teamA.id, decision: 'PENDING', version: 1, submittedAt: new Date() } });
    expect((await alice.post(`/api/deliverables/${d.id}/proofing`).send({ comment: 'while pending', x: 0.5, y: 0.5 })).status).toBe(201);
    expect((await alice.post(`/api/deliverables/${d.id}/approve`).send({})).status).toBe(200);
    const closed = await alice.post(`/api/deliverables/${d.id}/proofing`).send({ comment: 'too late' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('PROOFING_CLOSED');
    const list = await alice.get(`/api/deliverables/${d.id}/proofing`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.canComment).toBe(false);
    // staff may still add notes
    expect((await teamA.post(`/api/deliverables/${d.id}/proofing`).send({ comment: 'thanks' })).status).toBe(201);
    // proofing never added or changed approval rows
    expect((await prisma.approval.findMany({ where: { deliverableId: d.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.decision)).toEqual(['PENDING', 'APPROVED']);
  });

  it('team notes on a version the client has not received stay invisible to the client', async () => {
    const d = await prisma.deliverable.create({ data: { name: 'Two rounds', clientId: w.clientA.id, type: 'DESIGN', status: 'PENDING_APPROVAL', submittedAt: new Date(), description: 'x' } });
    await prisma.approval.create({ data: { deliverableId: d.id, clientId: w.clientA.id, userId: w.teamA.id, decision: 'PENDING', version: 1, submittedAt: new Date() } });
    expect((await alice.post(`/api/deliverables/${d.id}/request-changes`).send({ comment: 'please fix it' })).status).toBe(200);
    expect((await teamA.post(`/api/deliverables/${d.id}/new-version`)).status).toBe(200); // v2 draft
    const internal = await teamA.post(`/api/deliverables/${d.id}/proofing`).send({ comment: 'wip note for v2' });
    expect(internal.status).toBe(201);
    expect(internal.body.item.version).toBe(2);
    expect(await prisma.notification.count({ where: { userId: w.userA.id, type: 'PROOFING_COMMENT', entityId: d.id } })).toBe(0);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'PROOFING_COMMENT_CREATED', entityId: internal.body.item.id } })).clientVisible).toBe(false);
    const asClient = await alice.get(`/api/deliverables/${d.id}/proofing`);
    expect(asClient.body.items).toHaveLength(0);
    expect(asClient.body.versions).toEqual([1]);
    expect((await alice.patch(`/api/deliverables/${d.id}/proofing/${internal.body.item.id}`).send({ resolved: true })).status).toBe(404);
    expect((await teamA.get(`/api/deliverables/${d.id}/proofing`)).body.items).toHaveLength(1);
  });
});
