// Shared building blocks of the task workspace: status tones, drag & drop ordering, people / tag / task pickers.
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { TaskStatus } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { TagRow } from '@/api/types.tasks';
import type { CustomStatusRef, Task } from '@/api/types.work';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import type { Tone } from '@/components/ui/Badge';
import { useDebounced } from '@/components/ui/Filters';
import { useOutsideClose } from '@/components/ui/Popover';
import { cx } from '@/components/ui/cx';

export const STATUS_TONE: Record<TaskStatus, Tone> = { TODO: 'neutral', IN_PROGRESS: 'blue', REVIEW: 'violet', BLOCKED: 'red', DONE: 'green' };
export const PRIORITY_DOT: Record<string, string> = { LOW: 'text-zinc-400', NORMAL: 'text-sky-500', HIGH: 'text-orange-500', URGENT: 'text-rose-600' };

/** Coloured status pill: the custom status name/colour when the task has one, otherwise the translated built-in status. */
export function TaskStatusPill({ status, custom, className }: { status: TaskStatus; custom?: CustomStatusRef | null; className?: string }) {
  const { label } = useI18n();
  if (custom) {
    return (
      <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-black/5', className)} style={{ backgroundColor: `${custom.color}1f`, color: custom.color }}>
        <span className="size-1.5 rounded-full" style={{ backgroundColor: custom.color }} />{custom.name}
      </span>
    );
  }
  const tones: Record<Tone, string> = {
    neutral: 'bg-zinc-100 text-zinc-700', blue: 'bg-sky-50 text-sky-800', violet: 'bg-violet-50 text-violet-800', red: 'bg-rose-50 text-rose-800', green: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-900', orange: 'bg-orange-50 text-orange-900', teal: 'bg-teal-50 text-teal-800',
  };
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', tones[STATUS_TONE[status]], className)}>{label('taskStatus', status)}</span>;
}

export function AssigneeStack({ task, max = 3 }: { task: Pick<Task, 'assignees' | 'assignedTo'>; max?: number }) {
  const { t } = useI18n();
  const people = task.assignees?.length ? task.assignees : task.assignedTo ? [task.assignedTo] : [];
  if (people.length === 0) return <span className="text-xs text-zinc-400">{t('common.unassigned')}</span>;
  return (
    <span className="inline-flex items-center" title={people.map((p) => p.name).join(', ')}>
      {people.slice(0, max).map((p, i) => <Avatar key={p.id} name={p.name} src={p.avatar} size="xs" className={cx('ring-2 ring-white', i > 0 && '-ms-1.5')} />)}
      {people.length > max && <span className="-ms-1.5 inline-flex size-6 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 ring-2 ring-white">+{people.length - max}</span>}
    </span>
  );
}

// ───────────────────────── drag & drop ordering ─────────────────────────

/**
 * Native HTML5 drag & drop for a vertical list. `onReorder` gets the new id order; the caller persists it on the server
 * (nothing is kept only in client state). Keyboard users use the up / down buttons the caller may render.
 */
export function useSortable(ids: string[], onReorder: (ids: string[]) => void, enabled = true) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const props = (id: string) =>
    enabled
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; setDragging(id); },
          onDragOver: (e: DragEvent) => { e.preventDefault(); if (over !== id) setOver(id); },
          onDragEnd: () => { setDragging(null); setOver(null); },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            const from = e.dataTransfer.getData('text/plain') || dragging;
            setDragging(null);
            setOver(null);
            if (!from || from === id) return;
            const next = ids.filter((x) => x !== from);
            next.splice(next.indexOf(id), 0, from);
            onReorder(next);
          },
          className: cx('cursor-grab active:cursor-grabbing', dragging === id && 'opacity-40', over === id && dragging && dragging !== id && 'shadow-[inset_0_2px_0_var(--color-brand-500)]'),
        }
      : { className: '' };
  return { props, dragging };
}

// ───────────────────────── pickers ─────────────────────────

interface Person { id: string; name: string; role?: string }

/** Staff that may work on the given client (ADMINs + TEAM assigned to it). Without a client: everybody visible. */
export function useAssignable(clientId: string | null | undefined, enabled = true) {
  const q = useApi<{ items: Person[] }>(enabled ? '/team-members' : null, { clientId: clientId ?? undefined });
  return (q.data?.items ?? []).filter((m) => m.role !== 'CLIENT');
}

function PopoverShell({ trigger, children, open, setOpen, className }: { trigger: ReactNode; children: ReactNode; open: boolean; setOpen: (v: boolean) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className={cx('relative', className)}>
      {trigger}
      {open && <div className="og-pop absolute start-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]">{children}</div>}
    </div>
  );
}

