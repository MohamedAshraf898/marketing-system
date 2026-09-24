// Phase 3 task management: hierarchy, visibility, multi-assignees, dependencies, comments, bulk, templates,
// recurrence, automations, reports - with the authorization rules first.
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { hashPassword } from '../auth/password';
import { DEFAULT_TEAM_PERMISSIONS } from '../../../shared/src/permissions';
import { generateRecurringTasks, nextOccurrence } from '../services/taskRecurrence';
import { runMaintenance } from '../services/maintenance';
import { PASSWORD, buildWorld, loginAs, tinyPng, type Agent, type World } from './helpers';

let w: World;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;
let alice: Agent;
let bob: Agent;
let lead: Agent; // TEAM on client A with the team-lead permissions
let leadId: string;

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ids = (b: { items: Array<{ id: string }> }) => b.items.map((i) => i.id);
const LEAD_PERMS = [...DEFAULT_TEAM_PERMISSIONS, 'tasks.view_team', 'tasks.manage_spaces', 'tasks.templates', 'tasks.automations', 'tasks.edit_all', 'tasks.delete'];

beforeAll(async () => {
  w = await buildWorld();
  const l = await prisma.user.create({ data: { name: 'Lead', email: 'lead@t.test', role: 'TEAM', passwordHash: await hashPassword(PASSWORD), permissions: JSON.stringify(LEAD_PERMS) } });
  leadId = l.id;
  await prisma.clientAssignment.create({ data: { userId: l.id, clientId: w.clientA.id } });
  [admin, teamA, teamB, alice, bob, lead] = await Promise.all(['admin@t.test', 'teama@t.test', 'teamb@t.test', 'alice@alpha.test', 'bob@beta.test', 'lead@t.test'].map((e) => loginAs(e)));
});

// ───────────────────────── hierarchy ─────────────────────────

describe('spaces / folders / lists', () => {
  let spaceA: string;
  let spaceB: string;
  let listA: string;
  let projectA: string;

  it('only tasks.manage_spaces may build structure; TEAM only for their own clients', async () => {
    expect((await teamA.post('/api/spaces').send({ name: 'Nope' })).status).toBe(403);
    expect((await lead.post('/api/spaces').send({ name: 'Beta space', clientId: w.clientB.id })).body.error.fields.clientId).toBe('invalid_choice');
    spaceA = (await lead.post('/api/spaces').send({ name: 'Alpha space', clientId: w.clientA.id, color: '#22c55e' })).body.item.id;
    spaceB = (await admin.post('/api/spaces').send({ name: 'Beta space', clientId: w.clientB.id })).body.item.id;
    projectA = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Alpha launch' })).body.item.id;
    const folder = (await lead.post(`/api/spaces/${spaceA}/folders`).send({ name: 'Launch', projectId: projectA })).body.item;
    const list = await lead.post(`/api/spaces/${spaceA}/lists`).send({ name: 'Creative', folderId: folder.id });
    expect(list.status).toBe(201);
    expect(list.body.item.projectId).toBe(projectA); // inherits the folder's project
    listA = list.body.item.id;
    expect((await lead.post(`/api/spaces/${spaceB}/lists`).send({ name: 'x' })).status).toBe(404); // invisible space
  });

  it('the tree only shows spaces the caller may see; client users get nothing', async () => {
    const a = await teamA.get('/api/spaces/tree');
    expect(a.body.items.map((s: { id: string }) => s.id)).toContain(spaceA);
    expect(a.body.items.map((s: { id: string }) => s.id)).not.toContain(spaceB);
    expect((await teamB.get('/api/spaces/tree')).body.items.map((s: { id: string }) => s.id)).toEqual([spaceB]);
    expect((await alice.get('/api/spaces/tree')).status).toBe(403);
  });

  it('a task created in a list inherits the list project + client; a foreign client is refused', async () => {
    const t = await teamA.post('/api/tasks').send({ title: 'Design post', listId: listA });
    expect(t.status).toBe(201);
    expect(t.body.item).toMatchObject({ listId: listA, projectId: projectA, clientId: w.clientA.id, list: { spaceId: spaceA } });
    expect((await admin.post('/api/tasks').send({ title: 'x', listId: listA, clientId: w.clientB.id })).body.error.fields.clientId).toBe('invalid_choice');
    expect((await teamB.post('/api/tasks').send({ title: 'x', listId: listA })).body.error.fields.listId).toBe('invalid_choice');
    const tree = await teamA.get('/api/spaces/tree');
    const list = tree.body.items.find((s: { id: string }) => s.id === spaceA).folders[0].lists[0];
    expect(list.openTasks).toBe(1);
  });

  it('custom statuses map onto a built-in category; kanban moves keep both in sync', async () => {
    const res = await lead.put(`/api/spaces/${spaceA}/statuses`).send({
      statuses: [
        { name: 'Backlog', color: '#71717a', category: 'TODO' }, { name: 'Designing', color: '#0ea5e9', category: 'IN_PROGRESS' },
        { name: 'Client review', color: '#a855f7', category: 'REVIEW' }, { name: 'Shipped', color: '#22c55e', category: 'DONE' },
      ],
    });
    expect(res.status).toBe(200);
    const review = res.body.items.find((s: { name: string }) => s.name === 'Client review');
    const t = (await admin.post('/api/tasks').send({ title: 'Custom flow', listId: listA })).body.item;
    expect(t.customStatus.name).toBe('Backlog');
    const moved = await admin.post(`/api/tasks/${t.id}/move`).send({ customStatusId: review.id });
    expect(moved.body.item).toMatchObject({ status: 'REVIEW', customStatusId: review.id });
    // a status of another space is refused
    const other = (await admin.put(`/api/spaces/${spaceB}/statuses`).send({ statuses: [{ name: 'B', color: '#71717a', category: 'TODO' }] })).body.items[0];
    expect((await admin.post(`/api/tasks/${t.id}/move`).send({ customStatusId: other.id })).body.error.fields.customStatusId).toBe('invalid_choice');
  });

  it('deleting a list keeps its tasks (they just leave the list)', async () => {
    const tmp = (await lead.post(`/api/spaces/${spaceA}/lists`).send({ name: 'Temp' })).body.item.id;
    const t = (await admin.post('/api/tasks').send({ title: 'Survivor', listId: tmp })).body.item.id;
    expect((await teamA.delete(`/api/spaces/lists/${tmp}`)).status).toBe(403);
    expect((await lead.delete(`/api/spaces/lists/${tmp}`)).body).toEqual({ ok: true });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).listId).toBeNull();
  });
});

