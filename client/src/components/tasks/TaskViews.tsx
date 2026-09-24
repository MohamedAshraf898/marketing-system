// List / Board / Calendar / Timeline views of tasks + the bulk action bar. Data always comes from the server, already
// filtered, sorted and paginated there; drag & drop changes are persisted through the API before the view refreshes.
import { Fragment, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Columns3, Eye, GitBranch, Lock, MessageSquare, Repeat } from 'lucide-react';
import { PRIORITIES, TASK_STATUSES, type TaskStatus } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { BulkResult, StatusOption, TimelineResponse } from '@/api/types.tasks';
import type { Task } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge, type Tone } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { CalendarGrid, visibleRange } from '@/components/ui/CalendarGrid';
import { Checkbox, Input, Select } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useOutsideClose } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/components/ui/cx';
import { AssigneeStack, PeoplePicker, STATUS_TONE, TaskStatusPill, useAssignable, useHours } from './taskUi';

export type SortKey = 'title' | 'priority' | 'status' | 'startDate' | 'dueDate' | 'createdAt' | 'position';
export const COLUMNS = ['assignee', 'priority', 'status', 'startDate', 'dueDate', 'tracked', 'estimate', 'list', 'tags'] as const;
export type ColumnKey = (typeof COLUMNS)[number];

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ───────────────────────── list ─────────────────────────

function SubRows({ parent, cols, onOpen, depth }: { parent: Task; cols: ColumnKey[]; onOpen: (id: string) => void; depth: number }) {
  const q = useApi<Paged<Task>>('/tasks', { parentId: parent.id, sort: 'position', pageSize: 100 });
  return <>{(q.data?.items ?? []).map((s) => <Row key={s.id} task={s} cols={cols} onOpen={onOpen} depth={depth} />)}</>;
}

