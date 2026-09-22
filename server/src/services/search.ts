import type { Prisma } from '@prisma/client';
import {
  campaignWhere, clientWhere, contactWhere, contentWhere, contractWhere, deliverableWhere, fileWhere, invoiceWhere, projectWhere, requestWhere, taskWhere, type Scope,
} from '../authz/scope';
import { prisma } from '../db';
import { and } from './serializers';

/**
 * Global search. Every type is built from the caller's scope helper AND the permission that guards the feature, so
 * a hit is always something the caller could open from the normal UI. Only whitelisted fields are ever returned
 * (never internal notes, task comments, time entries, contact notes ...) and only whitelisted columns are searched.
 */

export const SEARCH_TYPES = ['client', 'contact', 'project', 'task', 'campaign', 'deliverable', 'content', 'request', 'file', 'invoice', 'contract'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const MIN_QUERY = 2;
export const MAX_QUERY = 80;
export const MAX_TYPES = 8;
export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 10;

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  status?: string;
  clientName?: string;
  url: string;
}

const enc = encodeURIComponent;
const opened = (path: string, key: string, id: string) => `${path}?${key}=${enc(id)}&open=${enc(id)}`;

/** Which types this caller may search at all (permission + role rules). */
export function allowedTypes(scope: Scope): SearchType[] {
  const client = scope.role === 'CLIENT';
  const can = (p: Parameters<Scope['permissions']['has']>[0]) => scope.permissions.has(p);
  return SEARCH_TYPES.filter((t) => {
    switch (t) {
      case 'client':
      case 'contact':
        return !client && can('clients.view');
      case 'task':
        return !client && can('tasks.view');
      case 'project':
        return client || can('projects.view');
      case 'campaign':
        return client || can('campaigns.view');
      case 'content':
        return client || can('content.view');
      case 'invoice':
        return client || can('invoices.view');
      case 'contract':
        return client || can('contracts.view');
      default:
        return true; // deliverables, requests, files: their scope helper already limits them
    }
  });
}

const contains = (fields: string[], term: string) => ({ OR: fields.map((f) => ({ [f]: { contains: term } })) });
const own = (scope: Scope, name?: string | null) => (scope.role === 'CLIENT' ? undefined : name ?? undefined);

/**
 * `%` and `_` are LIKE wildcards. They must match literally, so for terms that contain them the (wider) database
 * result is re-checked in memory against the literal text.
 */
const hasWildcard = (term: string) => /[%_\\]/.test(term);

type Builder = (scope: Scope, term: string, take: number) => Promise<{ rows: unknown[]; hits: (row: unknown) => Omit<SearchHit, 'type'>; values: (row: unknown) => Array<string | null | undefined> }>;

