// Sections of the task drawer. Every change goes straight to the API (which re-checks permissions); the UI only
// disables controls the caller cannot use.
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Ban, Download, GitBranch, Link2, Lock, Paperclip, Plus, Repeat, Trash2, X } from 'lucide-react';
import { PRIORITIES, RECURRENCE_FREQUENCIES, TASK_STATUSES, TASK_VISIBILITIES } from '@shared/enums';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { SpaceTree, StatusOption } from '@/api/types.tasks';
import type { Task, TaskChecklistItem } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/Progress';
import { FileTypeIcon } from '@/components/shared/Media';
import { TaskTimerButton } from '@/components/shared/TaskTimerButton';
import { UploadFileModal } from '@/components/forms/UploadFileModal';
import { AssigneeStack, PeoplePicker, TagInput, TaskSearchPicker, TaskStatusPill, useAssignable, useHours, useSortable } from './taskUi';

type Patch = (body: Record<string, unknown>) => void;

export const Section = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <section>
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-zinc-900">{title}</h3>{action}</div>
    {children}
  </section>
);

/** Statuses usable for this task: the custom statuses of its space, or the built-in ones. */
export function useSpaceStatuses(listId: string | null) {
  const q = useApi<{ item: { statuses: StatusOption[] } }>(listId ? `/spaces/lists/${listId}` : null);
  return q.data?.item.statuses ?? [];
}

export function StatusSelect({ task, onPatch, disabled }: { task: Task; onPatch: Patch; disabled?: boolean }) {
  const { label } = useI18n();
  const custom = useSpaceStatuses(task.listId);
  if (custom.length) {
    return (
      <Select value={task.customStatusId ?? ''} disabled={disabled} onChange={(e) => onPatch({ customStatusId: e.target.value })}>
        {!task.customStatusId && <option value="">{label('taskStatus', task.status)}</option>}
        {custom.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    );
  }
  return <Select value={task.status} disabled={disabled} onChange={(e) => onPatch({ status: e.target.value })}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{label('taskStatus', s)}</option>)}</Select>;
}

// ───────────────────────── properties ─────────────────────────

