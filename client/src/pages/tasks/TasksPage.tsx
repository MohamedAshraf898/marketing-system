import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CalendarRange, ClipboardList, Plus } from 'lucide-react';
import { PRIORITIES, TASK_STATUSES } from '@shared/enums';
import type { Tone } from '@/components/ui/Badge';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { Task, TaskSummary } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CalendarGrid, visibleRange } from '@/components/ui/CalendarGrid';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { Kanban } from '@/components/ui/Kanban';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Tabs';
import { StatCard } from '@/components/ui/StatCard';
import { useClientOptions, useProjectOptions } from '@/components/shared/options';
import { TaskTimerButton } from '@/components/shared/TaskTimerButton';
import { TaskFormModal } from '@/components/forms/TaskFormModal';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';

const STATUS_TONE: Record<(typeof TASK_STATUSES)[number], Tone> = { TODO: 'neutral', IN_PROGRESS: 'blue', REVIEW: 'violet', BLOCKED: 'red', DONE: 'green' };
type View = 'list' | 'board' | 'calendar';

function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { t, fmt, label } = useI18n();
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-xl border border-line bg-white p-3 text-start shadow-card transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <p className="text-[13px] font-semibold leading-snug text-zinc-900">{task.title}</p>
      {(task.project?.name || task.client?.companyName) && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{[task.client?.companyName, task.project?.name].filter(Boolean).join(' · ')}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          {task.assignedTo ? <Avatar name={task.assignedTo.name} size="xs" /> : <span className="size-6 rounded-full bg-zinc-100" />}
          <StatusBadge group="priority" value={task.priority} className="!px-1.5 !py-0.5 text-[10px]" />
        </span>
        {task.dueDate && <span className={task.overdue ? 'text-[11px] font-medium text-rose-600' : 'text-[11px] text-zinc-500'}>{fmt.date(task.dueDate)}</span>}
      </div>
      {task.checklist.total > 0 && <p className="mt-1.5 text-[11px] text-zinc-400 tabular">{t('work.task.checklistProgress', { done: fmt.number(task.checklist.done), total: fmt.number(task.checklist.total) })}</p>}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}><TaskTimerButton taskId={task.id} compact /></div>
      <span className="sr-only">{label('taskStatus', task.status)}</span>
    </button>
  );
}

