import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CalendarRange, ClipboardList, LayoutTemplate, Plus, Settings2 } from 'lucide-react';
import { PRIORITIES, TASK_STATUSES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { SpaceTree, TagRow } from '@/api/types.tasks';
import type { Task, TaskSummary } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button, LinkButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Tabs';
import { StatCard } from '@/components/ui/StatCard';
import { useClientOptions } from '@/components/shared/options';
import { TaskFormModal } from '@/components/forms/TaskFormModal';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { locationName, SpacesTree, type Location } from '@/components/tasks/SpacesTree';
import { ApplyTemplateModal } from '@/components/tasks/TemplatesAndRules';
import { BulkBar, COLUMNS, ColumnsMenu, TaskBoard, TaskCalendar, TaskTable, TaskTimeline, type ColumnKey, type SortKey } from '@/components/tasks/TaskViews';
import { useAssignable } from '@/components/tasks/taskUi';
import { ClientTasksPage } from './ClientTasksPage';

type View = 'list' | 'board' | 'calendar' | 'timeline';
const COLS_KEY = 'og_task_columns';
const readCols = (): ColumnKey[] => {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as unknown;
    if (Array.isArray(v)) return COLUMNS.filter((c) => v.includes(c));
  } catch { /* storage unavailable */ }
  return ['assignee', 'priority', 'status', 'dueDate', 'tracked'];
};

/** Staff task workspace: Spaces / Folders / Lists + List, Board, Calendar and Timeline views. Clients get their shared tasks. */
export function TasksPage() {
  const { user } = useAuth();
  if (user?.role === 'CLIENT') return <ClientTasksPage />;
  return <StaffTasks />;
}

