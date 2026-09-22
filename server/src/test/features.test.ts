import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { ROOT, config, resolveDbFile } from '../config';
import { prisma } from '../db';
import * as enums from '../../../shared/src/enums';
import { buildWorld, loginAs, tinyPng, type Agent, type World } from './helpers';

let w: World;
let alice: Agent;
let admin: Agent;
let teamA: Agent;
let teamB: Agent;

beforeAll(async () => {
  w = await buildWorld();
  [alice, admin, teamA, teamB] = await Promise.all(['alice@alpha.test', 'admin@t.test', 'teama@t.test', 'teamb@t.test'].map((e) => loginAs(e)));
});

describe('requests', () => {
  let id: string;

  it('client creates a request: client, user, status and dates are set by the server', async () => {
    const res = await alice.post('/api/requests').send({ title: 'New poster', type: 'DESIGN', description: 'Need a poster for Ramadan', priority: 'HIGH', campaignId: w.campA1.id });
    expect(res.status).toBe(201);
    id = res.body.item.id;
    expect(res.body.item).toMatchObject({ status: 'NEW', clientId: w.clientA.id, userId: w.userA.id, priority: 'HIGH', assignedToId: null });
    expect(res.body.item.createdAt).toBeTruthy();
    expect(res.body.item.completedAt).toBeNull();
    // clients cannot smuggle in internal fields
    expect((await alice.post('/api/requests').send({ title: 'Abc', type: 'COPY', description: 'Abc', status: 'COMPLETED' })).status).toBe(400);
    expect((await alice.post('/api/requests').send({ title: 'Abc', type: 'COPY', description: 'Abc', assignedToId: w.teamA.id })).status).toBe(400);
    expect((await alice.post('/api/requests').send({ title: '', type: 'COPY', description: '' })).body.error.fields).toMatchObject({ title: 'too_short' });
  });

  it('notifies assigned team + admins (not the requester, not unrelated team)', async () => {
    const got = async (userId: string) => prisma.notification.count({ where: { userId, type: 'NEW_REQUEST', entityId: id } });
    expect(await got(w.teamA.id)).toBe(1);
    expect(await got(w.admin.id)).toBe(1);
    expect(await got(w.userA.id)).toBe(0);
    expect(await got(w.teamB.id)).toBe(0);
    expect(await got(w.userB.id)).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'REQUEST_CREATED', entityId: id } })).toBe(1);
  });

  it('team updates status/assignee/due date; completedAt follows the status; client is notified', async () => {
    const res = await teamA.patch(`/api/requests/${id}`).send({ status: 'IN_PROGRESS', assignedToId: w.teamA.id, dueDate: '2026-12-01' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('IN_PROGRESS');
    expect(res.body.item.assignedToId).toBe(w.teamA.id);
    const done = await teamA.patch(`/api/requests/${id}`).send({ status: 'COMPLETED' });
    expect(done.body.item.completedAt).toBeTruthy();
    const reopened = await teamA.patch(`/api/requests/${id}`).send({ status: 'IN_PROGRESS' });
    expect(reopened.body.item.completedAt).toBeNull();
    expect(await prisma.notification.count({ where: { userId: w.userA.id, type: 'REQUEST_STATUS_CHANGED', entityId: id } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'REQUEST_STATUS_CHANGED', entityId: id } })).toBe(3);
    const detail = await alice.get(`/api/requests/${id}`);
    expect(detail.body.item.assignedTo.name).toBe('Team A');
  });

  it('refuses an assignee who cannot see this client', async () => {
    const bad = await teamA.patch(`/api/requests/${id}`).send({ assignedToId: w.teamB.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.assignedToId).toBe('invalid_choice');
  });

  it('client can cancel their own request but cannot re-open a finished one', async () => {
    const other = await alice.post('/api/requests').send({ title: 'Cancel me', type: 'COPY', description: 'abc' });
    const c = await alice.patch(`/api/requests/${other.body.item.id}`).send({ status: 'CANCELLED' });
    expect(c.status).toBe(200);
    expect((await alice.patch(`/api/requests/${other.body.item.id}`).send({ status: 'CANCELLED' })).status).toBe(409);
  });

  it('search and filters work', async () => {
    expect((await alice.get('/api/requests?q=poster')).body.items.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await alice.get('/api/requests?priority=HIGH')).body.items.length).toBe(1);
    expect((await alice.get('/api/requests?status=CANCELLED')).body.items.length).toBe(1);
  });

  it('request comments: authorType is derived from the role', async () => {
    const a = await alice.post(`/api/requests/${id}/comments`).send({ comment: 'Any update?' });
    const t = await teamA.post(`/api/requests/${id}/comments`).send({ comment: 'Working on it' });
    expect(a.body.item.authorType).toBe('CLIENT');
    expect(t.body.item.authorType).toBe('TEAM');
    expect((await alice.get(`/api/requests/${id}/comments`)).body.items).toHaveLength(2);
  });
});

