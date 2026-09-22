import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../db';
import { storage } from '../storage';
import { app, buildWorld, loginAs, tinyPng, type Agent, type World } from './helpers';

let w: World;
let alice: Agent; // CLIENT of company A
let bob: Agent; // CLIENT of company B
let admin: Agent;
let teamA: Agent; // assigned to client A
let teamB: Agent; // assigned to client B
let teamC: Agent; // assigned only to campaign A2
let fileA: string;
let fileB: string;
let draftFile: string;

beforeAll(async () => {
  w = await buildWorld();
  [alice, bob, admin, teamA, teamB, teamC] = await Promise.all(
    ['alice@alpha.test', 'bob@beta.test', 'admin@t.test', 'teama@t.test', 'teamb@t.test', 'teamc@t.test'].map((e) => loginAs(e)),
  );
  // one visible file per company + a draft-only file for company A
  const up = async (agent: Agent, fields: Record<string, string>) => {
    const r = agent.post('/api/files').attach('file', tinyPng(), { filename: 'pic.png', contentType: 'image/png' });
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    const res = await r;
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.item.id as string;
  };
  fileA = await up(admin, { campaignId: w.campA1.id });
  fileB = await up(admin, { campaignId: w.campB1.id });
  draftFile = await up(admin, { deliverableId: w.draftA.id });
});

const ids = (res: request.Response) => (res.body.items as Array<{ id: string }>).map((i) => i.id);

