import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TEAM_PERMISSIONS } from '../../../shared/src/permissions';
import { hashPassword } from '../auth/password';
import { prisma } from '../db';
import { PASSWORD, buildWorld, loginAs, type Agent, type World } from './helpers';

let w: World;
let alice: Agent;
let bob: Agent;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;
let teamC: Agent;

const SECRET_INTERNAL = 'TOPSECRET-internal-client-note';
const SECRET_NOTE = 'TOPSECRET-internal-note-text';
const SECRET_CONTACT = 'TOPSECRET-contact-note';
const SECRET_LEAD = 'TOPSECRET-lead-source';
const RETAINER = 4321.5;

/** Saves a custom permission list for a team member (the API reads it on every request). */
const setPerms = (userId: string, list: string[] | null) =>
  prisma.user.update({ where: { id: userId }, data: { permissions: list ? JSON.stringify(list) : null } });

const audits = (action: string, entityId?: string) => prisma.auditLog.findMany({ where: { action, ...(entityId ? { entityId } : {}) } });
const ids = (res: { body: { items: Array<{ id: string }> } }) => res.body.items.map((i) => i.id);

beforeAll(async () => {
  w = await buildWorld();
  [alice, bob, admin, teamA, teamB, teamC] = await Promise.all(
    ['alice@alpha.test', 'bob@beta.test', 'admin@t.test', 'teama@t.test', 'teamb@t.test', 'teamc@t.test'].map((e) => loginAs(e)),
  );
});