describe('reports', () => {
  it('server computes CTR / CPC / CPM / ROAS from raw numbers and keeps campaign.spent in sync', async () => {
    const res = await teamA.post('/api/reports').send({
      campaignId: w.campA2.id, date: '2026-02-01', spend: 250, reach: 8000, impressions: 10000, clicks: 200, conversions: 20, conversionValue: 1000, notes: 'day 1',
    });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ ctr: 2, cpc: 1.25, cpm: 25, roas: 4, clientId: w.clientA.id });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: w.campA2.id } })).spent).toBe(250);

    await teamA.post('/api/reports').send({ campaignId: w.campA2.id, date: '2026-02-02', spend: 150, reach: 1, impressions: 5000, clicks: 100, conversions: 5, conversionValue: 300 });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: w.campA2.id } })).spent).toBe(400);
  });

  it('rejects forged ratios, duplicates, impossible numbers and future dates', async () => {
    const base = { campaignId: w.campA2.id, date: '2026-03-01', spend: 10, reach: 100, impressions: 100, clicks: 10, conversions: 1 };
    expect((await teamA.post('/api/reports').send({ ...base, ctr: 99, roas: 99 })).status).toBe(400);
    expect((await teamA.post('/api/reports').send({ ...base, date: '2026-02-01' })).body.error.code).toBe('REPORT_EXISTS');
    expect((await teamA.post('/api/reports').send({ ...base, clicks: 500 })).body.error.fields.clicks).toBe('clicks_exceed_impressions');
    expect((await teamA.post('/api/reports').send({ ...base, spend: -1 })).status).toBe(400);
    expect((await teamA.post('/api/reports').send({ ...base, date: '2099-01-01' })).body.error.fields.date).toBe('date_in_future');
    expect((await teamA.post('/api/reports').send({ ...base, date: 'nope' })).status).toBe(400);
  });

  it('summary totals, daily series and filters come from real rows only', async () => {
    const all = await alice.get('/api/reports');
    // seeded 100 (A1 on 2026-01-01) + 250 + 150
    expect(all.body.summary.spend).toBe(500);
    expect(all.body.summary.clicks).toBe(350);
    expect(all.body.summary.ctr).toBe(Number(((350 / 16000) * 100).toFixed(4)));
    expect(all.body.series.map((s: { date: string }) => s.date)).toEqual(['2026-01-01', '2026-02-01', '2026-02-02']);
    const byCampaign = await alice.get(`/api/reports?campaignId=${w.campA2.id}`);
    expect(byCampaign.body.summary.spend).toBe(400);
    const byDate = await alice.get('/api/reports?from=2026-02-02&to=2026-02-28');
    expect(byDate.body.items).toHaveLength(1);
    expect(byDate.body.summary.spend).toBe(150);
    expect((await alice.get('/api/reports?from=garbage')).status).toBe(400);
  });

  it('a report cannot be attached to a campaign the user cannot access; delete re-syncs spend', async () => {
    const list = await teamA.get(`/api/reports?campaignId=${w.campA2.id}`);
    const rid = list.body.items[0].id;
    expect((await teamB.delete(`/api/reports/${rid}`)).status).toBe(404);
    expect((await teamA.delete(`/api/reports/${rid}`)).status).toBe(200);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: w.campA2.id } })).spent).toBeLessThan(400);
  });
});