export function TaskProperties({ task, onPatch, busy }: { task: Task; onPatch: Patch; busy: boolean }) {
  const { t, label } = useI18n();
  const a = task.permissions;
  const people = useAssignable(task.clientId, a.canEditFields);
  const tree = useApi<SpaceTree>(a.canEditFields && !task.parentId ? '/spaces/tree' : null);
  const lists = (tree.data?.items ?? []).flatMap((s) => [...s.lists, ...s.folders.flatMap((f) => f.lists)].map((l) => ({ id: l.id, name: `${s.name} / ${l.name}` })));
  const [tags, setTags] = useState(task.tags.map((x) => x.name));
  useEffect(() => setTags(task.tags.map((x) => x.name)), [task.id, task.tags]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Field label={t('common.status')}>{() => <StatusSelect task={task} onPatch={onPatch} disabled={!a.canWork || busy} />}</Field>
      <Field label={t('common.priority')}>{(id) => <Select id={id} value={task.priority} disabled={!a.canEditFields || busy} onChange={(e) => onPatch({ priority: e.target.value })}>{PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select>}</Field>
      <Field label={t('tasks.visibility')}>{(id) => <Select id={id} value={task.visibility} disabled={!a.canEditFields || busy || !task.clientId} onChange={(e) => onPatch({ visibility: e.target.value })}>{TASK_VISIBILITIES.map((s) => <option key={s} value={s}>{label('taskVisibility', s)}</option>)}</Select>}</Field>
      <Field label={t('tasks.startDate')}>{(id) => <Input id={id} type="date" value={task.startDate?.slice(0, 10) ?? ''} disabled={!a.canEditFields || busy} onChange={(e) => onPatch({ startDate: e.target.value || null })} />}</Field>
      <Field label={t('common.dueDate')}>{(id) => <Input id={id} type="date" value={task.dueDate?.slice(0, 10) ?? ''} disabled={!a.canEditFields || busy} onChange={(e) => onPatch({ dueDate: e.target.value || null })} />}</Field>
      <Field label={t('work.task.estimatedHours')}>{(id) => <Input id={id} type="number" min={0} step="0.25" dir="ltr" defaultValue={task.estimatedHours ?? ''} key={`${task.id}-${task.estimatedHours}`} disabled={!a.canEditFields || busy} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== task.estimatedHours) onPatch({ estimatedHours: v }); }} className="text-start" />}</Field>
      <Field label={t('tasks.assignees')} className="col-span-2">
        {() => a.canEditFields
          ? <PeoplePicker value={task.assignees.map((p) => p.id)} people={people.length ? people : task.assignees} disabled={busy} onChange={(ids) => onPatch({ assigneeIds: ids })} />
          : <div className="flex h-10 items-center"><AssigneeStack task={task} max={6} /></div>}
      </Field>
      <Field label={t('tasks.reviewer')}>
        {(id) => a.canEditFields
          ? <Select id={id} value={task.reviewerId ?? ''} disabled={busy} onChange={(e) => onPatch({ reviewerId: e.target.value || null })}><option value="">—</option>{(people.length ? people : task.reviewer ? [task.reviewer] : []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          : <p className="flex h-10 items-center text-sm text-zinc-700">{task.reviewer?.name ?? '—'}</p>}
      </Field>
      {!task.parentId && (
        <Field label={t('tasks.list')} className="col-span-2 sm:col-span-3">
          {(id) => a.canEditFields
            ? <Select id={id} value={task.listId ?? ''} disabled={busy} onChange={(e) => onPatch({ listId: e.target.value || null })}><option value="">{t('tasks.noList')}</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
            : <p className="flex h-10 items-center text-sm text-zinc-700">{task.list ? `${task.list.space.name} / ${task.list.name}` : '—'}</p>}
        </Field>
      )}
      <Field label={t('tasks.tags')} className="col-span-2 sm:col-span-3">{() => <TagInput value={tags} disabled={!a.canWork} onChange={(v) => { setTags(v); onPatch({ tags: v }); }} />}</Field>
      {(task.customFields ?? []).map((f) => (
        <Field key={f.id} label={f.name}>
          {(id) => {
            const dis = !a.canWork || busy;
            const save = (v: string | number | boolean | null) => onPatch({ customFields: { [f.id]: v } });
            if (f.type === 'CHECKBOX') return <div className="flex h-10 items-center"><Checkbox label="" checked={f.value === 'true'} disabled={dis} onChange={(e) => save(e.target.checked)} /></div>;
            if (f.type === 'SELECT') return <Select id={id} value={f.value ?? ''} disabled={dis} onChange={(e) => save(e.target.value || null)}><option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>;
            if (f.type === 'DATE') return <Input id={id} type="date" value={f.value ?? ''} disabled={dis} onChange={(e) => save(e.target.value || null)} />;
            return <Input id={id} type={f.type === 'NUMBER' ? 'number' : 'text'} defaultValue={f.value ?? ''} key={`${f.id}-${f.value}`} disabled={dis} onBlur={(e) => { if (e.target.value !== (f.value ?? '')) save(e.target.value === '' ? null : f.type === 'NUMBER' ? Number(e.target.value) : e.target.value); }} />;
          }}
        </Field>
      ))}
      {a.canEditFields && (
        <div className="col-span-2 sm:col-span-3">
          <Checkbox label={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-zinc-400" />{t('tasks.blockOnDependencies')}</span>} checked={task.blockOnDependencies} disabled={busy} onChange={(e) => onPatch({ blockOnDependencies: e.target.checked })} />
        </div>
      )}
    </div>
  );
}

// ───────────────────────── subtasks ─────────────────────────

export function TaskSubtasks({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { t, fmt } = useI18n();
  const { can } = useAuth();
  const [title, setTitle] = useState('');
  const subs = task.subtasks ?? [];
  const add = useAction(() => api.post('/tasks', { title: title.trim(), parentId: task.id }), { onSuccess: () => setTitle('') });
  const toggle = useAction((s: Task) => api.patch(`/tasks/${s.id}`, { status: s.status === 'DONE' ? 'TODO' : 'DONE' }));
  const reorder = useAction((ids: string[]) => api.put(`/tasks/${task.id}/subtasks/reorder`, { ids }));
  const sort = useSortable(subs.map((s) => s.id), (ids) => reorder.mutate(ids), task.permissions.canWork);
  const canAdd = task.permissions.canWork && can('tasks.create') && task.depth < 3;
  return (
    <Section title={t('tasks.subtasks')} action={subs.length > 0 && <span className="text-xs font-medium text-zinc-500 tabular">{t('tasks.subtaskProgress', { done: fmt.number(task.subtaskCounts.done), total: fmt.number(task.subtaskCounts.total) })}</span>}>
      {subs.length > 0 && <ProgressBar value={task.subtaskCounts.done} max={Math.max(1, task.subtaskCounts.total)} className="mb-2" size="sm" />}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {subs.map((s) => {
          const p = sort.props(s.id);
          return (
            <li key={s.id} {...p} className={`flex items-center gap-2.5 px-3 py-2 ${p.className}`}>
              <input type="checkbox" className="size-4 accent-[var(--color-brand-600)]" checked={s.status === 'DONE'} disabled={!s.permissions.canWork} onChange={() => toggle.mutate(s)} aria-label={t('tasks.markDone')} />
              <button type="button" onClick={() => onOpen(s.id)} className={`min-w-0 flex-1 truncate text-start text-sm ${s.status === 'DONE' ? 'text-zinc-400 line-through' : 'text-zinc-800 hover:text-brand-700'}`}>{s.title}</button>
              {s.subtaskCount > 0 && <span className="text-[11px] text-zinc-400 tabular">{s.subtaskCounts.done}/{s.subtaskCounts.total}</span>}
              <AssigneeStack task={s} max={2} />
              {s.dueDate && <span className={`text-[11px] tabular ${s.overdue ? 'text-rose-600' : 'text-zinc-500'}`}>{fmt.date(s.dueDate)}</span>}
            </li>
          );
        })}
        {subs.length === 0 && <li className="px-3 py-2.5 text-xs text-zinc-400">{t('tasks.noSubtasks')}</li>}
      </ul>
      {canAdd && (
        <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(undefined); }} className="mt-2 flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.newSubtask')} maxLength={200} />
          <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} loading={add.isPending} disabled={!title.trim()}>{t('common.add')}</Button>
        </form>
      )}
    </Section>
  );
}

