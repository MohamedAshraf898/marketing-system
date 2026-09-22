// Owner: Insights group.  analyticsRouter -> /analytics
import { Router, type Request } from 'express';
import { CAMPAIGN_STATUSES, OBJECTIVES, PLATFORMS } from '../../../shared/src/enums';
import { authenticate, staffOnly } from '../auth/middleware';
import { requirePerm, requirePermOrClient } from '../authz/permissions';
import { canWriteClient } from '../authz/scope';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, idParam, qs, qsEnum } from '../lib/http';
import { audit } from '../services/audit';
import {
  COMPARE_MODES, SORT_KEYS, campaignPerformance, campaignTable, clientPerformance, clientTable, comparePeriods, comparisonRange, readRange, sortRows, summary,
  type CampaignFilters, type CompareMode, type SortKey,
} from '../services/analytics';
import { campaignCsv } from '../services/reportExport';
import { sendCsv } from '../services/csv';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

const view = requirePermOrClient('reports.view');

const ID = /^[a-zA-Z0-9_-]{5,64}$/;
const optId = (req: Request, key: string): string | undefined => {
  const v = qs(req.query, key);
  if (v === undefined) return undefined;
  if (!ID.test(v)) throw Errors.validation({ [key]: 'invalid' });
  return v;
};

function campaignFilters(req: Request): CampaignFilters {
  return {
    clientId: optId(req, 'clientId'),
    platform: qsEnum(req.query, 'platform', PLATFORMS),
    objective: qsEnum(req.query, 'objective', OBJECTIVES),
    status: qsEnum(req.query, 'status', CAMPAIGN_STATUSES),
  };
}

function sortOf(req: Request): { key: SortKey; dir: 'asc' | 'desc' } {
  const key = qsEnum(req.query, 'sort', SORT_KEYS) ?? 'spend';
  const dir = qsEnum(req.query, 'dir', ['asc', 'desc'] as const) ?? (key === 'name' || key === 'client' ? 'asc' : 'desc');
  return { key, dir };
}

analyticsRouter.get(
  '/campaigns',
  view,
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const range = readRange(req.query);
    const { key, dir } = sortOf(req);
    const t = await campaignTable(scope, campaignFilters(req), range);
    res.json({ items: sortRows(t.items, key, dir), totals: t.totals, range, sort: { key, dir }, truncated: t.truncated });
  }),
);

analyticsRouter.get(
  '/campaign/:id',
  view,
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    res.json(await campaignPerformance(scope, idParam(req), readRange(req.query)));
  }),
);

// staff only: comparing clients with each other is an agency view (TEAM only sees their assigned clients)
analyticsRouter.get(
  '/clients',
  staffOnly,
  requirePerm('reports.view'),
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const range = readRange(req.query);
    const t = await clientTable(scope, range);
    const { key, dir } = sortOf(req);
    const k = key === 'name' || key === 'client' ? null : key;
    const items = [...t.items].sort((a, b) => {
      if (!k) return (dir === 'asc' ? 1 : -1) * a.client.companyName.localeCompare(b.client.companyName);
      const x = a.metrics[k];
      const y = b.metrics[k];
      if (x === null && y === null) return a.client.companyName.localeCompare(b.client.companyName);
      if (x === null) return 1;
      if (y === null) return -1;
      return x === y ? a.client.companyName.localeCompare(b.client.companyName) : (dir === 'asc' ? 1 : -1) * (x - y);
    });
    res.json({ items, totals: t.totals, range, sort: { key, dir } });
  }),
);

analyticsRouter.get(
  '/client/:id',
  view,
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    res.json(await clientPerformance(scope, idParam(req), readRange(req.query)));
  }),
);

analyticsRouter.get(
  '/compare',
  view,
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const kind = qsEnum(req.query, 'scope', ['client', 'campaign', 'all'] as const) ?? 'all';
    const id = kind === 'all' ? undefined : optId(req, 'id');
    if (kind !== 'all' && !id) throw Errors.validation({ id: 'required' });

    const range = readRange(req.query);
    if (!range.from || !range.to) throw Errors.validation({ ...(range.from ? {} : { from: 'required' }), ...(range.to ? {} : { to: 'required' }) });
    const mode = (qsEnum(req.query, 'mode', COMPARE_MODES) ?? 'custom') as CompareMode;
    const custom = mode === 'custom' ? readRange(req.query, 'compareFrom', 'compareTo') : undefined;
    const previous = comparisonRange({ from: range.from, to: range.to }, mode, custom);
    res.json({ mode, ...(await comparePeriods(scope, { kind, id, current: { from: range.from, to: range.to }, previous })) });
  }),
);

analyticsRouter.get(
  '/summary',
  view,
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const range = readRange(req.query);
    res.json(await summary(scope, range.from || range.to ? range : undefined));
  }),
);

// Campaign metrics table as a spreadsheet file.
analyticsRouter.get(
  '/export.csv',
  requirePermOrClient('reports.export'),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const range = readRange(req.query);
    const filters = campaignFilters(req);
    const { key, dir } = sortOf(req);
    const lang = qs(req.query, 'lang') === 'ar' ? 'ar' : 'en';
    const t = await campaignTable(ctx.scope, filters, range);
    const out = campaignCsv(sortRows(t.items, key, dir), t.totals, lang);
    await audit(ctx, 'REPORT_EXPORTED', 'report', null, { kind: 'campaigns', rows: t.items.length, from: range.from ?? null, to: range.to ?? null }, { clientId: ctx.scope.clientId ?? (filters.clientId && canWriteClient(ctx.scope, filters.clientId) ? filters.clientId : null), clientVisible: false });
    sendCsv(res, `campaign-performance-${new Date().toISOString().slice(0, 10)}.csv`, out);
  }),
);
