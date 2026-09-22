import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import type { Tone } from './Badge';
import { Segmented } from './Tabs';

export interface CalendarEvent {
  id: string;
  /** ISO string or Date. */
  date: string | Date;
  title: ReactNode;
  tone?: Tone;
  /** small text after the title (time, client ...) */
  meta?: ReactNode;
  href?: string;
  onClick?: () => void;
  /**
   * true (default): a date-only value (due dates, start / end dates ...). The UTC calendar day is used, so it never
   * shifts a day in any time zone. false: a real moment (publish time) - the viewer's local day is used.
   */
  allDay?: boolean;
}

const CHIP: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200', blue: 'bg-sky-50 text-sky-800 hover:bg-sky-100', green: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  amber: 'bg-amber-50 text-amber-900 hover:bg-amber-100', red: 'bg-rose-50 text-rose-800 hover:bg-rose-100', violet: 'bg-violet-50 text-violet-800 hover:bg-violet-100',
  orange: 'bg-orange-50 text-orange-900 hover:bg-orange-100', teal: 'bg-teal-50 text-teal-800 hover:bg-teal-100',
};

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const eventKey = (e: CalendarEvent) => {
  const d = e.date instanceof Date ? e.date : new Date(e.date);
  return e.allDay === false ? dayKey(d) : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** First visible day of the grid / week (respecting the first day of the week). */
export function gridStart(cursor: Date, view: 'month' | 'week', weekStartsOn: number): Date {
  const base = view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth(), 1) : startOfDay(cursor);
  const diff = (base.getDay() - weekStartsOn + 7) % 7;
  return addDays(base, -diff);
}

/** Inclusive range covered by the visible grid - use it to request only the events you need from the API. */
export function visibleRange(cursor: Date, view: 'month' | 'week', weekStartsOn = 1): { from: Date; to: Date } {
  const from = gridStart(cursor, view, weekStartsOn);
  if (view === 'week') return { from, to: addDays(from, 6) };
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const end = addDays(gridStart(last, 'week', weekStartsOn), 6);
  return { from, to: end };
}

/**
 * Month / week calendar. Desktop: a real grid. Phones: an agenda list of the days that have events.
 * The component only displays: keep `cursor` (any date inside the visible period) and `view` in your page state.
 */
export function CalendarGrid({ cursor, onCursorChange, view = 'month', onViewChange, events, onDayClick, weekStartsOn = 1, maxPerDay = 3, toolbarExtra }: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  view?: 'month' | 'week';
  onViewChange?: (v: 'month' | 'week') => void;
  events: CalendarEvent[];
  onDayClick?: (d: Date) => void;
  weekStartsOn?: number;
  maxPerDay?: number;
  toolbarExtra?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  const start = useMemo(() => gridStart(cursor, view, weekStartsOn), [cursor, view, weekStartsOn]);
  const days = useMemo(() => Array.from({ length: view === 'week' ? 7 : Math.round((visibleRange(cursor, 'month', weekStartsOn).to.getTime() - start.getTime()) / 86_400_000) + 1 }, (_, i) => addDays(start, i)), [cursor, view, weekStartsOn, start]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const k = eventKey(e);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return m;
  }, [events]);

  const todayKey = dayKey(new Date());
  const title = new Intl.DateTimeFormat(tag, view === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(view === 'month' ? cursor : start);
  const weekTitle = view === 'week' ? `${title} – ${new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }).format(addDays(start, 6))}` : title;
  const weekdayFmt = new Intl.DateTimeFormat(tag, { weekday: 'short' });
  const step = (dir: -1 | 1) => onCursorChange(view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1) : addDays(cursor, dir * 7));

  const chip = (e: CalendarEvent) => {
    const cls = cx('flex w-full min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-1 text-start text-[11.5px] font-medium leading-tight transition', CHIP[e.tone ?? 'neutral']);
    const inner = <><span className="truncate">{e.title}</span>{e.meta && <span className="ms-auto shrink-0 opacity-70">{e.meta}</span>}</>;
    return e.href ? <Link key={e.id} to={e.href} className={cls}>{inner}</Link> : <button key={e.id} type="button" onClick={e.onClick} className={cls}>{inner}</button>;
  };

  return (
    <div className="rounded-2xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <IconButton label={t('calendar.prev')} onClick={() => step(-1)} className="size-9"><ChevronLeft className="size-5 rtl:rotate-180" /></IconButton>
        <IconButton label={t('calendar.next')} onClick={() => step(1)} className="size-9"><ChevronRight className="size-5 rtl:rotate-180" /></IconButton>
        <h2 className="min-w-0 flex-1 px-1 text-[15px] font-semibold text-zinc-900 first-letter:uppercase">{weekTitle}</h2>
        {toolbarExtra}
        <Button variant="secondary" size="sm" onClick={() => onCursorChange(new Date())}>{t('calendar.today')}</Button>
        {onViewChange && <Segmented value={view} onChange={onViewChange} options={[{ id: 'month', label: t('calendar.month') }, { id: 'week', label: t('calendar.week') }]} />}
      </div>

      {/* desktop grid */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-line bg-zinc-50/70 text-center text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500">
          {days.slice(0, 7).map((d) => <div key={d.getDay()} className="px-2 py-2.5">{weekdayFmt.format(d)}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const outside = view === 'month' && d.getMonth() !== cursor.getMonth();
            return (
              <div
                key={k}
                onClick={onDayClick ? () => onDayClick(d) : undefined}
                className={cx('flex flex-col gap-1 border-b border-e border-line p-1.5 [&:nth-child(7n)]:border-e-0', view === 'month' ? 'min-h-28' : 'min-h-64', outside && 'bg-zinc-50/60', onDayClick && 'cursor-pointer hover:bg-zinc-50', i >= days.length - 7 && 'border-b-0')}
              >
                <span className={cx('flex size-6 items-center justify-center self-start rounded-full text-xs font-medium tabular', k === todayKey ? 'bg-brand-600 text-white' : outside ? 'text-zinc-300' : 'text-zinc-600')}>{d.getDate()}</span>
                {(view === 'week' ? list : list.slice(0, maxPerDay)).map((e) => <div key={e.id} onClick={(ev) => ev.stopPropagation()}>{chip(e)}</div>)}
                {view === 'month' && list.length > maxPerDay && <span className="px-1.5 text-[11px] font-medium text-zinc-500">{t('calendar.more', { n: list.length - maxPerDay })}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* phone agenda */}
      <div className="divide-y divide-line md:hidden">
        {(() => {
          const rows = days.filter((d) => (byDay.get(dayKey(d))?.length ?? 0) > 0 && (view === 'week' || d.getMonth() === cursor.getMonth()));
          if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-zinc-500">{t('calendar.noEvents')}</p>;
          return rows.map((d) => (
            <div key={dayKey(d)} className="flex gap-3 px-4 py-3">
              <div className={cx('w-11 shrink-0 text-center', dayKey(d) === todayKey && 'text-brand-600')}>
                <p className="text-[11px] font-semibold uppercase text-zinc-400">{weekdayFmt.format(d)}</p>
                <p className="text-lg font-semibold tabular">{d.getDate()}</p>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">{(byDay.get(dayKey(d)) ?? []).map(chip)}</div>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}
