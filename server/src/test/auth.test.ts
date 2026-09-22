import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { app, buildWorld, loginAs, PASSWORD, type World } from './helpers';

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

describe('authentication', () => {
  it('rejects unauthenticated access to every protected area', async () => {
    for (const path of ['/api/me', '/api/clients', '/api/campaigns', '/api/deliverables', '/api/requests', '/api/reports', '/api/files', '/api/notifications', '/api/audit-logs', '/api/users', '/api/dashboard', '/api/approvals']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('logs in with valid credentials and sets an HttpOnly session cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ALICE@alpha.test ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('CLIENT');
    expect(res.body.user.client.companyName).toBe('Alpha Co');
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/og_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('does not reveal whether the email or the password was wrong', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'alice@alpha.test', password: 'wrong-Pass1' });
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@alpha.test', password: 'wrong-Pass1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(b.body.error).toEqual(a.body.error);
  });

  it('validates the login form', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.email).toBe('invalid_email');
  });

  it('keeps the session (GET /api/me) and logout really ends it', async () => {
    const agent = await loginAs('alice@alpha.test');
    expect((await agent.get('/api/me')).status).toBe(200);
    // capture the cookie to replay it after logout
    const login = await request(app).post('/api/auth/login').send({ email: 'alice@alpha.test', password: PASSWORD });
    const cookie = login.headers['set-cookie'];
    expect((await request(app).get('/api/me').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get('/api/me').set('Cookie', cookie)).status).toBe(401); // token is dead server-side
  });

  it('blocks deactivated users immediately, even with a live session', async () => {
    const agent = await loginAs('teamc@t.test');
    expect((await agent.get('/api/me')).status).toBe(200);
    await prisma.user.update({ where: { id: w.teamC.id }, data: { status: 'INACTIVE' } });
    expect((await agent.get('/api/me')).status).toBe(403);
    const again = await request(app).post('/api/auth/login').send({ email: 'teamc@t.test', password: PASSWORD });
    expect(again.status).toBe(403);
    await prisma.user.update({ where: { id: w.teamC.id }, data: { status: 'ACTIVE' } });
  });

  it('blocks client users of an archived company', async () => {
    const agent = await loginAs('bob@beta.test');
    await prisma.client.update({ where: { id: w.clientB.id }, data: { status: 'ARCHIVED' } });
    expect((await agent.get('/api/campaigns')).status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ email: 'bob@beta.test', password: PASSWORD })).status).toBe(403);
    await prisma.client.update({ where: { id: w.clientB.id }, data: { status: 'ACTIVE' } });
  });

  it('writes a USER_LOGIN audit entry', async () => {
    const n = await prisma.auditLog.count({ where: { action: 'USER_LOGIN', userId: w.admin.id } });
    await loginAs('admin@t.test');
    expect(await prisma.auditLog.count({ where: { action: 'USER_LOGIN', userId: w.admin.id } })).toBe(n + 1);
  });

  it('rejects state-changing calls that come from a foreign origin (CSRF guard)', async () => {
    const agent = await loginAs('alice@alpha.test');
    const res = await agent.post('/api/requests').set('Origin', 'https://evil.example').send({ title: 'x y z', type: 'COPY', description: 'abc' });
    expect(res.status).toBe(403);
  });

  it('never leaks stack traces', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|node_modules/);
  });
});