// ───────────────────────── checklist ─────────────────────────

export function TaskChecklist({ task }: { task: Task }) {
  const { t, fmt } = useI18n();
  const [text, setText] = useState('');
  const items = task.checklistItems ?? [];
  const can = task.permissions.canWork;
  const add = useAction(() => api.post(`/tasks/${task.id}/checklist`, { text: text.trim() }), { onSuccess: () => setText('') });
  const toggle = useAction((v: { id: string; done: boolean }) => api.patch(`/tasks/${task.id}/checklist/${v.id}`, { done: v.done }));
  const remove = useAction((id: string) => api.del(`/tasks/${task.id}/checklist/${id}`));
  const reorder = useAction((ids: string[]) => api.put(`/tasks/${task.id}/checklist/reorder`, { ids }));
  const sort = useSortable(items.map((i) => i.id), (ids) => reorder.mutate(ids), can);
  const move = (i: number, d: -1 | 1) => { const ids = items.map((x) => x.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; reorder.mutate(ids); };
  return (
    <Section title={t('work.task.checklist')} action={task.checklist.total > 0 && <span className="text-xs font-medium text-zinc-500 tabular">{t('work.task.checklistProgress', { done: fmt.number(task.checklist.done), total: fmt.number(task.checklist.total) })}</span>}>
      {task.checklist.total > 0 && <ProgressBar value={task.checklist.done} max={task.checklist.total} className="mb-2" size="sm" />}
      <ul className="space-y-1">
        {items.map((c: TaskChecklistItem, i) => {
          const p = sort.props(c.id);
          return (
            <li key={c.id} {...p} className={`group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-zinc-50 ${p.className}`}>
              <Checkbox checked={c.done} disabled={!can} onChange={(e) => toggle.mutate({ id: c.id, done: e.target.checked })} label={<span className={c.done ? 'text-zinc-400 line-through' : 'text-zinc-800'}>{c.text}</span>} />
              {can && (
                <span className="ms-auto flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" onClick={() => move(i, -1)} className="rounded p-1 text-zinc-400 hover:text-zinc-700" aria-label={t('tasks.moveUp')}><ArrowUp className="size-3.5" /></button>
                  <button type="button" onClick={() => move(i, 1)} className="rounded p-1 text-zinc-400 hover:text-zinc-700" aria-label={t('tasks.moveDown')}><ArrowDown className="size-3.5" /></button>
                  <button type="button" onClick={() => remove.mutate(c.id)} className="rounded p-1 text-zinc-400 hover:text-rose-600" aria-label={t('common.delete')}><Trash2 className="size-3.5" /></button>
                </span>
              )}
            </li>
          );
        })}
        {items.length === 0 && <p className="text-xs text-zinc-400">{t('work.task.checklistEmpty')}</p>}
      </ul>
      {can && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(undefined); }} className="mt-2 flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('work.task.checklistPlaceholder')} maxLength={300} />
          <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} loading={add.isPending} disabled={!text.trim()}>{t('work.task.checklistAdd')}</Button>
        </form>
      )}
    </Section>
  );
}