export function TasksPage() {
  const { t, fmt, label } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [view, setView] = useState<View>('list');
  const [mine, setMine] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(new Date());
  const [calView, setCalView] = useState<'month' | 'week'>('month');
  const q = useDebounced(search);
  const statusOptions = useEnumOptions('taskStatus', TASK_STATUSES);
  const priorityOptions = useEnumOptions('priority', PRIORITIES);
  const { clients } = useClientOptions(staff);
  const { projects } = useProjectOptions(clientId || undefined);

  const baseFilters = { q, status, priority, projectId, clientId, mine: mine ? 1 : undefined, overdue: overdue ? 1 : undefined };
  const list = useApi<Paged<Task>>('/tasks', { ...baseFilters, page, pageSize: 20 }, { enabled: view === 'list' });
  const board = useApi<Paged<Task>>('/tasks', { ...baseFilters, pageSize: 200, sort: 'dueDate', dir: 'asc' }, { enabled: view === 'board' });
  const range = useMemo(() => visibleRange(cursor, calView), [cursor, calView]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const calendar = useApi<Paged<Task>>('/tasks', { ...baseFilters, dueFrom: iso(range.from), dueTo: iso(range.to), pageSize: 200 }, { enabled: view === 'calendar' });
  const summary = useApi<{ item: TaskSummary }>('/tasks/summary', { projectId, clientId, mine: mine ? 1 : undefined });
  const moveStatus = useAction((v: { id: string; status: string }) => api.patch(`/tasks/${v.id}`, { status: v.status }), { onSuccess: () => void board.refetch() });

  const reset = () => setPage(1);
  const filtered = !!(q || status || priority || projectId || clientId || overdue);

  const events = (calendar.data?.items ?? []).filter((tk) => tk.dueDate).map((tk) => ({
    id: tk.id, date: tk.dueDate!, title: tk.title, tone: tk.overdue ? ('red' as Tone) : STATUS_TONE[tk.status],
    meta: tk.assignedTo?.name, onClick: () => setOpenTaskId(tk.id),
  }));

  return (
    <div>
      <PageHeader
        title={t('nav.tasks')}
        subtitle={t('work.task.subtitle')}
        actions={can('tasks.create') && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('work.task.new')}</Button>}
      />

      {summary.data && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('common.overdue')} value={fmt.number(summary.data.item.overdue)} icon={AlertTriangle} tone="amber" />
          <StatCard label={t('common.today')} value={fmt.number(summary.data.item.dueToday)} icon={CalendarClock} tone="sky" />
          <StatCard label={t('work.task.dueThisWeek')} value={fmt.number(summary.data.item.dueThisWeek)} icon={CalendarRange} tone="brand" />
          <StatCard label={t('work.task.open')} value={fmt.number(summary.data.item.open)} icon={ClipboardList} tone="zinc" />
        </div>
      )}

      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('work.task.search')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        <FilterSelect value={priority} onChange={(v) => { setPriority(v); reset(); }} allLabel={t('common.priority')} options={priorityOptions} />
        <FilterSelect value={projectId} onChange={(v) => { setProjectId(v); reset(); }} allLabel={t('work.task.allProjects')} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        {staff && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        <Button variant={mine ? 'brand' : 'secondary'} size="sm" onClick={() => { setMine((v) => !v); reset(); }}>{t('work.task.mineOnly')}</Button>
        <Button variant={overdue ? 'brand' : 'secondary'} size="sm" onClick={() => { setOverdue((v) => !v); reset(); }}>{t('work.task.overdueOnly')}</Button>
        <div className="col-span-2 sm:ms-auto"><Segmented value={view} onChange={setView} options={[{ id: 'list', label: t('common.list') }, { id: 'board', label: t('common.board') }, { id: 'calendar', label: t('common.calendar') }]} /></div>
      </FilterBar>

      {view === 'list' && (
        list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
          <EmptyState icon={ClipboardList} title={t('work.task.empty')} description={filtered ? t('common.noResultsHint') : t('work.task.emptyHint')} action={can('tasks.create') && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('work.task.new')}</Button> : undefined} />
        ) : (
          <>
            <DataList
              rows={list.data.items}
              rowKey={(tk) => tk.id}
              onRowClick={(tk) => setOpenTaskId(tk.id)}
              columns={[
                { key: 'title', header: t('work.task.title'), primary: true, cell: (tk) => <div><p className="font-medium text-zinc-900">{tk.title}</p><p className="text-xs font-normal text-zinc-500">{[tk.client?.companyName, tk.project?.name].filter(Boolean).join(' · ')}</p></div> },
                { key: 'assignee', header: t('common.assignee'), hideOnTablet: true, cell: (tk) => tk.assignedTo ? <span className="inline-flex items-center gap-2"><Avatar name={tk.assignedTo.name} size="xs" />{tk.assignedTo.name}</span> : <span className="text-zinc-400">{t('common.unassigned')}</span> },
                { key: 'priority', header: t('common.priority'), hideOnTablet: true, cell: (tk) => <StatusBadge group="priority" value={tk.priority} /> },
                { key: 'status', header: t('common.status'), cell: (tk) => <StatusBadge group="taskStatus" value={tk.status} /> },
                { key: 'due', header: t('common.dueDate'), cell: (tk) => tk.dueDate ? <span className={tk.overdue ? 'font-medium text-rose-600' : 'text-zinc-500'}>{fmt.date(tk.dueDate)}</span> : <span className="text-zinc-400">—</span> },
                { key: 'timer', header: <span className="sr-only">{t('common.actions')}</span>, align: 'end', cell: (tk) => <div onClick={(e) => e.stopPropagation()}><TaskTimerButton taskId={tk.id} compact /></div> },
              ]}
            />
            <Pagination meta={list.data.meta} onPage={setPage} />
          </>
        )
      )}

      {view === 'board' && (
        board.isError ? <ErrorState onRetry={() => void board.refetch()} /> : board.isLoading ? <SkeletonRows /> : !board.data?.items.length ? (
          <EmptyState icon={ClipboardList} title={t('work.task.empty')} description={filtered ? t('common.noResultsHint') : t('work.task.emptyHint')} />
        ) : (
          <Kanban<Task>
            columns={TASK_STATUSES.map((s) => ({ id: s, title: label('taskStatus', s), tone: STATUS_TONE[s] }))}
            items={board.data.items}
            columnOf={(tk) => tk.status}
            keyOf={(tk) => tk.id}
            canMove={(tk) => tk.permissions.canWork}
            onMove={(tk, toColumn) => moveStatus.mutate({ id: tk.id, status: toColumn })}
            renderCard={(tk) => <TaskCard task={tk} onOpen={() => setOpenTaskId(tk.id)} />}
            empty={t('work.task.emptyBoardColumn')}
          />
        )
      )}

      {view === 'calendar' && (
        calendar.isError ? <ErrorState onRetry={() => void calendar.refetch()} /> : (
          <CalendarGrid cursor={cursor} onCursorChange={setCursor} view={calView} onViewChange={setCalView} events={events} />
        )
      )}

      {creating && <TaskFormModal open onClose={() => setCreating(false)} defaultClientId={clientId || undefined} defaultProjectId={projectId || undefined} onCreated={(tk) => setOpenTaskId(tk.id)} />}
      <TaskDrawer taskId={openTaskId} open={!!openTaskId} onClose={() => setOpenTaskId(null)} onDeleted={() => setOpenTaskId(null)} />
    </div>
  );
}
