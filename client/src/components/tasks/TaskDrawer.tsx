import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, ChevronRight, CopyPlus, Eye, Repeat, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Task } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { TaskActivity, TaskComments } from './TaskDiscussion';
import { RecurrenceModal, TaskAttachments, TaskChecklist, TaskDependencies, TaskProperties, TaskSubtasks, TaskTime } from './TaskSections';

type Tab = 'details' | 'comments' | 'activity';

/** Owner: Projects & tasks group. Full task detail as a side drawer; subtasks / dependencies open inside the same drawer. */
export function TaskDrawer({ taskId, open, onClose, onDeleted }: { taskId: string | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const { t, label } = useI18n();
  const { can } = useAuth();
  const [current, setCurrent] = useState<string | null>(taskId);
  const [tab, setTab] = useState<Tab>('details');
  useEffect(() => { setCurrent(taskId); setTab('details'); }, [taskId]);
  const id = current ?? taskId;
  const q = useApi<{ item: Task }>(id ? `/tasks/${id}` : null, undefined, { enabled: open && !!id, keepPrevious: false });
  const task = q.data?.item;
  const [desc, setDesc] = useState('');
  const [title, setTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [saveTemplate, setSaveTemplate] = useState(false);
  useEffect(() => { setDesc(task?.description ?? ''); setTitle(task?.title ?? ''); }, [task?.id, task?.description, task?.title]);

  const patch = useAction((body: Record<string, unknown>) => api.patch(`/tasks/${id}`, body), { success: t('work.task.updated') });
  const remove = useAction(() => api.del(`/tasks/${id}`), {
    success: t('work.task.deleted'),
    onSuccess: () => { setConfirmDelete(false); if (task?.parentId) setCurrent(task.parentId); else { onClose(); onDeleted?.(); } },
  });

  if (!open) return null;
  const a = task?.permissions;
  const openTask = (x: string) => { setCurrent(x); setTab('details'); };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={task ? (
        a?.canEditFields
          ? <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title.trim() !== task.title) patch.mutate({ title: title.trim() }); }} maxLength={200} className="w-full rounded-lg bg-transparent px-1 -mx-1 font-semibold focus:bg-zinc-50 focus:outline-none" aria-label={t('work.task.title')} />
          : task.title
      ) : <Skeleton className="h-5 w-40" />}
      subtitle={task && (
        <span className="flex flex-wrap items-center gap-1">
          {task.ancestors?.map((x) => <span key={x.id} className="inline-flex items-center gap-1"><button type="button" onClick={() => openTask(x.id)} className="hover:text-brand-700 hover:underline">{x.title}</button><ChevronRight className="size-3 rtl:rotate-180" /></span>)}
          {[task.client?.companyName, task.project?.name, task.list ? `${task.list.space.name} / ${task.list.name}` : null].filter(Boolean).join(' · ')}
        </span>
      )}
      footer={task && (
        <div className="flex w-full flex-wrap items-center gap-2">
          {a?.canEditFields && <Button variant="ghost" size="sm" icon={<Repeat className="size-4" />} onClick={() => setRecurring(true)}>{task.recurring ? t('tasks.editRecurrence') : t('tasks.makeRecurring')}</Button>}
          {can('tasks.templates') && <Button variant="ghost" size="sm" icon={<CopyPlus className="size-4" />} onClick={() => setSaveTemplate(true)}>{t('tasks.saveAsTemplate')}</Button>}
          <span className="flex-1" />
          {a?.canEditFields && (task.archivedAt
            ? <Button variant="ghost" size="sm" icon={<ArchiveRestore className="size-4" />} onClick={() => patch.mutate({ archived: false })}>{t('tasks.unarchive')}</Button>
            : <Button variant="ghost" size="sm" icon={<Archive className="size-4" />} onClick={() => patch.mutate({ archived: true })}>{t('tasks.archive')}</Button>)}
          {a?.canDelete && <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>{t('common.delete')}</Button>}
        </div>
      )}
    >
      {q.isLoading || !task ? (
        <div className="space-y-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge group="priority" value={task.priority} />
            {task.visibility === 'CLIENT_VISIBLE' && <Badge tone="teal"><Eye className="size-3" />{label('taskVisibility', task.visibility)}</Badge>}
            {task.overdue && <Badge tone="red">{t('common.overdue')}</Badge>}
            {task.blocked && <Badge tone="red">{t('tasks.blocked')}</Badge>}
            {task.recurring && <Badge tone="violet"><Repeat className="size-3" />{label('recurrence', task.recurrence!.frequency)}</Badge>}
            {task.archivedAt && <Badge tone="neutral">{t('tasks.archived')}</Badge>}
            {task.deliverable && <Link to={`/deliverables/${task.deliverable.id}`} className="text-xs font-medium text-brand-700 hover:underline">{t('tasks.deliverableLink', { name: task.deliverable.name })}</Link>}
          </div>

          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'details', label: t('tasks.tab.details') }, { id: 'comments', label: t('tasks.tab.comments'), count: task.commentCount }, { id: 'activity', label: t('tasks.tab.activity') }]} />

          {tab === 'details' && (
            <div className="space-y-6">
              <TaskProperties task={task} onPatch={(b) => patch.mutate(b)} busy={patch.isPending} />
              <Field label={t('common.description')}>
                {() => (
                  <div className="space-y-2">
                    <Textarea value={desc} disabled={!a?.canWork} onChange={(e) => setDesc(e.target.value)} rows={4} />
                    {a?.canWork && desc !== (task.description ?? '') && <div className="flex justify-end"><Button size="sm" loading={patch.isPending} onClick={() => patch.mutate({ description: desc || null })}>{t('common.saveChanges')}</Button></div>}
                  </div>
                )}
              </Field>
              <TaskSubtasks task={task} onOpen={openTask} />
              <TaskChecklist task={task} />
              <TaskDependencies task={task} onOpen={openTask} />
              <TaskTime task={task} />
              <TaskAttachments task={task} />
            </div>
          )}
          {tab === 'comments' && <TaskComments task={task} />}
          {tab === 'activity' && <TaskActivity taskId={task.id} />}
        </div>
      )}

      {task && recurring && <RecurrenceModal task={task} onClose={() => setRecurring(false)} />}
      {task && saveTemplate && <SaveTemplateModal task={task} onClose={() => setSaveTemplate(false)} />}
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} title={t('work.task.deleteTitle')}
        message={task && task.subtaskCount > 0 ? t('tasks.deleteWithSubtasks', { title: task.title, n: task.subtaskCount }) : t('work.task.deleteMessage', { title: task?.title ?? '' })} confirmLabel={t('common.delete')} />
    </Drawer>
  );
}

function SaveTemplateModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(task.title);
  const save = useAction(() => api.post(`/task-templates/from-task/${task.id}`, { name }), { success: t('tasks.templateSaved'), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} size="sm" title={t('tasks.saveAsTemplate')} description={t('tasks.saveAsTemplateHint')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <Field label={t('common.name')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />}</Field>
    </Modal>
  );
}