// ───────────────────────── dependencies ─────────────────────────

export function TaskDependencies({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<'BLOCKED_BY' | 'BLOCKING' | 'RELATED'>('BLOCKED_BY');
  const d = task.dependencies ?? { blockedBy: [], blocking: [], related: [] };
  const add = useAction((taskId: string) => api.post(`/tasks/${task.id}/dependencies`, { taskId, type }), { success: t('tasks.dependencyAdded') });
  const remove = useAction((depId: string) => api.del(`/tasks/${task.id}/dependencies/${depId}`));
  const linked = [...d.blockedBy, ...d.blocking, ...d.related].map((x) => x.task.id);
  const group = (title: string, icon: React.ReactNode, rows: typeof d.blockedBy) => rows.length > 0 && (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">{icon}{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
            <button type="button" onClick={() => onOpen(r.task.id)} className="min-w-0 flex-1 truncate text-start text-sm text-zinc-800 hover:text-brand-700">{r.task.title}</button>
            <TaskStatusPill status={r.task.status} />
            {task.permissions.canWork && <IconButton label={t('common.remove')} className="size-7" onClick={() => remove.mutate(r.id)}><X className="size-3.5" /></IconButton>}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Section title={t('tasks.dependencies')} action={task.blocked && <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600"><Ban className="size-3.5" />{t('tasks.waitingOn', { n: task.blockedByCount })}</span>}>
      <div className="space-y-3">
        {group(t('tasks.blockedBy'), <Lock className="size-3" />, d.blockedBy)}
        {group(t('tasks.blocking'), <GitBranch className="size-3" />, d.blocking)}
        {group(t('tasks.related'), <Link2 className="size-3" />, d.related)}
        {linked.length === 0 && <p className="text-xs text-zinc-400">{t('tasks.noDependencies')}</p>}
        {task.permissions.canWork && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="sm:w-44" aria-label={t('tasks.dependencyType')}>
              <option value="BLOCKED_BY">{t('tasks.blockedBy')}</option><option value="BLOCKING">{t('tasks.blocking')}</option><option value="RELATED">{t('tasks.related')}</option>
            </Select>
            <div className="flex-1"><TaskSearchPicker exclude={[task.id, ...linked]} onPick={(x) => add.mutate(x.id)} /></div>
          </div>
        )}
      </div>
    </Section>
  );
}

// ───────────────────────── time ─────────────────────────

export function TaskTime({ task }: { task: Task }) {
  const { t } = useI18n();
  const hours = useHours();
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const tracked = task.time?.trackedHours ?? task.actualHours;
  const est = task.estimatedHours;
  return (
    <Section title={t('tasks.time')} action={can('time.track') && <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>{t('tasks.logTime')}</Button>}>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line px-3 py-2.5">
        <div><p className="text-[11px] uppercase tracking-wide text-zinc-400">{t('tasks.tracked')}</p><p className="text-sm font-semibold tabular text-zinc-900">{hours(tracked)}</p></div>
        <div><p className="text-[11px] uppercase tracking-wide text-zinc-400">{t('tasks.estimated')}</p><p className="text-sm font-semibold tabular text-zinc-900">{hours(est)}</p></div>
        {est ? <ProgressBar value={tracked} max={est} tone="auto" size="sm" className="min-w-32 flex-1" label={`${Math.round((tracked / est) * 100)}%`} /> : <span className="flex-1" />}
        <TaskTimerButton taskId={task.id} />
      </div>
      {adding && <TimeEntryModal taskId={task.id} onClose={() => setAdding(false)} />}
    </Section>
  );
}

function TimeEntryModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { t } = useI18n();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const [f, setF] = useState({ date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, start: `${pad(Math.max(0, now.getHours() - 1))}:00`, minutes: '60', notes: '' });
  const save = useAction(() => api.post<{ overlapping: number }>('/time/entries', { taskId, startedAt: new Date(`${f.date}T${f.start}`).toISOString(), durationMinutes: Number(f.minutes), notes: f.notes || null }), {
    success: t('tasks.timeLogged'), onSuccess: onClose,
  });
  const errs = fieldErrors(save.error);
  return (
    <Modal open onClose={onClose} size="sm" title={t('tasks.logTime')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)} disabled={!Number(f.minutes)}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('common.date')}>{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />}</Field>
        <Field label={t('tasks.startTime')} error={fieldText(t, errs.startedAt)}>{(id) => <Input id={id} type="time" value={f.start} onChange={(e) => setF((s) => ({ ...s, start: e.target.value }))} />}</Field>
        <Field label={t('tasks.durationMinutes')} error={fieldText(t, errs.durationMinutes ?? errs.endedAt)} className="col-span-2">{(id) => <Input id={id} type="number" min={1} max={1440} value={f.minutes} onChange={(e) => setF((s) => ({ ...s, minutes: e.target.value }))} />}</Field>
        <Field label={t('common.notes')} className="col-span-2">{(id) => <Input id={id} value={f.notes} maxLength={1000} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} />}</Field>
      </div>
    </Modal>
  );
}