function Row({ task, cols, onOpen, depth = 0, selected, onSelect }: { task: Task; cols: ColumnKey[]; onOpen: (id: string) => void; depth?: number; selected?: boolean; onSelect?: (on: boolean) => void }) {
  const { fmt } = useI18n();
  const hours = useHours();
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr onClick={() => onOpen(task.id)} className={cx('cursor-pointer transition-colors hover:bg-zinc-50/80', selected && 'bg-brand-50/50')}>
        <td className="w-10 ps-4" onClick={(e) => e.stopPropagation()}>{onSelect && <input type="checkbox" className="size-4 accent-[var(--color-brand-600)]" checked={!!selected} onChange={(e) => onSelect(e.target.checked)} aria-label={task.title} />}</td>
        <td className="max-w-[28rem] py-2.5 pe-3" style={{ paddingInlineStart: depth * 20 }}>
          <div className="flex items-center gap-1.5">
            {task.subtaskCount > 0 ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}</button>
            ) : <span className="w-5" />}
            <div className="min-w-0">
              <p className={cx('truncate font-medium', task.status === 'DONE' ? 'text-zinc-400 line-through' : 'text-zinc-900')}>{task.title}</p>
              <p className="flex items-center gap-2 truncate text-xs text-zinc-500">
                {[task.client?.companyName, task.project?.name].filter(Boolean).join(' · ')}
                {task.subtaskCount > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch className="size-3" />{task.subtaskCounts.done}/{task.subtaskCounts.total}</span>}
                {task.commentCount > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{task.commentCount}</span>}
                {task.blocked && <Lock className="size-3 text-rose-500" />}
                {task.recurring && <Repeat className="size-3 text-violet-500" />}
                {task.visibility === 'CLIENT_VISIBLE' && <Eye className="size-3 text-teal-600" />}
              </p>
            </div>
          </div>
        </td>
        {cols.includes('assignee') && <td className="px-3"><AssigneeStack task={task} /></td>}
        {cols.includes('priority') && <td className="px-3"><StatusBadge group="priority" value={task.priority} /></td>}
        {cols.includes('status') && <td className="px-3"><TaskStatusPill status={task.status} custom={task.customStatus} /></td>}
        {cols.includes('startDate') && <td className="px-3 text-xs text-zinc-500 tabular">{task.startDate ? fmt.date(task.startDate) : '—'}</td>}
        {cols.includes('dueDate') && <td className={cx('px-3 text-xs tabular', task.overdue ? 'font-medium text-rose-600' : 'text-zinc-500')}>{task.dueDate ? fmt.date(task.dueDate) : '—'}</td>}
        {cols.includes('tracked') && <td className="px-3 text-xs text-zinc-600 tabular">{task.actualHours ? hours(task.actualHours) : '—'}</td>}
        {cols.includes('estimate') && <td className="px-3 text-xs text-zinc-600 tabular">{hours(task.estimatedHours)}</td>}
        {cols.includes('list') && <td className="max-w-40 truncate px-3 text-xs text-zinc-500">{task.list?.name ?? '—'}</td>}
        {cols.includes('tags') && <td className="px-3"><span className="flex flex-wrap gap-1">{task.tags.slice(0, 3).map((tg) => <span key={tg.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${tg.color}22`, color: tg.color }}>{tg.name}</span>)}</span></td>}
      </tr>
      {open && <SubRows parent={task} cols={cols} onOpen={onOpen} depth={depth + 1} />}
    </Fragment>
  );
}

export function ColumnsMenu({ value, onChange }: { value: ColumnKey[]; onChange: (v: ColumnKey[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" icon={<Columns3 className="size-4" />} onClick={() => setOpen((o) => !o)}>{t('tasks.columns')}</Button>
      {open && (
        <div className="og-pop absolute end-0 top-full z-40 mt-1 w-52 space-y-1 rounded-xl border border-line bg-white p-2 shadow-[var(--shadow-pop)]">
          {COLUMNS.map((c) => <Checkbox key={c} label={t(`tasks.col.${c}`)} checked={value.includes(c)} onChange={(e) => onChange(e.target.checked ? COLUMNS.filter((x) => x === c || value.includes(x)) : value.filter((x) => x !== c))} />)}
        </div>
      )}
    </div>
  );
}

/** Desktop table with sortable headers, selection, column visibility and expandable subtasks. Phones get compact cards. */
export function TaskTable({ items, cols, sort, dir, onSort, selected, onSelect, onOpen }: {
  items: Task[]; cols: ColumnKey[]; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void;
  selected: Set<string>; onSelect: (ids: string[], on: boolean) => void; onOpen: (id: string) => void;
}) {
  const { t, fmt } = useI18n();
  const head = (k: SortKey | null, text: string, col?: ColumnKey) => (!col || cols.includes(col)) && (
    <th key={text} className="whitespace-nowrap px-3 py-3 text-start">
      {k ? <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-zinc-800">{text}{sort === k ? (dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}</button> : text}
    </th>
  );
  const all = items.length > 0 && items.every((i) => selected.has(i.id));
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-white shadow-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-zinc-50/70 text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500">
                <th className="w-10 ps-4"><input type="checkbox" className="size-4 accent-[var(--color-brand-600)]" checked={all} onChange={(e) => onSelect(items.map((i) => i.id), e.target.checked)} aria-label={t('tasks.selectAll')} /></th>
                {head('title', t('work.task.title'))}
                {head(null, t('tasks.col.assignee'), 'assignee')}
                {head('priority', t('tasks.col.priority'), 'priority')}
                {head('status', t('tasks.col.status'), 'status')}
                {head('startDate', t('tasks.col.startDate'), 'startDate')}
                {head('dueDate', t('tasks.col.dueDate'), 'dueDate')}
                {head(null, t('tasks.col.tracked'), 'tracked')}
                {head(null, t('tasks.col.estimate'), 'estimate')}
                {head(null, t('tasks.col.list'), 'list')}
                {head(null, t('tasks.col.tags'), 'tags')}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((task) => <Row key={task.id} task={task} cols={cols} onOpen={onOpen} selected={selected.has(task.id)} onSelect={(on) => onSelect([task.id], on)} />)}
            </tbody>
          </table>
        </div>
      </div>
      <ul className="space-y-2.5 md:hidden">
        {items.map((task) => (
          <li key={task.id} className="flex items-start gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-card" onClick={() => onOpen(task.id)}>
            <input type="checkbox" className="mt-1 size-4 accent-[var(--color-brand-600)]" checked={selected.has(task.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => onSelect([task.id], e.target.checked)} aria-label={task.title} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-zinc-900">{task.title}</p>
              <p className="truncate text-xs text-zinc-500">{[task.client?.companyName, task.project?.name].filter(Boolean).join(' · ')}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><TaskStatusPill status={task.status} custom={task.customStatus} /><StatusBadge group="priority" value={task.priority} />{task.dueDate && <span className={cx('text-xs tabular', task.overdue ? 'text-rose-600' : 'text-zinc-500')}>{fmt.date(task.dueDate)}</span>}<span className="ms-auto"><AssigneeStack task={task} /></span></div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// ───────────────────────── bulk bar ─────────────────────────

export function BulkBar({ ids, onDone, clientId }: { ids: string[]; onDone: () => void; clientId?: string }) {
  const { t, label } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const people = useAssignable(clientId);
  const [confirm, setConfirm] = useState(false);
  const [assignee, setAssignee] = useState<string[]>([]);
  const run = useAction((body: Record<string, unknown>) => api.post<BulkResult>('/tasks/bulk', { ids, ...body }), {
    onSuccess: (r) => { r.skipped.length ? toast.error(t('tasks.bulkPartial', { ok: r.updated, skipped: r.skipped.length })) : toast.success(t('tasks.bulkDone', { n: r.updated })); setConfirm(false); onDone(); },
  });
  if (ids.length === 0) return null;
  return (
    <div className="og-pop sticky bottom-24 z-30 mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-2.5 shadow-[var(--shadow-pop)] lg:bottom-6">
      <span className="px-2 text-sm font-semibold text-zinc-900">{t('tasks.selected', { n: ids.length })}</span>
      <Select value="" onChange={(e) => e.target.value && run.mutate({ action: 'status', status: e.target.value })} className="h-9 w-36" aria-label={t('common.status')}><option value="">{t('common.status')}</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{label('taskStatus', s)}</option>)}</Select>
      <Select value="" onChange={(e) => e.target.value && run.mutate({ action: 'priority', priority: e.target.value })} className="h-9 w-36" aria-label={t('common.priority')}><option value="">{t('common.priority')}</option>{PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select>
      {can('tasks.assign') && <div className="w-48"><PeoplePicker value={assignee} people={people} placeholder={t('tasks.bulkAssign')} onChange={(v) => { const added = v.find((x) => !assignee.includes(x)); setAssignee([]); if (added) run.mutate({ action: 'assign', assigneeId: added }); }} /></div>}
      <Input type="date" className="h-9 w-40" aria-label={t('common.dueDate')} onChange={(e) => e.target.value && run.mutate({ action: 'dueDate', dueDate: e.target.value })} />
      <Input className="h-9 w-36" placeholder={t('tasks.bulkAddTag')} onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === 'Enter' && v) { run.mutate({ action: 'addTags', tags: [v] }); (e.target as HTMLInputElement).value = ''; } }} />
      <Button size="sm" variant="secondary" onClick={() => run.mutate({ action: 'archive' })} loading={run.isPending}>{t('tasks.archive')}</Button>
      {can('tasks.delete') && <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}
      <Button size="sm" variant="ghost" onClick={onDone}>{t('common.clear')}</Button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => run.mutate({ action: 'delete' })} loading={run.isPending} title={t('tasks.bulkDeleteTitle', { n: ids.length })} message={t('tasks.bulkDeleteMessage')} confirmLabel={t('common.delete')} />
    </div>
  );
}

// ───────────────────────── board ─────────────────────────

const DOT: Record<Tone, string> = { neutral: 'bg-zinc-400', blue: 'bg-sky-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', violet: 'bg-violet-500', orange: 'bg-orange-500', teal: 'bg-teal-500' };

function BoardCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { t, fmt } = useI18n();
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-xl border border-line bg-white p-3 text-start shadow-card transition hover:shadow-[var(--shadow-pop)]">
      <p className="text-[13px] font-semibold leading-snug text-zinc-900">{task.title}</p>
      {(task.project?.name || task.client?.companyName) && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{[task.client?.companyName, task.project?.name].filter(Boolean).join(' · ')}</p>}
      {task.tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{task.tags.slice(0, 3).map((tg) => <span key={tg.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${tg.color}22`, color: tg.color }}>{tg.name}</span>)}</div>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5"><AssigneeStack task={task} max={2} /><StatusBadge group="priority" value={task.priority} className="!px-1.5 !py-0.5 text-[10px]" /></span>
        {task.dueDate && <span className={task.overdue ? 'text-[11px] font-medium text-rose-600' : 'text-[11px] text-zinc-500'}>{fmt.date(task.dueDate)}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-400">
        {task.subtaskCount > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch className="size-3" />{task.subtaskCounts.done}/{task.subtaskCounts.total}</span>}
        {task.checklist.total > 0 && <span className="tabular">{t('work.task.checklistProgress', { done: fmt.number(task.checklist.done), total: fmt.number(task.checklist.total) })}</span>}
        {task.blocked && <span className="inline-flex items-center gap-0.5 text-rose-500"><Lock className="size-3" />{t('tasks.blocked')}</span>}
      </div>
    </button>
  );
}