describe('files', () => {
  const send = (agent: Agent, name: string, data: Buffer, type: string, fields: Record<string, string> = { campaignId: w.campA1.id }) => {
    const r = agent.post('/api/files').attach('file', data, { filename: name, contentType: type });
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r;
  };

  it('accepts a valid file, stores it under a random key and never shows the path', async () => {
    const res = await send(teamA, 'Ramadan Banner.png', tinyPng(), 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.item.fileName).toBe('Ramadan Banner.png');
    expect(res.body.item.filePath).toBeUndefined();
    const row = await prisma.file.findUniqueOrThrow({ where: { id: res.body.item.id } });
    expect(row.filePath).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(fs.existsSync(path.join(config.uploadDir, row.filePath))).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'FILE_UPLOADED', entityId: row.id } })).toBe(1);
  });

  it('keeps Arabic file names intact', async () => {
    const name = 'تصميم الإعلان.png';
    const res = await send(admin, name, tinyPng(), 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.item.fileName).toBe(name);
    const dl = await admin.get(`/api/files/${res.body.item.id}/download`);
    expect(dl.headers['content-disposition']).toContain(encodeURIComponent(name));
  });

  it('rejects executables, double extensions, spoofed content, bad MIME, empty and oversized files', async () => {
    const exe = await send(teamA, 'virus.exe', Buffer.from('MZ....'), 'application/octet-stream');
    expect(exe.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await send(teamA, 'shell.php.png', tinyPng(), 'image/png')).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await send(teamA, 'page.html', Buffer.from('<script>alert(1)</script>'), 'text/html')).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await send(teamA, 'logo.svg', Buffer.from('<svg onload=alert(1)/>'), 'image/svg+xml')).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await send(teamA, 'fake.png', Buffer.from('<html>not a png</html>'), 'image/png')).body.error.code).toBe('FILE_CONTENT_MISMATCH');
    expect((await send(teamA, 'a.png', tinyPng(), 'application/x-msdownload')).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await send(teamA, 'empty.txt', Buffer.alloc(0), 'text/plain')).status).toBe(400);
    const big = await send(teamA, 'big.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(config.maxUploadBytes + 10)]), 'application/pdf');
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');
    expect((await teamA.post('/api/files').field('campaignId', w.campA1.id)).body.error.code).toBe('FILE_REQUIRED');
  });

  it('path-traversal in the file name cannot escape the upload folder', async () => {
    const res = await send(teamA, '../../../evil.png', tinyPng(), 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.item.fileName).toBe('evil.png');
    const row = await prisma.file.findUniqueOrThrow({ where: { id: res.body.item.id } });
    expect(row.filePath).not.toContain('..');
  });

  it('non-safe types are never rendered inline', async () => {
    const res = await send(teamA, 'notes.txt', Buffer.from('hello'), 'text/plain');
    const dl = await teamA.get(`/api/files/${res.body.item.id}/download?inline=1`);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('team may delete only their own uploads; admin any; client none; blob is removed', async () => {
    const mine = await send(teamA, 'del.png', tinyPng(), 'image/png');
    const key = (await prisma.file.findUniqueOrThrow({ where: { id: mine.body.item.id } })).filePath;
    expect((await alice.delete(`/api/files/${mine.body.item.id}`)).status).toBe(403);
    const adminUp = await send(admin, 'admin.png', tinyPng(), 'image/png');
    expect((await teamA.delete(`/api/files/${adminUp.body.item.id}`)).status).toBe(403);
    expect((await teamA.delete(`/api/files/${mine.body.item.id}`)).status).toBe(200);
    expect(fs.existsSync(path.join(config.uploadDir, key))).toBe(false);
    expect((await admin.delete(`/api/files/${adminUp.body.item.id}`)).status).toBe(200);
  });

  it('file list search and kind filter', async () => {
    expect((await teamA.get('/api/files?kind=image')).body.items.length).toBeGreaterThan(0);
    expect((await teamA.get('/api/files?kind=document')).body.items.every((f: { fileType: string }) => !f.fileType.startsWith('image/'))).toBe(true);
    expect((await teamA.get('/api/files?q=Ramadan')).body.items).toHaveLength(1);
  });
});