const builders: Record<SearchType, Builder> = {
  client: async (scope, term, take) => {
    const rows = await prisma.client.findMany({
      where: and<Prisma.ClientWhereInput>(clientWhere(scope), contains(['companyName', 'name', 'email', 'industry'], term)),
      orderBy: { companyName: 'asc' },
      take,
      select: { id: true, companyName: true, name: true, email: true, status: true, industry: true },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.companyName, subtitle: x.name || x.email, status: x.status, url: `/clients/${x.id}` };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.companyName, x.name, x.email, x.industry];
      },
    };
  },
  contact: async (scope, term, take) => {
    const rows = await prisma.clientContact.findMany({
      where: and<Prisma.ClientContactWhereInput>(contactWhere(scope), contains(['name', 'email', 'jobTitle'], term)),
      orderBy: { name: 'asc' },
      take,
      select: { id: true, name: true, email: true, jobTitle: true, clientId: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.name, subtitle: x.jobTitle || x.email, clientName: x.client.companyName, url: `/clients/${x.clientId}` };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.name, x.email, x.jobTitle];
      },
    };
  },
  project: async (scope, term, take) => {
    const rows = await prisma.project.findMany({
      where: and<Prisma.ProjectWhereInput>(projectWhere(scope), contains(['name', 'description'], term)),
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, name: true, status: true, description: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.name, subtitle: null, status: x.status, clientName: own(scope, x.client.companyName), url: `/projects/${x.id}` };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.name, x.description];
      },
    };
  },
  task: async (scope, term, take) => {
    const rows = await prisma.task.findMany({
      where: and<Prisma.TaskWhereInput>(taskWhere(scope), contains(['title', 'description'], term)),
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, title: true, status: true, description: true, client: { select: { companyName: true } }, project: { select: { name: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.title, subtitle: x.project?.name ?? null, status: x.status, clientName: x.client?.companyName, url: opened('/tasks', 'task', x.id) };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.title, x.description];
      },
    };
  },
  campaign: async (scope, term, take) => {
    const rows = await prisma.campaign.findMany({
      where: and<Prisma.CampaignWhereInput>(campaignWhere(scope), contains(['name', 'description'], term)),
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, name: true, status: true, platform: true, description: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.name, subtitle: x.platform, status: x.status, clientName: own(scope, x.client.companyName), url: `/campaigns/${x.id}` };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.name, x.description];
      },
    };
  },
  deliverable: async (scope, term, take) => {
    const rows = await prisma.deliverable.findMany({
      where: and<Prisma.DeliverableWhereInput>(deliverableWhere(scope), contains(['name', 'description'], term)),
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, name: true, status: true, type: true, description: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.name, subtitle: x.type, status: x.status, clientName: own(scope, x.client.companyName), url: `/deliverables/${x.id}` };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.name, x.description];
      },
    };
  },
  content: async (scope, term, take) => {
    const rows = await prisma.contentItem.findMany({
      where: and<Prisma.ContentItemWhereInput>(contentWhere(scope), contains(['title', 'caption'], term)),
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, title: true, status: true, platform: true, caption: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.title, subtitle: x.platform, status: x.status, clientName: own(scope, x.client.companyName), url: opened('/content', 'item', x.id) };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.title, x.caption];
      },
    };
  },
  request: async (scope, term, take) => {
    const rows = await prisma.request.findMany({
      where: and<Prisma.RequestWhereInput>(requestWhere(scope), contains(['title', 'description'], term)),
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, title: true, status: true, type: true, description: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.title, subtitle: x.type, status: x.status, clientName: own(scope, x.client.companyName), url: `/requests/${x.id}` };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.title, x.description];
      },
    };
  },
  file: async (scope, term, take) => {
    const rows = await prisma.file.findMany({
      where: and<Prisma.FileWhereInput>(fileWhere(scope), contains(['fileName'], term)),
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, fileName: true, fileType: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.fileName, subtitle: x.fileType, clientName: own(scope, x.client.companyName), url: `/files?q=${enc(x.fileName)}` };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.fileName];
      },
    };
  },
  invoice: async (scope, term, take) => {
    const rows = await prisma.invoice.findMany({
      where: and<Prisma.InvoiceWhereInput>(invoiceWhere(scope), contains(['invoiceNumber', 'description'], term)),
      orderBy: { issueDate: 'desc' },
      take,
      select: { id: true, invoiceNumber: true, status: true, description: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.invoiceNumber, subtitle: x.description ? x.description.slice(0, 80) : null, status: x.status, clientName: own(scope, x.client.companyName), url: opened('/invoices', 'id', x.id) };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.invoiceNumber, x.description];
      },
    };
  },
  contract: async (scope, term, take) => {
    const rows = await prisma.contract.findMany({
      where: and<Prisma.ContractWhereInput>(contractWhere(scope), contains(['name', 'contractNumber'], term)),
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, name: true, contractNumber: true, status: true, client: { select: { companyName: true } } },
    });
    return {
      rows,
      hits: (r) => {
        const x = r as (typeof rows)[number];
        return { id: x.id, title: x.name, subtitle: x.contractNumber, status: x.status, clientName: own(scope, x.client.companyName), url: opened('/contracts', 'id', x.id) };
      },
      values: (r) => {
        const x = r as (typeof rows)[number];
        return [x.name, x.contractNumber];
      },
    };
  },
};

export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim().replace(/\s+/g, ' ');
  return q.length >= MIN_QUERY && q.length <= MAX_QUERY ? q : null;
}

/** Runs all allowed types in parallel; each type is a single small query. */
export async function searchAll(scope: Scope, term: string, opts: { types?: SearchType[]; limit?: number } = {}): Promise<SearchHit[]> {
  const allowed = allowedTypes(scope);
  const wanted = (opts.types?.length ? opts.types.filter((t) => allowed.includes(t)) : allowed).slice(0, opts.types?.length ? MAX_TYPES : SEARCH_TYPES.length);
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
  const wild = hasWildcard(term);
  const needle = term.toLowerCase();
  const groups = await Promise.all(
    wanted.map(async (type) => {
      // wildcard terms over-match in SQL, so look at a wider window and keep only literal matches
      const b = await builders[type](scope, term, wild ? 100 : limit);
      let rows = b.rows;
      if (wild) rows = rows.filter((r) => b.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(needle)));
      return rows.slice(0, limit).map((r): SearchHit => ({ type, ...b.hits(r) }));
    }),
  );
  return groups.flat();
}