// ───────────────────────── client visibility ─────────────────────────

describe('client visibility', () => {
  let internal: string;
  let shared: string;
  let sharedB: string;

  beforeAll(async () => {
    internal = (await admin.post('/api/tasks').send({ title: 'INTERNAL-ONLY-TASK', clientId: w.clientA.id, description: 'secret margin' })).body.item.id;
    shared = (await admin.post('/api/tasks').send({ title: 'Homepage copy', clientId: w.clientA.id, visibility: 'CLIENT_VISIBLE', estimatedHours: 7, tags: ['SECRET-TAG'] })).body.item.id;
    sharedB = (await admin.post('/api/tasks').send({ title: 'Beta shared', clientId: w.clientB.id, visibility: 'CLIENT_VISIBLE' })).body.item.id;
  });

  it('tasks default to INTERNAL; a client-less task cannot be shared', async () => {
    expect((await admin.get(`/api/tasks/${internal}`)).body.item.visibility).toBe('INTERNAL');
    expect((await admin.post('/api/tasks').send({ title: 'x', visibility: 'CLIENT_VISIBLE' })).body.error.fields.visibility).toBe('needs_client');
  });

  it('the staff API stays closed to clients', async () => {
    expect((await alice.get('/api/tasks')).status).toBe(403);
    expect((await alice.get(`/api/tasks/${shared}`)).status).toBe(403);
  });

  it('clients see only their own CLIENT_VISIBLE tasks, through a whitelist', async () => {
    const res = await alice.get('/api/client-tasks');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([shared]);
    const raw = JSON.stringify(res.body);
    for (const bad of ['INTERNAL-ONLY-TASK', 'SECRET-TAG', 'estimatedHours', 'actualHours', 'assignee', 'Beta shared']) expect(raw).not.toContain(bad);
    expect((await alice.get(`/api/client-tasks/${internal}`)).status).toBe(404);
    expect((await alice.get(`/api/client-tasks/${sharedB}`)).status).toBe(404); // another company
    expect(ids((await bob.get('/api/client-tasks')).body)).toEqual([sharedB]);
    // changing a query id does not help
    expect(ids((await alice.get(`/api/client-tasks?projectId=x&clientId=${w.clientB.id}`)).body)).toEqual([]);
    expect((await teamA.get('/api/client-tasks')).status).toBe(403); // staff use /tasks
  });

  it('a shared task inside an internal-only project stays hidden', async () => {
    const p = (await admin.post('/api/projects').send({ clientId: w.clientA.id, name: 'Internal P', visibleToClient: false })).body.item.id;
    const t = (await admin.post('/api/tasks').send({ title: 'Hidden by project', projectId: p, visibility: 'CLIENT_VISIBLE' })).body.item.id;
    expect((await alice.get(`/api/client-tasks/${t}`)).status).toBe(404);
  });

  it('comments: clients only read shared comments; their comments notify staff', async () => {
    await admin.post(`/api/tasks/${shared}/comments`).send({ comment: 'INTERNAL-REMARK' });
    await admin.post(`/api/tasks/${shared}/comments`).send({ comment: 'Draft is ready for you', clientVisible: true });
    expect((await admin.post(`/api/tasks/${internal}/comments`).send({ comment: 'x', clientVisible: true })).body.error.fields.clientVisible).toBe('task_not_shared');
    const detail = await alice.get(`/api/client-tasks/${shared}`);
    const texts = detail.body.item.comments.map((c: { comment: string }) => c.comment);
    expect(texts).toEqual(['Draft is ready for you']);
    const c = await alice.post(`/api/client-tasks/${shared}/comments`).send({ comment: 'Looks great' });
    expect(c.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: w.admin.id, type: 'TASK_COMMENT', entityId: shared } })).toBe(1);
    expect((await alice.post(`/api/client-tasks/${internal}/comments`).send({ comment: 'x' })).status).toBe(404);
  });

  it('dashboard shows shared tasks to the client and nothing internal', async () => {
    const d = (await alice.get('/api/dashboard')).body;
    expect(d.sharedTasks.items.map((t: { id: string }) => t.id)).toEqual([shared]);
    expect(JSON.stringify(d)).not.toContain('INTERNAL-ONLY-TASK');
    expect(d).not.toHaveProperty('teamAttendance');
    expect(d).not.toHaveProperty('myAttendance');
  });
});

