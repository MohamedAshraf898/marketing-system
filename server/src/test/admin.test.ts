import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_TEAM_PERMISSIONS } from '../../../shared/src/permissions';
import { prisma } from '../db';
import { app, buildWorld, loginAs, tinyPng, type Agent, type World } from './helpers';

let w: World;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;
let alice: Agent;
let bob: Agent;

const DAY = 86_400_000;
const midnight = (offsetDays: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + offsetDays * DAY);
};
const setPerms = (userId: string, list: string[] | null) => prisma.user.update({ where: { id: userId }, data: { permissions: list ? JSON.stringify(list) : null } });

beforeAll(async () => {
  w = await buildWorld();
  [admin, teamA, teamB, alice, bob] = await Promise.all(['admin@t.test', 'teama@t.test', 'teamb@t.test', 'alice@alpha.test', 'bob@beta.test'].map((e) => loginAs(e)));

  // ── internal + shared data for the dashboards ──
  await prisma.client.update({ where: { id: w.clientA.id }, data: { monthlyRetainer: 4321, internalNotes: 'SECRET-INTERNAL', onboardingStatus: 'IN_PROGRESS' } });
  await prisma.onboardingItem.createMany({ data: [
    { clientId: w.clientA.id, title: 'Kickoff', done: true, position: 0 },
    { clientId: w.clientA.id, title: 'Access', done: false, position: 1 },
  ] });
  const projA = await prisma.project.create({ data: { clientId: w.clientA.id, name: 'Site A', status: 'IN_PROGRESS', dueDate: midnight(3), visibleToClient: true } });
  await prisma.project.create({ data: { clientId: w.clientA.id, name: 'Internal A', status: 'IN_PROGRESS', dueDate: midnight(2), visibleToClient: false } });
  await prisma.milestone.create({ data: { projectId: projA.id, title: 'M1', dueDate: midnight(5) } });
  await prisma.task.create({ data: { title: 'Late task A', clientId: w.clientA.id, projectId: projA.id, assignedToId: w.teamA.id, status: 'TODO', dueDate: midnight(-2) } });
  await prisma.task.create({ data: { title: 'Today task A', clientId: w.clientA.id, assignedToId: w.teamA.id, status: 'IN_PROGRESS', dueDate: midnight(0) } });
  await prisma.task.create({ data: { title: 'Done task A', clientId: w.clientA.id, assignedToId: w.teamA.id, status: 'DONE', dueDate: midnight(-5) } });
  await prisma.task.create({ data: { title: 'Task B', clientId: w.clientB.id, assignedToId: w.teamB.id, status: 'TODO', dueDate: midnight(-1) } });
  await prisma.contentItem.create({ data: { clientId: w.clientA.id, title: 'Internal idea', status: 'IDEA', publishDate: midnight(1) } });
  const sentDel = await prisma.deliverable.create({ data: { name: 'Post design', clientId: w.clientA.id, type: 'DESIGN', status: 'APPROVED', submittedAt: new Date(), createdById: w.teamA.id } });
  await prisma.contentItem.create({ data: { clientId: w.clientA.id, title: 'Shared post', status: 'CLIENT_APPROVAL', publishDate: midnight(2), deliverableId: sentDel.id, notes: 'INTERNAL-CONTENT-NOTE' } });
  await prisma.invoice.create({ data: { clientId: w.clientA.id, invoiceNumber: 'INV-A-1', issueDate: midnight(-30), dueDate: midnight(-3), amount: 100, tax: 0, total: 100, status: 'SENT', visibleToClient: true, notes: 'INTERNAL-INV-NOTE' } });
  await prisma.invoice.create({ data: { clientId: w.clientA.id, invoiceNumber: 'INV-A-2', issueDate: midnight(-1), dueDate: midnight(20), amount: 900, tax: 0, total: 900, status: 'DRAFT', visibleToClient: true } });
  await prisma.invoice.create({ data: { clientId: w.clientA.id, invoiceNumber: 'INV-A-3', issueDate: midnight(-1), dueDate: midnight(20), amount: 50, tax: 0, total: 50, status: 'PENDING', visibleToClient: false } });
  await prisma.invoice.create({ data: { clientId: w.clientA.id, invoiceNumber: 'INV-A-4', issueDate: midnight(-10), dueDate: midnight(-1), amount: 70, tax: 0, total: 70, status: 'PAID', paidAt: new Date(), visibleToClient: true } });
  await prisma.invoice.create({ data: { clientId: w.clientB.id, invoiceNumber: 'INV-B-1', issueDate: midnight(-30), dueDate: midnight(-3), amount: 5000, tax: 0, total: 5000, status: 'OVERDUE', visibleToClient: true } });
  await prisma.contract.create({ data: { clientId: w.clientA.id, name: 'Retainer A', contractNumber: 'C-A-1', status: 'ACTIVE', endDate: midnight(10), visibleToClient: true, notes: 'INTERNAL-CONTRACT-NOTE' } });
  await prisma.contract.create({ data: { clientId: w.clientA.id, name: 'Hidden A', contractNumber: 'C-A-2', status: 'ACTIVE', endDate: midnight(12), visibleToClient: false } });
  await prisma.contract.create({ data: { clientId: w.clientB.id, name: 'Retainer B', contractNumber: 'C-B-1', status: 'ACTIVE', endDate: midnight(9), visibleToClient: true } });
  const started = new Date(Date.now() - 3600_000);
  await prisma.timeEntry.create({ data: { userId: w.teamA.id, clientId: w.clientA.id, startedAt: started, endedAt: new Date(), durationSec: 3600 } });
  await prisma.timeEntry.create({ data: { userId: w.teamB.id, clientId: w.clientB.id, startedAt: started, endedAt: new Date(), durationSec: 1800 } });
  // activity rows: one the client may see, one internal, one for the other client
  await prisma.auditLog.create({ data: { userId: w.teamA.id, action: 'DELIVERABLE_SUBMITTED', entity: 'deliverable', entityId: w.delA.id, metadata: JSON.stringify({ name: 'A Banner', ip: '9.9.9.9', secret: 'x' }), ip: '1.2.3.4', clientId: w.clientA.id, clientVisible: true } });
  await prisma.auditLog.create({ data: { userId: w.teamA.id, action: 'INTERNAL_NOTE_CREATED', entity: 'internal_note', entityId: 'note1', metadata: JSON.stringify({ title: 'INTERNAL-ACTIVITY' }), clientId: w.clientA.id, clientVisible: false } });
  await prisma.auditLog.create({ data: { userId: w.teamB.id, action: 'DELIVERABLE_SUBMITTED', entity: 'deliverable', entityId: w.delB.id, metadata: JSON.stringify({ name: 'B Video' }), clientId: w.clientB.id, clientVisible: true } });
});

