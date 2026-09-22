// Owner: Insights group.  searchRouter -> /search
import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, qs } from '../lib/http';
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY, SEARCH_TYPES, allowedTypes, normalizeQuery, searchAll, type SearchType } from '../services/search';

export const searchRouter = Router();
searchRouter.use(authenticate);

// GET /search?q=&types=client,project&limit=5
searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const raw = qs(req.query, 'q') ?? '';
    const q = normalizeQuery(raw);
    if (!q) throw Errors.validation({ q: raw.length > MAX_QUERY ? 'too_long' : 'too_short' });

    const typesRaw = qs(req.query, 'types');
    const types = typesRaw
      ? [...new Set(typesRaw.split(',').map((t) => t.trim()))].filter((t): t is SearchType => (SEARCH_TYPES as readonly string[]).includes(t))
      : undefined;
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(qs(req.query, 'limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

    const items = await searchAll(scope, q, { types, limit });
    res.json({ query: q, items, types: allowedTypes(scope) });
  }),
);
