import { useMemo, useRef, useState } from 'react';
import { Eye, Paperclip, Pencil, Send, Trash2 } from 'lucide-react';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Meta } from '@/api/types';
import type { ActivityRow } from '@/api/types.tasks';
import type { Task, TaskComment } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n, type TKey } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Feedback';
import { Checkbox, Textarea } from '@/components/ui/Form';
import { cx } from '@/components/ui/cx';
import { useAssignable } from './taskUi';

/** Renders "@Name" mentions highlighted. */
function CommentText({ text, mentions }: { text: string; mentions: Array<{ id: string; name: string }> }) {
  if (!mentions.length) return <>{text}</>;
  const names = mentions.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${names.join('|')}))`, 'g'));
  return <>{parts.map((p, i) => (p.startsWith('@') && mentions.some((m) => `@${m.name}` === p) ? <span key={i} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700">{p}</span> : p))}</>;
}

export function TaskComments({ task }: { task: Task }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const q = useApi<{ items: TaskComment[] }>(`/tasks/${task.id}/comments`);
  const people = useAssignable(task.clientId);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>([]);
  const [attach, setAttach] = useState<string[]>([]);
  const [shared, setShared] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // "@query" right before the caret opens the suggestion list
  const at = useMemo(() => { const m = /@([^\s@]{0,30})$/.exec(text); return m ? m[1].toLowerCase() : null; }, [text]);
  const suggestions = at === null ? [] : people.filter((p) => p.id !== user?.id && p.name.toLowerCase().includes(at)).slice(0, 6);
  const pick = (p: { id: string; name: string }) => {
    setText((s) => s.replace(/@([^\s@]{0,30})$/, `@${p.name} `));
    setMentions((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    ref.current?.focus();
  };

  const post = useAction(() => api.post(`/tasks/${task.id}/comments`, {
    comment: text.trim(), mentionIds: mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id), attachmentIds: attach, ...(shared ? { clientVisible: true } : {}),
  }), { onSuccess: () => { setText(''); setMentions([]); setAttach([]); setShared(false); } });
  const edit = useAction((v: { id: string; comment: string }) => api.patch(`/tasks/${task.id}/comments/${v.id}`, { comment: v.comment }), { onSuccess: () => setEditing(null) });
  const remove = useAction((id: string) => api.del(`/tasks/${task.id}/comments/${id}`));
  const files = task.files ?? [];

  return (
    <div>
      {q.isLoading ? <Spinner /> : (
        <ul className="space-y-4">
          {(q.data?.items ?? []).map((c) => (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar name={c.user.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900">{c.user.name}</span>
                  {c.authorType === 'CLIENT' && <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">{t('tasks.fromClient')}</span>}
                  {c.clientVisible && c.authorType !== 'CLIENT' && <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700"><Eye className="size-3" />{t('tasks.sharedWithClient')}</span>}
                  <span className="text-xs text-zinc-400">{fmt.relative(c.createdAt)}{c.editedAt ? ` · ${t('tasks.edited')}` : ''}</span>
                  <span className="ms-auto flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    {c.permissions?.canEdit && <IconButton label={t('common.edit')} className="size-7" onClick={() => setEditing({ id: c.id, text: c.comment })}><Pencil className="size-3.5" /></IconButton>}
                    {c.permissions?.canDelete && <IconButton label={t('common.delete')} className="size-7 hover:text-rose-600" onClick={() => remove.mutate(c.id)}><Trash2 className="size-3.5" /></IconButton>}
                  </span>
                </div>
                {editing?.id === c.id ? (
                  <div className="mt-1 space-y-2">
                    <Textarea rows={2} value={editing.text} maxLength={2000} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} />
                    <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button size="sm" loading={edit.isPending} disabled={!editing.text.trim()} onClick={() => edit.mutate({ id: c.id, comment: editing.text.trim() })}>{t('common.save')}</Button></div>
                  </div>
                ) : <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-zinc-700"><CommentText text={c.comment} mentions={c.mentions ?? []} /></p>}
                {(c.attachments ?? []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">{c.attachments!.map((f) => <a key={f.id} href={fileUrl(f.id)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"><Paperclip className="size-3" />{f.fileName}</a>)}</div>
                )}
              </div>
            </li>
          ))}
          {(q.data?.items ?? []).length === 0 && <p className="text-xs text-zinc-400">{t('review.commentsHint')}</p>}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) post.mutate(undefined); }} className="relative mt-4 space-y-2">
        <Textarea ref={ref} rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={t('tasks.commentPlaceholder')} />
        {suggestions.length > 0 && (
          <ul className="absolute start-0 top-full z-30 -mt-1 w-64 rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
            {suggestions.map((p) => <li key={p.id}><button type="button" onClick={() => pick(p)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50"><Avatar name={p.name} size="xs" />{p.name}</button></li>)}
          </ul>
        )}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.slice(0, 10).map((f) => {
              const on = attach.includes(f.id);
              return <button key={f.id} type="button" onClick={() => setAttach((a) => (on ? a.filter((x) => x !== f.id) : [...a, f.id]))} className={cx('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs', on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line text-zinc-500 hover:bg-zinc-50')}><Paperclip className="size-3" />{f.fileName}</button>;
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {task.visibility === 'CLIENT_VISIBLE' ? <Checkbox label={t('tasks.shareWithClient')} checked={shared} onChange={(e) => setShared(e.target.checked)} /> : <span className="text-xs text-zinc-400">{t('tasks.internalDiscussion')}</span>}
          <Button type="submit" size="sm" icon={<Send className="size-4" />} loading={post.isPending} disabled={!text.trim()}>{t('review.postComment')}</Button>
        </div>
      </form>
    </div>
  );
}

const ACTIVITY_TEXT: Record<string, TKey> = {
  TASK_CREATED: 'tasks.act.created', TASK_ASSIGNED: 'tasks.act.assigned', TASK_STATUS_CHANGED: 'tasks.act.status', TASK_COMPLETED: 'tasks.act.completed',
  TASK_PRIORITY_CHANGED: 'tasks.act.priority', TASK_DUE_DATE_CHANGED: 'tasks.act.dueDate', TASK_UPDATED: 'tasks.act.updated', COMMENT_CREATED: 'tasks.act.comment',
  COMMENT_UPDATED: 'tasks.act.commentEdited', COMMENT_DELETED: 'tasks.act.commentDeleted', FILE_UPLOADED: 'tasks.act.file', SUBTASK_CREATED: 'tasks.act.subtaskCreated',
  SUBTASK_COMPLETED: 'tasks.act.subtaskCompleted', TASK_DEPENDENCY_ADDED: 'tasks.act.depAdded', TASK_DEPENDENCY_REMOVED: 'tasks.act.depRemoved', TASK_ARCHIVED: 'tasks.act.archived',
  TASK_UNARCHIVED: 'tasks.act.unarchived', TASK_RECURRENCE_SET: 'tasks.act.recurrence', TASK_RECURRENCE_REMOVED: 'tasks.act.recurrenceRemoved', TASK_AUTOMATION_RAN: 'tasks.act.automation',
  TASK_TEMPLATE_APPLIED: 'tasks.act.template',
};

export function TaskActivity({ taskId }: { taskId: string }) {
  const { t, fmt, label } = useI18n();
  const [page, setPage] = useState(1);
  const q = useApi<{ items: ActivityRow[]; meta: Meta }>(`/tasks/${taskId}/activity`, { page });
  if (q.isLoading) return <Spinner />;
  const describe = (r: ActivityRow) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    const key = ACTIVITY_TEXT[r.action];
    const params: Record<string, string> = {
      from: r.action === 'TASK_STATUS_CHANGED' ? label('taskStatus', String(m.from ?? '')) : r.action === 'TASK_PRIORITY_CHANGED' ? label('priority', String(m.from ?? '')) : m.from ? String(m.from) : '—',
      to: r.action === 'TASK_STATUS_CHANGED' ? label('taskStatus', String(m.to ?? '')) : r.action === 'TASK_PRIORITY_CHANGED' ? label('priority', String(m.to ?? '')) : m.to ? String(m.to) : '—',
      subtask: String(m.subtask ?? ''), other: String(m.other ?? ''), fields: Array.isArray(m.fields) ? (m.fields as string[]).join(', ') : '', name: String(m.name ?? m.template ?? ''),
    };
    return key ? t(key, params) : label('auditAction', r.action);
  };
  return (
    <div>
      <ol className="relative space-y-4 border-s border-line ps-5">
        {(q.data?.items ?? []).map((r) => (
          <li key={r.id} className="relative">
            <span className="absolute -start-[25px] top-1 size-2.5 rounded-full bg-zinc-300 ring-4 ring-white" />
            <p className="text-sm text-zinc-800"><span className="font-medium">{r.user?.name ?? t('audit.system')}</span> {describe(r)}</p>
            <p className="text-xs text-zinc-400">{fmt.dateTime(r.createdAt)}</p>
          </li>
        ))}
      </ol>
      {q.data && q.data.meta.totalPages > page && <Button variant="ghost" size="sm" className="mt-3" onClick={() => setPage((p) => p + 1)}>{t('tasks.olderActivity')}</Button>}
    </div>
  );
}
