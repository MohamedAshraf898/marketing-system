import crypto from 'node:crypto';
import type { Client, Prisma } from '@prisma/client';
import { storage } from '../storage';
import { createWithNumber, round2 } from '../services/finance';
import type { SeedCtx } from './ctx';
import { prisma } from '../db';

/** A tiny but valid-looking PDF so the demo attachments can be downloaded. */
const demoPdf = (title: string) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n` +
      `4 0 obj<</Length 70>>stream\nBT /F1 14 Tf 20 60 Td (${title.replace(/[()\\]/g, '')} - DEMO) Tj ET\nendstream\nendobj\n` +
      `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );

/**
 * Demo data for the "finance" group (contracts, invoices, a few notifications). Everything is labelled "(DEMO)".
 * Tolerates rows of other groups being absent: projects are looked up, never assumed.
 */
export async function seedFinance(ctx: SeedCtx): Promise<void> {
  const { admin, daysAgo, dayOnly } = ctx;

  async function attach(o: { name: string; clientId: string; uploadedById: string; visible: boolean; contractId?: string; invoiceId?: string }) {
    const key = `${crypto.randomUUID()}.pdf`;
    const data = demoPdf(o.name);
    await storage.put(key, data, { contentType: 'application/pdf' });
    await prisma.file.create({
      data: {
        fileName: `${o.name}.pdf`, filePath: key, fileType: 'application/pdf', size: data.length, clientId: o.clientId, uploadedById: o.uploadedById,
        contractId: o.contractId ?? null, invoiceId: o.invoiceId ?? null, visibleToClient: o.visible,
      },
    });
  }

  const audits: Prisma.AuditLogCreateManyInput[] = [];
  const logAudit = (a: { action: string; entity: 'contract' | 'invoice'; id: string; clientId: string; projectId?: string | null; at: Date; visible: boolean; meta: Record<string, unknown> }) =>
    audits.push({ userId: admin.id, action: a.action, entity: a.entity, entityId: a.id, metadata: JSON.stringify(a.meta), clientId: a.clientId, projectId: a.projectId ?? null, clientVisible: a.visible, createdAt: a.at });

  // ── contracts ──
  type ContractSeed = { name: string; status: 'DRAFT' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED'; start: number; end: number; renewal?: number; value: number; shared: boolean; notes?: string; pdf?: boolean };
  async function contracts(client: Client, list: ContractSeed[]) {
    const out: Array<{ id: string; name: string; daysLeft: number }> = [];
    for (const c of list) {
      const created = Math.max(0, c.start + 2);
      const row = await createWithNumber('contract', (contractNumber) =>
        prisma.contract.create({
          data: {
            clientId: client.id, name: c.name, contractNumber, status: c.status, startDate: dayOnly(c.start), endDate: dayOnly(c.end),
            renewalDate: c.renewal !== undefined ? dayOnly(c.renewal) : null, value: c.value, visibleToClient: c.shared, notes: c.notes ?? null,
            createdById: admin.id, createdAt: daysAgo(created),
          },
        }),
      );
      logAudit({ action: 'CONTRACT_CREATED', entity: 'contract', id: row.id, clientId: client.id, at: daysAgo(created), visible: c.shared && c.status !== 'DRAFT', meta: { number: row.contractNumber } });
      if (c.pdf) await attach({ name: `${c.name} (signed)`, clientId: client.id, uploadedById: admin.id, visible: c.shared, contractId: row.id });
      out.push({ id: row.id, name: c.name, daysLeft: -c.end });
    }
    return out;
  }

  const lumenContracts = await contracts(ctx.lumen, [
    { name: 'Monthly Social Media Retainer (DEMO)', status: 'ACTIVE', start: 120, end: -245, renewal: -215, value: 14400, shared: true, notes: 'Includes 12 posts/month. Discount agreed verbally - keep at 10%.', pdf: true },
    { name: 'Website Refresh Agreement (DEMO)', status: 'EXPIRING', start: 340, end: -20, renewal: -10, value: 6500, shared: true, notes: 'Client wants to renew with a smaller scope.', pdf: true },
    { name: '2025 Launch Campaign Agreement (DEMO)', status: 'EXPIRED', start: 560, end: 30, value: 9000, shared: true },
    { name: 'Referral Partnership Terms - internal draft (DEMO)', status: 'DRAFT', start: -5, end: -365, value: 0, shared: false, notes: 'Internal draft only. Not sent to the client yet.' },
  ]);
  await contracts(ctx.ufuq, [
    { name: 'عقد الإدارة الشهرية للحملات (DEMO)', status: 'ACTIVE', start: 90, end: -275, renewal: -245, value: 18000, shared: true, notes: 'Internal: payment terms net 15.', pdf: true },
    { name: 'اتفاقية حملة رمضان السابقة (DEMO)', status: 'EXPIRED', start: 400, end: 45, value: 7500, shared: true },
    { name: 'Creative Services Addendum - internal draft (DEMO)', status: 'DRAFT', start: -3, end: -180, value: 3200, shared: false, notes: 'Waiting for the client to confirm the scope.' },
  ]);

  // ── invoices ──
  type InvoiceSeed = { status: 'DRAFT' | 'SENT' | 'PENDING' | 'PAID' | 'OVERDUE'; issued: number; due: number; amount: number; taxRate: number; shared: boolean; description: string; notes?: string; paid?: number; project?: number; pdf?: boolean };
  const overdueRows: Array<{ id: string; number: string; client: string }> = [];
  const sentRows: Array<{ id: string; number: string; clientId: string }> = [];
  async function invoices(client: Client, list: InvoiceSeed[]) {
    const projects = await prisma.project.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'asc' }, take: 3, select: { id: true } });
    for (const i of list) {
      const tax = round2(i.amount * i.taxRate);
      const projectId = i.project !== undefined ? (projects[i.project]?.id ?? null) : null;
      const row = await createWithNumber('invoice', (invoiceNumber) =>
        prisma.invoice.create({
          data: {
            clientId: client.id, projectId, invoiceNumber, issueDate: dayOnly(i.issued), dueDate: dayOnly(i.due), amount: i.amount, tax, total: round2(i.amount + tax),
            status: i.status, description: i.description, notes: i.notes ?? null, paidAt: i.status === 'PAID' ? daysAgo(i.paid ?? 3) : null,
            visibleToClient: i.shared, createdById: admin.id, createdAt: daysAgo(i.issued),
          },
        }),
      );
      const visible = i.shared && i.status !== 'DRAFT';
      logAudit({ action: 'INVOICE_CREATED', entity: 'invoice', id: row.id, clientId: client.id, projectId, at: daysAgo(i.issued), visible: false, meta: { number: row.invoiceNumber } });
      if (i.status !== 'DRAFT') logAudit({ action: 'INVOICE_STATUS_CHANGED', entity: 'invoice', id: row.id, clientId: client.id, projectId, at: daysAgo(i.issued, 11), visible, meta: { number: row.invoiceNumber, from: 'DRAFT', to: i.status === 'PAID' || i.status === 'OVERDUE' ? 'SENT' : i.status } });
      if (i.status === 'PAID') logAudit({ action: 'INVOICE_STATUS_CHANGED', entity: 'invoice', id: row.id, clientId: client.id, projectId, at: daysAgo(i.paid ?? 3), visible, meta: { number: row.invoiceNumber, from: 'SENT', to: 'PAID' } });
      if (i.status === 'OVERDUE') {
        logAudit({ action: 'INVOICE_STATUS_CHANGED', entity: 'invoice', id: row.id, clientId: client.id, projectId, at: daysAgo(Math.max(0, i.due - 1)), visible, meta: { number: row.invoiceNumber, from: 'SENT', to: 'OVERDUE', auto: true } });
        overdueRows.push({ id: row.id, number: row.invoiceNumber, client: client.companyName });
      }
      if (i.status === 'SENT' && visible) sentRows.push({ id: row.id, number: row.invoiceNumber, clientId: client.id });
      if (i.pdf) await attach({ name: `${row.invoiceNumber}`, clientId: client.id, uploadedById: admin.id, visible: i.shared, invoiceId: row.id });
    }
  }

  await invoices(ctx.lumen, [
    { status: 'PAID', issued: 75, due: 45, amount: 1200, taxRate: 0.14, shared: true, description: 'Social media management - month 1 (DEMO)', paid: 50, project: 0, pdf: true },
    { status: 'PAID', issued: 44, due: 14, amount: 1200, taxRate: 0.14, shared: true, description: 'Social media management - month 2 (DEMO)', paid: 3, project: 0, pdf: true },
    { status: 'OVERDUE', issued: 50, due: 20, amount: 2500, taxRate: 0.14, shared: true, description: 'Website refresh - design milestone (DEMO)', notes: 'Chased twice by e-mail. Nadia promised payment this week.', project: 1 },
    { status: 'PENDING', issued: 15, due: -15, amount: 800, taxRate: 0.14, shared: true, description: 'Ad creative pack - Spring Sale (DEMO)', project: 0 },
    { status: 'SENT', issued: 6, due: -24, amount: 1200, taxRate: 0.14, shared: true, description: 'Social media management - month 3 (DEMO)', project: 0, pdf: true },
    { status: 'DRAFT', issued: 0, due: -30, amount: 1900, taxRate: 0.14, shared: false, description: 'Wholesale landing page - draft (DEMO)', notes: 'Waiting for final scope before sending.' },
  ]);
  await invoices(ctx.ufuq, [
    { status: 'PAID', issued: 80, due: 50, amount: 1500, taxRate: 0.14, shared: true, description: 'إدارة الحملات الإعلانية - الشهر الأول (DEMO)', paid: 55, pdf: true },
    { status: 'PAID', issued: 48, due: 18, amount: 1500, taxRate: 0.14, shared: true, description: 'إدارة الحملات الإعلانية - الشهر الثاني (DEMO)', paid: 2 },
    { status: 'OVERDUE', issued: 40, due: 10, amount: 2200, taxRate: 0.14, shared: true, description: 'تصميم مواد حملة رمضان (DEMO)', notes: 'Client asked for a 2-week extension.' },
    { status: 'PENDING', issued: 12, due: -18, amount: 950, taxRate: 0.14, shared: false, description: 'Landing page copywriting (DEMO)', notes: 'Not shared yet - waiting for the client to approve the scope.' },
    { status: 'SENT', issued: 5, due: -25, amount: 1500, taxRate: 0.14, shared: true, description: 'إدارة الحملات الإعلانية - الشهر الثالث (DEMO)' },
    { status: 'DRAFT', issued: 0, due: -30, amount: 3000, taxRate: 0.14, shared: false, description: 'Brand video production - draft (DEMO)' },
  ]);

  await prisma.auditLog.createMany({ data: audits });

  // ── notifications ──
  const expiring = lumenContracts.find((c) => c.name.startsWith('Website Refresh'));
  const notes: Prisma.NotificationCreateManyInput[] = [];
  if (expiring) {
    notes.push({ userId: admin.id, type: 'CONTRACT_EXPIRING', entity: 'contract', entityId: expiring.id, data: JSON.stringify({ name: expiring.name, client: ctx.lumen.companyName, days: expiring.daysLeft }), createdAt: daysAgo(0, 8) });
  }
  for (const o of overdueRows) {
    notes.push({ userId: admin.id, type: 'INVOICE_OVERDUE', entity: 'invoice', entityId: o.id, data: JSON.stringify({ number: o.number, client: o.client }), createdAt: daysAgo(0, 8) });
  }
  for (const s of sentRows) {
    const user = s.clientId === ctx.lumen.id ? ctx.lumenUser : ctx.ufuqUser;
    notes.push({ userId: user.id, type: 'INVOICE_SENT', entity: 'invoice', entityId: s.id, data: JSON.stringify({ number: s.number }), createdAt: daysAgo(5, 11) });
  }
  if (notes.length) await prisma.notification.createMany({ data: notes });
}
