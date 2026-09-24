import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download } from 'lucide-react';
import { qs } from '@/api/client';
import { useApi } from '@/api/hooks';
import type { ReportRow } from '@/api/types.attendance';
import type { TaskReport } from '@/api/types.tasks';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar } from '@/components/ui/Filters';
import { Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented, Tabs } from '@/components/ui/Tabs';
import { PersonCell, localKey, useMinutes } from '@/components/attendance/attendanceUi';

type Tab = 'attendance' | 'tasks';

const CsvLink = ({ href }: { href: string }) => {
  const { t } = useI18n();
  return <a href={href} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"><Download className="size-4" />{t('common.exportCsv')}</a>;
};

/** Attendance, task and time reports for managers, each exportable as CSV. */
export function TeamReportsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const tabs = ([{ id: 'attendance', label: t('reports2.attendance'), show: can('attendance.view_all') }, { id: 'tasks', label: t('reports2.tasks'), show: can('tasks.view_team') }] as Array<{ id: Tab; label: string; show: boolean }>).filter((x) => x.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'attendance');
  const now = new Date();
  const [from, setFrom] = useState(localKey(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  return (
    <div>
      <PageHeader title={t('nav.teamReports')} subtitle={t('reports2.subtitle')} />
      <Tabs<Tab> value={tab} onChange={setTab} className="mb-5" tabs={tabs.map((x) => ({ id: x.id, label: x.label }))} />
      <FilterBar>
        <div className="col-span-2 flex items-center gap-2">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label={t('common.from')} />
          <span className="text-zinc-400">–</span>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label={t('common.to')} />
        </div>
        {can('time.view_all') && <Link to="/time" className="text-sm font-medium text-brand-600 hover:text-brand-700 sm:ms-auto">{t('reports2.timeReports')}</Link>}
      </FilterBar>
      {tab === 'attendance' && <AttendanceReport from={from} to={to} />}
      {tab === 'tasks' && <TaskReportView from={from} to={to} />}
    </div>
  );
}

function AttendanceReport({ from, to }: { from: string; to: string }) {
  const { t, fmt } = useI18n();
  const mins = useMinutes();
  const q = useApi<{ items: ReportRow[] }>('/attendance/report', { from, to });
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><CsvLink href={`/api/attendance/report${qs({ from, to, format: 'csv' })}`} /></div>
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonRows /> : !q.data?.items.length ? <EmptyState icon={BarChart3} title={t('att.noRecords')} /> : (
        <DataList rows={q.data.items} rowKey={(r) => r.user.id} columns={[
          { key: 'who', header: t('att.employee'), primary: true, cell: (r) => <PersonCell r={r} /> },
          { key: 'days', header: t('reports2.daysWorked'), cell: (r) => fmt.number(r.daysWorked) },
          { key: 'late', header: t('att.kpi.late'), cell: (r) => fmt.number(r.statusCounts.LATE) },
          { key: 'absent', header: t('att.kpi.absent'), cell: (r) => fmt.number(r.statusCounts.ABSENT) },
          { key: 'leave', header: t('att.kpi.onLeave'), cell: (r) => fmt.number(r.statusCounts.ON_LEAVE), hideOnTablet: true },
          { key: 'wfh', header: t('att.kpi.wfh'), cell: (r) => fmt.number(r.statusCounts.WFH), hideOnTablet: true },
          { key: 'worked', header: t('att.worked'), cell: (r) => <span className="tabular">{mins(r.workedMinutes)}</span> },
          { key: 'expected', header: t('att.expected'), cell: (r) => <span className="tabular">{mins(r.expectedMinutes)}</span>, hideOnTablet: true },
          { key: 'ot', header: t('att.overtime'), cell: (r) => <span className="tabular text-emerald-700">{mins(r.overtimeMinutes)}</span> },
        ]} />
      )}
    </div>
  );
}

function TaskReportView({ from, to }: { from: string; to: string }) {
  const { t, fmt } = useI18n();
  const [by, setBy] = useState<TaskReport['by']>('assignee');
  const q = useApi<TaskReport>('/team-reports/tasks', { from, to, by });
  const h = (n: number) => `${fmt.number(n)} ${t('time.hoursShort')}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={by} onChange={setBy} options={(['assignee', 'client', 'project'] as const).map((id) => ({ id, label: t(`tasks.by.${id}`) }))} />
        <CsvLink href={`/api/team-reports/tasks${qs({ from, to, by, format: 'csv' })}`} />
      </div>
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonRows /> : !q.data?.items.length ? <EmptyState icon={BarChart3} title={t('work.task.empty')} /> : (
        <>
          <DataList rows={q.data.items} rowKey={(r) => r.key ?? 'none'} columns={[
            { key: 'label', header: t(`tasks.by.${by}`), primary: true, cell: (r) => <span className="font-medium text-zinc-900">{r.label ?? t('tasks.none')}</span> },
            { key: 'created', header: t('reports2.created'), cell: (r) => fmt.number(r.created) },
            { key: 'completed', header: t('reports2.completed'), cell: (r) => fmt.number(r.completed) },
            { key: 'ontime', header: t('reports2.onTime'), cell: (r) => (r.completed ? `${fmt.number(r.completedOnTime)} / ${fmt.number(r.completed)}` : '—'), hideOnTablet: true },
            { key: 'open', header: t('work.task.open'), cell: (r) => fmt.number(r.open) },
            { key: 'overdue', header: t('common.overdue'), cell: (r) => <span className={r.overdue ? 'font-medium text-rose-600' : ''}>{fmt.number(r.overdue)}</span> },
            { key: 'est', header: t('reports2.estVsTracked'), cell: (r) => (r.completed ? `${h(r.estimatedHours)} / ${h(r.trackedOnCompleted)}` : '—') },
            { key: 'period', header: t('reports2.trackedPeriod'), cell: (r) => h(r.trackedInPeriod), hideOnTablet: true },
          ]} />
          <p className="text-xs text-zinc-500">{t('reports2.totals', { created: q.data.totals.created, completed: q.data.totals.completed, overdue: q.data.totals.overdue })}</p>
        </>
      )}
    </div>
  );
}
