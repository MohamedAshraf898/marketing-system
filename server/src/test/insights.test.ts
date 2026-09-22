import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashPassword } from '../auth/password';
import { prisma } from '../db';
import { DEFAULT_TEAM_PERMISSIONS } from '../../../shared/src/permissions';
import { deltaOf, metricsFrom, minusYear, pacing } from '../services/analytics';
import { csvCell, toCsv } from '../services/csv';
import { PASSWORD, app, buildWorld, loginAs, type Agent, type World } from './helpers';

let w: World;
let admin: Agent;
let alice: Agent; // CLIENT of Alpha
let bob: Agent; // CLIENT of Beta
let teamA: Agent; // Alpha (whole client), default permissions
let teamB: Agent;
let teamC: Agent; // only campaign A2
let noExport: Agent; // Alpha, reports.view but NOT reports.export / create
let noReports: Agent; // Alpha, without reports.view
let withInvoices: Agent; // Alpha + invoices.view / contracts.view

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const RANGE = 'from=2026-01-01&to=2026-01-31';

async function mkTeam(email: string, perms: string[] | null, clientIds: string[]) {
  const u = await prisma.user.create({
    data: { name: email.split('@')[0], email, role: 'TEAM', passwordHash: await hashPassword(PASSWORD), permissions: perms ? JSON.stringify(perms) : null },
  });
  for (const clientId of clientIds) await prisma.clientAssignment.create({ data: { userId: u.id, clientId } });
  return loginAs(email);
}

/** Raw bytes of a response (superagent would otherwise decode - and could hide - the BOM). */
const raw = async (req: request.Test) => {
  const res = await req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return { res, body: Buffer.isBuffer(res.body) ? res.body : Buffer.alloc(0) };
};

let campA3: { id: string }; // Alpha, no reports at all
let campA4: { id: string }; // Alpha, spend but no conversions
let campA5: { id: string }; // Alpha, used for notification tests
let evil: { id: string }; // Alpha campaign with a formula-injection name
let tabCamp: { id: string };

beforeAll(async () => {
  w = await buildWorld();
  const perms = (...remove: string[]) => DEFAULT_TEAM_PERMISSIONS.filter((p) => !remove.includes(p));
  [admin, alice, bob, teamA, teamB, teamC] = await Promise.all(['admin@t.test', 'alice@alpha.test', 'bob@beta.test', 'teama@t.test', 'teamb@t.test', 'teamc@t.test'].map((e) => loginAs(e)));
  noExport = await mkTeam('noexport@t.test', perms('reports.export', 'reports.create'), [w.clientA.id]);
  noReports = await mkTeam('noreports@t.test', perms('reports.view'), [w.clientA.id]);
  withInvoices = await mkTeam('inv@t.test', [...DEFAULT_TEAM_PERMISSIONS, 'invoices.view', 'contracts.view'], [w.clientA.id]);

  // ratios must come from sums: A1 has two days whose CTR / ROAS differ a lot
  await prisma.report.create({ data: { clientId: w.clientA.id, campaignId: w.campA1.id, date: day('2026-01-02'), spend: 50, impressions: 9000, clicks: 90, reach: 5000, conversions: 0, conversionValue: 0 } });
  // A2: a zero row (spend 0, no impressions) and a real day after it
  await prisma.report.create({ data: { clientId: w.clientA.id, campaignId: w.campA2.id, date: day('2026-01-03'), spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, conversionValue: 0 } });
  await prisma.report.create({ data: { clientId: w.clientA.id, campaignId: w.campA2.id, date: day('2026-01-04'), spend: 20, impressions: 200, clicks: 10, reach: 150, conversions: 2, conversionValue: 60 } });

  campA3 = await prisma.campaign.create({ data: { name: 'A3 NoData', clientId: w.clientA.id, platform: 'META', objective: 'TRAFFIC', status: 'RUNNING', budget: 100 } });
  campA4 = await prisma.campaign.create({ data: { name: 'A4 NoConv', clientId: w.clientA.id, platform: 'META', objective: 'TRAFFIC', status: 'RUNNING', budget: 100 } });
  await prisma.report.create({ data: { clientId: w.clientA.id, campaignId: campA4.id, date: day('2026-01-05'), spend: 10, impressions: 100, clicks: 5, reach: 90, conversions: 0, conversionValue: 0 } });
  campA5 = await prisma.campaign.create({ data: { name: 'A5 Notify', clientId: w.clientA.id, platform: 'GOOGLE', objective: 'LEADS', status: 'RUNNING', budget: 100 } });
  evil = await prisma.campaign.create({ data: { name: '=1+1,"x"', clientId: w.clientA.id, platform: 'OTHER', objective: 'LEADS', status: 'RUNNING', budget: 1 } });
  await prisma.report.create({ data: { clientId: w.clientA.id, campaignId: evil.id, date: day('2026-02-01'), spend: 1, impressions: 10, clicks: 1, reach: 5, conversions: 0, conversionValue: 0, notes: 'INTERNAL-REPORT-NOTE' } });
  tabCamp = await prisma.campaign.create({ data: { name: '\tTabbed', clientId: w.clientA.id, platform: 'OTHER', objective: 'LEADS', status: 'RUNNING', budget: 1 } });
  await prisma.report.create({ data: { clientId: w.clientA.id, campaignId: tabCamp.id, date: day('2026-02-02'), spend: 1, impressions: 10, clicks: 1, reach: 5, conversions: 0, conversionValue: 0 } });
});

// ───────────────────────── pure functions ─────────────────────────

