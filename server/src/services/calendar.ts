import type { Prisma } from '@prisma/client';
import {
  campaignWhere, clientWhere, contentWhere, contractWhere, deliverableWhere, invoiceWhere, projectWhere, taskWhere, type Scope,
} from '../authz/scope';
import { prisma } from '../db';
import { dayKey, endOfDayUtc, parseDateOnly } from '../lib/dates';
import { and } from './serializers';

/**
 * Unified calendar. Every source is scoped with the same where-builders + permission rules as the rest of the app,
 * so a user only sees dates of records they may open. CLIENT users never get tasks (taskWhere matches nothing).
 */

export const CALENDAR_TYPES = ['task', 'project', 'content', 'campaign', 'deliverable', 'invoice', 'contract', 'client'] as const;
export type CalendarSource = (typeof CALENDAR_TYPES)[number];

export const MAX_CALENDAR_DAYS = 100;
export const MAX_EVENTS = 1000;
const PER_SOURCE = 400;

export type CalendarKind = 'due' | 'start' | 'end' | 'publish' | 'milestone' | 'renewal' | 'contract_end';

export interface CalendarEvent {
  key: string; // unique per event (an entity can appear twice: campaign start + end)
  type: 'task' | 'project' | 'milestone' | 'content' | 'campaign' | 'deliverable' | 'invoice' | 'contract' | 'client';
  kind: CalendarKind;
  id: string;
  title: string;
  date: string; // date-only (YYYY-MM-DD) for allDay events, ISO datetime otherwise
  allDay: boolean;
  status?: string;
  clientName?: string;
  url: string;
  colorKey: 'task' | 'project' | 'content' | 'campaign' | 'deliverable' | 'invoice' | 'contract';
}

const enc = encodeURIComponent;

export function allowedSources(scope: Scope): CalendarSource[] {
  const client = scope.role === 'CLIENT';
  const can = (p: Parameters<Scope['permissions']['has']>[0]) => scope.permissions.has(p);
  return CALENDAR_TYPES.filter((t) => {
    switch (t) {
      case 'task': return !client && can('tasks.view');
      case 'client': return !client && can('clients.view');
      case 'project': return client || can('projects.view');
      case 'content': return client || can('content.view');
      case 'campaign': return client || can('campaigns.view');
      case 'invoice': return client || can('invoices.view');
      case 'contract': return client || can('contracts.view');
      default: return true; // deliverables: scope helper only
    }
  });
}

