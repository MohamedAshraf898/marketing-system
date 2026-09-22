import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { adminOnly, authenticate } from '../auth/middleware';
import { requirePerm } from '../authz/permissions';
import { prisma } from '../db';
import { Errors } from '../lib/errors';
import { asyncHandler, pageMeta, paging, qs } from '../lib/http';
import { endOfDayUtc, isDateOnly, parseDateOnly } from '../lib/dates';
import { and, parseJson } from '../services/serializers';

export const auditLogsRouter = Router();
// ADMIN only (defence in depth: the role gate AND the audit_logs.view permission, which TEAM members can never hold)
auditLogsRouter.use(authenticate, adminOnly, requirePerm('audit_logs.view'));

const SENSITIVE_KEY = /pass(word)?|token|secret|hash|authorization|cookie|api[-_]?key/i;

/** Metadata should never hold secrets, but if a key ever looks like one its value is masked before it leaves the server. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

function filters(req: Request): Prisma.AuditLogWhereInput {
  const action = qs(req.query, 'action');
  const entity = qs(req.query, 'entity');
  const userId = qs(req.query, 'userId');
  const clientId = qs(req.query, 'clientId');
  const q = qs(req.query, 'q')?.slice(0, 100);
  const from = qs(req.query, 'from');
  const to = qs(req.query, 'to');
  if ((from && !isDateOnly(from)) || (to && !isDateOnly(to))) throw Errors.validation({ from: 'invalid_date' });
  return and<Prisma.AuditLogWhereInput>(
    action ? { action } : undefined,
    entity ? { entity } : undefined,
    userId ? { userId } : undefined,
    clientId ? { clientId } : undefined,
    q ? { OR: [{ action: { contains: q } }, { entity: { contains: q } }, { entityId: { contains: q } }, { metadata: { contains: q } }] } : undefined,
    from || to ? { createdAt: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lte: endOfDayUtc(to) } : {}) } } : undefined,
  );
}

const include = { user: { select: { id: true, name: true, email: true, role: true } } } satisfies Prisma.AuditLogInclude;
type Row = Prisma.AuditLogGetPayload<{ include: typeof include }>;

const shape = (r: Row) => ({
  id: r.id,
  action: r.action,
  entity: r.entity,
  entityId: r.entityId,
  clientId: r.clientId,
  projectId: r.projectId,
  clientVisible: r.clientVisible,
  ip: r.ip,
  createdAt: r.createdAt,
  metadata: redact(parseJson(r.metadata)),
  user: r.user,
});

auditLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = paging(req.query, 30, 100);
    const where = filters(req);
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take, include }),
    ]);
    res.json({ items: rows.map(shape), meta: pageMeta(p, total) });
  }),
);

/** CSV cell: quoted when needed and neutralised against spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const EXPORT_CAP = 20_000;

auditLogsRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const where = filters(req);
    const rows = await prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: EXPORT_CAP, include });
    const head = ['createdAt', 'user', 'email', 'role', 'action', 'entity', 'entityId', 'clientId', 'projectId', 'ip', 'metadata'];
    const lines = [head.join(',')];
    for (const r of rows) {
      const m = shape(r);
      lines.push([m.createdAt, m.user?.name, m.user?.email, m.user?.role, m.action, m.entity, m.entityId, m.clientId, m.projectId, m.ip, m.metadata].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  }),
);
