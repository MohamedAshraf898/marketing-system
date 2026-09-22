// Owner: CRM group.  activityRouter -> /activity
// The activity feed is built from the audit trail, but NEVER exposes raw audit rows: the response is a sanitised DTO
// (no ip, no raw metadata - only a small whitelist of keys) and CLIENT users only get rows flagged clientVisible for
// their own company.
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../auth/middleware';
import { requirePermOrClient } from '../authz/permissions';
import { activityWhere, isClient, projectWhere, type Scope } from '../authz/scope';
import { prisma } from '../db';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, pageMeta, paging, qs } from '../lib/http';
import { and, parseJson } from '../services/serializers';

export const activityRouter = Router();
activityRouter.use(authenticate);

/** Entities that are internal by nature: never part of a CLIENT's timeline, even if a row was flagged visible by mistake. */
const CLIENT_HIDDEN_ENTITIES = ['internal_note', 'onboarding_item', 'task', 'time', 'user', 'settings', 'contact'];

/** Staff only see the entities they hold the permission for (an unassigned-money row must not leak through the feed). */
function hiddenEntitiesFor(scope: Scope): string[] {
  if (scope.role === 'ADMIN') return [];
  if (scope.role === 'CLIENT') return CLIENT_HIDDEN_ENTITIES;
  const p = scope.permissions;
  const hidden = ['user', 'settings'];
  if (!p.has('invoices.view')) hidden.push('invoice');
  if (!p.has('contracts.view')) hidden.push('contract');
  if (!p.has('tasks.view')) hidden.push('task');
  if (!p.has('notes.internal')) hidden.push('internal_note');
  if (!p.has('projects.view')) hidden.push('project', 'milestone');
  if (!p.has('content.view')) hidden.push('content');
  return hidden;
}

const shortStr = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, 120) : undefined);

/** Whitelisted, flat summary of an audit row's metadata. Anything not listed here is dropped. */
export function summarize(raw: string | null): { name?: string; title?: string; status?: string; from?: string; to?: string; version?: number } {
  const m = parseJson<Record<string, unknown>>(raw);
  if (!m) return {};
  const out: { name?: string; title?: string; status?: string; from?: string; to?: string; version?: number } = {};
  const name = shortStr(m.name) ?? shortStr(m.companyName) ?? shortStr(m.fileName);
  if (name) out.name = name;
  const title = shortStr(m.title);
  if (title) out.title = title;
  // status can be a plain string ({status:'RUNNING'}) or a transition ({status:{from,to}})
  const st = m.status;
  if (typeof st === 'string') out.status = shortStr(st);
  else if (st && typeof st === 'object') {
    const s = st as Record<string, unknown>;
    if (shortStr(s.from)) out.from = shortStr(s.from);
    if (shortStr(s.to)) out.to = shortStr(s.to);
  }
  if (shortStr(m.from) && typeof m.from === 'string') out.from = m.from.slice(0, 120);
  if (shortStr(m.to) && typeof m.to === 'string') out.to = m.to.slice(0, 120);
  if (typeof m.version === 'number' && Number.isFinite(m.version)) out.version = m.version;
  for (const k of Object.keys(out) as Array<keyof typeof out>) if (out[k] === undefined) delete out[k];
  return out;
}

activityRouter.get(
  '/',
  requirePermOrClient('clients.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const client = isClient(scope);
    const p = paging(req.query, 20);
    const clientId = qs(req.query, 'clientId');
    const projectId = qs(req.query, 'projectId');
    const entity = qs(req.query, 'entity')?.slice(0, 40);
    const action = qs(req.query, 'action')?.slice(0, 60);
    const userId = client ? undefined : qs(req.query, 'userId'); // who did it is not a filter clients may use

    if (projectId) {
      // a project timeline needs the project to be in the caller's scope (404 otherwise, existence is not revealed)
      const proj = await prisma.project.findFirst({ where: and<Prisma.ProjectWhereInput>({ id: projectId, ...(clientId ? { clientId } : {}) }, projectWhere(scope)), select: { id: true } });
      if (!proj) throw Errors.notFound();
    }

    // Team members only get the activity of clients they are assigned to as a whole (activityWhere also lets in the
    // clients of single assigned campaigns - their partial access must not open the entire client timeline).
    const staffScope: Prisma.AuditLogWhereInput | undefined = scope.role === 'TEAM' ? { clientId: { in: scope.fullClientIds } } : undefined;
    const hidden = hiddenEntitiesFor(scope);
    // internal projects (visibleToClient = false) never show up in a client's feed
    const hiddenProjects = client && scope.clientId
      ? (await prisma.project.findMany({ where: { clientId: scope.clientId, visibleToClient: false }, select: { id: true } })).map((x) => x.id)
      : [];

    const where = and<Prisma.AuditLogWhereInput>(
      activityWhere(scope),
      staffScope,
      hidden.length ? { entity: { notIn: hidden } } : undefined,
      hiddenProjects.length ? { OR: [{ projectId: null }, { projectId: { notIn: hiddenProjects } }] } : undefined,
      clientId ? { clientId } : undefined,
      projectId ? { projectId } : undefined,
      entity ? { entity } : undefined,
      action ? { action } : undefined,
      userId ? { userId } : undefined,
    );
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: p.take,
        select: { id: true, action: true, entity: true, entityId: true, metadata: true, createdAt: true, clientId: true, projectId: true, user: { select: { id: true, name: true, role: true } } },
      }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      clientId: r.clientId,
      projectId: r.projectId,
      createdAt: r.createdAt,
      // clients see the name of the agency member (never an e-mail or id); staff see the full actor
      actor: r.user
        ? client
          ? { name: r.user.name, role: r.user.role === 'CLIENT' ? 'CLIENT' : 'TEAM' }
          : { id: r.user.id, name: r.user.name, role: r.user.role }
        : null,
      summary: summarize(r.metadata),
    }));
    res.json({ items, meta: pageMeta(p, total) });
  }),
);