export async function calendarEvents(scope: Scope, range: { from: string; to: string }, sources?: CalendarSource[]) {
  const allowed = allowedSources(scope);
  const want = new Set((sources?.length ? sources : allowed).filter((s) => allowed.includes(s)));
  const gte = parseDateOnly(range.from);
  const lte = endOfDayUtc(range.to);
  const inRange = { gte, lte };
  const own = (name?: string | null) => (scope.role === 'CLIENT' ? undefined : name ?? undefined);
  const day = (d: Date) => dayKey(d);
  const jobs: Array<Promise<CalendarEvent[]>> = [];

  if (want.has('task')) {
    jobs.push(
      prisma.task
        .findMany({
          where: and<Prisma.TaskWhereInput>(taskWhere(scope), { dueDate: inRange, archivedAt: null }),
          orderBy: { dueDate: 'asc' },
          take: PER_SOURCE,
          select: { id: true, title: true, status: true, dueDate: true, client: { select: { companyName: true } } },
        })
        .then((rows) =>
          rows.map((r): CalendarEvent => ({
            key: `task:${r.id}`, type: 'task', kind: 'due', id: r.id, title: r.title, date: day(r.dueDate!), allDay: true, status: r.status, clientName: r.client?.companyName,
            url: `/tasks?task=${enc(r.id)}&open=${enc(r.id)}`, colorKey: 'task',
          })),
        ),
    );
  }

  if (want.has('project')) {
    jobs.push(
      prisma.project
        .findMany({
          where: and<Prisma.ProjectWhereInput>(projectWhere(scope), { dueDate: inRange }),
          orderBy: { dueDate: 'asc' },
          take: PER_SOURCE,
          select: { id: true, name: true, status: true, dueDate: true, client: { select: { companyName: true } } },
        })
        .then((rows) =>
          rows.map((r): CalendarEvent => ({
            key: `project:${r.id}`, type: 'project', kind: 'due', id: r.id, title: r.name, date: day(r.dueDate!), allDay: true, status: r.status, clientName: own(r.client.companyName),
            url: `/projects/${r.id}`, colorKey: 'project',
          })),
        ),
      prisma.milestone
        .findMany({
          where: { dueDate: inRange, project: { is: projectWhere(scope) } },
          orderBy: { dueDate: 'asc' },
          take: PER_SOURCE,
          select: { id: true, title: true, dueDate: true, completedAt: true, project: { select: { id: true, name: true, client: { select: { companyName: true } } } } },
        })
        .then((rows) =>
          rows.map((r): CalendarEvent => ({
            key: `milestone:${r.id}`, type: 'milestone', kind: 'milestone', id: r.id, title: `${r.project.name}: ${r.title}`, date: day(r.dueDate!), allDay: true,
            status: r.completedAt ? 'DONE' : undefined, clientName: own(r.project.client.companyName), url: `/projects/${r.project.id}`, colorKey: 'project',
          })),
        ),
    );
  }

  if (want.has('content')) {
    jobs.push(
      prisma.contentItem
        .findMany({
          where: and<Prisma.ContentItemWhereInput>(contentWhere(scope), { publishDate: inRange }),
          orderBy: { publishDate: 'asc' },
          take: PER_SOURCE,
          select: { id: true, title: true, status: true, publishDate: true, client: { select: { companyName: true } } },
        })
        .then((rows) =>
          rows.map((r): CalendarEvent => ({
            key: `content:${r.id}`, type: 'content', kind: 'publish', id: r.id, title: r.title, date: r.publishDate!.toISOString(), allDay: false, status: r.status, clientName: own(r.client.companyName),
            url: `/content?item=${enc(r.id)}&open=${enc(r.id)}`, colorKey: 'content',
          })),
        ),
    );
  }

  if (want.has('campaign')) {
    jobs.push(
      prisma.campaign
        .findMany({
          where: and<Prisma.CampaignWhereInput>(campaignWhere(scope), { OR: [{ startDate: inRange }, { endDate: inRange }] }),
          take: PER_SOURCE,
          select: { id: true, name: true, status: true, startDate: true, endDate: true, client: { select: { companyName: true } } },
        })
        .then((rows) => {
          const out: CalendarEvent[] = [];
          for (const r of rows) {
            const base = { type: 'campaign' as const, id: r.id, title: r.name, allDay: true, status: r.status, clientName: own(r.client.companyName), url: `/campaigns/${r.id}`, colorKey: 'campaign' as const };
            if (r.startDate && r.startDate >= gte && r.startDate <= lte) out.push({ ...base, key: `campaign:${r.id}:start`, kind: 'start', date: day(r.startDate) });
            if (r.endDate && r.endDate >= gte && r.endDate <= lte) out.push({ ...base, key: `campaign:${r.id}:end`, kind: 'end', date: day(r.endDate) });
          }
          return out;
        }),
    );
  }

  if (want.has('deliverable')) {
    jobs.push(
      prisma.deliverable
        .findMany({
          where: and<Prisma.DeliverableWhereInput>(deliverableWhere(scope), { dueDate: inRange }),
          orderBy: { dueDate: 'asc' },
          take: PER_SOURCE,
          select: { id: true, name: true, status: true, dueDate: true, client: { select: { companyName: true } } },
        })
        .then((rows) =>
          rows.map((r): CalendarEvent => ({
            key: `deliverable:${r.id}`, type: 'deliverable', kind: 'due', id: r.id, title: r.name, date: day(r.dueDate!), allDay: true, status: r.status, clientName: own(r.client.companyName),
            url: `/deliverables/${r.id}`, colorKey: 'deliverable',
          })),
        ),
    );
  }

  if (want.has('invoice')) {
    jobs.push(
      prisma.invoice
        .findMany({
          where: and<Prisma.InvoiceWhereInput>(invoiceWhere(scope), { dueDate: inRange }),
          orderBy: { dueDate: 'asc' },
          take: PER_SOURCE,
          select: { id: true, invoiceNumber: true, status: true, dueDate: true, client: { select: { companyName: true } } },
        })
        .then((rows) =>
          rows.map((r): CalendarEvent => ({
            key: `invoice:${r.id}`, type: 'invoice', kind: 'due', id: r.id, title: r.invoiceNumber, date: day(r.dueDate), allDay: true, status: r.status, clientName: own(r.client.companyName),
            url: `/invoices?id=${enc(r.id)}&open=${enc(r.id)}`, colorKey: 'invoice',
          })),
        ),
    );
  }

  if (want.has('contract')) {
    jobs.push(
      prisma.contract
        .findMany({
          where: and<Prisma.ContractWhereInput>(contractWhere(scope), { OR: [{ endDate: inRange }, { renewalDate: inRange }] }),
          take: PER_SOURCE,
          select: { id: true, name: true, status: true, endDate: true, renewalDate: true, client: { select: { companyName: true } } },
        })
        .then((rows) => {
          const out: CalendarEvent[] = [];
          for (const r of rows) {
            const base = { type: 'contract' as const, id: r.id, title: r.name, allDay: true, status: r.status, clientName: own(r.client.companyName), url: `/contracts?id=${enc(r.id)}&open=${enc(r.id)}`, colorKey: 'contract' as const };
            if (r.endDate && r.endDate >= gte && r.endDate <= lte) out.push({ ...base, key: `contract:${r.id}:end`, kind: 'end', date: day(r.endDate) });
            if (r.renewalDate && r.renewalDate >= gte && r.renewalDate <= lte) out.push({ ...base, key: `contract:${r.id}:renewal`, kind: 'renewal', date: day(r.renewalDate) });
          }
          return out;
        }),
    );
  }

  if (want.has('client')) {
    // the client-level contract end date (CRM field) - staff only
    jobs.push(
      prisma.client
        .findMany({
          where: and<Prisma.ClientWhereInput>(clientWhere(scope), { contractEnd: inRange }),
          take: PER_SOURCE,
          select: { id: true, companyName: true, status: true, contractEnd: true },
        })
        .then((rows) =>
          rows.map((r): CalendarEvent => ({
            key: `client:${r.id}:contract_end`, type: 'client', kind: 'contract_end', id: r.id, title: r.companyName, date: day(r.contractEnd!), allDay: true, status: r.status,
            url: `/clients/${r.id}`, colorKey: 'contract',
          })),
        ),
    );
  }

  const events = (await Promise.all(jobs)).flat().sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const truncated = events.length > MAX_EVENTS;
  return { events: truncated ? events.slice(0, MAX_EVENTS) : events, truncated };
}
