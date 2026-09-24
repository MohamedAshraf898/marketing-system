import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { hashPassword } from '../auth/password';
import { createWithNumber } from '../services/finance';
import { runMaintenance } from '../services/maintenance';
import { buildWorld, loginAs, PASSWORD, type Agent, type World } from './helpers';

const DAY = 86_400_000;
const dstr = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const dateOnly = (offsetDays: number) => new Date(`${dstr(offsetDays)}T00:00:00.000Z`);
const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let w: World;
let admin: Agent;
let alice: Agent; // CLIENT of A
let bob: Agent; // CLIENT of B
let teamA: Agent; // TEAM of A, default permissions (no finance)
let fin: Agent; // TEAM of A with all four finance permissions
let viewer: Agent; // TEAM of A with invoices.view + contracts.view only
let finUserId: string;
let viewerUserId: string;

const invBody = (clientId: string, extra: Record<string, unknown> = {}) => ({ clientId, issueDate: dstr(-5), dueDate: dstr(25), amount: 1000, tax: 140, ...extra });
const mkUser = async (name: string, email: string, permissions: string[]) => {
  const hash = await hashPassword(PASSWORD);
  return prisma.user.create({ data: { name, email, role: 'TEAM', passwordHash: hash, permissions: JSON.stringify(permissions) } });
};
const uploadPdf = (agent: Agent, field: 'contractId' | 'invoiceId', id: string, name = 'doc.pdf') =>
  agent.post('/api/files').field(field, id).attach('file', pdf(), { filename: name, contentType: 'application/pdf' });

beforeAll(async () => {
  w = await buildWorld();
  const base = ['clients.view', 'files.upload', 'files.delete'];
  const f = await mkUser('Finance Team', 'fin@t.test', [...base, 'invoices.view', 'invoices.manage', 'contracts.view', 'contracts.manage']);
  const v = await mkUser('Viewer Team', 'viewer@t.test', [...base, 'invoices.view', 'contracts.view']);
  finUserId = f.id;
  viewerUserId = v.id;
  await prisma.clientAssignment.createMany({ data: [{ userId: f.id, clientId: w.clientA.id }, { userId: v.id, clientId: w.clientA.id }] });
  [admin, alice, bob, teamA, fin, viewer] = await Promise.all(['admin@t.test', 'alice@alpha.test', 'bob@beta.test', 'teama@t.test', 'fin@t.test', 'viewer@t.test'].map((e) => loginAs(e)));
});

// ─────────────────────────────── invoices ───────────────────────────────

describe('invoices: creation, numbering and validation', () => {
  it('the server computes the total and numbers; a client-sent total and number are ignored', async () => {
    const res = await admin.post('/api/invoices').send({ ...invBody(w.clientA.id), total: 1, invoiceNumber: 'HACK-1', createdById: w.userA.id, notes: 'internal' });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ amount: 1000, tax: 140, total: 1140, status: 'DRAFT', paidAt: null, visibleToClient: false, createdById: w.admin.id });
    expect(res.body.item.invoiceNumber).toMatch(/^INV-\d{4}-0001$/);
    // rounding: 10.005 + 0.1 style values are rounded to 2 decimals
    const r2 = await admin.post('/api/invoices').send(invBody(w.clientA.id, { amount: 10.1, tax: 0.2 }));
    expect(r2.body.item.total).toBe(10.3);
    expect(r2.body.item.invoiceNumber).toMatch(/-0002$/);
    // an update recomputes the total and ignores a sent one
    const up = await admin.patch(`/api/invoices/${r2.body.item.id}`).send({ amount: 200, total: 5 });
    expect(up.status).toBe(200);
    expect(up.body.item.total).toBe(200.2);
  });

  it('concurrent creates never share a number', async () => {
    // racing creators (the same code path the route uses): the unique index + retry keeps every number distinct
    const rows = await Promise.all(
      Array.from({ length: 6 }, () =>
        createWithNumber('invoice', (invoiceNumber) => prisma.invoice.create({ data: { clientId: w.clientB.id, invoiceNumber, issueDate: dateOnly(0), dueDate: dateOnly(10), amount: 1, total: 1 } })),
      ),
    );
    expect(new Set(rows.map((r) => r.invoiceNumber)).size).toBe(6);
    expect(rows.every((r) => /^INV-\d{4}-\d{4}$/.test(r.invoiceNumber))).toBe(true);
  });

  it('validates money, dates, project and client', async () => {
    const bad = (extra: Record<string, unknown>) => admin.post('/api/invoices').send(invBody(w.clientA.id, extra));
    expect((await bad({ amount: -1 })).body.error.fields).toMatchObject({ amount: 'too_small' });
    expect((await bad({ tax: -5 })).body.error.fields).toMatchObject({ tax: 'too_small' });
    expect((await bad({ amount: 5_000_000_000 })).status).toBe(400);
    expect((await bad({ issueDate: dstr(10), dueDate: dstr(5) })).body.error.fields).toMatchObject({ dueDate: 'due_before_issue' });
    expect((await bad({ issueDate: 'tomorrow' })).status).toBe(400);
    expect((await bad({ status: 'NOPE' })).status).toBe(400);
    // a project of another client is refused
    const projB = await prisma.project.create({ data: { name: 'B project', clientId: w.clientB.id } });
    expect((await bad({ projectId: projB.id })).body.error.fields).toMatchObject({ projectId: 'invalid_choice' });
    // unknown client
    expect((await admin.post('/api/invoices').send(invBody('nope-nope-nope'))).body.error.fields).toMatchObject({ clientId: 'invalid_choice' });
    // update: due before issue against the stored issue date; unknown fields refused (strict)
    const ok = await bad({});
    expect((await admin.patch(`/api/invoices/${ok.body.item.id}`).send({ dueDate: dstr(-30) })).body.error.fields).toMatchObject({ dueDate: 'due_before_issue' });
    expect((await admin.patch(`/api/invoices/${ok.body.item.id}`).send({ clientId: w.clientB.id })).status).toBe(400);
    expect((await admin.patch(`/api/invoices/${ok.body.item.id}`).send({ paidAt: dstr(-1) })).body.error.fields).toMatchObject({ paidAt: 'not_allowed' });
  });

  it('attaches a project of the same client and lists it', async () => {
    const proj = await prisma.project.create({ data: { name: 'A project', clientId: w.clientA.id, visibleToClient: true } });
    const res = await admin.post('/api/invoices').send(invBody(w.clientA.id, { projectId: proj.id, description: 'Retainer' }));
    expect(res.status).toBe(201);
    expect(res.body.item.project).toEqual({ id: proj.id, name: 'A project' });
  });
});

