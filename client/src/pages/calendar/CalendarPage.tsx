import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarX2 } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { CalendarEventDto, CalendarResponse, CalendarSource } from '@/api/types.insights';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/ui/PageHeader';
import { CalendarGrid, dayKey, visibleRange, type CalendarEvent } from '@/components/ui/CalendarGrid';
import type { Tone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Drawer } from '@/components/ui/Drawer';
import { cx } from '@/components/ui/cx';

const TONE: Record<CalendarEventDto['colorKey'], Tone> = {
  task: 'blue', project: 'violet', content: 'teal', campaign: 'green', deliverable: 'amber', invoice: 'orange', contract: 'red',
};

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Unified calendar: tasks, project/campaign/contract dates, content publish times, deliverable + invoice due dates. */
export function CalendarPage() {
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [types, setTypes] = useState<CalendarSource[] | null>(null); // null = all allowed
  const [dayOpen, setDayOpen] = useState<Date | null>(null);

  const range = useMemo(() => visibleRange(cursor, view), [cursor, view]);
  const from = isoDay(range.from);
  const to = isoDay(range.to);

  const q = useApi<CalendarResponse>('/calendar', { from, to, types: types?.length ? types.join(',') : undefined });
  const allowed = q.data?.types ?? [];
  const activeTypes = types ?? allowed;

  const events: CalendarEvent[] = useMemo(
    () => (q.data?.items ?? []).map((e): CalendarEvent => ({
      id: e.key,
      date: e.date,
      allDay: e.allDay,
      href: e.url,
      tone: TONE[e.colorKey],
      title: e.title,
      meta: staff && e.clientName ? e.clientName : undefined,
    })),
    [q.data, staff],
  );

  const toggleType = (tp: CalendarSource) => {
    const base = types ?? allowed;
    const next = base.includes(tp) ? base.filter((x) => x !== tp) : [...base, tp];
    setTypes(next.length === allowed.length ? null : next);
  };

  // Matches CalendarGrid's own event-key rule: allDay dates key off their UTC calendar day (never shifts a day in
  // any timezone); real moments (allDay === false) key off the viewer's local day.
  const keyOf = (e: CalendarEvent): string => {
    const d = e.date instanceof Date ? e.date : new Date(e.date);
    return e.allDay === false ? dayKey(d) : dayKey(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };
  const dayEvents = dayOpen ? events.filter((e) => keyOf(e) === dayKey(dayOpen)) : [];

  return (
    <div>
      <PageHeader title={t('nav.calendar')} subtitle={t('insights.calendar.subtitle')} />

      {allowed.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {allowed.map((tp) => {
            const on = activeTypes.includes(tp);
            return (
              <button
                key={tp}
                onClick={() => toggleType(tp)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition',
                  on ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
                )}
              >
                <span className={cx('size-1.5 rounded-full', on ? DOT[TONE[colorKeyOf(tp)]] : 'bg-zinc-400')} />
                {label('calendarSource', tp)}
              </button>
            );
          })}
        </div>
      )}

      {q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.isLoading && !q.data ? (
        <Skeleton className="h-[36rem] w-full" />
      ) : allowed.length === 0 ? (
        <EmptyState icon={CalendarX2} title={t('insights.calendar.empty')} description={t('insights.calendar.emptyHint')} />
      ) : (
        <>
          <CalendarGrid cursor={cursor} onCursorChange={setCursor} view={view} onViewChange={setView} events={events} onDayClick={setDayOpen} />
          {q.data?.truncated && <p className="mt-3 text-xs text-zinc-400">{t('insights.calendar.truncated')}</p>}
        </>
      )}

      <Drawer open={!!dayOpen} onClose={() => setDayOpen(null)} title={dayOpen ? fmt.date(dayOpen) : ''}>
        {dayEvents.length === 0 ? (
          <p className="text-sm text-zinc-500">{t('calendar.noEvents')}</p>
        ) : (
          <ul className="space-y-2">
            {dayEvents.map((e) => (
              <li key={e.id}>
                <Link to={e.href ?? '#'} onClick={() => setDayOpen(null)} className="flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-sm hover:bg-zinc-50">
                  <span className={cx('size-2 shrink-0 rounded-full', DOT[e.tone ?? 'neutral'])} />
                  <span className="min-w-0 flex-1 truncate text-zinc-900">{e.title}</span>
                  {e.meta && <span className="shrink-0 truncate text-xs text-zinc-500">{e.meta}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </div>
  );
}

const DOT: Record<Tone, string> = {
  neutral: 'bg-zinc-400', blue: 'bg-sky-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', violet: 'bg-violet-500', orange: 'bg-orange-500', teal: 'bg-teal-500',
};

/** A calendar *source* (query filter, e.g. "client") can map to more than one event *type* (e.g. client -> contract_end uses the contract colour); this is only used for the filter chip's dot. */
function colorKeyOf(source: CalendarSource): CalendarEventDto['colorKey'] {
  if (source === 'client') return 'contract';
  return source;
}