describe('clients: scope + CLIENT whitelist', () => {
  it('CLIENT cannot read another client, TEAM cannot read an unassigned client, ADMIN reads all', async () => {
    expect((await alice.get(`/api/clients/${w.clientB.id}`)).status).toBe(404);
    expect((await alice.get(`/api/clients/${w.clientA.id}`)).status).toBe(200);
    expect((await teamA.get(`/api/clients/${w.clientB.id}`)).status).toBe(404);
    expect((await teamB.get(`/api/clients/${w.clientA.id}`)).status).toBe(404);
    expect(ids(await alice.get('/api/clients'))).toEqual([w.clientA.id]);
    expect(ids(await teamA.get('/api/clients'))).toEqual([w.clientA.id]);
    expect(ids(await admin.get('/api/clients')).sort()).toEqual([w.clientA.id, w.clientB.id].sort());
    expect((await admin.get(`/api/clients/${w.clientB.id}`)).status).toBe(200);
  });

  it('the account manager must be an ACTIVE admin / team member', async () => {
    const bad = await admin.patch(`/api/clients/${w.clientA.id}`).send({ accountManagerId: w.userA.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.accountManagerId).toBe('invalid_choice');
    const create = await admin.post('/api/clients').send({ name: 'N', companyName: 'Bad Manager Co', email: 'n@bm.test', accountManagerId: w.userB.id });
    expect(create.status).toBe(400);
    expect(create.body.error.fields.accountManagerId).toBe('invalid_choice');
    expect(await prisma.client.count({ where: { companyName: 'Bad Manager Co' } })).toBe(0);
    const inactive = await prisma.user.create({ data: { name: 'Gone', email: 'gone@t.test', role: 'TEAM', status: 'INACTIVE', passwordHash: await hashPassword(PASSWORD) } });
    expect((await admin.patch(`/api/clients/${w.clientA.id}`).send({ accountManagerId: inactive.id })).status).toBe(400);
    expect((await admin.patch(`/api/clients/${w.clientA.id}`).send({ accountManagerId: 'nope-nope' })).status).toBe(400);
  });

  it('admin fills the CRM fields; validation rejects unsafe / invalid values', async () => {
    expect((await admin.patch(`/api/clients/${w.clientA.id}`).send({ website: 'javascript:alert(1)' })).body.error.fields.website).toBe('invalid_url');
    expect((await admin.patch(`/api/clients/${w.clientA.id}`).send({ monthlyRetainer: -5 })).status).toBe(400);
    expect((await admin.patch(`/api/clients/${w.clientA.id}`).send({ clientType: 'GALAXY' })).status).toBe(400);
    expect((await admin.patch(`/api/clients/${w.clientA.id}`).send({ contractStart: '2026-05-01', contractEnd: '2026-01-01' })).body.error.fields.contractEnd).toBe('end_before_start');
    expect((await admin.patch(`/api/clients/${w.clientA.id}`).send({ mystery: 1 })).status).toBe(400); // strict
    const ok = await admin.patch(`/api/clients/${w.clientA.id}`).send({
      industry: 'Retail', website: 'https://alpha.example', city: 'Cairo', country: 'Egypt', address: '1 Nile St', leadSource: SECRET_LEAD, clientType: 'STARTUP',
      tags: ['vip', 'retail', 'vip'], notes: 'Visible note for the client', internalNotes: SECRET_INTERNAL, monthlyRetainer: RETAINER,
      accountManagerId: w.teamA.id, clientSince: '2025-01-15', contractStart: '2026-01-01', contractEnd: '2026-12-31',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.item).toMatchObject({ industry: 'Retail', clientType: 'STARTUP', tags: ['vip', 'retail'], accountManagerId: w.teamA.id, monthlyRetainer: RETAINER, internalNotes: SECRET_INTERNAL });
    expect(ok.body.item.contractEnd).toContain('2026-12-31');
  });

  it('CLIENT responses never contain internal fields (detail, list, patch attempts)', async () => {
    const detail = await alice.get(`/api/clients/${w.clientA.id}`);
    const list = await alice.get('/api/clients');
    for (const res of [detail, list]) {
      const text = JSON.stringify(res.body);
      for (const secret of [SECRET_INTERNAL, SECRET_LEAD, String(RETAINER), 'internalNotes', 'monthlyRetainer', 'leadSource', 'accountManager', 'onboardingStatus', '"contractEnd"', '"contractStart"', 'clientType']) {
        expect(text).not.toContain(secret);
      }
    }
    expect(detail.body.item).toMatchObject({ industry: 'Retail', notes: 'Visible note for the client', website: 'https://alpha.example' });
    expect(detail.body.item.tags).toBeUndefined();
    expect(detail.body.item.users).toBeUndefined();
    expect((await alice.patch(`/api/clients/${w.clientA.id}`).send({ notes: 'hax' })).status).toBe(403);
    expect((await alice.post('/api/clients').send({})).status).toBe(403);
    expect((await alice.delete(`/api/clients/${w.clientA.id}`)).status).toBe(403);
  });

  it('detail summary counts respect scope: CLIENT gets no internal counts and no unsent drafts', async () => {
    await prisma.task.create({ data: { title: 'Internal task', clientId: w.clientA.id, status: 'TODO' } });
    const c = (await alice.get(`/api/clients/${w.clientA.id}`)).body.item;
    expect(c.summary.deliverables).toBe(1); // draftA was never sent to the client
    expect(c.summary.openTasks).toBeUndefined();
    expect(c._count.deliverables).toBe(1);
    expect(c.summary).toMatchObject({ campaigns: 2, openRequests: 1, deliverablesPending: 1 });
    expect(JSON.stringify(c)).not.toContain('onboarding');
    const a = (await admin.get(`/api/clients/${w.clientA.id}`)).body.item;
    expect(a.summary).toMatchObject({ deliverables: 2, openTasks: 1, campaigns: 2 });
    expect(a.primaryContact).toBeNull();
    // teamB / teamC-like scope: the counts only include what they can see
    const bDetail = (await bob.get(`/api/clients/${w.clientB.id}`)).body.item;
    expect(bDetail.summary.campaigns).toBe(1);
  });

  it('TEAM sees what its permissions allow: internal notes need notes.internal, retainer needs finance access', async () => {
    const team = (await teamA.get(`/api/clients/${w.clientA.id}`)).body.item;
    expect(team.internalNotes).toBe(SECRET_INTERNAL);
    expect(team.monthlyRetainer).toBeUndefined();
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'notes.internal'));
    const noNotes = (await teamA.get(`/api/clients/${w.clientA.id}`)).body.item;
    expect(noNotes.internalNotes).toBeUndefined();
    expect(JSON.stringify((await teamA.get('/api/clients')).body)).not.toContain(SECRET_INTERNAL);
    await setPerms(w.teamA.id, [...DEFAULT_TEAM_PERMISSIONS, 'invoices.view']);
    expect((await teamA.get(`/api/clients/${w.clientA.id}`)).body.item.monthlyRetainer).toBe(RETAINER);
    await setPerms(w.teamA.id, []);
    expect((await teamA.get('/api/clients')).status).toBe(403);
    expect((await teamA.get(`/api/clients/${w.clientA.id}`)).status).toBe(403);
    await setPerms(w.teamA.id, null);
  });

  it('create / edit / archive permissions are enforced', async () => {
    expect((await teamA.post('/api/clients').send({ name: 'x', companyName: 'x', email: 'x@x.test' })).status).toBe(403);
    expect((await teamA.patch(`/api/clients/${w.clientA.id}`).send({ industry: 'Hack' })).status).toBe(403);
    await setPerms(w.teamA.id, [...DEFAULT_TEAM_PERMISSIONS, 'clients.edit']);
    expect((await teamA.patch(`/api/clients/${w.clientA.id}`).send({ industry: 'Retail & Food' })).status).toBe(200);
    expect((await teamA.patch(`/api/clients/${w.clientB.id}`).send({ industry: 'Nope' })).status).toBe(404);
    expect((await teamA.patch(`/api/clients/${w.clientA.id}`).send({ monthlyRetainer: 1 })).status).toBe(403); // needs finance manage
    expect((await teamA.patch(`/api/clients/${w.clientA.id}`).send({ status: 'ARCHIVED' })).status).toBe(403); // needs clients.delete
    expect((await teamA.delete(`/api/clients/${w.clientA.id}`)).status).toBe(403);
    // a team member who only sees a client through one campaign cannot edit it
    await setPerms(w.teamC.id, [...DEFAULT_TEAM_PERMISSIONS, 'clients.edit']);
    expect((await teamC.get(`/api/clients/${w.clientA.id}`)).status).toBe(200);
    expect((await teamC.patch(`/api/clients/${w.clientA.id}`).send({ industry: 'Nope' })).status).toBe(403);
    await setPerms(w.teamC.id, null);
    await setPerms(w.teamA.id, null);
  });

  it('team member with clients.create can create and keeps access to the new client', async () => {
    await setPerms(w.teamB.id, [...DEFAULT_TEAM_PERMISSIONS, 'clients.create']);
    const res = await teamB.post('/api/clients').send({ name: 'Tina', companyName: 'Team Made Co', email: 'tina@tm.test', accountManagerId: w.teamA.id });
    expect(res.status).toBe(400); // cannot make somebody else manager: that would grant them access
    const ok = await teamB.post('/api/clients').send({ name: 'Tina', companyName: 'Team Made Co', email: 'tina@tm.test', accountManagerId: w.teamB.id });
    expect(ok.status).toBe(201);
    expect((await teamB.get(`/api/clients/${ok.body.item.id}`)).status).toBe(200);
    expect((await teamA.get(`/api/clients/${ok.body.item.id}`)).status).toBe(404);
    await setPerms(w.teamB.id, null);
  });

  it('status changes write audit rows; archiving keeps the data; onboarding checklist is created once', async () => {
    const created = await admin.post('/api/clients').send({ name: 'Zoe', companyName: 'Zoe Studio', email: 'zoe@zs.test', status: 'LEAD', tags: ['inbound'] });
    expect(created.status).toBe(201);
    const id = created.body.item.id as string;
    expect((await audits('CLIENT_CREATED', id)).length).toBe(1);
    expect(created.body.item.onboardingStatus).toBe('NOT_STARTED');
    expect(await prisma.onboardingItem.count({ where: { clientId: id } })).toBe(0);

    const pro = await admin.patch(`/api/clients/${id}`).send({ status: 'PROSPECT' });
    expect(pro.status).toBe(200);
    const changed = await audits('CLIENT_STATUS_CHANGED', id);
    expect(changed.length).toBe(1);
    expect(JSON.parse(changed[0].metadata ?? '{}')).toMatchObject({ from: 'LEAD', to: 'PROSPECT' });

    const onb = await admin.patch(`/api/clients/${id}`).send({ status: 'ONBOARDING' });
    expect(onb.body.item.onboardingStatus).toBe('IN_PROGRESS');
    expect(await prisma.onboardingItem.count({ where: { clientId: id } })).toBe(8);
    await admin.patch(`/api/clients/${id}`).send({ status: 'ACTIVE' });
    await admin.patch(`/api/clients/${id}`).send({ status: 'PAUSED' });
    await admin.patch(`/api/clients/${id}`).send({ status: 'ACTIVE' });
    expect(await prisma.onboardingItem.count({ where: { clientId: id } })).toBe(8); // not duplicated

    expect((await admin.patch(`/api/clients/${id}`).send({ status: 'ARCHIVED' })).status).toBe(200);
    expect((await audits('CLIENT_ARCHIVED', id)).length).toBe(1);
    expect(await prisma.client.count({ where: { id } })).toBe(1);
    expect((await admin.delete(`/api/clients/${id}`)).status).toBe(200); // idempotent, never removes the row
    expect(await prisma.client.count({ where: { id } })).toBe(1);
    expect(await prisma.onboardingItem.count({ where: { clientId: id } })).toBe(8);
  });

  it('a client created as ACTIVE (the default) gets the default checklist', async () => {
    const res = await admin.post('/api/clients').send({ name: 'Act', companyName: 'Active Default Co', email: 'act@ad.test' });
    expect(res.body.item.onboardingStatus).toBe('IN_PROGRESS');
    expect(await prisma.onboardingItem.count({ where: { clientId: res.body.item.id } })).toBe(8);
  });

  it('list filters: q, status, clientType, accountManagerId, industry, tag (staff-only filters ignored for CLIENT)', async () => {
    expect(ids(await admin.get('/api/clients?q=Retail'))).toContain(w.clientA.id);
    expect(ids(await admin.get('/api/clients?clientType=STARTUP'))).toEqual([w.clientA.id]);
    expect(ids(await admin.get(`/api/clients?accountManagerId=${w.teamA.id}`))).toEqual([w.clientA.id]);
    expect(ids(await admin.get('/api/clients?industry=Retail'))).toContain(w.clientA.id);
    expect(ids(await admin.get('/api/clients?tag=vip'))).toEqual([w.clientA.id]);
    expect(ids(await admin.get('/api/clients?tag=vi'))).toEqual([]);
    expect(ids(await admin.get('/api/clients?status=ARCHIVED')).length).toBeGreaterThanOrEqual(1);
    // a client user cannot use internal fields as a filter (nothing leaks through the result count)
    expect(ids(await alice.get(`/api/clients?accountManagerId=${w.teamB.id}`))).toEqual([w.clientA.id]);
    expect(ids(await alice.get('/api/clients?tag=nothing'))).toEqual([w.clientA.id]);
  });
});