describe('dashboard', () => {
  const PHASE1 = ['role', 'kpis', 'activeCampaigns', 'recentCampaigns', 'pendingApprovals', 'requests', 'recentReports'];

  it('requires a session', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
  });

  it('keeps every phase-1 field for all three roles', async () => {
    for (const [agent, role, kpis] of [
      [admin, 'ADMIN', ['totalClients', 'activeClients', 'activeCampaigns', 'pendingApprovals', 'openRequests', 'totalSpend']],
      [teamA, 'TEAM', ['assignedClients', 'assignedCampaigns', 'pendingDeliverables', 'pendingApprovals', 'openRequests']],
      [alice, 'CLIENT', ['activeCampaigns', 'pendingApprovals', 'openRequests', 'totalSpend']],
    ] as const) {
      const res = await agent.get('/api/dashboard');
      expect(res.status).toBe(200);
      for (const k of PHASE1) expect(res.body).toHaveProperty(k);
      expect(res.body.role).toBe(role);
      for (const k of kpis) expect(typeof res.body.kpis[k]).toBe('number');
    }
    expect((await teamA.get('/api/dashboard')).body).toHaveProperty('recentFeedback');
    expect((await alice.get('/api/dashboard')).body.client.companyName).toBe('Alpha Co');
  });

  it('CLIENT payload holds only own, shared data and nothing internal', async () => {
    const res = await alice.get('/api/dashboard');
    const raw = JSON.stringify(res.body);
    for (const bad of ['myTasks', 'overdueTasks', 'hours', 'onboarding', 'monthlyRetainer', 'retainer', 'internalNotes', 'clientsByStatus', 'contentPipeline', 'approvalsWaiting',
      'SECRET-INTERNAL', 'INTERNAL-INV-NOTE', 'INTERNAL-CONTRACT-NOTE', 'INTERNAL-CONTENT-NOTE', 'INTERNAL-ACTIVITY', 'Late task A', 'Beta', 'B Video', 'Internal A', 'Internal idea']) {
      expect(raw).not.toContain(bad);
    }
    // shared invoices only: SENT (100) is outstanding + overdue; the DRAFT, the unshared one and clientB's invoice are invisible
    expect(res.body.invoices).toMatchObject({ outstandingTotal: 100, outstandingCount: 1, overdueCount: 1, overdueTotal: 100 });
    expect(res.body.contractsExpiring.count).toBe(1);
    expect(res.body.contractsExpiring.items.map((c: { name: string }) => c.name)).toEqual(['Retainer A']);
    expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(['Site A']);
    expect(typeof res.body.projects[0].progress).toBe('number');
    expect(res.body.upcomingContent.map((c: { title: string }) => c.title)).toEqual(['Shared post']);
    expect(res.body.pendingApprovals.map((d: { name: string }) => d.name)).toEqual(['A Banner']);
    expect(res.body.reportSummary).toMatchObject({ spend: 100 });
  });

  it('CLIENT activity feed carries clientVisible rows of its own company only, sanitised', async () => {
    const res = await alice.get('/api/dashboard');
    const feed = res.body.recentActivity as Array<Record<string, unknown>>;
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((r) => r.clientId === w.clientA.id)).toBe(true);
    expect(feed.map((r) => r.action)).toContain('DELIVERABLE_SUBMITTED');
    expect(feed.map((r) => r.action)).not.toContain('INTERNAL_NOTE_CREATED');
    const raw = JSON.stringify(feed);
    expect(raw).not.toContain('1.2.3.4'); // ip
    expect(raw).not.toContain('9.9.9.9'); // non-whitelisted metadata
    expect(raw).not.toContain('secret');
    expect(feed[0]).not.toHaveProperty('ip');
    expect(feed[0]).not.toHaveProperty('metadata');
    const bobFeed = JSON.stringify((await bob.get('/api/dashboard')).body.recentActivity);
    expect(bobFeed).toContain('B Video');
    expect(bobFeed).not.toContain('A Banner');
  });

  it('TEAM without finance permissions gets no invoices / contracts widgets; granting them adds the widgets, scoped to own clients', async () => {
    const before = (await teamA.get('/api/dashboard')).body;
    expect(before).not.toHaveProperty('invoices');
    expect(before).not.toHaveProperty('contractsExpiring');
    expect(before).not.toHaveProperty('hours.teamSec');
    expect(before.myTasks).toMatchObject({ open: 2, overdue: 1, dueToday: 1 });
    expect(before.myTasks.next.length).toBe(2);
    expect(before.projects.active).toBe(2);
    expect(before.projects.atRisk).toBe(2); // both due within 7 days
    expect(before.overdueTasks.total).toBe(1); // clientB's late task is out of scope

    await setPerms(w.teamA.id, [...DEFAULT_TEAM_PERMISSIONS, 'invoices.view', 'contracts.view', 'time.view_all']);
    const after = (await teamA.get('/api/dashboard')).body;
    expect(after.invoices).toMatchObject({ outstandingTotal: 150, outstandingCount: 2, overdueCount: 1, overdueTotal: 100, paidThisMonth: 70 });
    expect(after.contractsExpiring.count).toBe(2);
    expect(JSON.stringify(after)).not.toContain('INV-B-1');
    expect(after.hours.mineSec).toBeGreaterThanOrEqual(3600);
    expect(after.hours.teamSec).toBeGreaterThanOrEqual(3600);
    expect(after.hours.teamSec).toBeLessThan(3600 + 1800); // teamB's hours are out of scope
    await setPerms(w.teamA.id, null);
  });

  it('TEAM without tasks.view loses the task widgets', async () => {
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'tasks.view' && p !== 'content.view'));
    const res = (await teamA.get('/api/dashboard')).body;
    expect(res).not.toHaveProperty('myTasks');
    expect(res).not.toHaveProperty('overdueTasks');
    expect(res).not.toHaveProperty('contentPipeline');
    expect(res).toHaveProperty('projects');
    await setPerms(w.teamA.id, null);
  });

  it('ADMIN sees every widget across all clients', async () => {
    const res = (await admin.get('/api/dashboard')).body;
    for (const k of ['myTasks', 'overdueTasks', 'projects', 'upcomingDeadlines', 'contentPipeline', 'approvalsWaiting', 'clientsByStatus', 'onboarding', 'contractsExpiring', 'invoices', 'hours', 'recentActivity']) {
      expect(res).toHaveProperty(k);
    }
    expect(res.overdueTasks.total).toBe(2);
    expect(res.invoices.overdueCount).toBe(2);
    expect(res.invoices.overdueTotal).toBe(5100);
    expect(res.contractsExpiring.count).toBe(3);
    expect(res.approvalsWaiting.count).toBe(2);
    expect(res.approvalsWaiting.oldest.length).toBe(2);
    expect(res.clientsByStatus.ACTIVE).toBe(2);
    expect(res.onboarding.inProgress).toBe(1);
    expect(res.onboarding.lowest[0]).toMatchObject({ companyName: 'Alpha Co', done: 1, total: 2, progress: 50 });
    expect(res.contentPipeline.byStatus.IDEA).toBe(1);
    expect(res.contentPipeline.next7Days).toHaveLength(7);
    expect(res.contentPipeline.next7Days.reduce((a: number, d: { count: number }) => a + d.count, 0)).toBe(2);
    expect(res.upcomingDeadlines.length).toBeGreaterThan(0);
    expect(res.upcomingDeadlines.length).toBeLessThanOrEqual(10);
    expect(res.hours.teamSec).toBeGreaterThanOrEqual(5400);
    expect(res.recentActivity.length).toBeLessThanOrEqual(10);
    expect(res.recentActivity[0]).not.toHaveProperty('ip');
  });

  it('TEAM sees onboarding + clients only for assigned clients', async () => {
    const b = (await teamB.get('/api/dashboard')).body;
    expect(b.onboarding.inProgress).toBe(0);
    expect(b.clientsByStatus.ACTIVE).toBe(1);
    expect(JSON.stringify(b.recentActivity)).not.toContain('A Banner');
  });
});