// ───────────────────────── attachments ─────────────────────────

export function TaskAttachments({ task }: { task: Task }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const deleteFile = useAction((id: string) => api.del(`/files/${id}`));
  const files = task.files ?? [];
  return (
    <Section title={t('review.files')} action={task.clientId && <Button variant="secondary" size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => setUploading(true)}>{t('request.attach')}</Button>}>
      {!task.clientId && <p className="text-xs text-zinc-400">{t('tasks.attachNeedsClient')}</p>}
      {files.length === 0 ? (task.clientId ? <p className="text-xs text-zinc-400">{t('request.noAttachments')}</p> : null) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2">
              <FileTypeIcon mime={f.fileType} className="shrink-0 text-zinc-500" />
              <a href={fileUrl(f.id)} className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 hover:text-brand-700">{f.fileName}</a>
              <span className="shrink-0 text-xs text-zinc-400 tabular">{fmt.bytes(f.size)}</span>
              <a href={fileUrl(f.id)} aria-label={t('file.download')} className="shrink-0 rounded p-1 text-zinc-400 hover:text-zinc-700"><Download className="size-4" /></a>
              {(user?.role === 'ADMIN' || f.uploadedBy.id === user?.id) && <IconButton label={t('common.delete')} className="size-7 shrink-0 hover:bg-rose-50 hover:text-rose-600" onClick={() => deleteFile.mutate(f.id)}><Trash2 className="size-4" /></IconButton>}
            </li>
          ))}
        </ul>
      )}
      {uploading && <UploadFileModal open onClose={() => setUploading(false)} target={{ taskId: task.id }} title={t('request.attach')} />}
    </Section>
  );
}