/**
 * Board by status (custom statuses of the space when it has them). Drop on a column = change status; drop on a card =
 * also place it right before that card. Both are sent to POST /tasks/:id/move, which re-checks permissions and
 * dependency blocks; the board refetches from the server afterwards.
 */
export function TaskBoard({ items, statuses, onOpen, onChanged }: { items: Task[]; statuses: StatusOption[]; onOpen: (id: string) => void; onChanged: () => void }) {
  const { t, label } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = useAction((v: { id: string; body: Record<string, unknown> }) => api.post(`/tasks/${v.id}/move`, v.body), { onSuccess: onChanged });
  const columns = statuses.length
    ? statuses.map((s) => ({ id: s.id, title: s.name, color: s.color, category: s.category as TaskStatus, custom: true }))
    : TASK_STATUSES.map((s) => ({ id: s, title: label('taskStatus', s), color: null as string | null, category: s, custom: false }));
  const colOf = (task: Task) => (statuses.length ? (task.customStatusId ?? statuses.find((s) => s.category === task.status)?.id ?? '') : task.status);
  const sorted = useMemo(() => [...items].sort((a, b) => a.position - b.position), [items]);

  const drop = (e: DragEvent, colId: string, beforeTask?: Task) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData('text/plain') || dragging;
    setDragging(null);
    setOver(null);
    const task = items.find((x) => x.id === id);
    if (!task || !task.permissions.canWork || task.id === beforeTask?.id) return;
    const col = columns.find((c) => c.id === colId)!;
    const list = sorted.filter((x) => colOf(x) === colId && x.id !== task.id);
    const idx = beforeTask ? list.findIndex((x) => x.id === beforeTask.id) : list.length;
    const body: Record<string, unknown> = { afterId: idx > 0 ? list[idx - 1].id : null, beforeId: idx < list.length ? list[idx].id : null };
    if (colOf(task) !== colId) Object.assign(body, col.custom ? { customStatusId: col.id } : { status: col.category });
    move.mutate({ id: task.id, body });
  };

  return (
    <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
      {columns.map((col) => {
        const list = sorted.filter((x) => colOf(x) === col.id);
        return (
          <section key={col.id} onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver((o) => (o === col.id ? null : o))} onDrop={(e) => drop(e, col.id)}
            className={cx('flex w-72 shrink-0 snap-start flex-col rounded-2xl bg-zinc-100/70 p-2.5 transition-colors', over === col.id && 'bg-brand-50 ring-2 ring-brand-200')}>
            <header className="flex items-center gap-2 px-1.5 pb-2.5 pt-1">
              <span className={cx('size-2 rounded-full', !col.color && DOT[STATUS_TONE[col.category]])} style={col.color ? { backgroundColor: col.color } : undefined} />
              <h3 className="text-[13px] font-semibold text-zinc-800">{col.title}</h3>
              <span className="ms-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-500 tabular">{list.length}</span>
            </header>
            <div className="flex min-h-16 flex-1 flex-col gap-2.5">
              {list.length === 0 && <div className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-xs text-zinc-400">{t('work.task.emptyBoardColumn')}</div>}
              {list.map((task) => (
                <div key={task.id} draggable={task.permissions.canWork}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; setDragging(task.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e, col.id, task)}
                  className={cx(task.permissions.canWork && 'cursor-grab active:cursor-grabbing', dragging === task.id && 'opacity-40')}>
                  <BoardCard task={task} onOpen={() => onOpen(task.id)} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ───────────────────────── calendar ─────────────────────────

type CalView = 'month' | 'week' | 'day';

/** Tasks by due date, start date or both. Day view lists everything on one day (also the phone-friendly view). */
export function TaskCalendar({ filters, onOpen }: { filters: Record<string, string | number | undefined>; onOpen: (id: string) => void }) {
  const { t, fmt } = useI18n();
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<CalView>('month');
  const [field, setField] = useState<'due' | 'start' | 'both'>('due');
  const range = useMemo(() => (view === 'day' ? { from: cursor, to: cursor } : visibleRange(cursor, view)), [cursor, view]);
  const key = field === 'due' ? ['dueFrom', 'dueTo'] : field === 'start' ? ['startFrom', 'startTo'] : ['anyFrom', 'anyTo'];
  const q = useApi<Paged<Task>>('/tasks', { ...filters, [key[0]]: isoDay(range.from), [key[1]]: isoDay(range.to), pageSize: 100 });
  const items = q.data?.items ?? [];
  const events = items.flatMap((tk) => {
    const out: Array<{ id: string; date: string; title: string; tone: Tone; meta?: string; onClick: () => void }> = [];
    const tone = tk.overdue ? 'red' : STATUS_TONE[tk.status];
    if ((field === 'due' || field === 'both') && tk.dueDate) out.push({ id: `${tk.id}:d`, date: tk.dueDate, title: tk.title, tone, meta: tk.assignees[0]?.name, onClick: () => onOpen(tk.id) });
    if ((field === 'start' || field === 'both') && tk.startDate) out.push({ id: `${tk.id}:s`, date: tk.startDate, title: `▸ ${tk.title}`, tone, onClick: () => onOpen(tk.id) });
    return out;
  });
  const toolbar = (
    <span className="flex flex-wrap gap-2">
      <Segmented value={field} onChange={setField} options={[{ id: 'due', label: t('tasks.byDue') }, { id: 'start', label: t('tasks.byStart') }, { id: 'both', label: t('tasks.byBoth') }]} />
      <Segmented value={view} onChange={setView} options={[{ id: 'day', label: t('tasks.day') }, { id: 'week', label: t('calendar.week') }, { id: 'month', label: t('calendar.month') }]} />
    </span>
  );
  if (view === 'day') {
    const today = isoDay(cursor);
    const dayEvents = events.filter((e) => e.date.slice(0, 10) === today);
    return (
      <div className="rounded-2xl border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <IconButton label={t('calendar.prev')} className="size-9" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth(), c.getDate() - 1))}><ChevronRight className="size-5 rotate-180 rtl:rotate-0" /></IconButton>
          <IconButton label={t('calendar.next')} className="size-9" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1))}><ChevronRight className="size-5 rtl:rotate-180" /></IconButton>
          <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">{fmt.date(cursor)}</h2>
          <Button variant="secondary" size="sm" onClick={() => setCursor(new Date())}>{t('calendar.today')}</Button>
          {toolbar}
        </div>
        <ul className="divide-y divide-line">
          {dayEvents.map((e) => <li key={e.id}><button type="button" onClick={e.onClick} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-zinc-50"><span className={cx('size-2 rounded-full', DOT[e.tone])} /><span className="flex-1 text-sm font-medium text-zinc-900">{e.title}</span>{e.meta && <span className="text-xs text-zinc-500">{e.meta}</span>}</button></li>)}
          {dayEvents.length === 0 && <li className="px-4 py-10 text-center text-sm text-zinc-500">{t('calendar.noEvents')}</li>}
        </ul>
      </div>
    );
  }
  return <CalendarGrid cursor={cursor} onCursorChange={setCursor} view={view} events={events} toolbarExtra={toolbar} onDayClick={(d) => { setCursor(d); setView('day'); }} />;
}

// ───────────────────────── timeline (Gantt) ─────────────────────────

const DAY_W = 28;
const ROW_H = 36;

/** Bars from start to due date with dependency arrows. Rendered as plain divs + one SVG layer (hundreds of rows stay fast). */
export function TaskTimeline({ filters, onOpen }: { filters: Record<string, string | number | undefined>; onOpen: (id: string) => void }) {
  const { t, fmt, locale } = useI18n();
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; });
  const days = 49;
  const from = isoDay(start);
  const toD = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
  const q = useApi<TimelineResponse>('/tasks/timeline', { ...filters, from, to: isoDay(toD) });
  const items = q.data?.items ?? [];
  const dayIndex = (iso: string) => Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);
  const bars = items.map((tk, row) => {
    const s = tk.startDate ?? tk.dueDate!;
    const e = tk.dueDate ?? tk.startDate!;
    const a = Math.max(0, dayIndex(s));
    const b = Math.min(days - 1, dayIndex(e));
    return { tk, row, x: a * DAY_W, w: Math.max(1, b - a + 1) * DAY_W, clippedStart: dayIndex(s) < 0 };
  });
  const byId = new Map(bars.map((b) => [b.tk.id, b]));
  const todayIdx = dayIndex(isoDay(new Date()));
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  const dayFmt = new Intl.DateTimeFormat(tag, { day: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat(tag, { month: 'short' });
  const shift = (n: number) => setStart((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));

  return (
    <div className="rounded-2xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <IconButton label={t('calendar.prev')} className="size-9" onClick={() => shift(-14)}><ChevronRight className="size-5 rotate-180 rtl:rotate-0" /></IconButton>
        <IconButton label={t('calendar.next')} className="size-9" onClick={() => shift(14)}><ChevronRight className="size-5 rtl:rotate-180" /></IconButton>
        <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">{fmt.date(start)} – {fmt.date(toD)}</h2>
        <Button variant="secondary" size="sm" onClick={() => setStart(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })}>{t('calendar.today')}</Button>
      </div>
      {q.data?.truncated && <p className="px-4 pt-2 text-xs text-amber-700">{t('tasks.timelineTruncated')}</p>}
      <div className="flex" dir="ltr">
        <div className="w-56 shrink-0 border-e border-line">
          <div className="h-12 border-b border-line" />
          {items.map((tk) => (
            <button key={tk.id} type="button" onClick={() => onOpen(tk.id)} style={{ height: ROW_H }} className="flex w-full items-center gap-2 border-b border-line/60 px-3 text-start text-[13px] hover:bg-zinc-50" dir="auto">
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{tk.title}</span><AssigneeStack task={tk} max={1} />
            </button>
          ))}
          {items.length === 0 && !q.isLoading && <p className="p-4 text-sm text-zinc-500">{t('tasks.timelineEmpty')}</p>}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: days * DAY_W }} className="relative">
            <div className="flex h-12 border-b border-line text-[10.5px] text-zinc-500">
              {Array.from({ length: days }, (_, i) => {
                const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={i} style={{ width: DAY_W }} className={cx('flex shrink-0 flex-col items-center justify-end pb-1', weekend && 'bg-zinc-50', i === todayIdx && 'font-semibold text-brand-700')}>
                    {(d.getDate() === 1 || i === 0) && <span className="font-medium text-zinc-700">{monthFmt.format(d)}</span>}
                    <span className="tabular">{dayFmt.format(d)}</span>
                  </div>
                );
              })}
            </div>
            <div className="relative" style={{ height: Math.max(1, items.length) * ROW_H }}>
              {todayIdx >= 0 && todayIdx < days && <div className="absolute inset-y-0 w-px bg-brand-400" style={{ left: todayIdx * DAY_W + DAY_W / 2 }} />}
              <svg className="pointer-events-none absolute inset-0" width={days * DAY_W} height={items.length * ROW_H}>
                <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#a1a1aa" /></marker></defs>
                {(q.data?.dependencies ?? []).map((d) => {
                  const a = byId.get(d.dependsOnId);
                  const b = byId.get(d.taskId);
                  if (!a || !b) return null;
                  const x1 = a.x + a.w;
                  const y1 = a.row * ROW_H + ROW_H / 2;
                  const x2 = b.x;
                  const y2 = b.row * ROW_H + ROW_H / 2;
                  const mid = Math.max(x1 + 8, x2 - 8);
                  return <path key={d.id} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} fill="none" stroke="#a1a1aa" strokeWidth="1.25" markerEnd="url(#arrow)" />;
                })}
              </svg>
              {bars.map(({ tk, row, x, w }) => (
                <button key={tk.id} type="button" onClick={() => onOpen(tk.id)} title={`${tk.title} · ${tk.startDate ? fmt.date(tk.startDate) : '—'} → ${tk.dueDate ? fmt.date(tk.dueDate) : '—'}`}
                  className={cx('absolute flex items-center overflow-hidden rounded-md px-2 text-[11px] font-medium text-white shadow-sm transition hover:brightness-110', tk.overdue ? 'bg-rose-500' : tk.status === 'DONE' ? 'bg-emerald-500' : tk.status === 'IN_PROGRESS' ? 'bg-sky-500' : tk.status === 'REVIEW' ? 'bg-violet-500' : tk.status === 'BLOCKED' ? 'bg-rose-400' : 'bg-zinc-400')}
                  style={{ left: x + 2, width: w - 4, top: row * ROW_H + 7, height: ROW_H - 14 }}>
                  <span className="truncate">{w > 60 ? tk.title : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