function StaffTasks() {
  const { t, fmt } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [loc, setLoc] = useState<Location>({ kind: 'all' });
  const [view, setView] = useState<View>((params.get('view') as View) || 'list');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [clientId, setClientId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [tag, setTag] = useState('');
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [archived, setArchived] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [sort, setSort] = useState<SortKey>('dueDate');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [cols, setCols] = useState<ColumnKey[]>(readCols);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState(false);
  const openTaskId = params.get('open');
  const setOpenTaskId = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('open', id); else n.delete('open'); return n; }, { replace: true });
  const q = useDebounced(search);
  const tree = useApi<SpaceTree>('/spaces/tree');
  const tags = useApi<{ items: TagRow[] }>('/task-tags');
  const { clients } = useClientOptions();
  const people = useAssignable(clientId || undefined);
  const statusOptions = useEnumOptions('taskStatus', TASK_STATUSES);
  const priorityOptions = useEnumOptions('priority', PRIORITIES);
  const where = locationName(tree.data, loc);
  const statuses = where.space?.statuses ?? [];

  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch { /* ignore */ } }, [cols]);
  useEffect(() => { setSelected(new Set()); setPage(1); }, [loc, q, status, priority, clientId, assigneeId, tag, mine, overdue, archived, showDone]);

  const locFilter = loc.kind === 'all' ? {} : loc.kind === 'space' ? { spaceId: loc.id } : loc.kind === 'folder' ? { folderId: loc.id } : { listId: loc.id };
  const filters = useMemo(() => ({
    ...locFilter, q, status, priority, clientId, assigneeId, tag, mine: mine ? 1 : undefined, overdue: overdue ? 1 : undefined, archived: archived ? 1 : undefined,
  }), [JSON.stringify(locFilter), q, status, priority, clientId, assigneeId, tag, mine, overdue, archived]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useApi<Paged<Task>>(view === 'list' ? '/tasks' : null, { ...filters, topLevel: 1, open: showDone || status ? undefined : 1, sort, dir, page, pageSize: 50 });
  const board = useApi<Paged<Task>>(view === 'board' ? '/tasks' : null, { ...filters, sort: 'position', pageSize: 100 });
  const summary = useApi<{ item: TaskSummary }>('/tasks/summary', { ...locFilter, clientId, mine: mine ? 1 : undefined });

  const onSort = (k: SortKey) => { if (sort === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(k); setDir(k === 'priority' ? 'desc' : 'asc'); } };
  const select = (ids: string[], on: boolean) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const filtered = !!(q || status || priority || clientId || assigneeId || tag || overdue || mine);

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6">
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-card">
          <SpacesTree tree={tree.data} value={loc} onChange={setLoc} />
        </div>
      </aside>

      <div className="min-w-0">
        <PageHeader
          title={loc.kind === 'all' ? t('nav.tasks') : where.name}
          subtitle={loc.kind === 'all' ? t('work.task.subtitle') : where.list?.project ? t('tasks.linkedProject', { name: where.list.project.name }) : undefined}
          actions={
            <>
              {(can('tasks.templates') || can('tasks.automations') || can('tasks.manage_spaces')) && <LinkButton to="/tasks/settings" variant="ghost" icon={<Settings2 className="size-4" />}>{t('tasks.settings')}</LinkButton>}
              {can('tasks.create') && <Button variant="secondary" icon={<LayoutTemplate className="size-4" />} onClick={() => setApplying(true)}>{t('tasks.fromTemplate')}</Button>}
              {can('tasks.create') && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('work.task.new')}</Button>}
            </>
          }
        />

        <div className="mb-4 lg:hidden">
          <Select value={JSON.stringify(loc)} onChange={(e) => setLoc(JSON.parse(e.target.value) as Location)} aria-label={t('tasks.spaces')}>
            <option value={JSON.stringify({ kind: 'all' })}>{t('tasks.allTasks')}</option>
            {(tree.data?.items ?? []).map((s) => (
              <optgroup key={s.id} label={s.name}>
                <option value={JSON.stringify({ kind: 'space', id: s.id })}>{s.name}</option>
                {[...s.folders.flatMap((f) => f.lists), ...s.lists].map((l) => <option key={l.id} value={JSON.stringify({ kind: 'list', id: l.id })}>— {l.name}</option>)}
              </optgroup>
            ))}
          </Select>
        </div>

        {summary.data && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('common.overdue')} value={fmt.number(summary.data.item.overdue)} icon={AlertTriangle} tone="amber" />
            <StatCard label={t('common.today')} value={fmt.number(summary.data.item.dueToday)} icon={CalendarClock} tone="sky" />
            <StatCard label={t('work.task.dueThisWeek')} value={fmt.number(summary.data.item.dueThisWeek)} icon={CalendarRange} tone="brand" />
            <StatCard label={t('work.task.open')} value={fmt.number(summary.data.item.open)} icon={ClipboardList} tone="zinc" />
          </div>
        )}

        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder={t('tasks.searchPlaceholder')} />
          <FilterSelect value={status} onChange={setStatus} allLabel={t('common.allStatuses')} options={statusOptions} />
          <FilterSelect value={priority} onChange={setPriority} allLabel={t('common.priority')} options={priorityOptions} />
          <FilterSelect value={clientId} onChange={setClientId} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />
          <FilterSelect value={assigneeId} onChange={setAssigneeId} allLabel={t('tasks.anyAssignee')} options={people.map((p) => ({ value: p.id, label: p.name }))} />
          <FilterSelect value={tag} onChange={setTag} allLabel={t('tasks.anyTag')} options={(tags.data?.items ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <Button variant={mine ? 'brand' : 'secondary'} size="sm" onClick={() => setMine((v) => !v)}>{t('work.task.mineOnly')}</Button>
          <Button variant={overdue ? 'brand' : 'secondary'} size="sm" onClick={() => setOverdue((v) => !v)}>{t('work.task.overdueOnly')}</Button>
          {view === 'list' && <Button variant={showDone ? 'brand' : 'secondary'} size="sm" onClick={() => setShowDone((v) => !v)}>{t('tasks.showCompleted')}</Button>}
          <Button variant={archived ? 'brand' : 'secondary'} size="sm" onClick={() => setArchived((v) => !v)}>{t('tasks.archived')}</Button>
          <div className="col-span-2 flex items-center gap-2 sm:ms-auto">
            {view === 'list' && <ColumnsMenu value={cols} onChange={setCols} />}
            <Segmented value={view} onChange={(v) => { setView(v); setParams((p) => { const n = new URLSearchParams(p); n.set('view', v); return n; }, { replace: true }); }} options={[{ id: 'list', label: t('common.list') }, { id: 'board', label: t('common.board') }, { id: 'calendar', label: t('common.calendar') }, { id: 'timeline', label: t('tasks.timeline') }]} />
          </div>
        </FilterBar>

        {view === 'list' && (
          list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
            <EmptyState icon={ClipboardList} title={t('work.task.empty')} description={filtered ? t('common.noResultsHint') : t('work.task.emptyHint')} action={can('tasks.create') && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('work.task.new')}</Button> : undefined} />
          ) : (
            <>
              <TaskTable items={list.data.items} cols={cols} sort={sort} dir={dir} onSort={onSort} selected={selected} onSelect={select} onOpen={setOpenTaskId} />
              <Pagination meta={list.data.meta} onPage={setPage} />
            </>
          )
        )}
        {view === 'board' && (
          board.isError ? <ErrorState onRetry={() => void board.refetch()} /> : board.isLoading ? <SkeletonRows /> : (
            <>
              <TaskBoard items={board.data?.items ?? []} statuses={statuses} onOpen={setOpenTaskId} onChanged={() => void board.refetch()} />
              {board.data && board.data.meta.total > board.data.items.length && <p className="mt-2 text-xs text-zinc-500">{t('tasks.boardLimited', { shown: board.data.items.length, total: board.data.meta.total })}</p>}
            </>
          )
        )}
        {view === 'calendar' && <TaskCalendar filters={filters} onOpen={setOpenTaskId} />}
        {view === 'timeline' && <TaskTimeline filters={filters} onOpen={setOpenTaskId} />}

        <BulkBar ids={[...selected]} clientId={clientId || undefined} onDone={() => setSelected(new Set())} />
        {creating && <TaskFormModal open onClose={() => setCreating(false)} defaultListId={loc.kind === 'list' ? loc.id : undefined} defaultClientId={clientId || undefined} onCreated={(tk) => setOpenTaskId(tk.id)} />}
        {applying && <ApplyTemplateModal listId={loc.kind === 'list' ? loc.id : undefined} onClose={() => setApplying(false)} onCreated={(id) => setOpenTaskId(id)} />}
        <TaskDrawer taskId={openTaskId} open={!!openTaskId} onClose={() => setOpenTaskId(null)} onDeleted={() => setOpenTaskId(null)} />
        {!can('tasks.view_team') ? null : <p className="mt-6 text-center text-xs text-zinc-400"><Link to="/team-tasks" className="hover:text-brand-700">{t('tasks.goTeamTasks')}</Link></p>}
      </div>
    </div>
  );
}