describe('branding', () => {
  const logoRes = (agent: Agent, name = 'logo.png', buf: Buffer = tinyPng(), path = '/api/branding/logo') =>
    agent.post(path).attach('file', buf, { filename: name, contentType: 'application/octet-stream' });

  it('GET / is public and returns only the safe fields', async () => {
    const res = await request(app).get('/api/branding');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agencyName: 'Famolya', primaryColor: '#4f46e5', secondaryColor: '#0f172a', hasLogo: false, hasFavicon: false });
    expect(Object.keys(res.body).sort()).toEqual(['agencyName', 'contrastOk', 'hasFavicon', 'hasLogo', 'primaryColor', 'secondaryColor', 'updatedAt']);
    expect((await request(app).get('/api/branding/logo')).status).toBe(404);
    expect((await request(app).get('/api/branding/favicon')).status).toBe(404);
  });

  it('only ADMIN may change branding (401 / 403 otherwise)', async () => {
    expect((await request(app).put('/api/branding').send({ agencyName: 'X' })).status).toBe(401);
    for (const a of [teamA, alice]) {
      expect((await a.put('/api/branding').send({ agencyName: 'Hacked' })).status).toBe(403);
      expect((await logoRes(a)).status).toBe(403);
      expect((await logoRes(a, 'f.png', tinyPng(), '/api/branding/favicon')).status).toBe(403);
      expect((await a.delete('/api/branding/logo')).status).toBe(403);
    }
    expect((await request(app).get('/api/branding')).body.agencyName).toBe('Famolya');
  });

  it('PUT validates name and colours strictly', async () => {
    for (const bad of [{ primaryColor: 'red' }, { primaryColor: '#12345' }, { primaryColor: '#12345g' }, { secondaryColor: 'rgb(0,0,0)' }, { primaryColor: '#fff' }, { primaryColor: 'url(javascript:1)' }, { primaryColor: '#4f46e5; background:red' }]) {
      const r = await admin.put('/api/branding').send(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(Object.values(r.body.error.fields)).toContain('invalid_color');
    }
    expect((await admin.put('/api/branding').send({ agencyName: '   ' })).status).toBe(400);
    expect((await admin.put('/api/branding').send({ agencyName: 'x'.repeat(61) })).status).toBe(400);
    expect((await admin.put('/api/branding').send({ agencyName: 'Ok', role: 'ADMIN' })).status).toBe(400);
    expect((await admin.put('/api/branding').send({})).status).toBe(400);
  });

  it('ADMIN updates name + colours; the change is public, normalised and audited; low contrast is flagged', async () => {
    const res = await admin.put('/api/branding').send({ agencyName: '  Ufuq Studio  ', primaryColor: '#0F766E', secondaryColor: '#111827' });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ agencyName: 'Ufuq Studio', primaryColor: '#0f766e', secondaryColor: '#111827', contrastOk: true });
    const pub = await request(app).get('/api/branding');
    expect(pub.body).toMatchObject({ agencyName: 'Ufuq Studio', primaryColor: '#0f766e' });
    expect((await admin.put('/api/branding').send({ primaryColor: '#ffff00' })).body.item.contrastOk).toBe(false);
    const rows = await prisma.auditLog.findMany({ where: { action: 'BRANDING_UPDATED', entity: 'settings' } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].userId).toBe(w.admin.id);
    await admin.put('/api/branding').send({ agencyName: 'Famolya', primaryColor: '#4f46e5', secondaryColor: '#0f172a' });
  });

  it('rejects SVG, HTML, oversized files, wrong magic bytes and wrong extensions', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await logoRes(admin, 'logo.svg', svg)).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await logoRes(admin, 'logo.png', svg)).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED'); // SVG renamed to .png
    expect((await logoRes(admin, 'logo.png', Buffer.from('<html><script>1</script></html>'))).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await logoRes(admin, 'logo.png', Buffer.from('hello, not an image at all'))).body.error.code).toBe('FILE_CONTENT_MISMATCH');
    expect((await logoRes(admin, 'logo.jpg', tinyPng())).body.error.code).toBe('FILE_CONTENT_MISMATCH'); // PNG bytes, .jpg name
    expect((await logoRes(admin, 'logo.gif', Buffer.from('GIF89a......'))).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await logoRes(admin, 'logo.exe', tinyPng())).status).toBe(400);
    const big = Buffer.concat([tinyPng(), Buffer.alloc(1024 * 1024, 2)]);
    const r = await logoRes(admin, 'logo.png', big);
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('FILE_TOO_LARGE');
    const none = await admin.post('/api/branding/logo');
    expect(none.status).toBe(400);
    expect((await request(app).get('/api/branding')).body.hasLogo).toBe(false);
  });

  it('accepts a valid PNG logo, serves it publicly with safe headers + ETag, and removes it', async () => {
    const up = await logoRes(admin);
    expect(up.status).toBe(200);
    expect(up.body.item.hasLogo).toBe(true);
    const img = await request(app).get('/api/branding/logo');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.headers['cache-control']).toContain('max-age');
    const etag = img.headers.etag;
    expect(etag).toBeTruthy();
    expect((await request(app).get('/api/branding/logo').set('If-None-Match', etag)).status).toBe(304);
    // the stored key is server-derived, never the uploaded file name
    const row = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    expect(row?.logoKey).toMatch(/^[0-9a-f-]{36}\.png$/);
    // replacing deletes the old file and changes the ETag
    expect((await logoRes(admin)).status).toBe(200);
    expect((await request(app).get('/api/branding/logo')).headers.etag).not.toBe(etag);
    expect((await admin.delete('/api/branding/logo')).body.item.hasLogo).toBe(false);
    expect((await request(app).get('/api/branding/logo')).status).toBe(404);
  });

  it('accepts a favicon (ICO) and refuses it as a logo when the bytes lie', async () => {
    const ico = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(40, 3)]);
    const up = await logoRes(admin, 'favicon.ico', ico, '/api/branding/favicon');
    expect(up.status).toBe(200);
    const img = await request(app).get('/api/branding/favicon');
    expect(img.headers['content-type']).toContain('image/x-icon');
    expect((await admin.delete('/api/branding/favicon')).status).toBe(200);
  });
});