// ───────────────────────── assignees, subtasks, dependencies ─────────────────────────

describe('multiple assignees, subtasks and dependencies', () => {
  let parent: string;

  it('multiple assignees: all notified, all may work, all are validated', async () => {
    const res = await admin.post('/api/tasks').send({ title: 'Campaign', clientId: w.clientA.id, assigneeIds: [w.teamA.id, leadId], priority: 'HIGH' });
    expect(res.status).toBe(201);
    parent = res.body.item.id;
    expect(res.body.item.assignees.map((a: { id: string }) => a.id).sort()).toEqual([w.teamA.id, leadId].sort());
    expect(await prisma.notification.count({ where: { type: 'TASK_ASSIGNED', entityId: parent } })).toBe(2);
    expect((await teamA.patch(`/api/tasks/${parent}`).send({ status: 'IN_PROGRESS' })).status).toBe(200);
    expect((await admin.post('/api/tasks').send({ title: 'x', clientId: w.clientA.id, assigneeIds: [w.teamB.id] })).body.error.fields.assigneeIds).toBe('invalid_choice');
    // "mine" includes secondary assignees
    expect(ids((await lead.get('/api/tasks?mine=1&pageSize=100')).body)).toContain(parent);
  });

  it('subtasks inherit the parent, nest up to the depth limit, and roll up progress', async () => {
    const s1 = (await teamA.post('/api/tasks').send({ title: 'Creative', parentId: parent })).body.item;
    expect(s1).toMatchObject({ parentId: parent, depth: 1, clientId: w.clientA.id });
    const s2 = (await teamA.post('/api/tasks').send({ title: 'Post 1', parentId: s1.id })).body.item;
    const s3 = (await teamA.post('/api/tasks').send({ title: 'Deeper', parentId: s2.id })).body.item;
    expect(s3.depth).toBe(3);
    expect((await teamA.post('/api/tasks').send({ title: 'Too deep', parentId: s3.id })).body.error.fields.parentId).toBe('too_deep');
    expect((await teamA.post('/api/tasks').send({ title: 'x', parentId: parent, clientId: w.clientB.id })).body.error.fields.clientId).toBe('invalid_choice');
    expect((await teamB.post('/api/tasks').send({ title: 'x', parentId: parent })).body.error.fields.parentId).toBe('invalid_choice');
    await admin.patch(`/api/tasks/${s1.id}`).send({ status: 'DONE' });
    const d = await admin.get(`/api/tasks/${parent}`);
    expect(d.body.item.subtaskCounts).toEqual({ done: 1, total: 1 });
    expect(d.body.item.subtasks.map((s: { id: string }) => s.id)).toEqual([s1.id]);
    expect(await prisma.auditLog.count({ where: { action: 'SUBTASK_COMPLETED', entityId: parent } })).toBe(1);
    expect((await admin.patch(`/api/tasks/${parent}`).send({ parentId: s2.id })).body.error.fields.parentId).toBe('invalid_choice'); // cycle
  });

  it('dependencies: blocked-by / blocking, no cycles, optional hard block, notification on completion', async () => {
    const design = (await admin.post('/api/tasks').send({ title: 'Design', clientId: w.clientA.id, assigneeIds: [w.teamA.id] })).body.item.id;
    const copy = (await admin.post('/api/tasks').send({ title: 'Copy', clientId: w.clientA.id, assigneeIds: [leadId], blockOnDependencies: true })).body.item.id;
    const dep = await admin.post(`/api/tasks/${copy}/dependencies`).send({ taskId: design, type: 'BLOCKED_BY' });
    expect(dep.status).toBe(201);
    expect((await admin.post(`/api/tasks/${design}/dependencies`).send({ taskId: copy, type: 'BLOCKED_BY' })).body.error.code).toBe('DEPENDENCY_EXISTS');
    const third = (await admin.post('/api/tasks').send({ title: 'Approval', clientId: w.clientA.id })).body.item.id;
    await admin.post(`/api/tasks/${third}/dependencies`).send({ taskId: copy, type: 'BLOCKED_BY' });
    expect((await admin.post(`/api/tasks/${design}/dependencies`).send({ taskId: third, type: 'BLOCKED_BY' })).body.error.code).toBe('DEPENDENCY_CYCLE');
    expect((await admin.get(`/api/tasks/${copy}`)).body.item).toMatchObject({ blocked: true });
    expect((await lead.patch(`/api/tasks/${copy}`).send({ status: 'IN_PROGRESS' })).body.error.code).toBe('TASK_BLOCKED');
    await teamA.patch(`/api/tasks/${design}`).send({ status: 'DONE' });
    expect(await prisma.notification.count({ where: { userId: leadId, type: 'TASK_DEPENDENCY_DONE', entityId: copy } })).toBe(1);
    expect((await lead.patch(`/api/tasks/${copy}`).send({ status: 'IN_PROGRESS' })).status).toBe(200);
    const detail = (await admin.get(`/api/tasks/${copy}`)).body.item.dependencies;
    expect(detail.blockedBy[0].task.id).toBe(design);
    expect(detail.blocking[0].task.id).toBe(third);
    expect((await teamB.post(`/api/tasks/${copy}/dependencies`).send({ taskId: design, type: 'RELATED' })).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'TASK_DEPENDENCY_ADDED', entityId: copy } })).toBe(1);
  });

  it('old/new values are audited for priority, due date and other fields', async () => {
    await admin.patch(`/api/tasks/${parent}`).send({ priority: 'URGENT', dueDate: day(3), startDate: day(1) });
    const p = await prisma.auditLog.findFirstOrThrow({ where: { action: 'TASK_PRIORITY_CHANGED', entityId: parent } });
    expect(JSON.parse(p.metadata!)).toMatchObject({ from: 'HIGH', to: 'URGENT' });
    const d = await prisma.auditLog.findFirstOrThrow({ where: { action: 'TASK_DUE_DATE_CHANGED', entityId: parent } });
    expect(JSON.parse(d.metadata!)).toMatchObject({ from: null, to: day(3) });
    const act = await teamA.get(`/api/tasks/${parent}/activity`);
    expect(act.body.items.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['TASK_CREATED', 'TASK_PRIORITY_CHANGED', 'TASK_STATUS_CHANGED']));
    expect((await admin.patch(`/api/tasks/${parent}`).send({ dueDate: day(0), startDate: day(5) })).body.error.fields.dueDate).toBe('end_before_start');
  });
});

