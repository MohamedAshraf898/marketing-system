import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck2, Clock3, Hourglass, TimerReset } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { AttendanceRecord, MyHistory } from '@/api/types.attendance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';
import { Tabs } from '@/components/ui/Tabs';
import { CheckInCard, localKey, RecordDrawer, useClockTime, useMinutes } from '@/components/attendance/attendanceUi';
import { AttendanceCalendar } from './AttendanceCalendar';
import { AttendanceSettings } from './AttendanceSettings';
import { LeaveTab } from './LeaveTab';
import { TeamBoard } from './TeamBoard';

type Tab = 'me' | 'team' | 'calendar' | 'leave' | 'settings';


function MyAttendance() {
  const { t, fmt } = useI18n();
  const mins = useMinutes();
  const clock = useClockTime();
  const now = new Date();
  const [from, setFrom] = useState(localKey(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localKey(now));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const q = useApi<MyHistory>('/attendance/me', { from, to, page, pageSize: 31 });

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <CheckInCard />
        <div className="grid grid-cols-2 gap-3">
          <StatCard label={t('att.worked')} value={mins(q.data?.totals.workedMinutes ?? 0)} icon={Clock3} tone="brand" loading={q.isLoading} />
          <StatCard label={t('att.overtime')} value={mins(q.data?.totals.overtimeMinutes ?? 0)} icon={TimerReset} tone="emerald" loading={q.isLoading} />
          <StatCard label={t('att.lateDays')} value={fmt.number(q.data?.statusCounts.LATE ?? 0)} icon={Hourglass} tone="amber" loading={q.isLoading} />
          <StatCard label={t('att.daysPresent')} value={fmt.number((q.data?.statusCounts.PRESENT ?? 0) + (q.data?.statusCounts.LATE ?? 0) + (q.data?.statusCounts.WFH ?? 0) + (q.data?.statusCounts.HALF_DAY ?? 0))} icon={CalendarCheck2} tone="sky" loading={q.isLoading} />
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-zinc-900">{t('att.history')}</h2>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" aria-label={t('common.from')} />
            <span className="text-zinc-400">–</span>
            <Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" aria-label={t('common.to')} />
          </div>
        </div>
        {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonRows /> : !q.data?.items.length ? <EmptyState icon={CalendarCheck2} title={t('att.noHistory')} /> : (
          <>
            <DataList
              rows={q.data.items}
              rowKey={(r) => r.id ?? r.date}
              onRowClick={(r) => setOpen(r)}
              columns={[
                { key: 'date', header: t('common.date'), primary: true, cell: (r) => <span className="font-medium text-zinc-900">{fmt.date(`${r.date}T00:00:00Z`)}</span> },
                { key: 'status', header: t('common.status'), cell: (r) => <StatusBadge group="attendanceStatus" value={r.status} /> },
                { key: 'in', header: t('att.checkIn'), cell: (r) => <span className="tabular">{clock(r.checkInAt)}</span> },
                { key: 'out', header: t('att.checkOut'), cell: (r) => <span className="tabular">{clock(r.checkOutAt)}{r.missingCheckout ? ' ⚠' : ''}</span> },
                { key: 'worked', header: t('att.worked'), cell: (r) => <span className="tabular">{mins(r.workedMinutes)}</span> },
                { key: 'break', header: t('att.break'), hideOnTablet: true, cell: (r) => <span className="tabular">{mins(r.breakMinutes)}</span> },
                { key: 'late', header: t('att.late'), hideOnTablet: true, cell: (r) => (r.lateMinutes ? <span className="tabular text-amber-700">{mins(r.lateMinutes)}</span> : '—') },
                { key: 'ot', header: t('att.overtime'), hideOnTablet: true, cell: (r) => (r.overtimeMinutes ? <span className="tabular text-emerald-700">{mins(r.overtimeMinutes)}</span> : '—') },
              ]}
            />
            <Pagination meta={q.data.meta} onPage={setPage} />
          </>
        )}
      </div>
      <RecordDrawer id={open?.id ?? null} virtual={open && !open.id ? open : null} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Attendance: my day for everybody who tracks attendance, the team board / calendar / leave / settings by permission. */
export function AttendancePage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'me', label: t('att.tab.me'), show: can('attendance.track') },
    { id: 'team', label: t('att.tab.team'), show: can('attendance.view_all') },
    { id: 'calendar', label: t('att.tab.calendar'), show: can('attendance.track') || can('attendance.view_all') },
    { id: 'leave', label: t('att.tab.leave'), show: can('attendance.track') || can('leave.approve') },
    { id: 'settings', label: t('att.tab.settings'), show: can('attendance.manage') },
  ];
  const visible = tabs.filter((x) => x.show);
  const wanted = params.get('tab') as Tab | null;
  const tab: Tab = visible.find((x) => x.id === wanted)?.id ?? visible[0]?.id ?? 'me';

  return (
    <div>
      <PageHeader title={t('nav.attendance')} subtitle={t('att.subtitle')} />
      <Tabs<Tab> value={tab} onChange={(v) => setParams(v === visible[0]?.id ? {} : { tab: v }, { replace: true })} className="mb-6" tabs={visible.map((x) => ({ id: x.id, label: x.label }))} />
      {tab === 'me' && <MyAttendance />}
      {tab === 'team' && <TeamBoard />}
      {tab === 'calendar' && <AttendanceCalendar />}
      {tab === 'leave' && <LeaveTab />}
      {tab === 'settings' && <AttendanceSettings />}
    </div>
  );
}