describe('permissions admin', () => {
  it('catalog is ADMIN only', async () => {
    expect((await request(app).get('/api/permissions/catalog')).status).toBe(401);
    expect((await teamA.get('/api/permissions/catalog')).status).toBe(403);
    expect((await alice.get('/api/permissions/catalog')).status).toBe(403);
    const res = await admin.get('/api/permissions/catalog');
    expect(res.status).toBe(200);
    expect(res.body.groups.length).toBeGreaterThan(5);
    expect(res.body.defaults).toEqual(DEFAULT_TEAM_PERMISSIONS);
    expect(res.body.adminOnly).toContain('audit_logs.view');
  });

  it('only ADMIN can change permissions (TEAM cannot even change their own)', async () => {
    const body = { permissions: ['clients.view'] };
    expect((await request(app).put(`/api/users/${w.teamA.id}/permissions`).send(body)).status).toBe(401);
    expect((await teamA.put(`/api/users/${w.teamA.id}/permissions`).send({ permissions: ['invoices.manage'] })).status).toBe(403);
    expect((await alice.put(`/api/users/${w.teamA.id}/permissions`).send(body)).status).toBe(403);
    expect((await teamA.get('/api/users')).status).toBe(403);
    expect((await teamA.post('/api/users').send({ name: 'x', email: 'x@x.test', password: 'Passw0rd!test', role: 'ADMIN' })).status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: w.teamA.id } }))?.permissions).toBeNull();
  });

  it('saves a TEAM list: deduped, ADMIN-only keys stripped, effective immediately on /api/me, audited with added/removed only', async () => {
    const list = ['tasks.view', 'invoices.view', 'invoices.view', 'audit_logs.view', 'clients.view'];
    const res = await admin.put(`/api/users/${w.teamA.id}/permissions`).send({ permissions: list });
    expect(res.status).toBe(200);
    expect(res.body.item.permissionsCustom).toBe(true);
    expect([...res.body.item.permissions].sort()).toEqual(['clients.view', 'invoices.view', 'tasks.view']);
    expect(JSON.parse((await prisma.user.findUnique({ where: { id: w.teamA.id } }))!.permissions!)).toEqual(['tasks.view', 'invoices.view', 'clients.view']);

    const me = await teamA.get('/api/me'); // same session, no re-login
    expect([...me.body.user.permissions].sort()).toEqual(['clients.view', 'invoices.view', 'tasks.view']);
    expect(me.body.user.permissions).not.toContain('audit_logs.view');
    expect((await teamA.get('/api/audit-logs')).status).toBe(403);

    const row = await prisma.auditLog.findFirst({ where: { action: 'USER_PERMISSIONS_CHANGED', entityId: w.teamA.id }, orderBy: { createdAt: 'desc' } });
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(w.admin.id);
    expect(row!.entity).toBe('user');
    const meta = JSON.parse(row!.metadata!);
    expect(Object.keys(meta).sort()).toEqual(['added', 'removed', 'reset']);
    expect(meta.added).toEqual(['invoices.view']);
    expect(meta.removed).toContain('files.upload');
    expect(meta.removed).not.toContain('invoices.view');
  });

  it('lists the effective permissions + custom flag in the user payloads', async () => {
    const list = await admin.get('/api/users?role=TEAM');
    const a = list.body.items.find((u: { id: string }) => u.id === w.teamA.id);
    const b = list.body.items.find((u: { id: string }) => u.id === w.teamB.id);
    expect(a.permissionsCustom).toBe(true);
    expect(b.permissionsCustom).toBe(false);
    expect(b.permissions.sort()).toEqual([...DEFAULT_TEAM_PERMISSIONS].sort());
    const detail = await admin.get(`/api/users/${w.teamA.id}`);
    expect(detail.body.item.permissionsCustom).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    const admins = (await admin.get('/api/users?role=ADMIN')).body.items[0];
    expect(admins.permissionsCustom).toBe(false);
    expect(admins.permissions).toContain('audit_logs.view');
    expect((await admin.get('/api/users?role=CLIENT')).body.items[0].permissions).toEqual([]);
  });

  it('null resets to the defaults', async () => {
    const res = await admin.put(`/api/users/${w.teamA.id}/permissions`).send({ permissions: null });
    expect(res.status).toBe(200);
    expect(res.body.item.permissionsCustom).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: w.teamA.id } }))?.permissions).toBeNull();
    expect([...(await teamA.get('/api/me')).body.user.permissions].sort()).toEqual([...DEFAULT_TEAM_PERMISSIONS].sort());
    const row = await prisma.auditLog.findFirst({ where: { action: 'USER_PERMISSIONS_CHANGED', entityId: w.teamA.id }, orderBy: { createdAt: 'desc' } });
    expect(JSON.parse(row!.metadata!).reset).toBe(true);
  });

  it('an empty list is valid (no permissions at all)', async () => {
    expect((await admin.put(`/api/users/${w.teamC.id}/permissions`).send({ permissions: [] })).body.item.permissions).toEqual([]);
    await admin.put(`/api/users/${w.teamC.id}/permissions`).send({ permissions: null });
  });

  it('rejects unknown keys, bad shapes, ADMIN and CLIENT targets, unknown users', async () => {
    const put = (id: string, body: unknown) => admin.put(`/api/users/${id}/permissions`).send(body as object);
    expect((await put(w.teamB.id, { permissions: ['clients.view', 'root.everything'] })).body.error.fields.permissions).toBe('invalid_choice');
    expect((await put(w.teamB.id, { permissions: 'clients.view' })).status).toBe(400);
    expect((await put(w.teamB.id, {})).status).toBe(400);
    expect((await put(w.teamB.id, { permissions: [], extra: 1 })).status).toBe(400);
    const cl = await put(w.userA.id, { permissions: ['clients.view'] });
    expect(cl.status).toBe(400);
    expect(cl.body.error.code).toBe('PERMISSIONS_TEAM_ONLY');
    expect((await put(w.admin.id, { permissions: [] })).status).toBe(400);
    expect((await put('doesnotexist123', { permissions: [] })).status).toBe(404);
    expect((await prisma.user.findUnique({ where: { id: w.userA.id } }))?.permissions).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: w.teamB.id } }))?.permissions).toBeNull();
  });

  it('a stored permission list on a CLIENT / ADMIN is ignored by /api/me and the scope', async () => {
    await prisma.user.update({ where: { id: w.userB.id }, data: { permissions: JSON.stringify(['invoices.view', 'clients.view']) } });
    expect((await bob.get('/api/me')).body.user.permissions).toEqual([]);
    expect((await bob.get('/api/dashboard')).body).not.toHaveProperty('myTasks');
    await prisma.user.update({ where: { id: w.userB.id }, data: { permissions: null } });
  });

  it('changing a TEAM member to another role drops the stored custom list; deactivating ends the sessions', async () => {
    await admin.put(`/api/users/${w.teamC.id}/permissions`).send({ permissions: ['tasks.view'] });
    const c = await loginAs('teamc@t.test');
    expect((await c.get('/api/me')).status).toBe(200);
    expect((await admin.patch(`/api/users/${w.teamC.id}`).send({ status: 'INACTIVE' })).status).toBe(200);
    expect([401, 403]).toContain((await c.get('/api/me')).status);
    await admin.patch(`/api/users/${w.teamC.id}`).send({ status: 'ACTIVE', role: 'ADMIN' });
    expect((await prisma.user.findUnique({ where: { id: w.teamC.id } }))?.permissions).toBeNull();
    await admin.patch(`/api/users/${w.teamC.id}`).send({ role: 'TEAM' });
  });
});