// ───────────────────────── comments ─────────────────────────

describe('comments: mentions, attachments, edit / delete', () => {
  let t: string;
  beforeAll(async () => { t = (await admin.post('/api/tasks').send({ title: 'Discussed', clientId: w.clientA.id, assigneeIds: [w.teamA.id] })).body.item.id; });

  it('mentions only reach staff who can see the task', async () => {
    expect((await teamA.post(`/api/tasks/${t}/comments`).send({ comment: '@Team B look', mentionIds: [w.teamB.id] })).body.error.fields.mentionIds).toBe('invalid_choice');
    expect((await teamA.post(`/api/tasks/${t}/comments`).send({ comment: '@Alice', mentionIds: [w.userA.id] })).status).toBe(400);
    const ok = await teamA.post(`/api/tasks/${t}/comments`).send({ comment: '@Lead please check', mentionIds: [leadId] });
    expect(ok.status).toBe(201);
    expect(ok.body.item.mentions.map((m: { id: string }) => m.id)).toEqual([leadId]);
    expect(await prisma.notification.count({ where: { userId: leadId, type: 'TASK_MENTION', entityId: t } })).toBe(1);
  });

  it('attachments must be files of this task', async () => {
    const f = (await admin.post('/api/files').field('taskId', t).attach('file', tinyPng(), 'shot.png')).body.item.id;
    const other = (await admin.post('/api/tasks').send({ title: 'Other', clientId: w.clientA.id })).body.item.id;
    const g = (await admin.post('/api/files').field('taskId', other).attach('file', tinyPng(), 'x.png')).body.item.id;
    expect((await teamA.post(`/api/tasks/${t}/comments`).send({ comment: 'see', attachmentIds: [g] })).body.error.fields.attachmentIds).toBe('invalid_choice');
    const ok = await teamA.post(`/api/tasks/${t}/comments`).send({ comment: 'see attached', attachmentIds: [f] });
    expect(ok.body.item.attachments.map((a: { id: string }) => a.id)).toEqual([f]);
  });

  it('only the author edits; the author or an admin deletes', async () => {
    const c = (await teamA.post(`/api/tasks/${t}/comments`).send({ comment: 'tpyo' })).body.item;
    expect((await lead.patch(`/api/tasks/${t}/comments/${c.id}`).send({ comment: 'hacked' })).status).toBe(403);
    const e = await teamA.patch(`/api/tasks/${t}/comments/${c.id}`).send({ comment: 'typo' });
    expect(e.body.item).toMatchObject({ comment: 'typo' });
    expect(e.body.item.editedAt).toBeTruthy();
    expect((await lead.delete(`/api/tasks/${t}/comments/${c.id}`)).status).toBe(403);
    expect((await admin.delete(`/api/tasks/${t}/comments/${c.id}`)).body).toEqual({ ok: true });
  });
});