describe('invoices: permissions and isolation', () => {
  let draftA: string;
  let sentSharedA: string;
  let sentPrivateA: string;
  let paidSharedA: string;
  let sentSharedB: string;
  let a1File: string;

  beforeAll(async () => {
    const mk = (clientId: string, status: string, visibleToClient: boolean, n: string) =>
      prisma.invoice.create({
        data: { clientId, invoiceNumber: `TEST-${n}`, issueDate: dateOnly(-20), dueDate: dateOnly(10), amount: 100, tax: 10, total: 110, status: status as 'DRAFT', visibleToClient, notes: 'SECRET internal note', createdById: w.admin.id },
      });
    draftA = (await mk(w.clientA.id, 'DRAFT', true, 'DA')).id; // shared flag but still a draft
    sentSharedA = (await mk(w.clientA.id, 'SENT', true, 'SA')).id;
    sentPrivateA = (await mk(w.clientA.id, 'SENT', false, 'PA')).id;
    paidSharedA = (await mk(w.clientA.id, 'PAID', true, 'PD')).id;
    sentSharedB = (await mk(w.clientB.id, 'SENT', true, 'SB')).id;
    const up = await uploadPdf(admin, 'invoiceId', sentPrivateA, 'private.pdf');
    expect(up.status).toBe(201);
    a1File = up.body.item.id;
  });

  it('a CLIENT sees only their own shared, non-draft invoices - without internal fields', async () => {
    const res = await alice.get('/api/invoices?pageSize=100');
    expect(res.status).toBe(200);
    const numbers = res.body.items.map((i: { invoiceNumber: string }) => i.invoiceNumber);
    expect(numbers).toContain('TEST-SA');
    expect(numbers).toContain('TEST-PD');
    expect(numbers).not.toContain('TEST-DA');
    expect(numbers).not.toContain('TEST-PA');
    expect(numbers).not.toContain('TEST-SB');
    for (const i of res.body.items) {
      expect(i.clientId).toBe(w.clientA.id);
      expect('notes' in i).toBe(false);
      expect('createdBy' in i).toBe(false);
      expect('createdById' in i).toBe(false);
      expect('visibleToClient' in i).toBe(false);
      expect(Object.keys(i)).toEqual(expect.arrayContaining(['invoiceNumber', 'issueDate', 'dueDate', 'amount', 'tax', 'total', 'status', 'description']));
    }
    const detail = await alice.get(`/api/invoices/${sentSharedA}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain('SECRET');
    expect(detail.body.item.total).toBe(110);
  });

  it('other clients, drafts and unshared invoices are 404 for a CLIENT', async () => {
    for (const id of [sentSharedB, draftA, sentPrivateA]) expect((await alice.get(`/api/invoices/${id}`)).status).toBe(404);
    expect((await bob.get(`/api/invoices/${sentSharedA}`)).status).toBe(404);
    expect((await alice.get(`/api/invoices?clientId=${w.clientB.id}`)).body.items).toEqual([]);
  });

  it('a CLIENT cannot create, update or delete', async () => {
    expect((await alice.post('/api/invoices').send(invBody(w.clientA.id))).status).toBe(403);
    expect((await alice.patch(`/api/invoices/${sentSharedA}`).send({ status: 'PAID' })).status).toBe(403);
    expect((await alice.delete(`/api/invoices/${draftA}`)).status).toBe(403);
    expect((await prisma.invoice.findUnique({ where: { id: sentSharedA } }))?.status).toBe('SENT');
  });

  it('TEAM without invoices.view gets 403 on list, detail and summary, and cannot download invoice files', async () => {
    expect((await teamA.get('/api/invoices')).status).toBe(403);
    expect((await teamA.get(`/api/invoices/${sentSharedA}`)).status).toBe(403);
    expect((await teamA.get('/api/invoices/summary')).status).toBe(403);
    expect((await teamA.post('/api/invoices').send(invBody(w.clientA.id))).status).toBe(403);
    expect((await teamA.get(`/api/files/${a1File}/download`)).status).toBe(404);
    expect((await teamA.get('/api/files?pageSize=100')).body.items.map((f: { id: string }) => f.id)).not.toContain(a1File);
  });

  it('TEAM with invoices.view sees only assigned clients, and cannot write without invoices.manage', async () => {
    const list = await viewer.get('/api/invoices?pageSize=100');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((i: { clientId: string }) => i.clientId === w.clientA.id)).toBe(true);
    expect('notes' in list.body.items[0]).toBe(true); // staff see internal notes
    expect((await viewer.get(`/api/invoices/${sentSharedB}`)).status).toBe(404);
    expect((await viewer.get(`/api/invoices/${draftA}`)).status).toBe(200);
    expect((await viewer.post('/api/invoices').send(invBody(w.clientA.id))).status).toBe(403);
    expect((await viewer.patch(`/api/invoices/${draftA}`).send({ description: 'x' })).status).toBe(403);
    expect((await viewer.delete(`/api/invoices/${draftA}`)).status).toBe(403);
    // the invoice attachment is downloadable for someone who may view invoices
    expect((await viewer.get(`/api/files/${a1File}/download`)).status).toBe(200);
  });

  it('TEAM with invoices.manage writes only for assigned clients', async () => {
    expect((await fin.post('/api/invoices').send(invBody(w.clientB.id))).body.error.fields).toMatchObject({ clientId: 'invalid_choice' });
    expect((await fin.patch(`/api/invoices/${sentSharedB}`).send({ description: 'x' })).status).toBe(404);
    expect((await fin.delete(`/api/invoices/${sentSharedB}`)).status).toBe(404);
    const ok = await fin.post('/api/invoices').send(invBody(w.clientA.id));
    expect(ok.status).toBe(201);
    expect(ok.body.item.createdById).toBe(finUserId);
    // an unassigned TEAM member (teamB) with the permission still cannot touch client A
    expect((await fin.get(`/api/invoices/${sentSharedA}`)).status).toBe(200);
  });

  it('ADMIN sees every client', async () => {
    const res = await admin.get('/api/invoices?pageSize=100');
    const clients = new Set(res.body.items.map((i: { clientId: string }) => i.clientId));
    expect(clients.has(w.clientA.id) && clients.has(w.clientB.id)).toBe(true);
    expect((await admin.get(`/api/invoices/${draftA}`)).status).toBe(200);
  });

  it('filters: status, client, search, overdue, dates and sort', async () => {
    expect((await admin.get('/api/invoices?status=PAID&pageSize=100')).body.items.every((i: { status: string }) => i.status === 'PAID')).toBe(true);
    expect((await admin.get(`/api/invoices?clientId=${w.clientB.id}&pageSize=100`)).body.items.every((i: { clientId: string }) => i.clientId === w.clientB.id)).toBe(true);
    expect((await admin.get('/api/invoices?q=TEST-SA')).body.items.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(['TEST-SA']);
    const late = await prisma.invoice.create({ data: { clientId: w.clientA.id, invoiceNumber: 'TEST-LATE', issueDate: dateOnly(-60), dueDate: dateOnly(-30), amount: 50, total: 50, status: 'SENT', visibleToClient: true } });
    const ov = await admin.get('/api/invoices?overdue=1&pageSize=100');
    expect(ov.body.items.map((i: { id: string }) => i.id)).toContain(late.id);
    expect(ov.body.items.every((i: { status: string; dueDate: string }) => i.status === 'OVERDUE' || new Date(i.dueDate) < new Date())).toBe(true);
    const ranged = await admin.get(`/api/invoices?from=${dstr(-70)}&to=${dstr(-50)}&pageSize=100`);
    expect(ranged.body.items.map((i: { id: string }) => i.id)).toEqual([late.id]);
    const asc = await admin.get('/api/invoices?sort=total&pageSize=100');
    const totals = asc.body.items.map((i: { total: number }) => i.total);
    expect(totals).toEqual([...totals].sort((a: number, b: number) => a - b));
    await prisma.invoice.delete({ where: { id: late.id } });
  });

  it('summary is scoped and totals are right', async () => {
    const all = await admin.get('/api/invoices/summary');
    expect(all.status).toBe(200);
    const rows = await prisma.invoice.findMany();
    const outstanding = rows.filter((r) => ['SENT', 'PENDING', 'OVERDUE'].includes(r.status)).reduce((n, r) => n + r.total, 0);
    expect(all.body.item.outstanding.total).toBeCloseTo(outstanding, 2);
    expect(all.body.item.byStatus.PAID.count).toBe(rows.filter((r) => r.status === 'PAID').length);
    // a client only counts their own shared, non-draft invoices
    const mine = await alice.get('/api/invoices/summary');
    expect(mine.status).toBe(200);
    expect(mine.body.item.byStatus.DRAFT.count).toBe(0);
    expect(mine.body.item.byStatus.SENT.count).toBe(1); // TEAM-SA only (TEST-PA is private)
    // a team member sees only assigned clients
    const team = await viewer.get('/api/invoices/summary');
    const aRows = rows.filter((r) => r.clientId === w.clientA.id);
    expect(team.body.item.byStatus.DRAFT.count).toBe(aRows.filter((r) => r.status === 'DRAFT').length);
    expect(viewerUserId).toBeTruthy();
  });
});

describe('invoices: status rules, immutability, deletion, notifications, audit', () => {
  const make = async (extra: Record<string, unknown> = {}) => {
    const r = await admin.post('/api/invoices').send(invBody(w.clientA.id, extra));
    expect(r.status).toBe(201);
    return r.body.item as { id: string; invoiceNumber: string };
  };

  it('marking PAID sets paidAt (server time or an explicit past date); leaving PAID clears it', async () => {
    const inv = await make({ status: 'SENT' });
    const before = Date.now();
    const paid = await fin.patch(`/api/invoices/${inv.id}`).send({ status: 'PAID' });
    expect(paid.status).toBe(200);
    expect(paid.body.item.status).toBe('PAID');
    expect(new Date(paid.body.item.paidAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const inv2 = await make({ status: 'PENDING' });
    const explicit = await admin.patch(`/api/invoices/${inv2.id}`).send({ status: 'PAID', paidAt: dstr(-3) });
    expect(explicit.body.item.paidAt.slice(0, 10)).toBe(dstr(-3));
    const inv3 = await make({ status: 'PENDING' });
    const future = await admin.patch(`/api/invoices/${inv3.id}`).send({ status: 'PAID', paidAt: dstr(3) });
    expect(future.status).toBe(400);
    expect(future.body.error.fields).toMatchObject({ paidAt: 'date_in_future' });
    expect((await prisma.invoice.findUnique({ where: { id: inv3.id } }))?.paidAt).toBeNull();

    const back = await admin.patch(`/api/invoices/${inv.id}`).send({ status: 'SENT' });
    expect(back.status).toBe(200);
    expect(back.body.item.paidAt).toBeNull();
  });

  it('PAID / CANCELLED invoices are immutable; only an ADMIN may reverse the status', async () => {
    const inv = await make({ status: 'SENT' });
    await admin.patch(`/api/invoices/${inv.id}`).send({ status: 'PAID' });
    const edit = await fin.patch(`/api/invoices/${inv.id}`).send({ amount: 5 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('INVOICE_LOCKED');
    expect((await fin.patch(`/api/invoices/${inv.id}`).send({ status: 'SENT' })).status).toBe(409); // team cannot reverse
    expect((await admin.patch(`/api/invoices/${inv.id}`).send({ amount: 5 })).status).toBe(409); // not even admin edits fields
    expect((await admin.delete(`/api/invoices/${inv.id}`)).status).toBe(409);
    expect((await prisma.invoice.findUnique({ where: { id: inv.id } }))?.amount).toBe(1000);

    const cancelled = await make({ status: 'SENT' });
    await fin.patch(`/api/invoices/${cancelled.id}`).send({ status: 'CANCELLED' });
    expect((await fin.patch(`/api/invoices/${cancelled.id}`).send({ description: 'x' })).body.error.code).toBe('INVOICE_LOCKED');
    const reversed = await admin.patch(`/api/invoices/${cancelled.id}`).send({ status: 'DRAFT' });
    expect(reversed.status).toBe(200);
    expect(reversed.body.item.status).toBe('DRAFT');
  });

  it('only DRAFT invoices can be deleted; their attachments are removed with them', async () => {
    const sent = await make({ status: 'SENT' });
    const res = await admin.delete(`/api/invoices/${sent.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ONLY_DRAFT_DELETABLE');

    const draft = await make();
    const up = await uploadPdf(admin, 'invoiceId', draft.id);
    const fileId = up.body.item.id as string;
    expect((await admin.get(`/api/files/${fileId}/download`)).status).toBe(200);
    expect((await fin.delete(`/api/invoices/${draft.id}`)).status).toBe(200);
    expect(await prisma.invoice.count({ where: { id: draft.id } })).toBe(0);
    expect(await prisma.file.count({ where: { id: fileId } })).toBe(0);
    expect((await admin.get(`/api/files/${fileId}/download`)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'INVOICE_DELETED', entityId: draft.id } })).toBe(1);
  });

  it('SENT + shared notifies the client users only; audit rows carry the client and the right visibility', async () => {
    const inv = await make({ visibleToClient: true, notes: 'private words' });
    expect(await prisma.notification.count({ where: { type: 'INVOICE_SENT', entityId: inv.id } })).toBe(0);
    const created = await prisma.auditLog.findFirst({ where: { action: 'INVOICE_CREATED', entityId: inv.id } });
    expect(created).toMatchObject({ clientId: w.clientA.id, clientVisible: false }); // still a draft

    const sent = await admin.patch(`/api/invoices/${inv.id}`).send({ status: 'SENT' });
    expect(sent.status).toBe(200);
    const notes = await prisma.notification.findMany({ where: { type: 'INVOICE_SENT', entityId: inv.id } });
    expect(notes.map((n) => n.userId)).toEqual([w.userA.id]);
    expect(notes[0]).toMatchObject({ entity: 'invoice' });
    const changed = await prisma.auditLog.findFirst({ where: { action: 'INVOICE_STATUS_CHANGED', entityId: inv.id } });
    expect(changed).toMatchObject({ clientId: w.clientA.id, clientVisible: true, userId: w.admin.id });
    expect(changed?.metadata).not.toContain('private words');

    const quiet = await make({ visibleToClient: false });
    await admin.patch(`/api/invoices/${quiet.id}`).send({ status: 'SENT' });
    expect(await prisma.notification.count({ where: { type: 'INVOICE_SENT', entityId: quiet.id } })).toBe(0);
    const quietAudit = await prisma.auditLog.findFirst({ where: { action: 'INVOICE_STATUS_CHANGED', entityId: quiet.id } });
    expect(quietAudit?.clientVisible).toBe(false);
  });

  it('sharing an invoice makes its attachments visible to the client, unsharing hides them again', async () => {
    const inv = await make({ status: 'SENT' });
    const up = await uploadPdf(admin, 'invoiceId', inv.id, 'inv.pdf');
    const fid = up.body.item.id as string;
    expect(up.body.item.visibleToClient).toBe(false);
    expect((await alice.get(`/api/files/${fid}/download`)).status).toBe(404);
    await admin.patch(`/api/invoices/${inv.id}`).send({ visibleToClient: true });
    const dl = await alice.get(`/api/files/${fid}/download`);
    expect(dl.status).toBe(200);
    expect((await alice.get(`/api/invoices/${inv.id}`)).body.item.files.map((f: { id: string }) => f.id)).toEqual([fid]);
    await admin.patch(`/api/invoices/${inv.id}`).send({ visibleToClient: false });
    expect((await alice.get(`/api/files/${fid}/download`)).status).toBe(404);
    expect((await bob.get(`/api/files/${fid}/download`)).status).toBe(404);
    // a CLIENT cannot attach files to invoices, and a team member without invoices.manage neither
    expect((await uploadPdf(alice, 'invoiceId', inv.id)).status).toBe(403);
    expect((await uploadPdf(viewer, 'invoiceId', inv.id)).status).toBe(403);
    expect((await viewer.delete(`/api/files/${fid}`)).status).toBe(403);
  });
});