describe('metric maths', () => {
  it('recomputes ratios from sums and returns null when a metric cannot be computed', () => {
    const m = metricsFrom({ spend: 150, reach: 0, impressions: 10000, clicks: 140, conversions: 5, conversionValue: 300 }, 2);
    expect(m).toMatchObject({ ctr: 1.4, cpm: 15, cpa: 30, roas: 2, hasData: true, dataPoints: 2 });
    expect(m.cpc).toBeCloseTo(1.0714, 4);
    const none = metricsFrom({ spend: 0, reach: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }, 1);
    expect(none).toMatchObject({ spend: 0, ctr: null, cpc: null, cpm: null, cvr: null, cpa: null, roas: null, hasData: true });
    const empty = metricsFrom({ spend: 0, reach: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }, 0);
    expect(Object.values(empty).filter((v) => v === 0 || Number.isNaN(v))).toEqual([0]); // only dataPoints is 0
    expect(empty).toMatchObject({ spend: null, roas: null, hasData: false, dataPoints: 0 });
  });

  it('deltas: pct is null when the previous value is 0 or null (never Infinity)', () => {
    expect(deltaOf(150, 100)).toEqual({ abs: 50, pct: 50 });
    expect(deltaOf(50, 100)).toEqual({ abs: -50, pct: -50 });
    expect(deltaOf(20, 0)).toEqual({ abs: 20, pct: null });
    expect(deltaOf(20, null)).toEqual({ abs: null, pct: null });
    expect(deltaOf(null, 5)).toEqual({ abs: null, pct: null });
  });

  it('previous-year shifts by one calendar year and clamps 29 Feb', () => {
    expect(minusYear('2026-03-01')).toBe('2025-03-01');
    expect(minusYear('2024-02-29')).toBe('2023-02-28');
  });

  it('budget pacing', () => {
    const c = { budget: 100, startDate: day('2026-01-01'), endDate: day('2026-01-10') };
    expect(pacing(c, 50, new Date('2026-01-05T12:00:00Z'))).toMatchObject({ spentPct: 50, elapsedPct: 50, status: 'on_track' });
    expect(pacing(c, 90, new Date('2026-01-03T12:00:00Z')).status).toBe('fast');
    expect(pacing(c, 10, new Date('2026-01-09T12:00:00Z')).status).toBe('slow');
    expect(pacing(c, 120, new Date('2026-01-05T12:00:00Z')).status).toBe('over_budget');
    expect(pacing({ budget: 0, startDate: null, endDate: null }, 5)).toMatchObject({ spentPct: null, elapsedPct: null, status: null, remaining: null });
  });

  it('csv cells: escaping and formula-injection protection', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe('"\'\rx"');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(-3)).toBe('-3'); // real numbers are not text
    expect(csvCell(null)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
    expect(toCsv(['a'], [['b']])).toBe('﻿a\r\nb\r\n');
  });
});

// ───────────────────────── analytics ─────────────────────────