// ───────────────────────── recurrence ─────────────────────────

export function RecurrenceModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t, label } = useI18n();
  const r = task.recurrence;
  const [f, setF] = useState({
    frequency: r?.frequency ?? 'WEEKLY', interval: String(r?.interval ?? 1), weekdays: r?.weekdays ? r.weekdays.split(',').map(Number) : [task.dueDate ? new Date(task.dueDate).getUTCDay() : 1],
    monthDay: String(r?.monthDay ?? (task.dueDate ? new Date(task.dueDate).getUTCDate() : 1)), endDate: r?.endDate?.slice(0, 10) ?? '',
  });
  const wd = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
  const save = useAction(() => api.put(`/tasks/${task.id}/recurrence`, {
    frequency: f.frequency, interval: Number(f.interval) || 1, ...(f.frequency === 'WEEKLY' ? { weekdays: f.weekdays } : {}), ...(f.frequency === 'MONTHLY' ? { monthDay: Number(f.monthDay) } : {}), endDate: f.endDate || null,
  }), { success: t('tasks.recurrenceSaved'), onSuccess: onClose });
  const stop = useAction(() => api.del(`/tasks/${task.id}/recurrence`), { success: t('tasks.recurrenceStopped'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><Repeat className="size-4" />{t('tasks.recurrence')}</span>} description={t('tasks.recurrenceHint')}
      footer={<>{r && <Button variant="ghost" className="text-rose-600 sm:me-auto" loading={stop.isPending} onClick={() => stop.mutate(undefined)}>{t('tasks.stopRecurring')}</Button>}<Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('tasks.frequency')}>{(id) => <Select id={id} value={f.frequency} onChange={(e) => setF((s) => ({ ...s, frequency: e.target.value as typeof f.frequency }))}>{RECURRENCE_FREQUENCIES.map((x) => <option key={x} value={x}>{label('recurrence', x)}</option>)}</Select>}</Field>
        {f.frequency !== 'DAILY' && <Field label={f.frequency === 'CUSTOM' ? t('tasks.everyNDays') : f.frequency === 'WEEKLY' ? t('tasks.everyNWeeks') : t('tasks.everyNMonths')}>{(id) => <Input id={id} type="number" min={1} max={365} value={f.interval} onChange={(e) => setF((s) => ({ ...s, interval: e.target.value }))} />}</Field>}
        {f.frequency === 'WEEKLY' && (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[13px] font-medium text-zinc-700">{t('tasks.onDays')}</p>
            <div className="flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5, 6, 0].map((d) => { const on = f.weekdays.includes(d); return <button key={d} type="button" onClick={() => setF((s) => ({ ...s, weekdays: on ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d] }))} className={`h-9 min-w-12 rounded-lg px-3 text-sm font-medium ring-1 ring-inset ${on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-zinc-600 ring-line-strong'}`}>{wd.format(new Date(Date.UTC(2024, 0, 7 + d)))}</button>; })}</div>
            {errs.weekdays && <p className="mt-1 text-xs text-rose-600">{fieldText(t, errs.weekdays)}</p>}
          </div>
        )}
        {f.frequency === 'MONTHLY' && <Field label={t('tasks.dayOfMonth')}>{(id) => <Input id={id} type="number" min={1} max={31} value={f.monthDay} onChange={(e) => setF((s) => ({ ...s, monthDay: e.target.value }))} />}</Field>}
        <Field label={t('tasks.endsOn')} hint={t('common.optional')} error={fieldText(t, errs.endDate)}>{(id) => <Input id={id} type="date" value={f.endDate} onChange={(e) => setF((s) => ({ ...s, endDate: e.target.value }))} />}</Field>
      </div>
    </Modal>
  );
}
