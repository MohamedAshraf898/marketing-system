import http from 'node:http';
import request from 'supertest';
import { createApp } from '../app';
import { hashPassword } from '../auth/password';
import { prisma } from '../db';

/**
 * One listening server per test file. Handing supertest the bare Express app makes it start and stop a new server on a
 * random port for EVERY request, which under parallel load intermittently fails with "socket hang up".
 * It is listening long before the first request runs (requests only happen inside hooks / tests).
 */
export const app = http.createServer(createApp()).listen(0, '127.0.0.1');
app.unref();
export const PASSWORD = 'Passw0rd!test';

export type Agent = ReturnType<typeof request.agent>;

export async function loginAs(email: string, password = PASSWORD): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** PNG signature + padding: passes the magic-byte check for .png uploads. */
export const tinyPng = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

/**
 * Two companies (A and B), each with campaigns, deliverables, requests, reports and a client user,
 * plus an admin and three team members:
 *   teamA   -> assigned to client A
 *   teamB   -> assigned to client B
 *   teamC   -> assigned ONLY to campaign A2 of client A (not the whole client)
 */
export async function buildWorld() {
  const hash = await hashPassword(PASSWORD);
  const mkUser = (name: string, email: string, role: 'ADMIN' | 'TEAM' | 'CLIENT', clientId?: string) =>
    prisma.user.create({ data: { name, email, role, clientId: clientId ?? null, passwordHash: hash } });

  const clientA = await prisma.client.create({ data: { name: 'Alice A', companyName: 'Alpha Co', email: 'a@alpha.test' } });
  const clientB = await prisma.client.create({ data: { name: 'Bob B', companyName: 'Beta Co', email: 'b@beta.test' } });

  const admin = await mkUser('Admin', 'admin@t.test', 'ADMIN');
  const teamA = await mkUser('Team A', 'teama@t.test', 'TEAM');
  const teamB = await mkUser('Team B', 'teamb@t.test', 'TEAM');
  const teamC = await mkUser('Team C', 'teamc@t.test', 'TEAM');
  const userA = await mkUser('Alice Client', 'alice@alpha.test', 'CLIENT', clientA.id);
  const userB = await mkUser('Bob Client', 'bob@beta.test', 'CLIENT', clientB.id);

  const campA1 = await prisma.campaign.create({ data: { name: 'A1 Launch', clientId: clientA.id, platform: 'META', objective: 'SALES', status: 'RUNNING', budget: 1000 } });
  const campA2 = await prisma.campaign.create({ data: { name: 'A2 Leads', clientId: clientA.id, platform: 'GOOGLE', objective: 'LEADS', status: 'RUNNING', budget: 500 } });
  const campB1 = await prisma.campaign.create({ data: { name: 'B1 Awareness', clientId: clientB.id, platform: 'TIKTOK', objective: 'AWARENESS', status: 'RUNNING', budget: 800 } });

  await prisma.clientAssignment.create({ data: { userId: teamA.id, clientId: clientA.id } });
  await prisma.clientAssignment.create({ data: { userId: teamB.id, clientId: clientB.id } });
  await prisma.campaignAssignment.create({ data: { userId: teamC.id, campaignId: campA2.id } });

  const submitted = new Date();
  const delA = await prisma.deliverable.create({
    data: { name: 'A Banner', clientId: clientA.id, campaignId: campA1.id, type: 'BANNER', status: 'PENDING_APPROVAL', version: 1, submittedAt: submitted, description: 'x', createdById: teamA.id },
  });
  await prisma.approval.create({ data: { deliverableId: delA.id, clientId: clientA.id, userId: teamA.id, decision: 'PENDING', version: 1, submittedAt: submitted } });
  const delB = await prisma.deliverable.create({
    data: { name: 'B Video', clientId: clientB.id, campaignId: campB1.id, type: 'VIDEO', status: 'PENDING_APPROVAL', version: 1, submittedAt: submitted, description: 'y', createdById: teamB.id },
  });
  await prisma.approval.create({ data: { deliverableId: delB.id, clientId: clientB.id, userId: teamB.id, decision: 'PENDING', version: 1, submittedAt: submitted } });
  const draftA = await prisma.deliverable.create({
    data: { name: 'A Secret Draft', clientId: clientA.id, campaignId: campA1.id, type: 'DESIGN', status: 'DRAFT', description: 'wip', createdById: teamA.id },
  });

  const reqA = await prisma.request.create({ data: { title: 'A request', clientId: clientA.id, userId: userA.id, type: 'DESIGN', description: 'need it', campaignId: campA1.id } });
  const reqB = await prisma.request.create({ data: { title: 'B request', clientId: clientB.id, userId: userB.id, type: 'COPY', description: 'need copy' } });

  await prisma.report.create({ data: { clientId: clientA.id, campaignId: campA1.id, date: new Date('2026-01-01T00:00:00Z'), spend: 100, impressions: 1000, clicks: 50, reach: 800, conversions: 5, conversionValue: 300, ctr: 5, cpc: 2, cpm: 100, roas: 3 } });
  await prisma.report.create({ data: { clientId: clientB.id, campaignId: campB1.id, date: new Date('2026-01-01T00:00:00Z'), spend: 200, impressions: 2000, clicks: 40, reach: 1500, conversions: 2, conversionValue: 100, ctr: 2, cpc: 5, cpm: 100, roas: 0.5 } });

  return { clientA, clientB, admin, teamA, teamB, teamC, userA, userB, campA1, campA2, campB1, delA, delB, draftA, reqA, reqB };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;