describe('users & clients administration', () => {
  it('admin creates a client, a client user, a team member and assigns work', async () => {
    const c = await admin.post('/api/clients').send({ name: 'Cara', companyName: 'Gamma LLC', email: 'cara@gamma.test', phone: '+20100000000' });
    expect(c.status).toBe(201);
    const clientId = c.body.item.id;

    const cu = await admin.post('/api/users').send({ name: 'Cara Client', email: 'Cara@Gamma.test', password: 'Sup3rSecret', role: 'CLIENT', clientId });
    expect(cu.status).toBe(201);
    expect(cu.body.item.email).toBe('cara@gamma.test');
    expect(cu.body.item.passwordHash).toBeUndefined();
    const login = await loginAs('cara@gamma.test', 'Sup3rSecret');
    expect((await login.get('/api/campaigns')).body.items).toEqual([]);

    const tm = await admin.post('/api/users').send({ name: 'Tina Team', email: 'tina@t.test', password: 'Sup3rSecret', role: 'TEAM' });
    expect(tm.status).toBe(201);
    const tina = await loginAs('tina@t.test', 'Sup3rSecret');
    expect((await tina.get('/api/clients')).body.items).toEqual([]); // nothing until assigned
    expect((await admin.put(`/api/users/${tm.body.item.id}/assignments`).send({ clientIds: [clientId], campaignIds: [] })).status).toBe(200);
    expect((await tina.get('/api/clients')).body.items).toHaveLength(1);
    expect((await admin.put(`/api/users/${tm.body.item.id}/assignments`).send({ clientIds: ['nope'], campaignIds: [] })).status).toBe(400);

    const camp = await admin.post('/api/campaigns').send({ name: 'Gamma Launch', clientId, platform: 'META', objective: 'LEADS', budget: 500, startDate: '2026-05-01', endDate: '2026-06-01' });
    expect(camp.status).toBe(201);
    expect((await tina.get('/api/campaigns')).body.items).toHaveLength(1);
    expect((await admin.post('/api/campaigns').send({ name: 'Bad', clientId, platform: 'META', objective: 'LEADS', startDate: '2026-06-01', endDate: '2026-05-01' })).body.error.fields.endDate).toBe('end_before_start');
    expect(await prisma.auditLog.count({ where: { action: 'CAMPAIGN_CREATED', entityId: camp.body.item.id } })).toBe(1);

    const upd = await admin.patch(`/api/campaigns/${camp.body.item.id}`).send({ status: 'RUNNING', budget: 900 });
    expect(upd.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'CAMPAIGN_UPDATED', entityId: camp.body.item.id } })).toBe(1);
    expect((await admin.patch(`/api/campaigns/${camp.body.item.id}`).send({ clientId: w.clientA.id })).status).toBe(400);
  });

  it('enforces the CLIENT-belongs-to-exactly-one-client rule and password policy', async () => {
    expect((await admin.post('/api/users').send({ name: 'X', email: 'x1@t.test', password: 'Sup3rSecret', role: 'CLIENT' })).body.error.fields.clientId).toBe('required');
    expect((await admin.post('/api/users').send({ name: 'X', email: 'x2@t.test', password: 'Sup3rSecret', role: 'TEAM', clientId: w.clientA.id })).body.error.fields.clientId).toBe('not_allowed');
    expect((await admin.post('/api/users').send({ name: 'X', email: 'x3@t.test', password: 'short', role: 'TEAM' })).body.error.fields.password).toBe('password_too_short');
    expect((await admin.post('/api/users').send({ name: 'X', email: 'x4@t.test', password: 'allletters', role: 'TEAM' })).body.error.fields.password).toBe('password_weak');
    expect((await admin.post('/api/users').send({ name: 'X', email: 'alice@alpha.test', password: 'Sup3rSecret', role: 'TEAM' })).body.error.fields.email).toBe('email_taken');
  });

  it('admin cannot lock themselves out; deactivating a user kills their sessions', async () => {
    expect((await admin.patch(`/api/users/${w.admin.id}`).send({ status: 'INACTIVE' })).body.error.code).toBe('CANNOT_MODIFY_SELF');
    expect((await admin.patch(`/api/users/${w.admin.id}`).send({ role: 'TEAM' })).body.error.code).toBe('CANNOT_MODIFY_SELF');
    const victim = await loginAs('teamb@t.test');
    expect((await victim.get('/api/me')).status).toBe(200);
    expect((await admin.patch(`/api/users/${w.teamB.id}`).send({ status: 'INACTIVE' })).status).toBe(200);
    expect((await victim.get('/api/me')).status).toBe(401);
    await admin.patch(`/api/users/${w.teamB.id}`).send({ status: 'ACTIVE' });
  });

  it('archiving a client keeps the data but locks their users out', async () => {
    const c = await admin.post('/api/clients').send({ name: 'Zed', companyName: 'Zed Inc', email: 'z@z.test' });
    await admin.post('/api/users').send({ name: 'Zed U', email: 'zu@z.test', password: 'Sup3rSecret', role: 'CLIENT', clientId: c.body.item.id });
    const zu = await loginAs('zu@z.test', 'Sup3rSecret');
    expect((await admin.patch(`/api/clients/${c.body.item.id}`).send({ status: 'ARCHIVED' })).status).toBe(200);
    expect((await zu.get('/api/me')).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'CLIENT_ARCHIVED', entityId: c.body.item.id } })).toBe(1);
    expect((await admin.get(`/api/clients?status=ARCHIVED&q=Zed`)).body.items).toHaveLength(1);
  });

  it('deleting a campaign keeps deliverables and their approval history', async () => {
    const camp = await admin.post('/api/campaigns').send({ name: 'Temp', clientId: w.clientA.id, platform: 'OTHER', objective: 'TRAFFIC' });
    const d = await prisma.deliverable.create({ data: { name: 'Keep me', clientId: w.clientA.id, campaignId: camp.body.item.id, type: 'DESIGN', status: 'APPROVED', submittedAt: new Date() } });
    await prisma.approval.create({ data: { deliverableId: d.id, clientId: w.clientA.id, userId: w.userA.id, decision: 'APPROVED', version: 1, decidedAt: new Date() } });
    expect((await admin.delete(`/api/campaigns/${camp.body.item.id}`)).status).toBe(200);
    expect((await prisma.deliverable.findUniqueOrThrow({ where: { id: d.id } })).campaignId).toBeNull();
    expect(await prisma.approval.count({ where: { deliverableId: d.id } })).toBe(1);
  });

  it('users can change their language and password', async () => {
    const res = await alice.patch('/api/me').send({ locale: 'ar' });
    expect(res.body.user.locale).toBe('ar');
    expect((await alice.patch('/api/me').send({ locale: 'fr' })).status).toBe(400);
    expect((await alice.patch('/api/me').send({ newPassword: 'NewPassw0rd', currentPassword: 'wrong' })).body.error.fields.currentPassword).toBe('wrong_password');
    expect((await alice.patch('/api/me').send({ role: 'ADMIN' })).status).toBe(400); // cannot self-promote
  });
});