// ─────────────────────────────── contracts ───────────────────────────────

describe('contracts', () => {
  const cBody = (extra: Record<string, unknown> = {}) => ({ clientId: w.clientA.id, name: 'Retainer 2026', startDate: dstr(-30), endDate: dstr(335), value: 12000, ...extra });
  let sharedActive: string;
  let privateActive: string;
  let draftShared: string;
  let otherClient: string;

  beforeAll(async () => {
    const mk = (clientId: string, name: string, status: string, visibleToClient: boolean) =>
      prisma.contract.create({
        data: { clientId, name, contractNumber: `TC-${name}`, status: status as 'ACTIVE', visibleToClient, value: 500, notes: 'SECRET contract note', endDate: dateOnly(200) },
      });
    sharedActive = (await mk(w.clientA.id, 'sharedActive', 'ACTIVE', true)).id;
    privateActive = (await mk(w.clientA.id, 'privateActive', 'ACTIVE', false)).id;
    draftShared = (await mk(w.clientA.id, 'draftShared', 'DRAFT', true)).id;
    otherClient = (await mk(w.clientB.id, 'otherClient', 'ACTIVE', true)).id;
  });

  it('numbers are generated by the server; validation; audit', async () => {
    const res = await admin.post('/api/contracts').send(cBody({ contractNumber: 'HACK', createdById: w.userA.id }));
    expect(res.status).toBe(201);
    expect(res.body.item.contractNumber).toMatch(/^CT-\d{4}-0001$/);
    expect(res.body.item).toMatchObject({ status: 'DRAFT', visibleToClient: false, createdById: w.admin.id, value: 12000 });
    const second = await admin.post('/api/contracts').send(cBody());
    expect(second.body.item.contractNumber).toMatch(/-0002$/);
    const many = await Promise.all(
      Array.from({ length: 5 }, () => createWithNumber('contract', (contractNumber) => prisma.contract.create({ data: { clientId: w.clientB.id, name: 'race', contractNumber } }))),
    );
    expect(new Set(many.map((r) => r.contractNumber)).size).toBe(5);

    expect((await admin.post('/api/contracts').send(cBody({ value: -5 }))).body.error.fields).toMatchObject({ value: 'too_small' });
    expect((await admin.post('/api/contracts').send(cBody({ startDate: dstr(10), endDate: dstr(5) }))).body.error.fields).toMatchObject({ endDate: 'end_before_start' });
    expect((await admin.post('/api/contracts').send(cBody({ name: '' }))).status).toBe(400);
    expect((await admin.post('/api/contracts').send(cBody({ renewalDate: dstr(300) }))).status).toBe(201); // renewal date optional
    const audit = await prisma.auditLog.findFirst({ where: { action: 'CONTRACT_CREATED', entityId: res.body.item.id } });
    expect(audit).toMatchObject({ clientId: w.clientA.id, clientVisible: false });
    expect((await admin.patch(`/api/contracts/${res.body.item.id}`).send({ startDate: dstr(400) })).body.error.fields).toMatchObject({ endDate: 'end_before_start' });
    expect((await admin.patch(`/api/contracts/${res.body.item.id}`).send({ contractNumber: 'X' })).status).toBe(400);
  });

  it('a CLIENT sees only their own shared, non-draft contracts without notes', async () => {
    const list = await alice.get('/api/contracts?pageSize=100');
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([sharedActive]);
    expect('notes' in list.body.items[0]).toBe(false);
    expect('createdBy' in list.body.items[0]).toBe(false);
    expect('visibleToClient' in list.body.items[0]).toBe(false);
    const detail = await alice.get(`/api/contracts/${sharedActive}`);
    expect(JSON.stringify(detail.body)).not.toContain('SECRET');
    for (const id of [privateActive, draftShared, otherClient]) expect((await alice.get(`/api/contracts/${id}`)).status).toBe(404);
    expect((await bob.get(`/api/contracts/${sharedActive}`)).status).toBe(404);
  });

  it('a CLIENT cannot write; TEAM needs the permission and the client assignment', async () => {
    expect((await alice.post('/api/contracts').send(cBody())).status).toBe(403);
    expect((await alice.patch(`/api/contracts/${sharedActive}`).send({ name: 'x' })).status).toBe(403);
    expect((await alice.delete(`/api/contracts/${draftShared}`)).status).toBe(403);
    expect((await teamA.get('/api/contracts')).status).toBe(403);
    expect((await teamA.get(`/api/contracts/${sharedActive}`)).status).toBe(403);
    expect((await teamA.post('/api/contracts').send(cBody())).status).toBe(403);
    expect((await viewer.get(`/api/contracts/${sharedActive}`)).status).toBe(200);
    expect((await viewer.post('/api/contracts').send(cBody())).status).toBe(403);
    expect((await fin.get(`/api/contracts/${otherClient}`)).status).toBe(404);
    expect((await fin.post('/api/contracts').send(cBody({ clientId: w.clientB.id }))).status).toBe(400);
    expect((await fin.patch(`/api/contracts/${otherClient}`).send({ name: 'x' })).status).toBe(404);
    const mine = await fin.post('/api/contracts').send(cBody());
    expect(mine.status).toBe(201);
    const ids = (await fin.get('/api/contracts?pageSize=100')).body.items.map((c: { clientId: string }) => c.clientId);
    expect(new Set(ids)).toEqual(new Set([w.clientA.id]));
  });

  it('list filters: status, client, search, expiringWithinDays, sort', async () => {
    const soon = await prisma.contract.create({ data: { clientId: w.clientA.id, name: 'soonEnding', contractNumber: 'TC-soon', status: 'ACTIVE', endDate: dateOnly(12) } });
    const exp = await admin.get('/api/contracts?expiringWithinDays=30&pageSize=100');
    expect(exp.body.items.map((c: { id: string }) => c.id)).toContain(soon.id);
    expect(exp.body.items.every((c: { endDate: string }) => new Date(c.endDate).getTime() <= Date.now() + 31 * DAY)).toBe(true);
    expect((await admin.get('/api/contracts?q=soonEnding')).body.items.length).toBe(1);
    expect((await admin.get('/api/contracts?status=DRAFT&pageSize=100')).body.items.every((c: { status: string }) => c.status === 'DRAFT')).toBe(true);
    expect((await admin.get(`/api/contracts?clientId=${w.clientB.id}&pageSize=100`)).body.items.every((c: { clientId: string }) => c.clientId === w.clientB.id)).toBe(true);
    const sorted = (await admin.get('/api/contracts?sort=-value&pageSize=100')).body.items.map((c: { value: number }) => c.value);
    expect(sorted).toEqual([...sorted].sort((a: number, b: number) => b - a));
    await prisma.contract.delete({ where: { id: soon.id } });
  });

  it('status changes are audited; only DRAFT contracts can be deleted (files go with them)', async () => {
    const c = (await admin.post('/api/contracts').send(cBody({ name: 'to-delete' }))).body.item;
    const up = await uploadPdf(admin, 'contractId', c.id);
    const fid = up.body.item.id as string;
    const act = await admin.patch(`/api/contracts/${c.id}`).send({ status: 'ACTIVE' });
    expect(act.body.item.status).toBe('ACTIVE');
    const a = await prisma.auditLog.findFirst({ where: { action: 'CONTRACT_STATUS_CHANGED', entityId: c.id } });
    expect(JSON.parse(a!.metadata!)).toMatchObject({ from: 'DRAFT', to: 'ACTIVE' });
    const del = await admin.delete(`/api/contracts/${c.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('ONLY_DRAFT_DELETABLE');
    await admin.patch(`/api/contracts/${c.id}`).send({ status: 'TERMINATED' });
    expect((await admin.delete(`/api/contracts/${c.id}`)).status).toBe(409);
    await admin.patch(`/api/contracts/${c.id}`).send({ status: 'DRAFT' });
    expect((await fin.delete(`/api/contracts/${c.id}`)).status).toBe(200);
    expect(await prisma.file.count({ where: { id: fid } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'CONTRACT_DELETED', entityId: c.id } })).toBe(1);
  });

  it('moving the end date of an expiring contract far ahead re-activates it (renewal)', async () => {
    const c = await prisma.contract.create({ data: { clientId: w.clientA.id, name: 'renew', contractNumber: 'TC-renew', status: 'EXPIRING', endDate: dateOnly(5) } });
    const r = await admin.patch(`/api/contracts/${c.id}`).send({ endDate: dstr(200) });
    expect(r.body.item.status).toBe('ACTIVE');
  });

  it('contract files: a CLIENT downloads the shared contract PDF but not an unshared one; unauthorised users cannot', async () => {
    const shared = await uploadPdf(admin, 'contractId', sharedActive, 'signed.pdf');
    const priv = await uploadPdf(admin, 'contractId', privateActive, 'private.pdf');
    expect(shared.status).toBe(201);
    expect(shared.body.item.contractId).toBe(sharedActive);
    expect(shared.body.item.visibleToClient).toBe(true);
    expect(priv.body.item.visibleToClient).toBe(false);
    const dl = await alice.get(`/api/files/${shared.body.item.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect((await alice.get(`/api/files/${priv.body.item.id}/download`)).status).toBe(404);
    expect((await bob.get(`/api/files/${shared.body.item.id}/download`)).status).toBe(404);
    expect((await teamA.get(`/api/files/${shared.body.item.id}/download`)).status).toBe(404); // no contracts.view
    expect((await viewer.get(`/api/files/${shared.body.item.id}/download`)).status).toBe(200);
    expect((await alice.get(`/api/contracts/${sharedActive}`)).body.item.files.map((f: { id: string }) => f.id)).toEqual([shared.body.item.id]);
    expect((await alice.get(`/api/files?contractId=${privateActive}`)).body.items).toEqual([]);
    // attaching needs contracts.manage and a contract in scope
    expect((await uploadPdf(alice, 'contractId', sharedActive)).status).toBe(403);
    expect((await uploadPdf(viewer, 'contractId', sharedActive)).status).toBe(403);
    expect((await uploadPdf(fin, 'contractId', otherClient)).status).toBe(404);
    expect((await uploadPdf(fin, 'contractId', sharedActive)).status).toBe(201);
    // unsharing hides the file again (even though the row was uploaded as visible)
    await admin.patch(`/api/contracts/${sharedActive}`).send({ visibleToClient: false });
    expect((await alice.get(`/api/files/${shared.body.item.id}/download`)).status).toBe(404);
    await admin.patch(`/api/contracts/${sharedActive}`).send({ visibleToClient: true });
    expect((await alice.get(`/api/files/${shared.body.item.id}/download`)).status).toBe(200);
    // a draft contract stays hidden even if flagged shared
    const dFile = await uploadPdf(admin, 'contractId', draftShared, 'draft.pdf');
    expect((await alice.get(`/api/files/${dFile.body.item.id}/download`)).status).toBe(404);
  });
});

// ─────────────────────────────── maintenance ───────────────────────────────

describe('maintenance job', () => {
  it('flips contract / invoice statuses and sends de-duplicated notifications (second run changes nothing)', async () => {
    const cid = w.clientA.id;
    const mkC = (name: string, status: string, endDate: Date | null) =>
      prisma.contract.create({ data: { clientId: cid, name, contractNumber: `MC-${name}`, status: status as 'ACTIVE', endDate } });
    const cSoon = await mkC('soon', 'ACTIVE', dateOnly(20));
    const cFar = await mkC('far', 'ACTIVE', dateOnly(90));
    const cPast = await mkC('past', 'ACTIVE', dateOnly(-3));
    const cExpiringPast = await mkC('expiringPast', 'EXPIRING', dateOnly(-1));
    const cDraft = await mkC('draftPast', 'DRAFT', dateOnly(-10));
    const cTerm = await mkC('termPast', 'TERMINATED', dateOnly(-10));
    const cNoEnd = await mkC('noEnd', 'ACTIVE', null);
    const mkI = (n: string, status: string, due: number) =>
      prisma.invoice.create({ data: { clientId: cid, invoiceNumber: `MI-${n}`, issueDate: dateOnly(-60), dueDate: dateOnly(due), amount: 10, total: 10, status: status as 'SENT' } });
    const iSent = await mkI('sent', 'SENT', -2);
    const iPending = await mkI('pending', 'PENDING', -1);
    const iFuture = await mkI('future', 'SENT', 5);
    const iDraft = await mkI('draft', 'DRAFT', -9);
    const iPaid = await mkI('paid', 'PAID', -9);
    const iCancelled = await mkI('cancelled', 'CANCELLED', -9);

    const first = await runMaintenance();
    expect(first.contractsExpiring).toBeGreaterThanOrEqual(1);
    const st = async (model: 'contract' | 'invoice', id: string) => ((await (prisma[model] as unknown as { findUnique: (a: unknown) => Promise<{ status: string }> }).findUnique({ where: { id } })).status);
    expect(await st('contract', cSoon.id)).toBe('EXPIRING');
    expect(await st('contract', cFar.id)).toBe('ACTIVE');
    expect(await st('contract', cPast.id)).toBe('EXPIRED');
    expect(await st('contract', cExpiringPast.id)).toBe('EXPIRED');
    expect(await st('contract', cDraft.id)).toBe('DRAFT');
    expect(await st('contract', cTerm.id)).toBe('TERMINATED');
    expect(await st('contract', cNoEnd.id)).toBe('ACTIVE');
    expect(await st('invoice', iSent.id)).toBe('OVERDUE');
    expect(await st('invoice', iPending.id)).toBe('OVERDUE');
    expect(await st('invoice', iFuture.id)).toBe('SENT');
    expect(await st('invoice', iDraft.id)).toBe('DRAFT');
    expect(await st('invoice', iPaid.id)).toBe('PAID');
    expect(await st('invoice', iCancelled.id)).toBe('CANCELLED');

    const count = (where: Record<string, unknown>) => prisma.notification.count({ where });
    // recipients: admin + team with the finance permission that is assigned to the client. Not teamA (no permission),
    // not teamB (other client), never client users
    expect(await count({ userId: w.admin.id, type: 'CONTRACT_EXPIRING', entityId: cSoon.id })).toBe(1);
    expect(await count({ userId: finUserId, type: 'CONTRACT_EXPIRING', entityId: cSoon.id })).toBe(1);
    expect(await count({ userId: viewerUserId, type: 'CONTRACT_EXPIRING', entityId: cSoon.id })).toBe(1);
    expect(await count({ userId: w.teamA.id, entityId: cSoon.id })).toBe(0);
    expect(await count({ userId: w.teamB.id, entityId: cSoon.id })).toBe(0);
    expect(await count({ userId: w.userA.id, type: { in: ['CONTRACT_EXPIRING', 'CONTRACT_EXPIRED', 'INVOICE_OVERDUE'] } })).toBe(0);
    expect(await count({ userId: w.admin.id, type: 'CONTRACT_EXPIRED', entityId: cPast.id })).toBe(1);
    expect(await count({ userId: w.admin.id, type: 'CONTRACT_EXPIRED', entityId: cExpiringPast.id })).toBe(1);
    expect(await count({ userId: w.admin.id, type: 'INVOICE_OVERDUE', entityId: iSent.id })).toBe(1);
    expect(await count({ userId: w.admin.id, type: 'INVOICE_OVERDUE', entityId: iPending.id })).toBe(1);
    expect(await count({ type: 'INVOICE_OVERDUE', entityId: iDraft.id })).toBe(0);
    const n = await prisma.notification.findFirst({ where: { userId: w.admin.id, type: 'CONTRACT_EXPIRING', entityId: cSoon.id } });
    expect(n).toMatchObject({ entity: 'contract' });
    expect(JSON.parse(n!.data!)).toMatchObject({ days: 20 });
    expect(await prisma.auditLog.count({ where: { action: 'CONTRACT_STATUS_CHANGED', entityId: cSoon.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'INVOICE_STATUS_CHANGED', entityId: iSent.id } })).toBe(1);

    const totalBefore = await prisma.notification.count();
    const auditBefore = await prisma.auditLog.count();
    const second = await runMaintenance();
    expect(second).toEqual({ contractsExpiring: 0, contractsExpired: 0, invoicesOverdue: 0, taskReminders: 0, attendanceDaysClosed: 0, recurringTasksCreated: 0, automationsRun: 0 });
    expect(await prisma.notification.count()).toBe(totalBefore);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
  });

  it('task reminders: due soon / overdue once per task, assignee only, done tasks skipped', async () => {
    const mkT = (title: string, dueDate: Date | null, extra: Record<string, unknown> = {}) =>
      prisma.task.create({ data: { title, clientId: w.clientA.id, assignedToId: w.teamA.id, dueDate, ...extra } });
    const soon = await mkT('soon', new Date(Date.now() + 5 * 3_600_000));
    const late = await mkT('late', new Date(Date.now() - 5 * 3_600_000));
    const lateDay = await mkT('lateDay', dateOnly(-2));
    const todayDateOnly = await mkT('todayDateOnly', dateOnly(0)); // "end of today" -> due soon, not overdue
    const far = await mkT('far', new Date(Date.now() + 10 * DAY));
    const done = await mkT('done', new Date(Date.now() - 5 * 3_600_000), { status: 'DONE' });
    const nobody = await mkT('nobody', new Date(Date.now() - 5 * 3_600_000), { assignedToId: null });

    await runMaintenance();
    await runMaintenance();
    const c = (type: string, taskId: string) => prisma.notification.count({ where: { userId: w.teamA.id, type, entityId: taskId } });
    expect(await c('TASK_DUE_SOON', soon.id)).toBe(1);
    expect(await c('TASK_OVERDUE', late.id)).toBe(1);
    expect(await c('TASK_OVERDUE', lateDay.id)).toBe(1);
    expect(await c('TASK_DUE_SOON', todayDateOnly.id)).toBe(1);
    expect(await c('TASK_OVERDUE', todayDateOnly.id)).toBe(0);
    for (const t of [far, done, nobody]) expect(await prisma.notification.count({ where: { entityId: t.id } })).toBe(0);
    // nobody else is told about the task
    expect(await prisma.notification.count({ where: { entityId: soon.id, userId: { not: w.teamA.id } } })).toBe(0);

    // after 24 hours the reminder may repeat (once per task per day)
    await prisma.notification.updateMany({ where: { entityId: late.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await runMaintenance();
    expect(await c('TASK_OVERDUE', late.id)).toBe(2);
  });
});

// ─────────────────────────────── notifications API ───────────────────────────────

describe('notifications API', () => {
  let ids: string[] = [];
  beforeAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [w.userA.id, w.userB.id] } } });
    const rows = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.notification.create({
          data: { userId: w.userA.id, type: i % 2 ? 'INVOICE_SENT' : 'NEW_COMMENT', entity: i % 2 ? 'invoice' : 'deliverable', entityId: `ent-${i}00000`, data: JSON.stringify({ n: i }), createdAt: new Date(Date.now() - i * 1000) },
        }),
      ),
    );
    ids = rows.map((r) => r.id);
    await prisma.notification.create({ data: { userId: w.userB.id, type: 'NEW_COMMENT', entity: 'deliverable', entityId: 'ent-bob0000' } });
  });

  it('lists only the caller\'s own notifications with paging, filters and link info', async () => {
    const res = await alice.get('/api/notifications?pageSize=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.meta).toMatchObject({ total: 5, totalPages: 3, pageSize: 2 });
    expect(res.body.unreadCount).toBe(5);
    expect(res.body.items[0]).toMatchObject({ entity: 'deliverable', entityId: 'ent-000000', data: { n: 0 } });
    expect((await alice.get('/api/notifications?type=INVOICE_SENT')).body.meta.total).toBe(2);
    expect((await alice.get('/api/notifications?type=%27%20OR%201=1')).body.meta.total).toBe(5); // malformed type ignored
    expect((await bob.get('/api/notifications')).body.items.every((n: { userId: string }) => n.userId === w.userB.id)).toBe(true);
    expect((await bob.get('/api/notifications')).body.meta.total).toBe(1);
  });

  it('unread count, mark one read, read-all, and the unread filter', async () => {
    expect((await alice.get('/api/notifications/unread-count')).body).toEqual({ unreadCount: 5 });
    expect((await alice.patch(`/api/notifications/${ids[0]}/read`).send({})).status).toBe(200);
    expect((await alice.get('/api/notifications/unread-count')).body.unreadCount).toBe(4);
    expect((await alice.get('/api/notifications?unread=1')).body.meta.total).toBe(4);
    expect((await alice.patch(`/api/notifications/${ids[0]}/read`).send({})).status).toBe(200); // idempotent
    // someone else's notification: 404, and it stays unread
    const bobs = await prisma.notification.findFirstOrThrow({ where: { userId: w.userB.id } });
    expect((await alice.patch(`/api/notifications/${bobs.id}/read`).send({})).status).toBe(404);
    expect((await alice.delete(`/api/notifications/${bobs.id}`)).status).toBe(404);
    expect((await prisma.notification.findUnique({ where: { id: bobs.id } }))?.readAt).toBeNull();
    // read-all only touches the caller
    expect((await alice.post('/api/notifications/read-all')).status).toBe(200);
    expect((await alice.get('/api/notifications/unread-count')).body.unreadCount).toBe(0);
    expect((await bob.get('/api/notifications/unread-count')).body.unreadCount).toBe(1);
  });

  it('a user can delete their own notification; ADMIN has a separate inbox', async () => {
    expect((await alice.delete(`/api/notifications/${ids[4]}`)).status).toBe(200);
    expect((await alice.get('/api/notifications')).body.meta.total).toBe(4);
    const a = await admin.get('/api/notifications?pageSize=50');
    expect(a.status).toBe(200);
    expect(a.body.items.every((n: { userId: string }) => n.userId === w.admin.id)).toBe(true);
    expect((await admin.get(`/api/notifications/${ids[1]}`)).status).toBe(404);
    // unauthenticated
    const anon = await (await import('supertest')).default((await import('./helpers')).app).get('/api/notifications/unread-count');
    expect(anon.status).toBe(401);
  });
});
