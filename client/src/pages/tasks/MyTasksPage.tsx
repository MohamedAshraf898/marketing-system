import { useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Flame, Plus } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { MyOverview } from '@/api/types.tasks';
import type { Task } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n, type TKey } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Segmented } from '@/components/ui/Tabs';
import { cx } from '@/components/ui/cx';
import { tzOffsetMin } from '@/components/shared/timer';
import { TaskTimerButton } from '@/components/shared/TaskTimerButton';
import { TaskFormModal } from '@/components/forms/TaskFormModal';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { TaskStatusPill } from '@/components/tasks/taskUi';

type Bucket = 'overdue' | 'dueToday' | 'upcoming' | 'urgent' | 'highPriority' | 'noDueDate' | 'completed';

/** One task row with one-tap "done" (mobile friendly). */
function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { t, fmt } = useI18n();
  const done = useAction(() => api.patch(`/tasks/${task.id}`, { status: task.status === 'DONE' ? 'TODO' : 'DONE' }), { success: task.status === 'DONE' ? t('tasks.reopened') : t('tasks.completed') });
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <input type="checkbox" className="size-5 accent-[var(--color-brand-600)]" checked={task.status === 'DONE'} disabled={!task.permissions.canWork || done.isPending} onChange={() => done.mutate(undefined)} aria-label={t('tasks.markDone')} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-start">
        <p className={cx('truncate text-sm font-medium', task.status === 'DONE' ? 'text-zinc-400 line-through' : 'text-zinc-900')}>{task.title}</p>
        <p className="truncate text-xs text-zinc-500">{[task.client?.companyName, task.project?.name, task.parent ? `↳ ${task.parent.title}` : null].filter(Boolean).join(' · ')}</p>
      </button>
      <span className="hidden sm:inline"><TaskStatusPill status={task.status} custom={task.customStatus} /></span>
      <StatusBadge group="priority" value={task.priority} className="max-sm:hidden" />
      {task.dueDate && <span className={cx('shrink-0 text-xs tabular', task.overdue ? 'font-medium text-rose-600' : 'text-zinc-500')}>{fmt.date(task.dueDate)}</span>}
      <span className="max-sm:hidden"><TaskTimerButton taskId={task.id} compact /></span>
    </li>
  );
}

/** Everything assigned to me, in actionable buckets. */
export function MyTasksPage() {
  const { t, fmt } = useI18n();
  const { can } = useAuth();
  const q = useApi<MyOverview>('/tasks/my-overview', { tz: tzOffsetMin(), take: 20 });
  const [bucket, setBucket] = useState<Bucket>('dueToday');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const c = q.data?.counts;
  const buckets: Array<{ id: Bucket; label: TKey; n?: number }> = [
    { id: 'overdue', label: 'tasks.bucket.overdue', n: c?.overdue }, { id: 'dueToday', label: 'tasks.bucket.dueToday', n: c?.dueToday },
    { id: 'upcoming', label: 'tasks.bucket.upcoming', n: c?.upcoming }, { id: 'urgent', label: 'tasks.bucket.urgent', n: c?.urgent },
    { id: 'highPriority', label: 'tasks.bucket.highPriority', n: c?.highPriority }, { id: 'noDueDate', label: 'tasks.bucket.noDueDate', n: c?.noDueDate },
    { id: 'completed', label: 'tasks.bucket.completed', n: c?.completedThisWeek },
  ];
  const items = q.data?.lists[bucket] ?? [];

  return (
    <div>
      <PageHeader title={t('nav.myTasks')} subtitle={t('tasks.mySubtitle')} actions={can('tasks.create') && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('work.task.new')}</Button>} />
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('tasks.kpi.myTasks')} value={fmt.number(c?.assigned ?? 0)} icon={ClipboardList} tone="brand" loading={q.isLoading} />
            <StatCard label={t('tasks.kpi.dueToday')} value={fmt.number(c?.dueToday ?? 0)} icon={CalendarClock} tone="sky" loading={q.isLoading} />
            <StatCard label={t('tasks.kpi.overdue')} value={fmt.number(c?.overdue ?? 0)} icon={AlertTriangle} tone="amber" loading={q.isLoading} />
            <StatCard label={t('tasks.kpi.completedWeek')} value={fmt.number(c?.completedThisWeek ?? 0)} icon={CheckCircle2} tone="emerald" loading={q.isLoading} />
          </div>
          <div className="mb-4 overflow-x-auto"><Segmented value={bucket} onChange={setBucket} options={buckets.map((b) => ({ id: b.id, label: <span className="whitespace-nowrap">{t(b.label)}{b.n !== undefined ? ` · ${fmt.number(b.n)}` : ''}</span> }))} /></div>
          {q.isLoading ? <SkeletonCards count={2} /> : (
            <Card className="overflow-hidden">
              <CardHeader title={t(buckets.find((b) => b.id === bucket)!.label)} subtitle={bucket === 'urgent' || bucket === 'highPriority' ? undefined : undefined} action={bucket === 'urgent' ? <Flame className="size-4 text-rose-500" /> : undefined} />
              {items.length === 0 ? <EmptyState compact icon={CheckCircle2} title={t('tasks.bucketEmpty')} /> : <ul className="mt-3 divide-y divide-line border-t border-line">{items.map((x) => <TaskRow key={x.id} task={x} onOpen={() => setOpen(x.id)} />)}</ul>}
            </Card>
          )}
        </>
      )}
      {creating && <TaskFormModal open onClose={() => setCreating(false)} onCreated={(tk) => setOpen(tk.id)} />}
      <TaskDrawer taskId={open} open={!!open} onClose={() => setOpen(null)} onDeleted={() => setOpen(null)} />
    </div>
  );
}