describe('contacts', () => {
  let c1: string;
  let c2: string;
  let hidden: string;

  it('first contact becomes primary; exactly one primary contact per client', async () => {
    const r1 = await admin.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Ann Owner', jobTitle: 'CEO', email: 'ann@alpha.test', phone: '+20 1', whatsapp: '+20 1' });
    expect(r1.status).toBe(201);
    expect(r1.body.item.isPrimary).toBe(true);
    c1 = r1.body.item.id;
    const r2 = await admin.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Bill Billing', email: 'bill@alpha.test', isPrimary: true });
    c2 = r2.body.item.id;
    const r3 = await admin.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Hidden Person', visibleToClient: false, notes: SECRET_CONTACT, email: '' });
    hidden = r3.body.item.id;
    expect(r3.body.item.email).toBeNull();
    const primaries = await prisma.clientContact.findMany({ where: { clientId: w.clientA.id, isPrimary: true } });
    expect(primaries.map((p) => p.id)).toEqual([c2]);
    // promoting through PATCH demotes the others, in one go
    const promote = await admin.patch(`/api/contacts/${c1}`).send({ isPrimary: true });
    expect(promote.status).toBe(200);
    expect((await prisma.clientContact.findMany({ where: { clientId: w.clientA.id, isPrimary: true } })).map((p) => p.id)).toEqual([c1]);
    // the primary cannot be "un-primaried" (that would leave the company without one)
    await admin.patch(`/api/contacts/${c1}`).send({ isPrimary: false });
    expect((await prisma.clientContact.findMany({ where: { clientId: w.clientA.id, isPrimary: true } })).length).toBe(1);
    expect((await admin.get(`/api/clients/${w.clientA.id}`)).body.item.primaryContact.name).toBe('Ann Owner');
  });

  it('validation', async () => {
    expect((await admin.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Bad', email: 'not-an-email' })).body.error.fields.email).toBe('invalid_email');
    expect((await admin.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: '' })).status).toBe(400);
    expect((await admin.patch(`/api/contacts/${c2}`).send({ clientId: w.clientB.id })).status).toBe(400); // strict: cannot move
  });

  it('CLIENT sees only visible contacts of its own company and never the notes', async () => {
    const res = await alice.get(`/api/clients/${w.clientA.id}/contacts`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id).sort()).toEqual([c1, c2].sort());
    expect(JSON.stringify(res.body)).not.toContain(SECRET_CONTACT);
    expect(JSON.stringify(res.body)).not.toContain('Hidden Person');
    for (const c of res.body.items) expect('notes' in c).toBe(false);
    // staff see the internal notes
    const staff = await admin.get(`/api/clients/${w.clientA.id}/contacts`);
    expect(staff.body.items.find((c: { id: string }) => c.id === hidden).notes).toBe(SECRET_CONTACT);
    expect((await bob.get(`/api/clients/${w.clientA.id}/contacts`)).status).toBe(404);
  });

  it('CLIENT cannot write contacts; TEAM only on assigned clients', async () => {
    expect((await alice.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Mallory' })).status).toBe(403);
    expect((await alice.patch(`/api/contacts/${c1}`).send({ name: 'Mallory' })).status).toBe(403);
    expect((await alice.delete(`/api/contacts/${c1}`)).status).toBe(403);
    expect((await teamB.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Nope' })).status).toBe(404);
    expect((await teamB.patch(`/api/contacts/${c1}`).send({ name: 'Nope' })).status).toBe(404);
    expect((await teamB.delete(`/api/contacts/${c1}`)).status).toBe(404);
    expect((await teamB.get(`/api/clients/${w.clientA.id}/contacts`)).status).toBe(404);
    expect((await teamC.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Nope' })).status).toBe(404); // campaign-only access
    const ok = await teamA.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'Team Added' });
    expect(ok.status).toBe(201);
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'contacts.manage'));
    expect((await teamA.post(`/api/clients/${w.clientA.id}/contacts`).send({ name: 'No perm' })).status).toBe(403);
    expect((await teamA.get(`/api/clients/${w.clientA.id}/contacts`)).status).toBe(200);
    await setPerms(w.teamA.id, null);
  });

  it('deleting the primary promotes another contact; audit rows exist', async () => {
    expect((await admin.delete(`/api/contacts/${c1}`)).status).toBe(200);
    const left = await prisma.clientContact.findMany({ where: { clientId: w.clientA.id } });
    expect(left.filter((c) => c.isPrimary).length).toBe(1);
    expect(left.some((c) => c.id === c1)).toBe(false);
    expect((await audits('CONTACT_CREATED')).length).toBeGreaterThanOrEqual(4);
    expect((await audits('CONTACT_UPDATED')).length).toBeGreaterThanOrEqual(1);
    expect((await audits('CONTACT_DELETED', c1)).length).toBe(1);
    // contact rows are internal: never flagged client-visible
    expect((await prisma.auditLog.count({ where: { entity: 'contact', clientVisible: true } }))).toBe(0);
  });
});

describe('onboarding', () => {
  let itemIds: string[] = [];

  it('CLIENT is locked out of every onboarding endpoint', async () => {
    expect((await alice.get(`/api/clients/${w.clientA.id}/onboarding`)).status).toBe(403);
    expect((await alice.post(`/api/clients/${w.clientA.id}/onboarding`).send({ title: 'x' })).status).toBe(403);
    expect((await alice.post(`/api/clients/${w.clientA.id}/onboarding/start`).send({})).status).toBe(403);
    expect((await alice.get('/api/onboarding')).status).toBe(403);
  });

  it('start creates the default checklist once; progress and onboardingStatus stay in sync', async () => {
    const start = await admin.post(`/api/clients/${w.clientA.id}/onboarding/start`).send({});
    expect(start.status).toBe(201);
    expect(start.body.items.length).toBe(8);
    expect(start.body.progress).toMatchObject({ total: 8, done: 0, percent: 0 });
    expect(start.body.onboardingStatus).toBe('IN_PROGRESS');
    const again = await admin.post(`/api/clients/${w.clientA.id}/onboarding/start`).send({});
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.items.length).toBe(8);
    expect((await audits('ONBOARDING_STARTED')).length).toBe(1);
    itemIds = start.body.items.map((i: { id: string }) => i.id);

    const done = await admin.patch(`/api/onboarding/${itemIds[0]}`).send({ done: true });
    expect(done.status).toBe(200);
    expect(done.body.item.completedById).toBe(w.admin.id);
    expect(done.body.item.completedAt).toBeTruthy();
    const get = await teamA.get(`/api/clients/${w.clientA.id}/onboarding`);
    expect(get.body.progress).toMatchObject({ total: 8, done: 1, percent: 13 });
    // who/when cannot be forged
    expect((await admin.patch(`/api/onboarding/${itemIds[1]}`).send({ completedById: w.teamA.id })).status).toBe(400);

    for (const id of itemIds.slice(1)) await admin.patch(`/api/onboarding/${id}`).send({ done: true });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: w.clientA.id } })).onboardingStatus).toBe('COMPLETED');
    const reopen = await teamA.patch(`/api/onboarding/${itemIds[3]}`).send({ done: false });
    expect(reopen.body.item.completedAt).toBeNull();
    expect(reopen.body.item.completedById).toBeNull();
    expect((await prisma.client.findUniqueOrThrow({ where: { id: w.clientA.id } })).onboardingStatus).toBe('IN_PROGRESS');
    expect((await audits('ONBOARDING_ITEM_UPDATED')).length).toBeGreaterThanOrEqual(9);
    // internal: never client visible
    expect(await prisma.auditLog.count({ where: { entity: 'onboarding_item', clientVisible: true } })).toBe(0);
  });

  it('add / assign / notify / delete', async () => {
    const bad = await teamA.post(`/api/clients/${w.clientA.id}/onboarding`).send({ title: 'Custom', assignedToId: w.userA.id });
    expect(bad.status).toBe(400);
    expect((await teamA.post(`/api/clients/${w.clientA.id}/onboarding`).send({ title: 'Custom', assignedToId: w.teamB.id })).status).toBe(400); // not on this client
    const add = await admin.post(`/api/clients/${w.clientA.id}/onboarding`).send({ title: 'Custom step', assignedToId: w.teamA.id, dueDate: '2020-01-01' });
    expect(add.status).toBe(201);
    expect(add.body.item.position).toBe(8);
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'ONBOARDING_ITEM_ASSIGNED' } })).toBe(1);
    expect((await audits('ONBOARDING_ITEM_ADDED')).length).toBe(1);
    // reassigning to somebody else notifies the new assignee (not yourself)
    await teamA.patch(`/api/onboarding/${add.body.item.id}`).send({ assignedToId: w.teamA.id });
    expect(await prisma.notification.count({ where: { userId: w.teamA.id, type: 'ONBOARDING_ITEM_ASSIGNED' } })).toBe(1);

    const dash = await teamA.get('/api/onboarding');
    expect(dash.status).toBe(200);
    const row = dash.body.items.find((c: { id: string }) => c.id === w.clientA.id);
    expect(row.progress.total).toBe(9);
    expect(row.progress.percent).toBeGreaterThanOrEqual(0);
    expect(row.progress.percent).toBeLessThanOrEqual(100);
    expect(row.progress.overdue).toBe(1);
    expect(row.nextItem).toBeTruthy();
    expect(row.myOpenItems).toBe(1);
    expect(dash.body.items.find((c: { id: string }) => c.id === w.clientB.id)).toBeUndefined();
    expect(dash.body.summary.overdueItems).toBe(1);
    expect(ids(await teamA.get('/api/onboarding?mine=1'))).toEqual([w.clientA.id]);
    expect(ids(await teamA.get('/api/onboarding?overdue=1'))).toEqual([w.clientA.id]);

    expect((await admin.delete(`/api/onboarding/${add.body.item.id}`)).status).toBe(200);
    expect((await audits('ONBOARDING_ITEM_DELETED', add.body.item.id)).length).toBe(1);
    expect((await admin.get(`/api/clients/${w.clientA.id}/onboarding`)).body.items.length).toBe(8);
  });

  it('team scope and permissions', async () => {
    expect((await teamB.get(`/api/clients/${w.clientA.id}/onboarding`)).status).toBe(404);
    expect((await teamB.patch(`/api/onboarding/${itemIds[0]}`).send({ done: false })).status).toBe(404);
    expect((await teamB.delete(`/api/onboarding/${itemIds[0]}`)).status).toBe(404);
    expect((await teamC.get(`/api/clients/${w.clientA.id}/onboarding`)).status).toBe(404); // campaign-only access
    expect((await teamC.patch(`/api/onboarding/${itemIds[0]}`).send({ done: false })).status).toBe(404);
    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'onboarding.manage'));
    expect((await teamA.get(`/api/clients/${w.clientA.id}/onboarding`)).status).toBe(200);
    expect((await teamA.patch(`/api/onboarding/${itemIds[0]}`).send({ done: false })).status).toBe(403);
    expect((await teamA.post(`/api/clients/${w.clientA.id}/onboarding`).send({ title: 'x' })).status).toBe(403);
    expect((await teamA.delete(`/api/onboarding/${itemIds[0]}`)).status).toBe(403);
    await setPerms(w.teamA.id, null);
    expect((await admin.patch(`/api/onboarding/${itemIds[0]}`).send({ done: 'yes' })).status).toBe(400);
  });
});