describe('CLIENT isolation - reading', () => {
  it('lists only their own company data', async () => {
    const clients = await alice.get('/api/clients');
    expect(ids(clients)).toEqual([w.clientA.id]);

    expect(ids(await alice.get('/api/campaigns')).sort()).toEqual([w.campA1.id, w.campA2.id].sort());
    expect(ids(await alice.get('/api/deliverables'))).toContain(w.delA.id);
    expect(ids(await alice.get('/api/deliverables'))).not.toContain(w.delB.id);
    expect(ids(await alice.get('/api/requests'))).toEqual([w.reqA.id]);
    expect(ids(await alice.get('/api/files'))).toContain(fileA);
    expect(ids(await alice.get('/api/files'))).not.toContain(fileB);

    const reports = await alice.get('/api/reports');
    expect(reports.body.summary.spend).toBe(100); // never includes company B's 200
    expect((reports.body.items as Array<{ clientId: string }>).every((r) => r.clientId === w.clientA.id)).toBe(true);
  });

  it('cannot open another company by changing the id in the URL (IDOR) - gets 404, not the data', async () => {
    for (const path of [
      `/api/clients/${w.clientB.id}`,
      `/api/clients/${w.clientB.id}/logo`,
      `/api/campaigns/${w.campB1.id}`,
      `/api/deliverables/${w.delB.id}`,
      `/api/deliverables/${w.delB.id}/approvals`,
      `/api/deliverables/${w.delB.id}/comments`,
      `/api/requests/${w.reqB.id}`,
      `/api/requests/${w.reqB.id}/comments`,
      `/api/files/${fileB}/download`,
    ]) {
      const res = await alice.get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('cannot filter their way into another company either', async () => {
    expect(ids(await alice.get(`/api/campaigns?clientId=${w.clientB.id}`))).toEqual([]);
    expect(ids(await alice.get(`/api/requests?clientId=${w.clientB.id}`))).toEqual([]);
    const rep = await alice.get(`/api/reports?clientId=${w.clientB.id}`);
    expect(rep.body.items).toEqual([]);
    expect(rep.body.summary.spend).toBe(0);
    expect(ids(await alice.get(`/api/files?campaignId=${w.campB1.id}`))).toEqual([]);
  });

  it('cannot see drafts that were never sent to them, nor the files attached to those drafts', async () => {
    expect(ids(await alice.get('/api/deliverables'))).not.toContain(w.draftA.id);
    expect((await alice.get(`/api/deliverables/${w.draftA.id}`)).status).toBe(404);
    expect(ids(await alice.get('/api/files'))).not.toContain(draftFile);
    expect((await alice.get(`/api/files/${draftFile}/download`)).status).toBe(404);
    // ...but staff can
    expect((await teamA.get(`/api/files/${draftFile}/download`)).status).toBe(200);
  });

  it('downloads their own files, with safe headers and no filesystem path anywhere', async () => {
    const list = await alice.get('/api/files');
    expect(JSON.stringify(list.body)).not.toMatch(/filePath|\/uploads|og-test-/);
    const res = await alice.get(`/api/files/${fileA}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const inline = await alice.get(`/api/files/${fileA}/download?inline=1`);
    expect(inline.headers['content-disposition']).toMatch(/^inline/);
  });

  it('dashboards only count their own company', async () => {
    const d = await alice.get('/api/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.kpis.activeCampaigns).toBe(2);
    expect(d.body.kpis.pendingApprovals).toBe(1);
    expect(d.body.kpis.openRequests).toBe(1);
    expect(d.body.client.companyName).toBe('Alpha Co');
  });
});

describe('CLIENT isolation - writing', () => {
  it('cannot approve / request changes on another company\'s deliverable', async () => {
    expect((await alice.post(`/api/deliverables/${w.delB.id}/approve`).send({})).status).toBe(404);
    expect((await alice.post(`/api/deliverables/${w.delB.id}/request-changes`).send({ comment: 'nope nope' })).status).toBe(404);
    expect((await prisma.deliverable.findUniqueOrThrow({ where: { id: w.delB.id } })).status).toBe('PENDING_APPROVAL');
  });

  it('cannot comment on another company\'s deliverable or request', async () => {
    expect((await alice.post(`/api/deliverables/${w.delB.id}/comments`).send({ comment: 'hi' })).status).toBe(404);
    expect((await alice.post(`/api/requests/${w.reqB.id}/comments`).send({ comment: 'hi' })).status).toBe(404);
    expect(await prisma.comment.count({ where: { clientId: w.clientB.id } })).toBe(0);
  });

  it('cannot create a request against another company\'s campaign, nor pick a different clientId', async () => {
    const r1 = await alice.post('/api/requests').send({ title: 'Sneaky', type: 'COPY', description: 'abc', campaignId: w.campB1.id });
    expect(r1.status).toBe(400);
    const r2 = await alice.post('/api/requests').send({ title: 'Sneaky', type: 'COPY', description: 'abc', clientId: w.clientB.id });
    expect(r2.status).toBe(400); // clientId is not an accepted field for clients
    expect(await prisma.request.count({ where: { clientId: w.clientB.id } })).toBe(1); // only Bob's own
  });

  it('cannot modify another company\'s request or set internal fields', async () => {
    expect((await alice.patch(`/api/requests/${w.reqB.id}`).send({ status: 'CANCELLED' })).status).toBe(404);
    const own = await alice.patch(`/api/requests/${w.reqA.id}`).send({ status: 'COMPLETED' });
    expect(own.status).toBe(400); // clients may only cancel
    const own2 = await alice.patch(`/api/requests/${w.reqA.id}`).send({ assignedToId: w.teamA.id });
    expect(own2.status).toBe(400);
    const own3 = await alice.patch(`/api/requests/${w.reqA.id}`).send({ priority: 'URGENT' });
    expect(own3.status).toBe(400);
  });

  it('cannot upload files except as attachments on their own requests', async () => {
    const png = tinyPng();
    const attach = (fields: Record<string, string>) => {
      const r = alice.post('/api/files').attach('file', png, { filename: 'a.png', contentType: 'image/png' });
      for (const [k, v] of Object.entries(fields)) r.field(k, v);
      return r;
    };
    expect((await attach({ campaignId: w.campA1.id })).status).toBe(403);
    expect((await attach({ deliverableId: w.delA.id })).status).toBe(403);
    expect((await attach({ clientId: w.clientA.id })).status).toBe(403);
    expect((await attach({ requestId: w.reqB.id })).status).toBe(404);
    const ok = await attach({ requestId: w.reqA.id });
    expect(ok.status).toBe(201);
    expect(ok.body.item.clientId).toBe(w.clientA.id);
  });

  it('cannot use staff-only endpoints', async () => {
    expect((await alice.post('/api/campaigns').send({})).status).toBe(403);
    expect((await alice.patch(`/api/campaigns/${w.campA1.id}`).send({ status: 'PAUSED' })).status).toBe(403);
    expect((await alice.delete(`/api/campaigns/${w.campA1.id}`)).status).toBe(403);
    expect((await alice.post('/api/clients').send({})).status).toBe(403);
    expect((await alice.patch(`/api/clients/${w.clientA.id}`).send({ status: 'PAUSED' })).status).toBe(403);
    expect((await alice.post('/api/deliverables').send({})).status).toBe(403);
    expect((await alice.post(`/api/deliverables/${w.delA.id}/submit`).send({})).status).toBe(403);
    expect((await alice.post('/api/reports').send({})).status).toBe(403);
    expect((await alice.get('/api/users')).status).toBe(403);
    expect((await alice.get('/api/audit-logs')).status).toBe(403);
    expect((await alice.get('/api/team-members')).status).toBe(403);
    expect((await alice.delete(`/api/files/${fileA}`)).status).toBe(403);
  });
});

describe('TEAM scoping', () => {
  it('sees only assigned clients', async () => {
    expect(ids(await teamA.get('/api/clients'))).toEqual([w.clientA.id]);
    expect(ids(await teamB.get('/api/clients'))).toEqual([w.clientB.id]);
    expect((await teamA.get(`/api/clients/${w.clientB.id}`)).status).toBe(404);
    expect((await teamA.get(`/api/campaigns/${w.campB1.id}`)).status).toBe(404);
    expect((await teamA.get(`/api/deliverables/${w.delB.id}`)).status).toBe(404);
    expect((await teamA.get(`/api/requests/${w.reqB.id}`)).status).toBe(404);
    expect((await teamA.get(`/api/files/${fileB}/download`)).status).toBe(404);
    expect(ids(await teamA.get('/api/campaigns')).sort()).toEqual([w.campA1.id, w.campA2.id].sort());
  });

  it('a campaign-only assignment exposes just that campaign (not the rest of the client)', async () => {
    expect(ids(await teamC.get('/api/campaigns'))).toEqual([w.campA2.id]);
    expect((await teamC.get(`/api/campaigns/${w.campA1.id}`)).status).toBe(404);
    expect((await teamC.get(`/api/deliverables/${w.delA.id}`)).status).toBe(404); // belongs to A1
    expect(ids(await teamC.get('/api/requests'))).toEqual([]); // A's request is on A1
    // the owning client is visible (read-only listing) so the campaign has context
    expect(ids(await teamC.get('/api/clients'))).toEqual([w.clientA.id]);
    // and they cannot create client-level things for the whole client
    const d = await teamC.post('/api/deliverables').send({ name: 'x', type: 'DESIGN', clientId: w.clientA.id });
    expect(d.status).toBe(400);
    const okD = await teamC.post('/api/deliverables').send({ name: 'C work', type: 'DESIGN', campaignId: w.campA2.id });
    expect(okD.status).toBe(201);
  });

  it('cannot create records for a client they are not assigned to', async () => {
    expect((await teamA.post('/api/deliverables').send({ name: 'x', type: 'DESIGN', clientId: w.clientB.id })).status).toBe(400);
    expect((await teamA.post('/api/deliverables').send({ name: 'x', type: 'DESIGN', campaignId: w.campB1.id })).status).toBe(400);
    expect((await teamA.post('/api/requests').send({ title: 'abc', type: 'COPY', description: 'abc', clientId: w.clientB.id })).status).toBe(400);
    expect((await teamA.post('/api/reports').send({ campaignId: w.campB1.id, date: '2026-02-01', spend: 1, reach: 1, impressions: 1, clicks: 0, conversions: 0 })).status).toBe(400);
    expect((await teamA.patch(`/api/campaigns/${w.campB1.id}`).send({ status: 'PAUSED' })).status).toBe(404);
  });

  it('may only change the status of a campaign (not budget, client, ...)', async () => {
    expect((await teamA.patch(`/api/campaigns/${w.campA1.id}`).send({ budget: 999999 })).status).toBe(400);
    const ok = await teamA.patch(`/api/campaigns/${w.campA1.id}`).send({ status: 'PAUSED' });
    expect(ok.status).toBe(200);
    expect(ok.body.item.status).toBe('PAUSED');
    await teamA.patch(`/api/campaigns/${w.campA1.id}`).send({ status: 'RUNNING' });
  });

  it('cannot approve deliverables and cannot manage users, clients or audit logs', async () => {
    expect((await teamA.post(`/api/deliverables/${w.delA.id}/approve`).send({})).status).toBe(403);
    expect((await teamA.post(`/api/deliverables/${w.delA.id}/request-changes`).send({ comment: 'abc' })).status).toBe(403);
    expect((await teamA.get('/api/users')).status).toBe(403);
    expect((await teamA.post('/api/clients').send({})).status).toBe(403);
    expect((await teamA.delete(`/api/campaigns/${w.campA1.id}`)).status).toBe(403);
    expect((await teamA.get('/api/audit-logs')).status).toBe(403);
  });

  it('dashboard counts follow the assignment', async () => {
    const d = await teamA.get('/api/dashboard');
    expect(d.body.kpis.assignedClients).toBe(1);
    expect(d.body.kpis.assignedCampaigns).toBe(2);
    const dc = await teamC.get('/api/dashboard');
    expect(dc.body.kpis.assignedCampaigns).toBe(1);
  });
});

describe('ADMIN', () => {
  it('can access everything', async () => {
    expect(ids(await admin.get('/api/clients')).sort()).toEqual([w.clientA.id, w.clientB.id].sort());
    expect((await admin.get(`/api/clients/${w.clientB.id}`)).status).toBe(200);
    expect((await admin.get(`/api/campaigns/${w.campB1.id}`)).status).toBe(200);
    expect((await admin.get(`/api/deliverables/${w.delB.id}`)).status).toBe(200);
    expect((await admin.get(`/api/deliverables/${w.draftA.id}`)).status).toBe(200);
    expect((await admin.get(`/api/requests/${w.reqB.id}`)).status).toBe(200);
    expect((await admin.get(`/api/files/${fileB}/download`)).status).toBe(200);
    expect((await admin.get('/api/users')).status).toBe(200);
    expect((await admin.get('/api/audit-logs')).status).toBe(200);
    const rep = await admin.get('/api/reports');
    expect(rep.body.summary.spend).toBe(300);
    const d = await admin.get('/api/dashboard');
    expect(d.body.kpis.totalClients).toBe(2);
  });

  it('still cannot approve on behalf of a client', async () => {
    expect((await admin.post(`/api/deliverables/${w.delA.id}/approve`).send({})).status).toBe(403);
  });
});

describe('notifications & audit are private', () => {
  it('a user only sees and marks their own notifications', async () => {
    const n = await prisma.notification.create({ data: { userId: w.userB.id, type: 'NEW_COMMENT', data: '{}' } });
    const mine = await alice.get('/api/notifications');
    expect(ids(mine)).not.toContain(n.id);
    expect((await alice.patch(`/api/notifications/${n.id}/read`)).status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toBeNull();
    expect((await bob.patch(`/api/notifications/${n.id}/read`)).status).toBe(200);
  });

  it('only admins read the audit log', async () => {
    const res = await admin.get('/api/audit-logs?action=FILE_UPLOADED');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].user.name).toBeTruthy();
  });
});

describe('file storage hygiene', () => {
  it('rejects garbage keys (path traversal) at the storage layer', async () => {
    for (const key of ['../../etc/passwd', '..\\..\\x', '/etc/passwd', 'a/b', '']) {
      await expect(storage.get(key)).rejects.toMatchObject({ status: 404 });
    }
  });

  it('rejects malformed ids before touching the database', async () => {
    expect((await admin.get('/api/files/..%2f..%2fetc%2fpasswd/download')).status).toBe(404);
    expect((await request(app).get('/api/files/x/download')).status).toBe(401);
  });
});
