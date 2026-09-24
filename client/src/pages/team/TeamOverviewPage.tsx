import { Link } from 'react-router-dom';
import { AlarmClock, ArrowRight, Briefcase, Coffee, Palmtree, UserX, Users } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { AttendanceSummary, LeaveResponse, RecordsResponse } from '@/api/types.attendance';
import type { GroupedTasks } from '@/api/types.tasks';
import type { WorkloadResponse } from '@/api/types.time';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/Progress';
import { StatCard } from '@/components/ui/StatCard';
import { useClockTime, useMinutes } from '@/components/attendance/attendanceUi';

const ViewAll = ({ to }: { to: string }) => {
  const { t } = useI18n();
  return <Link to={to} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700">{t('common.viewAll')}<ArrowRight className="size-3.5 rtl:rotate-180" /></Link>;
};

/** One screen for managers: who is working right now, lateness, leave, workload and overdue work per person. */
export function TeamOverviewPage() {
  const { t, fmt, label } = useI18n();
  const { can } = useAuth();
  const mins = useMinutes();
  const clock = useClockTime();
  const seesAttendance = can('attendance.view_all');
  const summary = useApi<AttendanceSummary>(seesAttendance ? '/attendance/summary' : null);
  const today = useApi<RecordsResponse>(seesAttendance ? '/attendance/records' : null, { pageSize: 200 });
  const leave = useApi<LeaveResponse>(can('leave.approve') ? '/leave' : null, { status: 'PENDING', pageSize: 5 });
  const workload = useApi<WorkloadResponse>(can('workload.view') ? '/workload' : null);
  const overdue = useApi<GroupedTasks>(can('tasks.view_team') ? '/tasks/grouped' : null, { by: 'assignee', overdue: 1 });
  const s = summary.data;
  const working = (today.data?.items ?? []).filter((r) => r.presence === 'WORKING' || r.presence === 'ON_BREAK');
  const late = (today.data?.items ?? []).filter((r) => r.lateMinutes > 0);

  return (
    <div>
      <PageHeader title={t('nav.teamOverview')} subtitle={t('team.subtitle')} />
      {seesAttendance && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard label={t('att.kpi.working')} value={fmt.number((s?.presence.WORKING ?? 0) + (s?.presence.ON_BREAK ?? 0))} icon={Briefcase} tone="emerald" loading={summary.isLoading} />
          <StatCard label={t('att.kpi.onBreak')} value={fmt.number(s?.presence.ON_BREAK ?? 0)} icon={Coffee} tone="amber" loading={summary.isLoading} />
          <StatCard label={t('att.kpi.late')} value={fmt.number(s?.statusCounts.LATE ?? 0)} icon={AlarmClock} tone="amber" loading={summary.isLoading} />
          <StatCard label={t('att.kpi.absent')} value={fmt.number(s?.presence.ABSENT ?? 0)} icon={UserX} tone="zinc" loading={summary.isLoading} />
          <StatCard label={t('att.kpi.onLeave')} value={fmt.number(s?.presence.ON_LEAVE ?? 0)} icon={Palmtree} tone="brand" loading={summary.isLoading} />
          <StatCard label={t('att.kpi.members')} value={fmt.number(s?.members ?? 0)} icon={Users} tone="sky" loading={summary.isLoading} />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {seesAttendance && (
          <Card className="overflow-hidden">
            <CardHeader title={t('team.workingNow')} action={<ViewAll to="/attendance?tab=team" />} />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {working.length === 0 ? <EmptyState compact icon={Briefcase} title={t('team.nobodyWorking')} /> : working.map((r) => (
                <li key={r.userId} className="flex items-center gap-3 px-5 py-3"><Avatar name={r.user?.name ?? '?'} size="sm" /><span className="flex-1 text-sm font-medium text-zinc-900">{r.user?.name}</span><StatusBadge group="presence" value={r.presence} /><span className="text-xs text-zinc-500 tabular">{t('team.since', { time: clock(r.checkInAt) })}</span></li>
              ))}
            </ul>
          </Card>
        )}
        {seesAttendance && (
          <Card className="overflow-hidden">
            <CardHeader title={t('team.lateToday')} />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {late.length === 0 ? <EmptyState compact icon={AlarmClock} title={t('team.nobodyLate')} /> : late.map((r) => (
                <li key={r.userId} className="flex items-center gap-3 px-5 py-3"><Avatar name={r.user?.name ?? '?'} size="sm" /><span className="flex-1 text-sm font-medium text-zinc-900">{r.user?.name}</span><span className="text-xs text-zinc-500 tabular">{clock(r.checkInAt)}</span><Badge tone="amber" dot={false}>{mins(r.lateMinutes)}</Badge></li>
              ))}
            </ul>
          </Card>
        )}
        {can('workload.view') && (
          <Card className="overflow-hidden">
            <CardHeader title={t('nav.workload')} subtitle={workload.data ? `${fmt.date(workload.data.window.from)} – ${fmt.date(workload.data.window.to)}` : undefined} action={<ViewAll to="/workload" />} />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {(workload.data?.items ?? []).map((w) => (
                <li key={w.user.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={w.user.name} size="sm" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-900">{w.user.name}</p><ProgressBar value={w.estimatedHours} max={Math.max(1, w.capacityHours)} size="sm" tone="auto" label={`${Math.round(w.utilization * 100)}%`} /></div>
                  <Badge dot={false} tone={w.indicator === 'OVERLOADED' ? 'red' : w.indicator === 'HIGH' ? 'amber' : w.indicator === 'BALANCED' ? 'green' : 'blue'}>{label('loadIndicator', w.indicator)}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {can('tasks.view_team') && (
          <Card className="overflow-hidden">
            <CardHeader title={t('team.overdueByPerson')} action={<ViewAll to="/team-tasks" />} />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {(overdue.data?.groups ?? []).filter((g) => g.overdue > 0).length === 0 ? <EmptyState compact icon={AlarmClock} title={t('team.noOverdue')} /> : overdue.data!.groups.filter((g) => g.overdue > 0).map((g) => (
                <li key={g.key ?? 'none'} className="flex items-center gap-3 px-5 py-3"><Avatar name={g.label ?? '?'} size="sm" /><span className="flex-1 text-sm font-medium text-zinc-900">{g.label ?? t('common.unassigned')}</span><Badge tone="red" dot={false}>{fmt.number(g.overdue)}</Badge></li>
              ))}
            </ul>
          </Card>
        )}
        {can('leave.approve') && (
          <Card className="overflow-hidden">
            <CardHeader title={t('team.pendingLeave')} action={<ViewAll to="/attendance?tab=leave" />} />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {(leave.data?.items ?? []).length === 0 ? <EmptyState compact icon={Palmtree} title={t('leave.noneToReview')} /> : leave.data!.items.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3"><Avatar name={r.user.name} size="sm" /><span className="flex-1 text-sm text-zinc-900"><span className="font-medium">{r.user.name}</span> · {label('leaveType', r.type)}</span><span className="text-xs text-zinc-500">{fmt.date(`${r.startDate}T00:00:00Z`)} – {fmt.date(`${r.endDate}T00:00:00Z`)}</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