describe('internal notes (staff only)', () => {
  let noteId: string;
  let pinnedId: string;

  it('CLIENT gets 403 on every internal-notes route', async () => {
    const created = await teamA.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: SECRET_NOTE });
    expect(created.status).toBe(201);
    noteId = created.body.item.id;
    expect(created.body.item.authorId).toBe(w.teamA.id); // from the session
    expect((await alice.get(`/api/clients/${w.clientA.id}/internal-notes`)).status).toBe(403);
    expect((await alice.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: 'x' })).status).toBe(403);
    expect((await alice.patch(`/api/internal-notes/${noteId}`).send({ body: 'x' })).status).toBe(403);
    expect((await alice.delete(`/api/internal-notes/${noteId}`)).status).toBe(403);
    expect((await bob.get(`/api/clients/${w.clientA.id}/internal-notes`)).status).toBe(403);
    expect(await prisma.internalNote.count({ where: { id: noteId } })).toBe(1);
  });

  it('list is scoped, pinned first, author cannot be forged; project links are validated', async () => {
    expect((await teamA.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: 'x', authorId: w.admin.id })).status).toBe(201); // extra key ignored
    expect((await prisma.internalNote.findMany({ where: { body: 'x' } })).every((n) => n.authorId === w.teamA.id)).toBe(true);
    const pinned = await admin.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: 'Pinned by admin', pinned: true });
    pinnedId = pinned.body.item.id;
    const list = await teamA.get(`/api/clients/${w.clientA.id}/internal-notes`);
    expect(list.body.items[0].id).toBe(pinnedId);
    expect(list.body.items.some((n: { id: string }) => n.id === noteId)).toBe(true);
    expect((await teamB.get(`/api/clients/${w.clientA.id}/internal-notes`)).status).toBe(404);
    expect((await teamC.get(`/api/clients/${w.clientA.id}/internal-notes`)).status).toBe(404);
    expect((await teamB.patch(`/api/internal-notes/${noteId}`).send({ body: 'nope' })).status).toBe(404);
    expect((await teamB.delete(`/api/internal-notes/${noteId}`)).status).toBe(404);

    const projA = await prisma.project.create({ data: { name: 'Proj A', clientId: w.clientA.id } });
    const projB = await prisma.project.create({ data: { name: 'Proj B', clientId: w.clientB.id } });
    const onProject = await teamA.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: 'About the project', projectId: projA.id });
    expect(onProject.status).toBe(201);
    expect(onProject.body.item.projectId).toBe(projA.id);
    expect((await teamA.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: 'x', projectId: projB.id })).body.error.fields.projectId).toBe('invalid_choice');
    expect((await teamA.get(`/api/clients/${w.clientA.id}/internal-notes?projectId=${projB.id}`)).status).toBe(404);
    const byProject = await teamA.get(`/api/clients/${w.clientA.id}/internal-notes?projectId=${projA.id}`);
    expect(ids(byProject)).toEqual([onProject.body.item.id]);
  });

  it('only the author or an admin may edit / delete; TEAM without notes.internal gets 403', async () => {
    const hash = await hashPassword(PASSWORD);
    const other = await prisma.user.create({ data: { name: 'Team A2', email: 'teama2@t.test', role: 'TEAM', passwordHash: hash } });
    await prisma.clientAssignment.create({ data: { userId: other.id, clientId: w.clientA.id } });
    const a2 = await loginAs('teama2@t.test');
    expect((await a2.get(`/api/clients/${w.clientA.id}/internal-notes`)).status).toBe(200);
    expect((await a2.patch(`/api/internal-notes/${noteId}`).send({ body: 'hijack' })).status).toBe(403);
    expect((await a2.delete(`/api/internal-notes/${noteId}`)).status).toBe(403);
    expect((await teamA.patch(`/api/internal-notes/${noteId}`).send({ body: SECRET_NOTE, pinned: true })).status).toBe(200);
    expect((await admin.patch(`/api/internal-notes/${noteId}`).send({ pinned: false })).status).toBe(200);
    expect((await admin.patch(`/api/internal-notes/${noteId}`).send({ authorId: w.admin.id })).status).toBe(400);

    await setPerms(w.teamA.id, DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'notes.internal'));
    expect((await teamA.get(`/api/clients/${w.clientA.id}/internal-notes`)).status).toBe(403);
    expect((await teamA.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: 'x' })).status).toBe(403);
    expect((await teamA.patch(`/api/internal-notes/${noteId}`).send({ body: 'x' })).status).toBe(403);
    expect((await teamA.delete(`/api/internal-notes/${noteId}`)).status).toBe(403);
    await setPerms(w.teamA.id, null);

    const tmp = await teamA.post(`/api/clients/${w.clientA.id}/internal-notes`).send({ body: 'to delete' });
    expect((await teamA.delete(`/api/internal-notes/${tmp.body.item.id}`)).status).toBe(200);
    expect(await prisma.internalNote.count({ where: { id: tmp.body.item.id } })).toBe(0);
  });

  it('audit rows are written without the note text and are never client visible', async () => {
    const rows = await prisma.auditLog.findMany({ where: { entity: 'internal_note' } });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(r.clientVisible).toBe(false);
      expect(r.metadata ?? '').not.toContain('TOPSECRET');
      expect(r.metadata ?? '').not.toContain('Pinned by admin');
    }
    expect((await audits('INTERNAL_NOTE_CREATED')).length).toBeGreaterThanOrEqual(3);
    expect((await audits('INTERNAL_NOTE_UPDATED')).length).toBeGreaterThanOrEqual(2);
    expect((await audits('INTERNAL_NOTE_DELETED')).length).toBeGreaterThanOrEqual(1);
  });

  it('internal notes never appear in any CLIENT-visible payload', async () => {
    const payloads = [
      await alice.get(`/api/clients/${w.clientA.id}`),
      await alice.get('/api/clients'),
      await alice.get(`/api/clients/${w.clientA.id}/contacts`),
      await alice.get('/api/activity'),
      await alice.get(`/api/activity?clientId=${w.clientA.id}&entity=internal_note`),
      await alice.get('/api/dashboard'),
    ];
    for (const res of payloads) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('TOPSECRET');
      expect(text).not.toContain('Pinned by admin');
      expect(text).not.toContain('internal_note');
    }
  });
});

