import { useState } from 'react';
import { AlertTriangle, CalendarClock, ClipboardList, FolderKanban, Gauge, Info, Timer } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { LoadIndicator, WorkloadResponse, WorkloadRow, WorkloadTasksResponse } from '@/api/types.time';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge, type Tone } from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, SkeletonCards, Skeleton } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/Progress';
import { Segmented } from '@/components/ui/Tabs';
import { cx } from '@/components/ui/cx';
import { addDays, localDateStr, tzOffsetMin, useTimeFormat } from '@/components/shared/timer';

type Preset = 'thisWeek' | 'nextWeek' | 'thisMonth';

/** Monday-based weeks and calendar months, in the user's own zone. */
function rangeOf(p: Preset): { from: string; to: string } {
  const now = new Date();
  const today = localDateStr(now);
  const monday = addDays(today, -((now.getDay() + 6) % 7));
  if (p === 'thisWeek') return { from: monday, to: addDays(monday, 6) };
  if (p === 'nextWeek') return { from: addDays(monday, 7), to: addDays(monday, 13) };
  return { from: localDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
}

const TONE: Record<LoadIndicator, { badge: Tone; bar: 'blue' | 'green' | 'amber' | 'red' }> = {
  LOW: { badge: 'blue', bar: 'blue' },
  BALANCED: { badge: 'green', bar: 'green' },
  HIGH: { badge: 'amber', bar: 'amber' },
  OVERLOADED: { badge: 'red', bar: 'red' },
};

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ClipboardList; label: string; value: string | number; tone?: 'red' }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400"><Icon className="size-3.5 shrink-0" /><span className="truncate">{label}</span></p>
      <p className={cx('mt-0.5 text-lg font-semibold tabular text-zinc-900', tone === 'red' && 'text-rose-600')}>{value}</p>
    </div>
  );
}

function MemberCard({ row, onOpen }: { row: WorkloadRow; onOpen: () => void }) {
  const { t, fmt, label } = useI18n();
  const tone = TONE[row.indicator];
  const pct = Math.round(row.utilization * 100);
  return (
    <button type="button" onClick={onOpen} className="block w-full text-start focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-100">
      <Card className="h-full transition hover:border-zinc-300 hover:shadow-md">
        <CardBody className="space-y-4 !pt-5">
          <div className="flex items-start gap-3">
            <Avatar name={row.user.name} src={row.user.avatar} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-zinc-900">{row.user.name}</p>
              <p className="truncate text-[13px] text-zinc-500">{row.user.jobTitle || label('role', row.user.role)}</p>
            </div>
            <Badge tone={tone.badge}>{label('loadIndicator', row.indicator)}</Badge>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
              <span className="text-zinc-500">{t('workload.planned')}</span>
              <span className="font-medium text-zinc-800 tabular">{fmt.number(row.estimatedHours)} / {fmt.number(row.capacityHours)} {t('time.hoursShort')}</span>
            </div>
            <ProgressBar value={row.estimatedHours} max={Math.max(row.capacityHours, 1)} tone={tone.bar} label={`${pct}%`} />
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
            <Stat icon={ClipboardList} label={t('workload.open')} value={row.openTasks} />
            <Stat icon={AlertTriangle} label={t('workload.overdue')} value={row.overdueTasks} tone={row.overdueTasks > 0 ? 'red' : undefined} />
            <Stat icon={CalendarClock} label={t('workload.dueInRange')} value={row.dueInWindow} />
            <Stat icon={Timer} label={t('workload.logged')} value={`${fmt.number(row.loggedHours)} ${t('time.hoursShort')}`} />
            <Stat icon={FolderKanban} label={t('workload.projects')} value={row.activeProjects} />
          </div>
          {(row.unestimatedTasks > 0 || row.loggedPartial) && (
            <p className="text-xs text-zinc-500">
              {row.unestimatedTasks > 0 && <span>{t('workload.unestimated', { n: row.unestimatedTasks })} </span>}
              {row.loggedPartial && <span>{t('workload.partialLogged')}</span>}
            </p>
          )}
        </CardBody>
      </Card>
    </button>
  );
}