describe('schema hygiene', () => {
  const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');

  it('shared enums match the Prisma schema', () => {
    const fromPrisma = (name: string) => {
      const m = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))!;
      return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    };
    const map: Record<string, readonly string[]> = {
      ClientStatus: enums.CLIENT_STATUSES, Role: enums.ROLES, UserStatus: enums.USER_STATUSES, Platform: enums.PLATFORMS,
      Objective: enums.OBJECTIVES, CampaignStatus: enums.CAMPAIGN_STATUSES, DeliverableType: enums.DELIVERABLE_TYPES,
      DeliverableStatus: enums.DELIVERABLE_STATUSES, ApprovalDecision: enums.APPROVAL_DECISIONS, RequestType: enums.REQUEST_TYPES,
      RequestPriority: enums.REQUEST_PRIORITIES, RequestStatus: enums.REQUEST_STATUSES, AuthorType: enums.AUTHOR_TYPES,
      ClientType: enums.CLIENT_TYPES, OnboardingStatus: enums.ONBOARDING_STATUSES, Priority: enums.PRIORITIES, ProjectStatus: enums.PROJECT_STATUSES,
      TaskStatus: enums.TASK_STATUSES, SocialPlatform: enums.SOCIAL_PLATFORMS, ContentType: enums.CONTENT_TYPES, ContentStatus: enums.CONTENT_STATUSES,
      ContractStatus: enums.CONTRACT_STATUSES, InvoiceStatus: enums.INVOICE_STATUSES,
    };
    for (const [name, values] of Object.entries(map)) expect(fromPrisma(name), name).toEqual([...values]);
  });

  it('every schema field has a column in the migrated database (migration is in sync)', async () => {
    const modelNames = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
    const enumNames = [...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]);
    const scalars = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', ...enumNames]);
    const db = createClient({ url: `file:${resolveDbFile(config.databaseUrl)}` });
    for (const model of modelNames) {
      const body = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'))![1];
      const fields = body
        .split('\n')
        .map((l) => l.trim().match(/^(\w+)\s+(\w+)(\?|\[\])?/))
        .filter((m): m is RegExpMatchArray => !!m && scalars.has(m[2]) && m[3] !== '[]' && !m[0].startsWith('@@'))
        .map((m) => m[1]);
      const cols = (await db.execute(`PRAGMA table_info("${model}")`)).rows.map((r) => String(r.name));
      expect(cols.sort(), model).toEqual([...fields].sort());
    }
    db.close();
  });
});
