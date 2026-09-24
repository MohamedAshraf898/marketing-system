import { useState } from 'react';
import { ClipboardList, Users } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { GroupedTasks, TaskGroup } from '@/api/types.tasks';
import type { Task } from '@/api/types.work';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonCards, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, SearchInput, useDebounced } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ProgressBar } from '@/components/ui/Progress';
import { Segmented } from '@/components/ui/Tabs';
import { cx } from '@/components/ui/cx';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { BulkBar, TaskTable, type ColumnKey, type SortKey } from '@/components/tasks/TaskViews';

type By = GroupedTasks['by'];
const FILTER_KEY: Record<By, string> = { assignee: 'assigneeId', project: 'projectId', client: 'clientId', status: 'status', list: 'listId' };
const COLS: ColumnKey[] = ['assignee', 'priority', 'status', 'dueDate', 'tracked', 'estimate'];

/** Team leads: every task they may see, grouped by person / project / client / status / list. */
export function TeamTasksPage() {
  const { t, fmt, label } = useI18n();
  const [by, setBy] = useState<By>('assignee');
  const [group, setGroup] = useState<TaskGroup | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [openOnly, setOpenOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>('dueDate');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(search);
  const base = { q, overdue: overdue ? 1 : undefined };
  const groups = useApi<GroupedTasks>('/tasks/grouped', { by, ...base });
  const groupFilter = group ? (group.key === null ? (by === 'assignee' ? { unassigned: 1 } : {}) : { [FILTER_KEY[by]]: group.key }) : {};
  const tasks = useApi<Paged<Task>>('/tasks', { ...base, ...groupFilter, open: openOnly && by !== 'status' ? 1 : undefined, sort, dir, page, pageSize: 50 });
  const name = (g: TaskGroup) => (g.key === null ? (by === 'assignee' ? t('common.unassigned') : t('tasks.none')) : by === 'status' ? label('taskStatus', g.key) : (g.label ?? '—'));

  return (
    <div>
      <PageHeader title={t('nav.teamTasks')} subtitle={t('tasks.teamSubtitle')} />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('tasks.searchPlaceholder')} />
        <div className="col-span-2"><Segmented value={by} onChange={(v) => { setBy(v); setGroup(null); setPage(1); }} options={(['assignee', 'project', 'client', 'status', 'list'] as const).map((id) => ({ id, label: t(`tasks.by.${id}`) }))} /></div>
        <Button size="sm" variant={overdue ? 'brand' : 'secondary'} onClick={() => { setOverdue((v) => !v); setPage(1); }}>{t('work.task.overdueOnly')}</Button>
        <Button size="sm" variant={openOnly ? 'brand' : 'secondary'} onClick={() => { setOpenOnly((v) => !v); setPage(1); }}>{t('tasks.openOnly')}</Button>
      </FilterBar>

      {groups.isError ? <ErrorState onRetry={() => void groups.refetch()} /> : groups.isLoading ? <SkeletonCards count={3} className="sm:grid-cols-3" /> : !groups.data?.groups.length ? <EmptyState icon={Users} title={t('work.task.empty')} /> : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {groups.data.groups.map((g) => {
            const on = group?.key === g.key;
            return (
              <button key={g.key ?? 'none'} type="button" onClick={() => { setGroup(on ? null : g); setPage(1); setSelected(new Set()); }}
                className={cx('rounded-2xl border bg-white p-4 text-start shadow-card transition hover:border-zinc-300', on ? 'border-brand-400 ring-4 ring-brand-100' : 'border-line')}>
                <p className="truncate font-semibold text-zinc-900">{name(g)}</p>
                <div className="mt-2 flex gap-4 text-xs text-zinc-500">
                  <span><strong className="text-base font-semibold text-zinc-900 tabular">{fmt.number(g.open)}</strong> {t('tasks.openLower')}</span>
                  <span className={g.overdue ? 'text-rose-600' : ''}><strong className="text-base font-semibold tabular">{fmt.number(g.overdue)}</strong> {t('tasks.overdueLower')}</span>
                  <span><strong className="text-base font-semibold text-zinc-900 tabular">{fmt.number(g.done)}</strong> {t('tasks.doneLower')}</span>
                </div>
                <ProgressBar value={g.done} max={Math.max(1, g.total)} size="sm" className="mt-2" tone="green" />
              </button>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 text-[15px] font-semibold text-zinc-900">{group ? name(group) : t('tasks.allTeamTasks')}</h2>
      {tasks.isError ? <ErrorState onRetry={() => void tasks.refetch()} /> : tasks.isLoading ? <SkeletonRows /> : !tasks.data?.items.length ? <EmptyState compact icon={ClipboardList} title={t('work.task.empty')} /> : (
        <>
          <TaskTable items={tasks.data.items} cols={COLS} sort={sort} dir={dir} onSort={(k) => { if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(k); setDir('asc'); } }}
            selected={selected} onSelect={(ids, on) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; })} onOpen={setOpen} />
          <Pagination meta={tasks.data.meta} onPage={setPage} />
        </>
      )}
      <BulkBar ids={[...selected]} onDone={() => setSelected(new Set())} />
      <TaskDrawer taskId={open} open={!!open} onClose={() => setOpen(null)} onDeleted={() => setOpen(null)} />
    </div>
  );
}