describe('audit log', () => {
  beforeAll(async () => {
    const mk = (data: Record<string, unknown>) => prisma.auditLog.create({ data: { action: 'TASK_CREATED', entity: 'task', ...data } as never });
    await mk({ userId: w.teamB.id, action: 'REPORT_CREATED', entity: 'report', entityId: '=HYPERLINK("http://evil","x")', metadata: JSON.stringify({ name: 'Q1', password: 'hunter2', nested: { apiToken: 'tok', ok: 1 } }), clientId: w.clientB.id, ip: '5.6.7.8' });
    await mk({ userId: w.teamA.id, entityId: '+1+1', metadata: JSON.stringify({ title: 'a, "quoted"\nline' }), clientId: w.clientA.id });
    for (let i = 0; i < 5; i++) await mk({ userId: w.teamA.id, entityId: `bulk-${i}`, clientId: w.clientA.id });
  });

  it('is ADMIN only', async () => {
    for (const path of ['/api/audit-logs', '/api/audit-logs/export.csv']) {
      expect((await request(app).get(path)).status).toBe(401);
      expect((await teamA.get(path)).status).toBe(403);
      expect((await alice.get(path)).status).toBe(403);
    }
    expect((await admin.get('/api/audit-logs')).status).toBe(200);
  });

  it('filters by user, action, entity, client, date range and free text; paginates', async () => {
    const get = (qs: string) => admin.get(`/api/audit-logs?${qs}`);
    const byUser = await get(`userId=${w.teamB.id}&action=REPORT_CREATED`);
    expect(byUser.body.items.length).toBe(1);
    expect(byUser.body.items[0]).toMatchObject({ action: 'REPORT_CREATED', entity: 'report', ip: '5.6.7.8', user: { name: 'Team B', email: 'teamb@t.test', role: 'TEAM' } });
    expect((await get('entity=task')).body.items.every((r: { entity: string }) => r.entity === 'task')).toBe(true);
    const byClient = await get(`clientId=${w.clientB.id}`);
    expect(byClient.body.items.every((r: { clientId: string }) => r.clientId === w.clientB.id)).toBe(true);
    expect(byClient.body.items.length).toBeGreaterThan(0);
    expect((await get('q=bulk-3')).body.items.length).toBe(1);
    expect((await get('q=REPORT_')).body.items.length).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`from=${today}&to=${today}`)).body.meta.total).toBeGreaterThan(5);
    expect((await get('to=2000-01-01')).body.meta.total).toBe(0);
    expect((await get('from=nonsense')).status).toBe(400);
    const p1 = await get('entity=task&pageSize=2&page=1');
    const p2 = await get('entity=task&pageSize=2&page=2');
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect(p1.body.meta.totalPages).toBeGreaterThan(1);
    expect(p1.body.items[0].id).not.toBe(p2.body.items[0].id);
  });

  it('redacts secret-looking metadata keys', async () => {
    const r = (await admin.get('/api/audit-logs?action=REPORT_CREATED')).body.items[0];
    expect(r.metadata).toMatchObject({ name: 'Q1', password: '[redacted]', nested: { apiToken: '[redacted]', ok: 1 } });
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });

  it('exports a CSV: BOM, attachment, quoting, formula injection neutralised, filters applied', async () => {
    const res = await admin.get('/api/audit-logs/export.csv').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const csv = res.body as unknown as string;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('createdAt,user,email,role,action,entity,entityId,clientId,projectId,ip,metadata');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv).toContain("'+1+1");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain('"{""title"":""a, \\""quoted\\""\\nline""}"'); // embedded comma/quote/newline are escaped
    expect(csv).not.toContain('hunter2');
    const filtered = (await admin.get(`/api/audit-logs/export.csv?action=REPORT_CREATED`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
    })).body as unknown as string;
    expect(filtered.trim().split('\r\n')).toHaveLength(2);
    expect((await admin.get('/api/audit-logs/export.csv?from=bad')).status).toBe(400);
  });
});
