// Owner: Insights group.  calendarRouter -> /calendar
import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { ctxOf } from '../lib/context';
import { Errors } from '../lib/errors';
import { asyncHandler, qs } from '../lib/http';
import { daysBetween, readRange } from '../services/analytics';
import { CALENDAR_TYPES, MAX_CALENDAR_DAYS, allowedSources, calendarEvents, type CalendarSource } from '../services/calendar';

export const calendarRouter = Router();
calendarRouter.use(authenticate);

// GET /calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&types=task,project,...   (range <= 100 days)
calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { scope } = ctxOf(req);
    const range = readRange(req.query);
    if (!range.from || !range.to) throw Errors.validation({ ...(range.from ? {} : { from: 'required' }), ...(range.to ? {} : { to: 'required' }) });
    if (daysBetween(range.from, range.to) > MAX_CALENDAR_DAYS) throw Errors.validation({ to: 'range_too_large' });
    const typesRaw = qs(req.query, 'types');
    const types = typesRaw ? typesRaw.split(',').map((t) => t.trim()).filter((t): t is CalendarSource => (CALENDAR_TYPES as readonly string[]).includes(t)) : undefined;
    const out = await calendarEvents(scope, { from: range.from, to: range.to }, types);
    res.json({ range, items: out.events, truncated: out.truncated, types: allowedSources(scope) });
  }),
);