describe('activity feed', () => {
  let projPublic: string;
  let projInternal: string;
  let projB: string;

  beforeAll(async () => {
    projPublic = (await prisma.project.create({ data: { name: 'Public project', clientId: w.clientA.id } })).id;
    projInternal = (await prisma.project.create({ data: { name: 'Internal project', clientId: w.clientA.id, visibleToClient: false } })).id;
    projB = (await prisma.project.create({ data: { name: 'B project', clientId: w.clientB.id } })).id;
    const row = (o: { clientId: string; visible: boolean; entity?: string; action?: string; projectId?: string; metadata?: Record<string, unknown> }) =>
      prisma.auditLog.create({
        data: {
          userId: w.teamA.id, action: o.action ?? 'DELIVERABLE_SUBMITTED', entity: o.entity ?? 'deliverable', entityId: 'e1', ip: '203.0.113.9',
          clientId: o.clientId, clientVisible: o.visible, projectId: o.projectId ?? null, metadata: o.metadata ? JSON.stringify(o.metadata) : null,
        },
      });
    await row({ clientId: w.clientA.id, visible: true, metadata: { name: 'Summer banner', version: 2, secretField: 'RAW-METADATA-LEAK', internalCost: 999 } });
    await row({ clientId: w.clientA.id, visible: true, action: 'REQUEST_STATUS_CHANGED', entity: 'request', metadata: { from: 'NEW', to: 'IN_PROGRESS', title: 'Poster' } });
    await row({ clientId: w.clientA.id, visible: false, action: 'CONTRACT_UPDATED', entity: 'contract', metadata: { name: 'INTERNAL-ONLY-EVENT' } });
    await row({ clientId: w.clientA.id, visible: true, action: 'INTERNAL_NOTE_CREATED', entity: 'internal_note', metadata: { name: 'MISFLAGGED-NOTE' } }); // flagged visible by mistake
    await row({ clientId: w.clientB.id, visible: true, metadata: { name: 'OTHER-CLIENT-EVENT' } });
    await row({ clientId: w.clientA.id, visible: true, projectId: projPublic, metadata: { name: 'On public project' } });
    await row({ clientId: w.clientA.id, visible: true, projectId: projInternal, metadata: { name: 'On internal project' } });
  });

  it('CLIENT only sees clientVisible rows of its own company, as a sanitised DTO', async () => {
    const res = await alice.get('/api/activity');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('OTHER-CLIENT-EVENT');
    expect(text).not.toContain('INTERNAL-ONLY-EVENT');
    expect(text).not.toContain('MISFLAGGED-NOTE');
    expect(text).not.toContain('On internal project');
    expect(text).not.toContain('RAW-METADATA-LEAK');
    expect(text).not.toContain('internalCost');
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('teama@t.test');
    expect(text).toContain('Summer banner');
    for (const it of res.body.items) {
      expect(Object.keys(it).sort()).toEqual(['action', 'actor', 'clientId', 'createdAt', 'entity', 'entityId', 'id', 'projectId', 'summary']);
      expect(it.clientId).toBe(w.clientA.id);
      expect(it.actor).toEqual({ name: 'Team A', role: 'TEAM' });
      expect('metadata' in it).toBe(false);
      expect('ip' in it).toBe(false);
    }
    const banner = res.body.items.find((i: { summary: { name?: string } }) => i.summary.name === 'Summer banner');
    expect(banner.summary).toEqual({ name: 'Summer banner', version: 2 });
    const status = res.body.items.find((i: { action: string }) => i.action === 'REQUEST_STATUS_CHANGED');
    expect(status.summary).toEqual({ title: 'Poster', from: 'NEW', to: 'IN_PROGRESS' });
    expect(res.body.meta.pageSize).toBe(20);
  });

  it('filters cannot widen a CLIENT scope; project timelines need a visible project', async () => {
    expect((await alice.get(`/api/activity?clientId=${w.clientB.id}`)).body.items).toEqual([]);
    expect(JSON.stringify((await alice.get(`/api/activity?userId=${w.teamB.id}`)).body)).toContain('Summer banner'); // userId ignored
    expect((await alice.get(`/api/activity?projectId=${projB}`)).status).toBe(404);
    expect((await alice.get(`/api/activity?projectId=${projInternal}`)).status).toBe(404);
    const pub = await alice.get(`/api/activity?projectId=${projPublic}`);
    expect(pub.status).toBe(200);
    expect(pub.body.items.map((i: { summary: { name?: string } }) => i.summary.name)).toEqual(['On public project']);
    expect((await alice.get(`/api/activity?entity=request`)).body.items.length).toBe(1);
    expect((await alice.get(`/api/activity?pageSize=1`)).body.items.length).toBe(1);
  });

  it('TEAM sees only assigned clients (internal rows included), ADMIN sees all, campaign-only members see none', async () => {
    const a = await teamA.get('/api/activity');
    const text = JSON.stringify(a.body);
    expect(text).toContain('Summer banner');
    expect(text).not.toContain('INTERNAL-ONLY-EVENT'); // a contract row: teamA has no contracts.view
    expect(text).not.toContain('OTHER-CLIENT-EVENT');
    expect((await teamB.get(`/api/activity?clientId=${w.clientA.id}`)).body.items).toEqual([]);
    expect((await teamB.get(`/api/activity?projectId=${projPublic}`)).status).toBe(404);
    expect((await teamC.get('/api/activity')).body.items).toEqual([]);
    const adminAll = JSON.stringify((await admin.get('/api/activity?pageSize=100')).body);
    expect(adminAll).toContain('OTHER-CLIENT-EVENT');
    expect(adminAll).toContain('INTERNAL-ONLY-EVENT');
    // staff see the full actor
    expect((await admin.get('/api/activity')).body.items[0].actor).toMatchObject({ id: expect.any(String), role: expect.any(String) });
  });

  it('TEAM without the permission for an entity does not see its rows; without clients.view gets 403', async () => {
    const hasContract = (await teamA.get('/api/activity?pageSize=100')).body.items.some((i: { entity: string }) => i.entity === 'contract');
    expect(hasContract).toBe(false); // default team has no contracts.view
    await setPerms(w.teamA.id, []);
    expect((await teamA.get('/api/activity')).status).toBe(403);
    await setPerms(w.teamA.id, null);
  });
});
