import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ATTENDANCE_STATUSES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { AttendanceMember, AttendanceRecord, CalendarResponse } from '@/api/types.attendance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { toneOf, type Tone } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { cx } from '@/components/ui/cx';
import { RecordDrawer, useClockTime, useMinutes } from '@/components/attendance/attendanceUi';

const CELL: Record<Tone, string> = {
  neutral: 'bg-zinc-50 text-zinc-500', blue: 'bg-sky-50 text-sky-800 ring-sky-200', green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200', red: 'bg-rose-50 text-rose-800 ring-rose-200', violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  orange: 'bg-orange-50 text-orange-900 ring-orange-200', teal: 'bg-teal-50 text-teal-800 ring-teal-200',
};
const DOT: Record<Tone, string> = { neutral: 'bg-zinc-300', blue: 'bg-sky-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', violet: 'bg-violet-500', orange: 'bg-orange-500', teal: 'bg-teal-500' };

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Month calendar per person: own for everybody, anybody's with attendance.view_all. Click a day for the full record. */
export function AttendanceCalendar() {
  const { t, label, locale, fmt } = useI18n();
  const { user, can } = useAuth();
  const mins = useMinutes();
  const clock = useClockTime();
  const viewAll = can('attendance.view_all');
  const [cursor, setCursor] = useState(() => new Date());
  const [userId, setUserId] = useState('');
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const members = useApi<{ items: AttendanceMember[] }>(viewAll ? '/attendance/members' : null);
  const meTracked = viewAll ? !!members.data?.items.find((m) => m.id === user?.id)?.trackAttendance : true;
  const effectiveUser = userId || (meTracked && can('attendance.track') ? user?.id : members.data?.items.find((m) => m.trackAttendance)?.id) || '';
  const q = useApi<CalendarResponse>(effectiveUser ? '/attendance/calendar' : null, { userId: effectiveUser, month: monthKey(cursor) });
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' });
  const title = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }).format(cursor);
  const step = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  const days = q.data?.days ?? [];
  const lead = days.length ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0; // Monday first

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {viewAll && (
          <Select value={effectiveUser} onChange={(e) => setUserId(e.target.value)} className="sm:w-64" aria-label={t('att.employee')}>
            {(members.data?.items ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.trackAttendance ? '' : ` (${t('att.notTracked')})`}</option>)}
          </Select>
        )}
        <div className="flex items-center gap-1 sm:ms-auto">
          <IconButton label={t('calendar.prev')} onClick={() => step(-1)} className="size-9"><ChevronLeft className="size-5 rtl:rotate-180" /></IconButton>
          <h2 className="min-w-40 text-center text-[15px] font-semibold text-zinc-900 first-letter:uppercase">{title}</h2>
          <IconButton label={t('calendar.next')} onClick={() => step(1)} className="size-9"><ChevronRight className="size-5 rtl:rotate-180" /></IconButton>
          <Button variant="secondary" size="sm" onClick={() => setCursor(new Date())}>{t('calendar.today')}</Button>
        </div>
      </div>

      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <Card className="p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {Array.from({ length: 7 }, (_, i) => <div key={i} className="py-1">{weekday.format(new Date(Date.UTC(2024, 0, 1 + i)))}</div>)}
          </div>
          {q.isLoading || !q.data ? <Skeleton className="mt-2 h-72 w-full" /> : (
            <div className="mt-1 grid grid-cols-7 gap-1.5">
              {Array.from({ length: lead }, (_, i) => <div key={`pad${i}`} />)}
              {days.map((d) => {
                const tone = d.future ? 'neutral' : toneOf('attendanceStatus', d.status);
                const isToday = d.date === q.data.today;
                return (
                  <button key={d.date} type="button" onClick={() => setOpen(d)} disabled={d.future && !d.id}
                    className={cx('flex min-h-16 flex-col items-start rounded-xl p-1.5 text-start ring-1 ring-inset ring-transparent transition sm:min-h-20 sm:p-2', CELL[tone], !d.future && 'hover:ring-zinc-300', isToday && 'ring-2 !ring-brand-500')}>
                    <span className="text-xs font-semibold tabular">{Number(d.date.slice(8))}</span>
                    {!d.future && <span className="mt-auto hidden truncate text-[10.5px] font-medium sm:block">{label('attendanceStatus', d.status)}</span>}
                    {!d.future && d.checkInAt && <span className="hidden text-[10px] tabular opacity-80 sm:block">{clock(d.checkInAt)}–{d.checkOutAt ? clock(d.checkOutAt) : '…'}</span>}
                    {d.holidayName && <span className="hidden truncate text-[10px] sm:block">{d.holidayName}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-xs text-zinc-600">
            {ATTENDANCE_STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5"><span className={cx('size-2.5 rounded-full', DOT[toneOf('attendanceStatus', s)])} />{label('attendanceStatus', s)}{q.data ? ` (${fmt.number(q.data.statusCounts[s])})` : ''}</span>
            ))}
          </div>
          {q.data && <p className="mt-2 text-xs text-zinc-500">{t('att.monthTotals', { worked: mins(q.data.totals.workedMinutes), overtime: mins(q.data.totals.overtimeMinutes), late: mins(q.data.totals.lateMinutes) })}</p>}
        </Card>
      )}
      <RecordDrawer id={open?.id ?? null} virtual={open && !open.id ? open : null} onClose={() => setOpen(null)} />
    </div>
  );
}