function MemberTasks({ userId, from, to }: { userId: string; from: string; to: string }) {
  const { t, fmt } = useI18n();
  const q = useApi<WorkloadTasksResponse>(`/workload/${userId}`, { from, to });
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  if (q.data.items.length === 0) return <EmptyState compact icon={ClipboardList} title={t('workload.noTasks')} description={t('workload.noTasksHint')} />;
  return (
    <ul className="space-y-2.5">
      {q.data.items.map((task) => (
        <li key={task.id} className="rounded-xl border border-line bg-white p-3.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 font-medium text-zinc-900">{task.title}</p>
            <StatusBadge group="taskStatus" value={task.status} />
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500">{[task.project?.name, task.client?.companyName].filter(Boolean).join(' · ') || '—'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
            <span className={cx('tabular', task.overdue && 'font-semibold text-rose-600')}>{task.dueDate ? t('common.due', { date: fmt.date(task.dueDate) }) : t('workload.noDueDate')}{task.overdue ? ` · ${t('common.overdue')}` : ''}</span>
            {task.estimatedHours !== null && <span className="tabular">{t('workload.estimate', { n: fmt.number(task.estimatedHours) })}</span>}
            {task.actualHours > 0 && <span className="tabular">{t('workload.loggedOnTask', { n: fmt.number(task.actualHours) })}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Team capacity view (workload.view). A capacity indicator - planned hours against weekly hours - NOT a performance ranking. */
export function WorkloadPage() {
  const { t, fmt } = useI18n();
  const tf = useTimeFormat();
  const [preset, setPreset] = useState<Preset>('thisWeek');
  const [open, setOpen] = useState<WorkloadRow | null>(null);
  const range = rangeOf(preset);
  const q = useApi<WorkloadResponse>('/workload', { ...range, tz: tzOffsetMin() });

  return (
    <div>
      <PageHeader
        title={t('workload.title')}
        subtitle={t('workload.subtitle')}
        actions={
          <Segmented
            value={preset}
            onChange={setPreset}
            options={[{ id: 'thisWeek', label: t('workload.thisWeek') }, { id: 'nextWeek', label: t('workload.nextWeek') }, { id: 'thisMonth', label: t('workload.thisMonth') }]}
          />
        }
      />

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3.5 text-sm text-sky-950">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">{t('workload.noteTitle')}</p>
          <p className="text-[13px] leading-relaxed text-sky-900/90">{t('workload.note')}</p>
        </div>
      </div>

      <p className="mb-4 text-[13px] text-zinc-500">
        {tf.day(range.from, { month: 'short', day: 'numeric', year: 'numeric' })} – {tf.day(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}
        {q.data && <span> · {t('workload.capacityNote', { n: fmt.number(q.data.window.weeks) })}</span>}
      </p>

      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonCards count={6} className="sm:grid-cols-2 xl:grid-cols-3" /> : !q.data?.items.length ? (
        <Card><EmptyState icon={Gauge} title={t('workload.empty')} description={t('workload.emptyHint')} /></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-600">
            <span className="me-1 font-medium text-zinc-500">{t('workload.legend')}</span>
            {(['LOW', 'BALANCED', 'HIGH', 'OVERLOADED'] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5"><span className={cx('size-2.5 rounded-full', { LOW: 'bg-sky-500', BALANCED: 'bg-emerald-500', HIGH: 'bg-amber-500', OVERLOADED: 'bg-rose-500' }[k])} />{t(`workload.legend.${k}` as const)}</span>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.items.map((row) => <MemberCard key={row.user.id} row={row} onOpen={() => setOpen(row)} />)}
          </div>
        </>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.user.name ?? ''} subtitle={t('workload.openTasksOf')} width="md">
        {open && <MemberTasks userId={open.user.id} from={range.from} to={range.to} />}
      </Drawer>
    </div>
  );
}