describe('analytics: scoping', () => {
  const ids = (res: request.Response) => (res.body.items as Array<{ campaign: { id: string } }>).map((i) => i.campaign.id).sort();

  it('CLIENT sees only their own company campaigns and totals', async () => {
    const res = await alice.get(`/api/analytics/campaigns?${RANGE}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([w.campA1.id, w.campA2.id, campA3.id, campA4.id, campA5.id, evil.id, tabCamp.id].sort());
    expect(JSON.stringify(res.body)).not.toContain(w.campB1.id);
    expect(JSON.stringify(res.body)).not.toContain('Beta Co');
    // Alpha only: A1 (100+50) + A2 (0+20) + A4 (10)
    expect(res.body.totals.spend).toBe(180);
    const bobRes = await bob.get(`/api/analytics/campaigns?${RANGE}`);
    expect(ids(bobRes)).toEqual([w.campB1.id]);
    expect(bobRes.body.totals.spend).toBe(200);
  });

  it('CLIENT cannot read another company campaign / client (404) or the client comparison (403)', async () => {
    expect((await alice.get(`/api/analytics/campaign/${w.campB1.id}`)).status).toBe(404);
    expect((await alice.get(`/api/analytics/client/${w.clientB.id}`)).status).toBe(404);
    expect((await alice.get('/api/analytics/clients')).status).toBe(403);
    expect((await alice.get(`/api/analytics/compare?scope=client&id=${w.clientB.id}&${RANGE}&mode=previous_period`)).status).toBe(404);
    expect((await alice.get(`/api/analytics/compare?scope=campaign&id=${w.campB1.id}&${RANGE}&mode=previous_period`)).status).toBe(404);
    // asking for someone else's clientId as a filter yields nothing, not their data
    const res = await alice.get(`/api/analytics/campaigns?clientId=${w.clientB.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totals.hasData).toBe(false);
  });

  it('TEAM sees only assigned clients; campaign-level assignment only that campaign', async () => {
    expect(ids(await teamB.get(`/api/analytics/campaigns?${RANGE}`))).toEqual([w.campB1.id]);
    expect(ids(await teamC.get(`/api/analytics/campaigns?${RANGE}`))).toEqual([w.campA2.id]);
    const c = await teamC.get(`/api/analytics/campaigns?${RANGE}`);
    expect(c.body.totals.spend).toBe(20);
    expect((await teamC.get(`/api/analytics/campaign/${w.campA1.id}`)).status).toBe(404);
    expect((await teamC.get(`/api/analytics/campaign/${w.campA2.id}`)).status).toBe(200);
    expect((await teamA.get(`/api/analytics/campaign/${w.campB1.id}`)).status).toBe(404);
    expect((await teamB.get(`/api/analytics/client/${w.clientA.id}`)).status).toBe(404);
    // client A is visible to teamC (through A2) but only A2's numbers count
    const cl = await teamC.get(`/api/analytics/client/${w.clientA.id}?${RANGE}`);
    expect(cl.status).toBe(200);
    expect(cl.body.totals.spend).toBe(20);
    expect(cl.body.totals.dataPoints).toBe(2);
    const list = await teamC.get(`/api/analytics/clients?${RANGE}`);
    expect(list.body.items.map((i: { client: { id: string } }) => i.client.id)).toEqual([w.clientA.id]);
    expect(list.body.totals.spend).toBe(20);
  });

  it('per-client comparison: ADMIN sees all clients, TEAM only theirs', async () => {
    const a = await admin.get(`/api/analytics/clients?${RANGE}&sort=spend`);
    expect(a.status).toBe(200);
    expect(a.body.items.map((i: { client: { id: string } }) => i.client.id)).toEqual([w.clientB.id, w.clientA.id]); // B 200 > A 180
    expect(a.body.totals.spend).toBe(380);
    const t = await teamA.get(`/api/analytics/clients?${RANGE}`);
    expect(t.body.items.map((i: { client: { id: string } }) => i.client.id)).toEqual([w.clientA.id]);
    expect(t.body.totals.spend).toBe(180);
    expect(JSON.stringify(t.body)).not.toContain('Beta Co');
  });

  it('ADMIN sees every campaign', async () => {
    const res = await admin.get(`/api/analytics/campaigns?${RANGE}`);
    expect(ids(res)).toContain(w.campB1.id);
    expect(ids(res)).toContain(w.campA1.id);
    expect(res.body.totals.spend).toBe(380);
  });

  it('permissions: reports.view is required for staff', async () => {
    expect((await noReports.get('/api/analytics/campaigns')).status).toBe(403);
    expect((await noReports.get('/api/analytics/summary')).status).toBe(403);
    expect((await noReports.get('/api/analytics/clients')).status).toBe(403);
    expect((await noReports.get('/api/reports')).status).toBe(403);
    expect((await noExport.get('/api/analytics/campaigns')).status).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await (await import('supertest')).default((await import('./helpers')).app).get('/api/analytics/summary');
    expect(res.status).toBe(401);
  });
});

describe('analytics: numbers', () => {
  it('ratios are recomputed from summed raw fields, not averaged', async () => {
    const res = await admin.get(`/api/analytics/campaign/${w.campA1.id}?${RANGE}`);
    expect(res.status).toBe(200);
    const t = res.body.totals;
    expect(t).toMatchObject({ spend: 150, impressions: 10000, clicks: 140, conversions: 5, conversionValue: 300, reach: 5800, dataPoints: 2, hasData: true });
    expect(t.ctr).toBe(1.4); // an average of 5% and 1% would be 3
    expect(t.cpm).toBe(15);
    expect(t.cpa).toBe(30);
    expect(t.roas).toBe(2); // an average of 3 and 0 would be 1.5
    expect(t.cvr).toBeCloseTo(3.5714, 4);
    expect(t.cpc).toBeCloseTo(1.0714, 4);
    expect(res.body.series.map((p: { date: string }) => p.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(res.body.series[1]).toMatchObject({ spend: 50, ctr: 1, roas: 0, cpa: null });
    expect(res.body.campaign).toMatchObject({ id: w.campA1.id, platform: 'META', clientName: 'Alpha Co' });
  });

  it('a campaign with no reports returns null metrics, hasData false and dataPoints 0', async () => {
    const res = await admin.get(`/api/analytics/campaign/${campA3.id}?${RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      spend: null, impressions: null, reach: null, clicks: null, conversions: null, conversionValue: null,
      ctr: null, cpc: null, cpm: null, cvr: null, cpa: null, roas: null, dataPoints: 0, hasData: false,
    });
    expect(res.body.series).toEqual([]);
    // the table row too
    const table = await admin.get(`/api/analytics/campaigns?${RANGE}`);
    const row = table.body.items.find((i: { campaign: { id: string } }) => i.campaign.id === campA3.id);
    expect(row.metrics.hasData).toBe(false);
    expect(row.metrics.ctr).toBeNull();
  });

  it('zero rows and missing denominators give null, never 0 / NaN / Infinity', async () => {
    const zero = await admin.get(`/api/analytics/campaign/${w.campA2.id}?from=2026-01-03&to=2026-01-03`);
    expect(zero.body.totals).toMatchObject({ spend: 0, impressions: 0, hasData: true, dataPoints: 1, ctr: null, cpc: null, cpm: null, cvr: null, cpa: null, roas: null });
    const noConv = await admin.get(`/api/analytics/campaign/${campA4.id}?${RANGE}`);
    expect(noConv.body.totals).toMatchObject({ ctr: 5, cpc: 2, cpm: 100, cvr: 0, cpa: null, roas: 0 });
    for (const path of [`/api/analytics/campaigns?${RANGE}`, `/api/analytics/clients?${RANGE}`, `/api/analytics/client/${w.clientA.id}?${RANGE}`, `/api/analytics/summary?${RANGE}`]) {
      const res = await admin.get(path);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/NaN|Infinity/);
    }
  });

  it('table: filters and sorting (nulls last)', async () => {
    const meta = await admin.get(`/api/analytics/campaigns?${RANGE}&platform=META`);
    expect(meta.body.items.every((i: { campaign: { platform: string } }) => i.campaign.platform === 'META')).toBe(true);
    const byRoas = await admin.get(`/api/analytics/campaigns?${RANGE}&sort=roas&dir=desc`);
    const roas = byRoas.body.items.map((i: { metrics: { roas: number | null } }) => i.metrics.roas);
    const firstNull = roas.findIndex((r: number | null) => r === null);
    expect(firstNull).toBeGreaterThan(0);
    expect(roas.slice(firstNull).every((r: number | null) => r === null)).toBe(true);
    expect(roas.slice(0, firstNull)).toEqual([...roas.slice(0, firstNull)].sort((a: number, b: number) => b - a));
    const byClient = await admin.get(`/api/analytics/campaigns?${RANGE}&clientId=${w.clientB.id}`);
    expect(ids2(byClient)).toEqual([w.campB1.id]);
    const ranged = await admin.get('/api/analytics/campaigns?from=2026-01-02&to=2026-01-02');
    const a1 = ranged.body.items.find((i: { campaign: { id: string } }) => i.campaign.id === w.campA1.id);
    expect(a1.metrics.spend).toBe(50);
  });

  it('client performance: platform breakdown, best / worst by ROAS, daily series', async () => {
    const res = await admin.get(`/api/analytics/client/${w.clientA.id}?${RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({ id: w.clientA.id, companyName: 'Alpha Co' });
    const meta = res.body.byPlatform.find((p: { platform: string }) => p.platform === 'META');
    expect(meta.metrics.spend).toBe(160); // A1 150 + A4 10
    const google = res.body.byPlatform.find((p: { platform: string }) => p.platform === 'GOOGLE');
    expect(google.metrics).toMatchObject({ spend: 20, roas: 3 });
    const top = res.body.topCampaigns.map((c: { id: string }) => c.id);
    const bottom = res.body.bottomCampaigns.map((c: { id: string }) => c.id);
    expect(top[0]).toBe(w.campA2.id); // ROAS 3
    expect(top.filter((id: string) => bottom.includes(id))).toEqual([]);
    // every ranked campaign has a real ROAS (campaigns without spend are excluded)
    for (const c of [...res.body.topCampaigns, ...res.body.bottomCampaigns]) expect(c.metrics.roas).not.toBeNull();
    expect(res.body.series.length).toBeGreaterThan(0);
  });

  it('campaign budget vs spent and pacing', async () => {
    const res = await admin.get(`/api/analytics/campaign/${w.campA1.id}`);
    expect(res.body.budget).toMatchObject({ budget: 1000, spent: 150, remaining: 850, spentPct: 15, elapsedPct: null, status: null });
  });

  it('summary: headline numbers with the previous period', async () => {
    const res = await alice.get('/api/analytics/summary?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(200);
    expect(res.body.metrics.spend).toBe(180);
    expect(res.body.range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(res.body.previousRange).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(res.body.previous.hasData).toBe(false);
    expect(res.body.deltas.spend).toEqual({ abs: null, pct: null });
    expect(res.body.campaigns.total).toBeGreaterThanOrEqual(5);
    expect((await alice.get('/api/analytics/summary')).status).toBe(200); // default window works
  });
});

const ids2 = (res: request.Response) => (res.body.items as Array<{ campaign: { id: string } }>).map((i) => i.campaign.id).sort();

describe('analytics: period comparison', () => {
  it('custom periods: absolute and percentage deltas', async () => {
    const res = await admin.get(`/api/analytics/compare?scope=campaign&id=${w.campA1.id}&from=2026-01-02&to=2026-01-02&compareFrom=2026-01-01&compareTo=2026-01-01`);
    expect(res.status).toBe(200);
    expect(res.body.current.metrics.spend).toBe(50);
    expect(res.body.previous.metrics.spend).toBe(100);
    expect(res.body.deltas.spend).toEqual({ abs: -50, pct: -50 });
    expect(res.body.deltas.ctr).toEqual({ abs: -4, pct: -80 });
    expect(res.body.deltas.roas).toEqual({ abs: -3, pct: -100 });
    expect(res.body.deltas.cpa).toEqual({ abs: null, pct: null }); // no conversions on the current day
  });

  it('percentage is null when the previous value is 0 (not Infinity)', async () => {
    const res = await admin.get(`/api/analytics/compare?scope=campaign&id=${w.campA2.id}&from=2026-01-04&to=2026-01-04&compareFrom=2026-01-03&compareTo=2026-01-03`);
    expect(res.body.previous.metrics.spend).toBe(0);
    expect(res.body.deltas.spend).toEqual({ abs: 20, pct: null });
    expect(res.body.deltas.ctr).toEqual({ abs: null, pct: null }); // previous CTR could not be computed
    expect(res.text).not.toMatch(/NaN|Infinity/);
  });

  it('presets are resolved on the server', async () => {
    const pp = await admin.get('/api/analytics/compare?from=2026-01-08&to=2026-01-14&mode=previous_period');
    expect(pp.status).toBe(200);
    expect(pp.body).toMatchObject({ mode: 'previous_period', scope: 'all' });
    expect(pp.body.previous).toMatchObject({ from: '2026-01-01', to: '2026-01-07' });
    const py = await admin.get('/api/analytics/compare?from=2026-01-01&to=2026-01-31&mode=previous_year');
    expect(py.body.previous).toMatchObject({ from: '2025-01-01', to: '2025-01-31' });
    expect(py.body.current.metrics.spend).toBe(380);
    expect(py.body.previous.metrics.hasData).toBe(false);
    const leap = await admin.get('/api/analytics/compare?from=2024-02-29&to=2024-03-01&mode=previous_year');
    expect(leap.body.previous).toMatchObject({ from: '2023-02-28', to: '2023-03-01' });
  });

  it('client scoped comparison honours the caller scope', async () => {
    const res = await alice.get(`/api/analytics/compare?scope=client&id=${w.clientA.id}&${RANGE}&mode=previous_period`);
    expect(res.status).toBe(200);
    expect(res.body.current.metrics.spend).toBe(180);
    // without a scope the caller still only gets their own data
    const all = await alice.get(`/api/analytics/compare?${RANGE}&mode=previous_period`);
    expect(all.body.current.metrics.spend).toBe(180);
  });

  it('validates its input', async () => {
    expect((await admin.get('/api/analytics/compare?mode=previous_period')).status).toBe(400); // from / to required
    expect((await admin.get(`/api/analytics/compare?${RANGE}`)).body.error.fields).toMatchObject({ compareFrom: 'required', compareTo: 'required' });
    expect((await admin.get('/api/analytics/compare?scope=client&from=2026-01-01&to=2026-01-31&mode=previous_period')).body.error.fields).toMatchObject({ id: 'required' });
  });
});

describe('analytics: date validation', () => {
  it('rejects invalid dates, reversed and oversized ranges', async () => {
    for (const q of ['from=2026-13-45', 'from=nope', 'to=2026-02-31', 'from=2026-1-1']) {
      const res = await admin.get(`/api/analytics/campaigns?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const rev = await admin.get('/api/analytics/campaigns?from=2026-02-01&to=2026-01-01');
    expect(rev.status).toBe(400);
    expect(rev.body.error.fields.to).toBe('end_before_start');
    const big = await admin.get('/api/analytics/campaigns?from=2023-01-01&to=2026-01-01');
    expect(big.status).toBe(400);
    expect(big.body.error.fields.to).toBe('range_too_large');
    expect((await admin.get('/api/analytics/campaigns?from=2024-01-01&to=2025-12-31')).status).toBe(200); // 731 days = two years
    expect((await admin.get('/api/analytics/campaigns?from=2024-01-01&to=2026-01-01')).status).toBe(400);
    expect((await admin.get('/api/analytics/campaign/x')).status).toBe(404);
  });
});

// ───────────────────────── CSV export ─────────────────────────

describe('CSV export', () => {
  it('daily export: BOM, headers, escaping, formula protection, no internal fields', async () => {
    const { res, body } = await raw(admin.get('/api/reports/export.csv?from=2026-01-01&to=2026-12-31'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="reports-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect([body[0], body[1], body[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = body.toString('utf8');
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('Date,Client,Campaign,Platform,Spend,Reach,Impressions,Clicks,CTR %,CPC,CPM,Conversions,Conversion value,CVR %,CPA,ROAS');
    expect(text).toContain('"\'=1+1,""x"""'); // formula prefix + quoting + doubled quotes
    expect(text).toContain("'\tTabbed");
    expect(text).not.toContain('INTERNAL-REPORT-NOTE');
    expect(text).toContain('2026-01-01,Alpha Co,A1 Launch,META,100,800,1000,50,5,2,100,5,300,10,20,3');
    // an unusable ratio is an empty cell, never 0 / NaN
    expect(text).toContain('2026-01-03,Alpha Co,A2 Leads,GOOGLE,0,0,0,0,,,,0,0,,,');
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('hard cap constant and Arabic headers', async () => {
    expect((await import('../services/csv')).CSV_MAX_ROWS).toBe(50_000);
    const { body } = await raw(admin.get('/api/reports/export.csv?lang=ar'));
    expect(body.toString('utf8').split('\r\n')[0]).toContain('التاريخ');
  });

  it('campaign table export with totals row', async () => {
    const { res, body } = await raw(admin.get(`/api/analytics/export.csv?${RANGE}&sort=name&dir=asc`));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="campaign-performance-/);
    const lines = body.toString('utf8').slice(1).trim().split('\r\n');
    expect(lines[0].startsWith('Client,Campaign,Platform,Objective,Status,Budget,Spend')).toBe(true);
    expect(lines.find((l) => l.includes('A1 Launch'))).toBe('Alpha Co,A1 Launch,META,SALES,RUNNING,1000,150,5800,10000,140,1.4,1.0714,15,5,300,3.5714,30,2,2');
    expect(lines.find((l) => l.includes('A3 NoData'))).toBe(`Alpha Co,A3 NoData,META,TRAFFIC,RUNNING,100${','.repeat(13)}0`); // nothing invented
    expect(lines[lines.length - 1].startsWith('Total,')).toBe(true);
  });

  it('permission: reports.export is required for TEAM', async () => {
    expect((await noExport.get('/api/reports/export.csv')).status).toBe(403);
    expect((await noExport.get('/api/analytics/export.csv')).status).toBe(403);
    expect((await noReports.get('/api/reports/export.csv')).status).toBe(403);
    expect((await teamA.get('/api/reports/export.csv')).status).toBe(200);
    expect((await teamA.get('/api/analytics/export.csv')).status).toBe(200);
  });

  it('exports are limited to the caller scope (CLIENT own client, TEAM assigned)', async () => {
    for (const path of ['/api/reports/export.csv', '/api/analytics/export.csv']) {
      const a = (await alice.get(path)).text;
      expect(a).toContain('Alpha Co');
      expect(a).not.toContain('Beta Co');
      expect(a).not.toContain('B1 Awareness');
      expect((await bob.get(path)).text).not.toContain('Alpha Co');
      expect((await teamB.get(path)).text).not.toContain('Alpha Co');
      expect((await teamC.get(path)).text).not.toContain('A1 Launch');
      // asking for another company's client id changes nothing
      const x = (await alice.get(`${path}?clientId=${w.clientB.id}`)).text;
      expect(x).not.toContain('Beta Co');
    }
  });

  it('writes an internal REPORT_EXPORTED audit row', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'REPORT_EXPORTED' } });
    await alice.get('/api/reports/export.csv');
    await admin.get(`/api/analytics/export.csv?clientId=${w.clientA.id}`);
    const rows = await prisma.auditLog.findMany({ where: { action: 'REPORT_EXPORTED' }, orderBy: { createdAt: 'desc' }, take: 2 });
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_EXPORTED' } })).toBe(before + 2);
    expect(rows.every((r) => r.clientVisible === false && r.entity === 'report' && r.clientId === w.clientA.id)).toBe(true);
    expect(rows.some((r) => r.userId === w.userA.id)).toBe(true);
    // a TEAM member cannot attach an export to a client they do not own
    await teamB.get(`/api/analytics/export.csv?clientId=${w.clientA.id}`);
    const foreign = await prisma.auditLog.findFirst({ where: { action: 'REPORT_EXPORTED', userId: w.teamB.id }, orderBy: { createdAt: 'desc' } });
    expect(foreign?.clientId).toBeNull();
  });
});

// ───────────────────────── global search ─────────────────────────

describe('global search', () => {
  let visibleContentB: string;
  let hiddenProject: string;
  let invA: string;
  let invDraft: string;
  let taskA: string;

  beforeAll(async () => {
    const { clientA, clientB, admin: adm } = w;
    const submitted = new Date();
    const mkDel = (clientId: string, name: string) => prisma.deliverable.create({ data: { name, clientId, type: 'DESIGN', status: 'PENDING_APPROVAL', submittedAt: submitted } });
    const delA = await mkDel(clientA.id, 'Zebra deliverable A');
    await mkDel(clientB.id, 'Zebra deliverable B');
    await prisma.deliverable.create({ data: { name: 'Zebra unsent draft', clientId: clientA.id, type: 'DESIGN', status: 'DRAFT' } });

    await prisma.project.create({ data: { clientId: clientA.id, name: 'Zebra Rebrand A', description: 'zebra stripes' } });
    hiddenProject = (await prisma.project.create({ data: { clientId: clientA.id, name: 'Zebra Internal A', visibleToClient: false } })).id;
    await prisma.project.create({ data: { clientId: clientB.id, name: 'Zebra Rebrand B' } });
    await prisma.project.create({ data: { clientId: clientA.id, name: 'snake_case project' } });
    await prisma.project.create({ data: { clientId: clientA.id, name: 'snakeXcase project' } });

    taskA = (await prisma.task.create({ data: { clientId: clientA.id, title: 'Zebra task A', description: 'do it' } })).id;
    await prisma.task.create({ data: { clientId: clientB.id, title: 'Zebra task B' } });
    await prisma.task.create({ data: { clientId: clientA.id, title: '100% done' } });
    await prisma.task.create({ data: { clientId: clientA.id, title: '1000 done' } });
    for (let i = 0; i < 12; i++) await prisma.task.create({ data: { clientId: clientA.id, title: `bulk item ${i}` } });

    await prisma.clientContact.create({ data: { clientId: clientA.id, name: 'Zoe Zebra', jobTitle: 'CEO', email: 'zoe@alpha.test', notes: 'SECRET-CONTACT-NOTE', visibleToClient: true } });
    await prisma.clientContact.create({ data: { clientId: clientB.id, name: 'Zed Zebra', email: 'zed@beta.test' } });

    await prisma.contentItem.create({ data: { clientId: clientA.id, title: 'Zebra post sent A', deliverableId: delA.id, notes: 'SECRET-CONTENT-NOTE' } });
    await prisma.contentItem.create({ data: { clientId: clientA.id, title: 'Zebra post unsent A' } });
    const delB = await mkDel(clientB.id, 'Zebra content deliverable B');
    visibleContentB = (await prisma.contentItem.create({ data: { clientId: clientB.id, title: 'Zebra post B', deliverableId: delB.id } })).id;

    invA = (await prisma.invoice.create({ data: { clientId: clientA.id, invoiceNumber: 'ZEBRA-001', issueDate: day('2026-01-01'), dueDate: day('2026-02-01'), amount: 10, total: 10, status: 'SENT', visibleToClient: true, notes: 'SECRET-INVOICE-NOTE' } })).id;
    invDraft = (await prisma.invoice.create({ data: { clientId: clientA.id, invoiceNumber: 'ZEBRA-002', issueDate: day('2026-01-01'), dueDate: day('2026-02-01'), amount: 10, total: 10, status: 'DRAFT', visibleToClient: true } })).id;
    await prisma.invoice.create({ data: { clientId: clientA.id, invoiceNumber: 'ZEBRA-003', issueDate: day('2026-01-01'), dueDate: day('2026-02-01'), amount: 10, total: 10, status: 'SENT', visibleToClient: false } });
    await prisma.invoice.create({ data: { clientId: clientB.id, invoiceNumber: 'ZEBRA-B01', issueDate: day('2026-01-01'), dueDate: day('2026-02-01'), amount: 10, total: 10, status: 'SENT', visibleToClient: true } });
    await prisma.contract.create({ data: { clientId: clientA.id, name: 'Zebra retainer A', contractNumber: 'C-ZEB-A', status: 'ACTIVE', visibleToClient: true, notes: 'SECRET-CONTRACT-NOTE' } });
    await prisma.contract.create({ data: { clientId: clientB.id, name: 'Zebra retainer B', contractNumber: 'C-ZEB-B', status: 'ACTIVE', visibleToClient: true } });

    const mkFile = (clientId: string, fileName: string, visibleToClient: boolean) => prisma.file.create({ data: { clientId, fileName, filePath: `k/${fileName}`, fileType: 'image/png', size: 1, visibleToClient, uploadedById: adm.id } });
    await mkFile(clientA.id, 'zebra-brief.png', true);
    await mkFile(clientA.id, 'zebra-hidden.png', false);
    await mkFile(clientB.id, 'zebra-beta.png', true);
    await prisma.client.update({ where: { id: clientA.id }, data: { internalNotes: 'SECRET-CLIENT-NOTE' } });
  });

  const search = (agent: Agent, q: string, extra = '') => agent.get(`/api/search?q=${encodeURIComponent(q)}${extra}`);
  const titles = (res: request.Response, type?: string) => (res.body.items as Array<{ type: string; title: string }>).filter((i) => !type || i.type === type).map((i) => i.title).sort();

  it('requires authentication and a 2..80 character query', async () => {
    expect((await request(app).get('/api/search?q=zebra')).status).toBe(401);
    expect((await search(admin, 'z')).status).toBe(400);
    expect((await search(admin, ' a ')).status).toBe(400);
    expect((await admin.get('/api/search')).status).toBe(400);
    expect((await search(admin, 'x'.repeat(81))).status).toBe(400);
    expect((await search(admin, 'x'.repeat(80))).status).toBe(200);
    expect((await search(admin, 'ze')).status).toBe(200);
  });

  it('CLIENT only finds their own shared items - never tasks, contacts, clients, other companies or internal data', async () => {
    const res = await search(alice, 'zebra');
    expect(res.status).toBe(200);
    const types = new Set((res.body.items as Array<{ type: string }>).map((i) => i.type));
    expect(types.has('task')).toBe(false);
    expect(types.has('contact')).toBe(false);
    expect(types.has('client')).toBe(false);
    expect(res.body.types).not.toContain('task');
    expect(titles(res, 'project')).toEqual(['Zebra Rebrand A']); // the internal-only project is invisible
    expect(titles(res, 'deliverable')).toEqual(['Zebra deliverable A']); // the unsent draft too
    expect(titles(res, 'content')).toEqual(['Zebra post sent A']);
    expect(titles(res, 'invoice')).toEqual(['ZEBRA-001']); // no draft, no unshared invoice
    expect(titles(res, 'contract')).toEqual(['Zebra retainer A']);
    expect(titles(res, 'file')).toEqual(['zebra-brief.png']);
    const json = JSON.stringify(res.body);
    for (const bad of ['Beta', 'zed@beta', 'SECRET', 'Zebra Internal', 'ZEBRA-B01', hiddenProject, invDraft, taskA, visibleContentB]) expect(json).not.toContain(bad);
    // the client-facing hits do not repeat the company name
    expect((res.body.items as Array<{ clientName?: string }>).every((i) => i.clientName === undefined)).toBe(true);
  });

  it('search never searches internal notes / hidden columns', async () => {
    for (const term of ['SECRET-CONTACT-NOTE', 'SECRET-CONTENT-NOTE', 'SECRET-INVOICE-NOTE', 'SECRET-CONTRACT-NOTE', 'SECRET-CLIENT-NOTE', 'INTERNAL-REPORT-NOTE']) {
      for (const who of [admin, alice, teamA, withInvoices]) expect((await search(who, term)).body.items).toEqual([]);
    }
  });

  it('TEAM sees only their clients: tasks and contacts yes, another client no', async () => {
    const res = await search(teamA, 'zebra');
    expect(titles(res, 'task')).toEqual(['Zebra task A']);
    expect(titles(res, 'contact')).toEqual(['Zoe Zebra']);
    expect(titles(res, 'project')).toEqual(['Zebra Internal A', 'Zebra Rebrand A']);
    expect(titles(res, 'deliverable')).toContain('Zebra unsent draft');
    expect(JSON.stringify(res.body)).not.toMatch(/Beta|zed@beta|Zebra task B|Zebra Rebrand B/);
    expect(titles(res, 'file')).toEqual(['zebra-brief.png', 'zebra-hidden.png']);
    const b = await search(teamB, 'zebra');
    expect(titles(b, 'task')).toEqual(['Zebra task B']);
    expect(JSON.stringify(b.body)).not.toContain('Alpha');
    // campaign-level assignment (teamC): only A2 (query must be >=2 chars per the validation rule above)
    const c = await search(teamC, 'Leads');
    expect(titles(c, 'campaign')).toEqual(['A2 Leads']);
    expect(titles(c, 'task')).toEqual([]);
    expect(titles(await search(teamC, 'Launch'), 'campaign')).toEqual([]);
  });

  it('TEAM without invoices.view / contracts.view gets no invoices or contracts; with them they appear', async () => {
    const plain = await search(teamA, 'zebra');
    expect(titles(plain, 'invoice')).toEqual([]);
    expect(titles(plain, 'contract')).toEqual([]);
    expect(plain.body.types).not.toContain('invoice');
    expect(JSON.stringify(plain.body)).not.toContain('ZEBRA-00');
    const fin = await search(withInvoices, 'zebra');
    expect(titles(fin, 'invoice')).toEqual(['ZEBRA-001', 'ZEBRA-002', 'ZEBRA-003']);
    expect(titles(fin, 'contract')).toEqual(['Zebra retainer A']);
    // team without clients.view: no clients / contacts
    const noClients = await mkTeam('noclients@t.test', DEFAULT_TEAM_PERMISSIONS.filter((p) => p !== 'clients.view' && p !== 'tasks.view'), [w.clientA.id]);
    const r = await search(noClients, 'zebra');
    expect(titles(r, 'contact')).toEqual([]);
    expect(titles(r, 'client')).toEqual([]);
    expect(titles(r, 'task')).toEqual([]);
  });

  it('ADMIN sees every company', async () => {
    const res = await search(admin, 'zebra', '&limit=10');
    expect(titles(res, 'project')).toEqual(['Zebra Internal A', 'Zebra Rebrand A', 'Zebra Rebrand B']);
    expect(titles(res, 'invoice')).toEqual(['ZEBRA-001', 'ZEBRA-002', 'ZEBRA-003', 'ZEBRA-B01']);
    expect(titles(res, 'contact')).toEqual(['Zed Zebra', 'Zoe Zebra']);
  });

  it('LIKE wildcards are matched literally', async () => {
    const pct = await search(admin, '0%');
    expect(titles(pct, 'task')).toEqual(['100% done']); // a raw LIKE would also match "1000 done"
    const us = await search(admin, 'e_c');
    expect(titles(us, 'project')).toEqual(['snake_case project']);
    expect(titles(await search(admin, '% d'), 'task')).toEqual(['100% done']);
    expect((await search(admin, '%%')).body.items).toEqual([]); // matches nothing instead of everything
    expect((await search(admin, '__')).body.items).toEqual([]);
  });

  it('returns whitelisted fields only, with frontend urls; limit and type filters work', async () => {
    const res = await search(admin, 'zebra', '&limit=10');
    const allowed = new Set(['type', 'id', 'title', 'subtitle', 'status', 'clientName', 'url']);
    for (const hit of res.body.items as Array<Record<string, unknown>>) {
      expect(Object.keys(hit).every((k) => allowed.has(k))).toBe(true);
      expect(String(hit.url)).toMatch(/^\//);
    }
    const url = (type: string, title: string) => (res.body.items as Array<{ type: string; title: string; url: string }>).find((i) => i.type === type && i.title === title)?.url;
    expect(url('project', 'Zebra Rebrand A')).toMatch(/^\/projects\/\w+$/);
    expect(url('task', 'Zebra task A')).toContain(`/tasks?task=${taskA}`);
        const bulk = await search(admin, 'bulk item');
    expect(titles(bulk, 'task')).toHaveLength(5); // default: top 5 per type
    expect(titles(await search(admin, 'bulk item', '&limit=50'), 'task')).toHaveLength(10); // hard cap 10
    expect(titles(await search(admin, 'bulk item', '&limit=3'), 'task')).toHaveLength(3);
    const only = await search(admin, 'zebra', '&types=project,nonsense');
    expect(new Set((only.body.items as Array<{ type: string }>).map((i) => i.type))).toEqual(new Set(['project']));
    const clients = await search(admin, 'alpha');
    expect(titles(clients, 'client')).toEqual(['Alpha Co']);
    expect((clients.body.items as Array<{ type: string; url: string }>).find((i) => i.type === 'client')?.url).toBe(`/clients/${w.clientA.id}`);
  });

  it('client search never reveals the record when it is outside scope (CLIENT B cannot find A)', async () => {
    const res = await search(bob, 'zebra');
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('Alpha');
    expect(json).not.toContain('zebra-brief');
    expect(titles(res, 'project')).toEqual(['Zebra Rebrand B']);
    expect(titles(res, 'content')).toEqual(['Zebra post B']);
  });
});

// ───────────────────────── calendar ─────────────────────────

describe('calendar', () => {
  const Q = 'from=2026-03-01&to=2026-03-31';
  let hiddenProject: string;

  beforeAll(async () => {
    const { clientA, clientB } = w;
    const mk = async (c: { id: string }, tag: string) => {
      await prisma.task.create({ data: { clientId: c.id, title: `Task ${tag}`, dueDate: day('2026-03-10') } });
      const p = await prisma.project.create({ data: { clientId: c.id, name: `Project ${tag}`, dueDate: day('2026-03-12') } });
      await prisma.milestone.create({ data: { projectId: p.id, title: `Milestone ${tag}`, dueDate: day('2026-03-15') } });
      const del = await prisma.deliverable.create({ data: { name: `Del ${tag}`, clientId: c.id, type: 'DESIGN', status: 'PENDING_APPROVAL', submittedAt: new Date(), dueDate: day('2026-03-13') } });
      await prisma.deliverable.create({ data: { name: `Unsent ${tag}`, clientId: c.id, type: 'DESIGN', status: 'DRAFT', dueDate: day('2026-03-13') } });
      await prisma.contentItem.create({ data: { clientId: c.id, title: `Post ${tag}`, publishDate: new Date('2026-03-11T10:00:00Z'), deliverableId: del.id } });
      await prisma.contentItem.create({ data: { clientId: c.id, title: `Unsent post ${tag}`, publishDate: new Date('2026-03-11T12:00:00Z') } });
      await prisma.campaign.create({ data: { name: `Camp ${tag}`, clientId: c.id, platform: 'META', objective: 'SALES', startDate: day('2026-03-05'), endDate: day('2026-03-20') } });
      await prisma.invoice.create({ data: { clientId: c.id, invoiceNumber: `CAL-${tag}`, issueDate: day('2026-03-01'), dueDate: day('2026-03-18'), amount: 1, total: 1, status: 'SENT', visibleToClient: true } });
      await prisma.invoice.create({ data: { clientId: c.id, invoiceNumber: `CAL-DRAFT-${tag}`, issueDate: day('2026-03-01'), dueDate: day('2026-03-19'), amount: 1, total: 1, status: 'DRAFT', visibleToClient: true } });
      await prisma.contract.create({ data: { clientId: c.id, name: `Contract ${tag}`, contractNumber: `CC-${tag}`, endDate: day('2026-03-25'), renewalDate: day('2026-03-26'), status: 'ACTIVE', visibleToClient: true } });
      await prisma.contract.create({ data: { clientId: c.id, name: `Private contract ${tag}`, contractNumber: `CP-${tag}`, endDate: day('2026-03-27'), status: 'ACTIVE', visibleToClient: false } });
      await prisma.client.update({ where: { id: c.id }, data: { contractEnd: day('2026-03-30') } });
    };
    await mk(clientA, 'A');
    await mk(clientB, 'B');
    hiddenProject = (await prisma.project.create({ data: { clientId: clientA.id, name: 'Hidden project A', visibleToClient: false, dueDate: day('2026-03-14') } })).id;
    await prisma.milestone.create({ data: { projectId: hiddenProject, title: 'Hidden milestone A', dueDate: day('2026-03-14') } });
  });

  const get = (agent: Agent, q = Q) => agent.get(`/api/calendar?${q}`);
  type Ev = { key: string; type: string; kind: string; title: string; date: string; url: string; colorKey: string; clientName?: string };
  const evs = (res: request.Response) => res.body.items as Ev[];
  const titles = (res: request.Response, type?: string) => evs(res).filter((e) => !type || e.type === type).map((e) => e.title).sort();

  it('requires authentication, a valid range and at most 100 days', async () => {
    expect((await request(app).get(`/api/calendar?${Q}`)).status).toBe(401);
    expect((await admin.get('/api/calendar')).status).toBe(400);
    expect((await admin.get('/api/calendar?from=2026-03-01')).status).toBe(400);
    expect((await admin.get('/api/calendar?from=2026-13-01&to=2026-14-01')).status).toBe(400);
    expect((await admin.get('/api/calendar?from=2026-03-31&to=2026-03-01')).status).toBe(400);
    const tooBig = await admin.get('/api/calendar?from=2026-01-01&to=2026-04-11'); // 101 days
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.fields.to).toBe('range_too_large');
    expect((await admin.get('/api/calendar?from=2026-01-01&to=2026-04-10')).status).toBe(200); // exactly 100 days
    expect((await admin.get('/api/calendar?from=2020-01-01&to=2026-04-10')).status).toBe(400);
  });

  it('ADMIN gets every source for every company, with the event contract', async () => {
    const res = await get(admin);
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.items.length).toBeLessThanOrEqual(1000);
    const types = new Set(evs(res).map((e) => e.type));
    for (const t of ['task', 'project', 'milestone', 'content', 'campaign', 'deliverable', 'invoice', 'contract', 'client']) expect(types.has(t), t).toBe(true);
    expect(titles(res, 'task')).toEqual(['Task A', 'Task B']);
    expect(titles(res, 'invoice')).toEqual(['CAL-A', 'CAL-B', 'CAL-DRAFT-A', 'CAL-DRAFT-B']);
    const camp = evs(res).filter((e) => e.title === 'Camp A');
    expect(camp.map((e) => [e.kind, e.date]).sort()).toEqual([['end', '2026-03-20'], ['start', '2026-03-05']]);
    const contract = evs(res).filter((e) => e.title === 'Contract A');
    expect(contract.map((e) => [e.kind, e.date]).sort()).toEqual([['end', '2026-03-25'], ['renewal', '2026-03-26']]);
    const task = evs(res).find((e) => e.title === 'Task A')!;
    expect(task).toMatchObject({ type: 'task', kind: 'due', date: '2026-03-10', colorKey: 'task', clientName: 'Alpha Co' });
    expect(task.url).toContain('/tasks?task=');
    expect(new Set(evs(res).map((e) => e.key)).size).toBe(evs(res).length); // keys are unique
    expect(evs(res).find((e) => e.title === 'Post A')?.date).toBe('2026-03-11T10:00:00.000Z');
    expect(evs(res).filter((e) => e.type === 'client').map((e) => e.title).sort()).toEqual(['Alpha Co', 'Beta Co']);
    // sorted by date
    const dates = evs(res).map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('CLIENT sees only their shared items - no tasks, drafts, unsent content, hidden projects or other companies', async () => {
    const res = await get(alice);
    expect(res.status).toBe(200);
    expect(res.body.types).not.toContain('task');
    expect(titles(res, 'task')).toEqual([]);
    expect(titles(res, 'project')).toEqual(['Project A']);
    expect(titles(res, 'milestone')).toEqual(['Project A: Milestone A']);
    expect(titles(res, 'content')).toEqual(['Post A']);
    expect(titles(res, 'deliverable')).toEqual(['Del A']);
    expect(titles(res, 'invoice')).toEqual(['CAL-A']);
    expect(titles(res, 'contract')).toEqual(['Contract A', 'Contract A']); // end + renewal
    expect(titles(res, 'campaign')).toEqual(['Camp A', 'Camp A']);
    expect(titles(res, 'client')).toEqual([]);
    const json = JSON.stringify(res.body);
    for (const bad of ['Beta', 'Task ', 'Hidden', 'Unsent', 'DRAFT-A', 'Private', hiddenProject]) expect(json).not.toContain(bad);
    expect(evs(res).every((e) => e.clientName === undefined)).toBe(true);
  });

  it('TEAM sees only assigned clients (whole client vs single campaign)', async () => {
    const a = await get(teamA);
    expect(titles(a, 'task')).toEqual(['Task A']);
    expect(titles(a, 'project')).toEqual(['Hidden project A', 'Project A']);
    expect(titles(a, 'invoice')).toEqual([]); // no invoices.view by default
    expect(titles(a, 'contract')).toEqual([]);
    expect(titles(a, 'client')).toEqual(['Alpha Co']);
    expect(JSON.stringify(a.body)).not.toContain('Beta');
    const fin = await get(withInvoices);
    expect(titles(fin, 'invoice')).toEqual(['CAL-A', 'CAL-DRAFT-A']);
    expect(titles(fin, 'contract')).toEqual(['Contract A', 'Contract A', 'Private contract A']);
    const b = await get(teamB);
    expect(titles(b, 'task')).toEqual(['Task B']);
    expect(JSON.stringify(b.body)).not.toContain('Alpha');
    // campaign-level assignment: no tasks / invoices of the client, no unrelated campaigns
    const c = await get(teamC);
    expect(titles(c, 'task')).toEqual([]);
    expect(titles(c, 'invoice')).toEqual([]);
    expect(titles(c, 'campaign')).toEqual([]); // A2 has no dates in March
  });

  it('types filter narrows the sources and never widens permissions', async () => {
    const only = await get(admin, `${Q}&types=task,bogus`);
    expect(new Set(evs(only).map((e) => e.type))).toEqual(new Set(['task']));
    const denied = await get(alice, `${Q}&types=task`);
    expect(evs(denied)).toEqual([]);
    const range = await get(admin, 'from=2026-03-10&to=2026-03-10');
    expect(evs(range).every((e) => e.date.slice(0, 10) === '2026-03-10')).toBe(true);
    expect(titles(range)).toEqual(['Task A', 'Task B']);
  });
});

// ───────────────────────── reports API additions ─────────────────────────

describe('reports API: permissions, client filter, REPORT_AVAILABLE notification', () => {
  const body = (campaignId: string, date: string) => ({ campaignId, date, spend: 10, reach: 80, impressions: 100, clicks: 5, conversions: 1, conversionValue: 20 });

  it('reports.create is required to add / delete; CLIENT can never create', async () => {
    expect((await noExport.post('/api/reports').send(body(campA5.id, '2026-01-10'))).status).toBe(403);
    expect((await alice.post('/api/reports').send(body(campA5.id, '2026-01-10'))).status).toBe(403);
    expect((await alice.delete('/api/reports/whatever123')).status).toBe(403);
    expect((await noExport.delete('/api/reports/whatever123')).status).toBe(403);
  });

  it('list supports the clientId filter and stays scoped', async () => {
    const res = await admin.get(`/api/reports?clientId=${w.clientB.id}`);
    expect(res.status).toBe(200);
    expect((res.body.items as Array<{ clientId: string }>).every((r) => r.clientId === w.clientB.id)).toBe(true);
    const cross = await teamA.get(`/api/reports?clientId=${w.clientB.id}`);
    expect(cross.body.items).toEqual([]);
    expect((await alice.get('/api/reports')).body.items.every((r: { clientId: string }) => r.clientId === w.clientA.id)).toBe(true);
    expect((await alice.get('/api/reports')).status).toBe(200); // CLIENT keeps read access
  });

  it('notifies the client users once per day and never other clients', async () => {
    const count = (userId: string) => prisma.notification.count({ where: { userId, type: 'REPORT_AVAILABLE' } });
    expect(await count(w.userA.id)).toBe(0);
    const first = await teamA.post('/api/reports').send(body(campA5.id, '2026-01-10'));
    expect(first.status).toBe(201);
    expect(await count(w.userA.id)).toBe(1);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: w.userA.id, type: 'REPORT_AVAILABLE' } });
    expect(n).toMatchObject({ entity: 'report', entityId: first.body.item.id });
    expect(JSON.parse(n.data ?? '{}')).toMatchObject({ campaign: 'A5 Notify', date: '2026-01-10' });
    // a second report on the same day does not spam
    expect((await teamA.post('/api/reports').send(body(campA5.id, '2026-01-11'))).status).toBe(201);
    expect(await count(w.userA.id)).toBe(1);
    expect(await count(w.userB.id)).toBe(0);
    expect(await count(w.teamA.id)).toBe(0);
    // an older notification does not block today's
    await prisma.notification.updateMany({ where: { userId: w.userA.id, type: 'REPORT_AVAILABLE' }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await admin.post('/api/reports').send(body(campA5.id, '2026-01-12'))).status).toBe(201);
    expect(await count(w.userA.id)).toBe(2);
    // other behaviour is unchanged: duplicates conflict, TEAM cannot report on unassigned campaigns
    expect((await admin.post('/api/reports').send(body(campA5.id, '2026-01-12'))).status).toBe(409);
    expect((await teamB.post('/api/reports').send(body(campA5.id, '2026-01-13'))).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_CREATED', clientId: w.clientA.id, clientVisible: true } })).toBeGreaterThanOrEqual(3);
  });
});