// ───────────────────────── views, overviews, bulk ─────────────────────────

describe('views, my tasks, team tasks, search, bulk', () => {
  it('my-overview counts the caller only', async () => {
    const mine = (await admin.post('/api/tasks').send({ title: 'Due today', clientId: w.clientA.id, assigneeIds: [w.teamA.id], dueDate: day(0) })).body.item.id;
    await admin.post('/api/tasks').send({ title: 'Late one', clientId: w.clientA.id, assigneeIds: [w.teamA.id], dueDate: day(-2) });
    const res = await teamA.get('/api/tasks/my-overview');
    expect(res.status).toBe(200);
    expect(res.body.counts.dueToday).toBeGreaterThanOrEqual(1);
    expect(res.body.counts.overdue).toBeGreaterThanOrEqual(1);
    expect(res.body.lists.dueToday.map((t: { id: string }) => t.id)).toContain(mine);
    expect(JSON.stringify((await teamB.get('/api/tasks/my-overview')).body)).not.toContain('Due today');
  });

  it('team tasks need tasks.view_team and respect scope', async () => {
    expect((await teamA.get('/api/tasks/grouped?by=assignee')).status).toBe(403);
    const res = await lead.get('/api/tasks/grouped?by=assignee');
    expect(res.status).toBe(200);
    const a = res.body.groups.find((g: { key: string }) => g.key === w.teamA.id);
    expect(a.label).toBe('Team A');
    expect(a.overdue).toBeGreaterThanOrEqual(1);
    const byClient = await lead.get('/api/tasks/grouped?by=client');
    expect(byClient.body.groups.map((g: { key: string }) => g.key)).not.toContain(w.clientB.id);
  });

  it('search covers assignee, client, project and tags', async () => {
    await admin.post('/api/tasks').send({ title: 'Plain title', clientId: w.clientA.id, tags: ['Q4-Launch'], assigneeIds: [leadId] });
    expect((await admin.get('/api/tasks?q=q4-launch')).body.items.map((t: { title: string }) => t.title)).toContain('Plain title');
    expect((await admin.get('/api/tasks?q=Lead&pageSize=100')).body.items.map((t: { title: string }) => t.title)).toContain('Plain title');
    expect((await teamB.get('/api/tasks?q=Q4-Launch')).body.items).toHaveLength(0);
    const g = await admin.get('/api/search?q=Q4-Launch');
    expect(g.body.items.some((h: { type: string; title: string }) => h.type === 'task' && h.title === 'Plain title')).toBe(true);
  });

  it('sorting by priority paginates in priority order', async () => {
    const res = await admin.get('/api/tasks?sort=priority&dir=desc&pageSize=100');
    const order = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
    const ps = res.body.items.map((t: { priority: string }) => order.indexOf(t.priority));
    expect(ps).toEqual([...ps].sort((a: number, b: number) => a - b));
    const p1 = await admin.get('/api/tasks?sort=priority&dir=desc&pageSize=3&page=1');
    const p2 = await admin.get('/api/tasks?sort=priority&dir=desc&pageSize=3&page=2');
    expect(new Set([...ids(p1.body), ...ids(p2.body)]).size).toBe(6);
  });

  it('bulk actions authorise every task separately', async () => {
    const mineA = (await teamA.post('/api/tasks').send({ title: 'Bulk mine', clientId: w.clientA.id })).body.item.id;
    const notMine = (await admin.post('/api/tasks').send({ title: 'Bulk other', clientId: w.clientA.id })).body.item.id;
    const foreign = (await admin.post('/api/tasks').send({ title: 'Bulk B', clientId: w.clientB.id })).body.item.id;
    const res = await teamA.post('/api/tasks/bulk').send({ ids: [mineA, notMine, foreign], action: 'priority', priority: 'URGENT' });
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped.map((s: { reason: string }) => s.reason).sort()).toEqual(['FORBIDDEN', 'NOT_FOUND']);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: foreign } })).priority).toBe('NORMAL');
    expect((await teamA.post('/api/tasks/bulk').send({ ids: [mineA], action: 'delete' })).status).toBe(403);
    expect((await teamA.post('/api/tasks/bulk').send({ ids: [mineA], action: 'status' })).body.error.fields.status).toBe('required');
    const arch = await lead.post('/api/tasks/bulk').send({ ids: [mineA, notMine], action: 'archive' });
    expect(arch.body.updated).toBe(2);
    expect(ids((await admin.get('/api/tasks?pageSize=100')).body)).not.toContain(mineA);
    expect(ids((await admin.get('/api/tasks?archived=1&pageSize=100')).body)).toContain(mineA);
  });

  it('kanban / list ordering is persisted server-side', async () => {
    const mk = async (title: string) => (await admin.post('/api/tasks').send({ title, clientId: w.clientA.id, status: 'REVIEW' })).body.item.id;
    const [a, b, c] = [await mk('Ord A'), await mk('Ord B'), await mk('Ord C')];
    await admin.post(`/api/tasks/${c}/move`).send({ afterId: a, beforeId: b, status: 'REVIEW' });
    const rows = (await admin.get('/api/tasks?status=REVIEW&sort=position&pageSize=100')).body.items.map((t: { id: string }) => t.id).filter((id: string) => [a, b, c].includes(id));
    expect(rows).toEqual([a, c, b]);
    await admin.post(`/api/tasks/${a}/move`).send({ status: 'DONE' });
    expect(await prisma.auditLog.count({ where: { action: 'TASK_STATUS_CHANGED', entityId: a } })).toBe(1);
  });

  it('timeline returns tasks overlapping the window and their dependencies', async () => {
    const res = await admin.get(`/api/tasks/timeline?from=${day(-30)}&to=${day(30)}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every((t: { startDate: string | null; dueDate: string | null }) => t.startDate || t.dueDate)).toBe(true);
  });
});

// ───────────────────────── templates, recurrence, automations ─────────────────────────

describe('templates / recurring / automations', () => {
  it('templates create a parent + subtasks; managing needs tasks.templates', async () => {
    const body = { name: 'Social Media Post', taskTitle: 'Social post', priority: 'HIGH', checklist: ['Brief'], items: ['Design', 'Copywriting', 'Review', 'Client Approval', 'Publishing'].map((title, i) => ({ title, dueOffsetDays: i + 1 })) };
    expect((await teamA.post('/api/task-templates').send(body)).status).toBe(403);
    const tpl = (await lead.post('/api/task-templates').send(body)).body.item;
    expect(tpl.items).toHaveLength(5);
    const applied = await teamA.post(`/api/task-templates/${tpl.id}/apply`).send({ clientId: w.clientA.id, title: 'Post for Alpha' });
    expect(applied.status).toBe(201);
    expect(applied.body.item).toMatchObject({ title: 'Post for Alpha', priority: 'HIGH', clientId: w.clientA.id, subtaskCount: 5, checklist: { done: 0, total: 1 } });
    // applying never widens scope
    expect((await teamA.post(`/api/task-templates/${tpl.id}/apply`).send({ clientId: w.clientB.id })).status).toBe(400);
  });

  it('recurring tasks: next occurrence rules and duplicate-proof generation', () => {
    expect(nextOccurrence({ frequency: 'DAILY', interval: 1, weekdays: null, monthDay: null }, '2026-03-02')).toBe('2026-03-03');
    expect(nextOccurrence({ frequency: 'WEEKLY', interval: 1, weekdays: '1', monthDay: null }, '2026-03-02')).toBe('2026-03-09');
    expect(nextOccurrence({ frequency: 'WEEKLY', interval: 2, weekdays: '1,3', monthDay: null }, '2026-03-02')).toBe('2026-03-04');
    expect(nextOccurrence({ frequency: 'WEEKLY', interval: 2, weekdays: '1,3', monthDay: null }, '2026-03-04')).toBe('2026-03-16');
    expect(nextOccurrence({ frequency: 'MONTHLY', interval: 1, weekdays: null, monthDay: 31 }, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence({ frequency: 'CUSTOM', interval: 3, weekdays: null, monthDay: null }, '2026-03-02')).toBe('2026-03-05');
  });

  it('a recurring task generates each occurrence exactly once', async () => {
    const t = (await admin.post('/api/tasks').send({ title: 'Daily standup notes', clientId: w.clientA.id, assigneeIds: [w.teamA.id], dueDate: day(-3) })).body.item.id;
    const r = await admin.put(`/api/tasks/${t}/recurrence`).send({ frequency: 'DAILY', interval: 1 });
    expect(r.body.item.recurring).toBe(true);
    expect((await teamB.put(`/api/tasks/${t}/recurrence`).send({ frequency: 'DAILY' })).status).toBe(404);
    const first = await generateRecurringTasks();
    expect(first).toBe(3); // day -2, -1, today
    expect(await generateRecurringTasks()).toBe(0);
    // even if the pointer is reset, the unique key prevents duplicates
    await prisma.taskRecurrence.update({ where: { taskId: t }, data: { nextDate: new Date(`${day(-2)}T00:00:00Z`) } });
    expect(await generateRecurringTasks()).toBe(0);
    const occ = await prisma.task.findMany({ where: { recurrenceSourceId: t } });
    expect(occ).toHaveLength(3);
    expect(new Set(occ.map((o) => o.occurrenceDate?.toISOString())).size).toBe(3);
    expect(await prisma.taskAssignee.count({ where: { taskId: occ[0].id, userId: w.teamA.id } })).toBe(1);
  });

  it('automations: only tasks.automations manages them; status rules run and can create the next task', async () => {
    const rule = { name: 'Next after done', trigger: 'STATUS_CHANGED', triggerStatus: 'DONE', action: 'CREATE_TASK', config: { title: 'Publish: {title}', assign: 'same', dueInDays: 2 } };
    expect((await teamA.post('/api/task-automations').send(rule)).status).toBe(403);
    expect((await lead.post('/api/task-automations').send({ ...rule, action: 'NOTIFY_USER', config: {} })).body.error.fields['config.userId']).toBe('required');
    const created = await lead.post('/api/task-automations').send(rule);
    expect(created.status).toBe(201);
    const t = (await admin.post('/api/tasks').send({ title: 'Design banner', clientId: w.clientA.id, assigneeIds: [w.teamA.id] })).body.item.id;
    await teamA.patch(`/api/tasks/${t}`).send({ status: 'DONE' });
    const follow = await prisma.task.findFirst({ where: { title: 'Publish: Design banner' }, include: { assignees: true } });
    expect(follow).toBeTruthy();
    expect(follow!.clientId).toBe(w.clientA.id);
    expect(follow!.assignees.map((a) => a.userId)).toEqual([w.teamA.id]);
    expect((await prisma.taskAutomation.findUniqueOrThrow({ where: { id: created.body.item.id } })).runCount).toBe(1);
    await lead.patch(`/api/task-automations/${created.body.item.id}`).send({ enabled: false });
  });

  it('overdue rules run once per task via maintenance; REVIEW notifies the reviewer', async () => {
    await lead.post('/api/task-automations').send({ name: 'Escalate overdue', trigger: 'TASK_OVERDUE', action: 'SET_PRIORITY', config: { priority: 'URGENT' } });
    const late = (await admin.post('/api/tasks').send({ title: 'Very late', clientId: w.clientA.id, dueDate: day(-5), priority: 'LOW' })).body.item.id;
    await runMaintenance();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: late } })).priority).toBe('URGENT');
    await prisma.task.update({ where: { id: late }, data: { priority: 'LOW' } });
    await runMaintenance();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: late } })).priority).toBe('LOW'); // not re-run
    const r = (await admin.post('/api/tasks').send({ title: 'Needs review', clientId: w.clientA.id, assigneeIds: [w.teamA.id], reviewerId: leadId })).body.item.id;
    await teamA.patch(`/api/tasks/${r}`).send({ status: 'REVIEW' });
    expect(await prisma.notification.count({ where: { userId: leadId, type: 'TASK_REVIEW', entityId: r } })).toBe(1);
  });
});

// ───────────────────────── delete, reports, workload ─────────────────────────

describe('delete, reports, workload', () => {
  it('deleting a parent removes the whole subtree', async () => {
    const p = (await admin.post('/api/tasks').send({ title: 'Tree', clientId: w.clientA.id })).body.item.id;
    const c = (await admin.post('/api/tasks').send({ title: 'Branch', parentId: p })).body.item.id;
    const g = (await admin.post('/api/tasks').send({ title: 'Leaf', parentId: c })).body.item.id;
    expect((await admin.delete(`/api/tasks/${p}`)).body).toEqual({ ok: true });
    expect(await prisma.task.count({ where: { id: { in: [p, c, g] } } })).toBe(0);
  });

  it('task report needs tasks.view_team, is scoped, exports CSV', async () => {
    expect((await teamA.get('/api/team-reports/tasks')).status).toBe(403);
    expect((await alice.get('/api/team-reports/tasks')).status).toBe(403);
    const res = await lead.get(`/api/team-reports/tasks?by=client&from=${day(-30)}&to=${day(0)}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { key: string }) => i.key)).not.toContain(w.clientB.id);
    const csv = await lead.get(`/api/team-reports/tasks?by=assignee&from=${day(-30)}&to=${day(0)}&format=csv`);
    expect(csv.text).toContain('Team member,Created,Completed');
  });

  it('workload counts every assignee of a shared task and splits the estimate', async () => {
    await prisma.user.update({ where: { id: w.admin.id }, data: { permissions: null } });
    const t = (await admin.post('/api/tasks').send({ title: 'Shared estimate', clientId: w.clientA.id, assigneeIds: [w.teamA.id, leadId], dueDate: day(1), estimatedHours: 10 })).body.item.id;
    const res = await admin.get(`/api/workload?from=${day(0)}&to=${day(6)}`);
    const a = res.body.items.find((i: { user: { id: string } }) => i.user.id === w.teamA.id);
    const l = res.body.items.find((i: { user: { id: string } }) => i.user.id === leadId);
    expect(a).toHaveProperty('dueToday');
    expect(a).toHaveProperty('completedTasks');
    const before = (await admin.get(`/api/workload?from=${day(0)}&to=${day(6)}&projectId=none`)).body.items.find((i: { user: { id: string } }) => i.user.id === w.teamA.id);
    expect(before.openTasks).toBe(0);
    expect(a.estimatedHours).toBeGreaterThanOrEqual(5);
    expect(l.estimatedHours).toBeGreaterThanOrEqual(5);
    await admin.delete(`/api/tasks/${t}`);
  });
});
