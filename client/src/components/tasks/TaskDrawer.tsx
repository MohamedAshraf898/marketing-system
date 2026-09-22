import { useEffect, useState } from 'react';
import { Download, Paperclip, Plus, Send, Trash2 } from 'lucide-react';
import { PRIORITIES, TASK_STATUSES } from '@shared/enums';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Task, TaskComment } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox as CheckboxInput, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton, Spinner } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/Progress';
import { FileTypeIcon } from '@/components/shared/Media';
import { TaskTimerButton } from '@/components/shared/TaskTimerButton';
import { UploadFileModal } from '@/components/forms/UploadFileModal';

/** Owner: Projects & tasks group. Full task detail (fields, checklist, discussion, attachments) as a side drawer. */
export function TaskDrawer({ taskId, open, onClose, onDeleted }: { taskId: string | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const q = useApi<{ item: Task }>(taskId ? `/tasks/${taskId}` : null, undefined, { enabled: open && !!taskId });
  const t_ = q.data?.item;
  const [desc, setDesc] = useState('');
  const [checklistText, setChecklistText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { setDesc(t_?.description ?? ''); }, [t_?.id, t_?.description]);

  const patch = useAction((body: Record<string, unknown>) => api.patch(`/tasks/${taskId}`, body), { success: t('work.task.updated') });
  const remove = useAction(() => api.del(`/tasks/${taskId}`), { success: t('work.task.deleted'), onSuccess: () => { setConfirmDelete(false); onClose(); onDeleted?.(); } });
  const addItem = useAction(() => api.post(`/tasks/${taskId}/checklist`, { text: checklistText.trim() }), { onSuccess: () => setChecklistText('') });
  const toggleItem = useAction((v: { id: string; done: boolean }) => api.patch(`/tasks/${taskId}/checklist/${v.id}`, { done: v.done }));
  const deleteItem = useAction((id: string) => api.del(`/tasks/${taskId}/checklist/${id}`));
  const comments = useApi<{ items: TaskComment[] }>(taskId ? `/tasks/${taskId}/comments` : null, undefined, { enabled: open && !!taskId });
  const postComment = useAction(() => api.post(`/tasks/${taskId}/comments`, { comment: commentText.trim() }), { onSuccess: () => setCommentText('') });
  const deleteFile = useAction((id: string) => api.del(`/files/${id}`));

  if (!open) return null;
  const access = t_?.permissions;
  const canDeleteFile = (f: NonNullable<Task['files']>[number]) => !!user && (user.role === 'ADMIN' || (user.role === 'TEAM' && f.uploadedBy.id === user.id));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={t_?.title ?? <Skeleton className="h-5 w-40" />}
      subtitle={t_ && [t_.client?.companyName, t_.project?.name, t_.campaign?.name].filter(Boolean).join(' · ')}
      footer={access?.canDelete ? <Button variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>{t('common.delete')}</Button> : undefined}
    >
      {q.isLoading || !t_ ? (
        <div className="space-y-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge group="taskStatus" value={t_.status} />
            <StatusBadge group="priority" value={t_.priority} />
            {t_.overdue && <span className="text-xs font-medium text-rose-600">{t('common.overdue')}</span>}
            <TaskTimerButton taskId={t_.id} compact showTotal />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={t('common.status')}>{(id) => <Select id={id} value={t_.status} disabled={!access?.canWork || patch.isPending} onChange={(e) => patch.mutate({ status: e.target.value })}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{label('taskStatus', s)}</option>)}</Select>}</Field>
            <Field label={t('common.priority')}>{(id) => <Select id={id} value={t_.priority} disabled={!access?.canEditFields || patch.isPending} onChange={(e) => patch.mutate({ priority: e.target.value })}>{PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select>}</Field>
            <Field label={t('common.dueDate')}>{(id) => <Input id={id} type="date" value={t_.dueDate?.slice(0, 10) ?? ''} disabled={!access?.canEditFields || patch.isPending} onChange={(e) => patch.mutate({ dueDate: e.target.value || null })} />}</Field>
            <Field label={t('common.assignee')}>{(id) => <span id={id} className="flex h-10 items-center gap-2 text-sm text-zinc-700">{t_.assignedTo ? <><Avatar name={t_.assignedTo.name} size="xs" />{t_.assignedTo.name}</> : <span className="text-zinc-400">{t('common.unassigned')}</span>}</span>}</Field>
          </div>

          <Field label={t('common.description')}>
            {() => (
              <div className="space-y-2">
                <Textarea value={desc} disabled={!access?.canWork} onChange={(e) => setDesc(e.target.value)} rows={4} />
                {access?.canWork && desc !== (t_.description ?? '') && (
                  <div className="flex justify-end"><Button size="sm" loading={patch.isPending} onClick={() => patch.mutate({ description: desc || null })}>{t('common.saveChanges')}</Button></div>
                )}
              </div>
            )}
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">{t('work.task.checklist')}</h3>
              {t_.checklist.total > 0 && <span className="text-xs font-medium text-zinc-500 tabular">{t('work.task.checklistProgress', { done: fmt.number(t_.checklist.done), total: fmt.number(t_.checklist.total) })}</span>}
            </div>
            {t_.checklist.total > 0 && <ProgressBar value={t_.checklist.done} max={t_.checklist.total} className="mb-3" />}
            <ul className="space-y-1.5">
              {(t_.checklistItems ?? []).map((c) => (
                <li key={c.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-zinc-50">
                  <CheckboxInput checked={c.done} disabled={!access?.canWork} onChange={(e) => toggleItem.mutate({ id: c.id, done: e.target.checked })} label={<span className={c.done ? 'text-zinc-400 line-through' : 'text-zinc-800'}>{c.text}</span>} />
                  {access?.canWork && <button type="button" onClick={() => deleteItem.mutate(c.id)} className="ms-auto rounded p-1 text-zinc-300 opacity-0 hover:text-rose-600 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>}
                </li>
              ))}
              {t_.checklist.total === 0 && <p className="text-xs text-zinc-400">{t('work.task.checklistEmpty')}</p>}
            </ul>
            {access?.canWork && (
              <form onSubmit={(e) => { e.preventDefault(); if (checklistText.trim()) addItem.mutate(undefined); }} className="mt-2.5 flex gap-2">
                <Input value={checklistText} onChange={(e) => setChecklistText(e.target.value)} placeholder={t('work.task.checklistPlaceholder')} maxLength={300} />
                <Button type="submit" variant="secondary" size="md" disabled={!checklistText.trim()} loading={addItem.isPending} icon={<Plus className="size-4" />}>{t('work.task.checklistAdd')}</Button>
              </form>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">{t('review.files')}</h3>
              <Button variant="secondary" size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => setUploading(true)}>{t('request.attach')}</Button>
            </div>
            {(t_.files ?? []).length === 0 ? (
              <p className="text-xs text-zinc-400">{t('request.noAttachments')}</p>
            ) : (
              <ul className="space-y-1.5">
                {(t_.files ?? []).map((f) => (
                  <li key={f.id} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2">
                    <FileTypeIcon mime={f.fileType} className="shrink-0 text-zinc-500" />
                    <a href={fileUrl(f.id)} className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 hover:text-brand-700">{f.fileName}</a>
                    <span className="shrink-0 text-xs text-zinc-400 tabular">{fmt.bytes(f.size)}</span>
                    <a href={fileUrl(f.id)} aria-label={t('file.download')} className="shrink-0 rounded p-1 text-zinc-400 hover:text-zinc-700"><Download className="size-4" /></a>
                    {canDeleteFile(f) && <IconButton label={t('common.delete')} className="size-7 shrink-0 hover:bg-rose-50 hover:text-rose-600" onClick={() => deleteFile.mutate(f.id)}><Trash2 className="size-4" /></IconButton>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900">{t('work.task.discussion')}</h3>
            {comments.isLoading ? <Spinner /> : (
              <ul className="space-y-3">
                {(comments.data?.items ?? []).map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <Avatar name={c.user.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">{c.user.name}{c.user.id === user?.id && <span className="ms-1.5 text-xs font-normal text-zinc-400">({t('user.you')})</span>}</span>
                        <span className="text-xs text-zinc-400">{fmt.relative(c.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-zinc-700">{c.comment}</p>
                    </div>
                  </li>
                ))}
                {(comments.data?.items ?? []).length === 0 && <p className="text-xs text-zinc-400">{t('review.commentsHint')}</p>}
              </ul>
            )}
            <form onSubmit={(e) => { e.preventDefault(); if (commentText.trim()) postComment.mutate(undefined); }} className="mt-3 flex flex-col gap-2">
              <Textarea rows={2} value={commentText} maxLength={2000} onChange={(e) => setCommentText(e.target.value)} placeholder={t('review.commentPlaceholder')} />
              <div className="flex justify-end"><Button type="submit" size="sm" icon={<Send className="size-4" />} loading={postComment.isPending} disabled={!commentText.trim()}>{t('review.postComment')}</Button></div>
            </form>
          </div>
        </div>
      )}

      {t_ && uploading && <UploadFileModal open onClose={() => setUploading(false)} target={{ taskId: t_.id }} title={t('request.attach')} />}
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} title={t('work.task.deleteTitle')} message={t('work.task.deleteMessage', { title: t_?.title ?? '' })} confirmLabel={t('common.delete')} />
    </Drawer>
  );
}