/** Multi-select of people (assignees). */
export function PeoplePicker({ value, people, onChange, disabled, placeholder }: { value: string[]; people: Person[]; onChange: (ids: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = people.filter((p) => value.includes(p.id));
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <PopoverShell open={open} setOpen={setOpen} trigger={
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-line-strong bg-white px-3 py-1.5 text-start text-sm shadow-sm disabled:bg-zinc-50">
        {chosen.length === 0 ? <span className="flex-1 text-zinc-400">{placeholder ?? t('common.unassigned')}</span> : (
          <span className="flex flex-1 flex-wrap gap-1">{chosen.map((p) => <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pe-2 ps-0.5 text-xs text-zinc-800"><Avatar name={p.name} size="xs" className="!size-5" />{p.name}</span>)}</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-zinc-400" />
      </button>
    }>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="mb-1 h-9 w-full rounded-lg border border-line px-2.5 text-sm focus:border-brand-500 focus:outline-none" />
      <ul className="max-h-64 overflow-y-auto">
        {shown.map((p) => {
          const on = value.includes(p.id);
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50">
                <Avatar name={p.name} size="xs" /><span className="flex-1 truncate text-start">{p.name}</span>{on && <Check className="size-4 text-brand-600" />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-zinc-400">{t('common.noResults')}</li>}
      </ul>
    </PopoverShell>
  );
}

/** Tag chips + free text entry with suggestions from existing tags. */
export function TagInput({ value, onChange, disabled }: { value: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const q = useDebounced(text, 200);
  const all = useApi<{ items: TagRow[] }>('/task-tags', { q: q || undefined });
  const lower = value.map((v) => v.toLowerCase());
  const suggestions = (all.data?.items ?? []).filter((x) => !lower.includes(x.name.toLowerCase())).slice(0, 6);
  const add = (name: string) => {
    const n = name.trim().slice(0, 40);
    if (n && !lower.includes(n.toLowerCase())) onChange([...value, n]);
    setText('');
  };
  const color = (name: string) => all.data?.items.find((x) => x.name.toLowerCase() === name.toLowerCase())?.color ?? '#71717a';
  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-line-strong bg-white px-2 py-1.5 shadow-sm">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color(tag)}22`, color: color(tag) }}>
            {tag}{!disabled && <button type="button" onClick={() => onChange(value.filter((v) => v !== tag))} aria-label={t('common.remove')}><X className="size-3" /></button>}
          </span>
        ))}
        {!disabled && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={value.length ? '' : t('tasks.addTag')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
            className="min-w-24 flex-1 bg-transparent px-1 text-sm focus:outline-none" />
        )}
      </div>
      {!disabled && text && suggestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">{suggestions.map((s) => <button key={s.id} type="button" onClick={() => add(s.name)} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-200">{s.name}</button>)}</div>
      )}
    </div>
  );
}

/** Search tasks the caller can see (dependencies, moving a subtask). */
export function TaskSearchPicker({ onPick, exclude = [], placeholder }: { onPick: (task: Task) => void; exclude?: string[]; placeholder?: string }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const res = useApi<Paged<Task>>(q.length >= 2 ? '/tasks' : null, { q, pageSize: 8, sort: 'updatedAt', dir: 'desc' });
  const items = useMemo(() => (res.data?.items ?? []).filter((x) => !exclude.includes(x.id)), [res.data, exclude]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? t('tasks.searchTask')} className="h-9 w-full rounded-lg border border-line-strong bg-white ps-9 pe-3 text-sm focus:border-brand-500 focus:outline-none" />
      {q.length >= 2 && (
        <ul className="absolute inset-x-0 top-full z-40 mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
          {items.map((x) => (
            <li key={x.id}><button type="button" onClick={() => { onPick(x); setText(''); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-zinc-50"><span className="min-w-0 flex-1 truncate">{x.title}</span><TaskStatusPill status={x.status} custom={x.customStatus} /></button></li>
          ))}
          {!res.isLoading && items.length === 0 && <li className="px-2 py-3 text-center text-xs text-zinc-400">{t('common.noResults')}</li>}
        </ul>
      )}
    </div>
  );
}

/** Tracked vs estimated, e.g. "2h 35m / 3h". */
export function useHours() {
  const { t, fmt } = useI18n();
  return (h: number | null | undefined) => {
    if (h === null || h === undefined) return '—';
    const m = Math.round(h * 60);
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return hh && mm ? t('att.hm', { h: fmt.number(hh), m: fmt.number(mm) }) : hh ? t('tasks.hoursN', { h: fmt.number(hh) }) : t('att.min', { m: fmt.number(mm) });
  };
}
