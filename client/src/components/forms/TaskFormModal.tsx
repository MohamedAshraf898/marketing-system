import { useState } from 'react';
import { PRIORITIES, TASK_VISIBILITIES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { SpaceTree } from '@/api/types.tasks';
import type { Task } from '@/api/types.work';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useCampaignOptions, useClientOptions, useProjectOptions } from '@/components/shared/options';
import { PeoplePicker, TagInput, useAssignable } from '@/components/tasks/taskUi';

/**
 * Owner: Projects & tasks group. Create a task, optionally pre-linked to a list / client / project / parent task.
 * Links are only suggestions: the server derives the client from the list / project and refuses anything out of scope.
 */
export function TaskFormModal({ open, onClose, defaultClientId, defaultProjectId, defaultListId, defaultStatus, parentId, onCreated }: {
  open: boolean; onClose: () => void; defaultClientId?: string; defaultProjectId?: string; defaultListId?: string; defaultStatus?: string; parentId?: string; onCreated?: (task: Task) => void;
}) {
  const { t, label } = useI18n();
  const [f, setF] = useState({
    title: '', description: '', listId: defaultListId ?? '',
    clientId: defaultClientId ?? '', projectId: defaultProjectId ?? '', campaignId: '',
    assigneeIds: [] as string[], priority: 'NORMAL' as (typeof PRIORITIES)[number], startDate: '', dueDate: '', estimatedHours: '',
    visibility: 'INTERNAL' as (typeof TASK_VISIBILITIES)[number], tags: [] as string[],
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const tree = useApi<SpaceTree>(open && !parentId ? '/spaces/tree' : null);
  const lists = (tree.data?.items ?? []).flatMap((s) => [...s.lists, ...s.folders.flatMap((x) => x.lists)].map((l) => ({ ...l, label: `${s.name} / ${l.name}`, clientId: s.clientId })));
  const list = lists.find((l) => l.id === f.listId);
  const listFixesClient = !!list?.clientId || !!list?.projectId;
  const fixedProject = !!defaultProjectId || !!parentId || !!list?.projectId;
  const fixedClient = !!defaultClientId || !!parentId || listFixesClient;
  const clientForPeople = f.clientId || list?.clientId || undefined;
  const { clients } = useClientOptions(open && !fixedClient && !fixedProject);
  const { projects } = useProjectOptions(f.clientId || undefined, open && !fixedProject && !!f.clientId);
  const { campaigns } = useCampaignOptions(f.clientId || undefined, open && !!f.clientId && !parentId);
  const people = useAssignable(clientForPeople, open);

  const save = useAction(
    () => api.post<{ item: Task }>('/tasks', {
      title: f.title, description: f.description || null, parentId: parentId || undefined,
      listId: parentId ? undefined : f.listId || null,
      projectId: parentId || list?.projectId ? undefined : f.projectId || null,
      clientId: parentId || listFixesClient || f.projectId ? undefined : (f.clientId || null),
      campaignId: parentId ? undefined : f.campaignId || null,
      assigneeIds: f.assigneeIds, priority: f.priority, startDate: f.startDate || null, dueDate: f.dueDate || null,
      estimatedHours: f.estimatedHours !== '' ? Number(f.estimatedHours) : null, visibility: f.visibility, tags: f.tags,
      ...(defaultStatus ? { status: defaultStatus } : {}),
    }),
    { success: t('work.task.created'), onSuccess: (res) => { onClose(); onCreated?.(res.item); } },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={parentId ? t('tasks.newSubtask') : t('work.task.new')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.title.trim()} className="max-sm:h-11">{t('work.task.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('work.task.title')} required error={err('title')} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} onChange={(e) => set('title', e.target.value)} invalid={!!errs.title} maxLength={200} />}</Field>
        {!parentId && (
          <Field label={t('tasks.list')} hint={t('common.optional')} error={err('listId')} className="sm:col-span-2">
            {(id) => (
              <Select id={id} value={f.listId} onChange={(e) => { set('listId', e.target.value); set('assigneeIds', []); }} invalid={!!errs.listId}>
                <option value="">{t('tasks.noList')}</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </Select>
            )}
          </Field>
        )}
        {!fixedClient && !fixedProject && (
          <Field label={t('common.client')} hint={t('common.optional')} error={err('clientId')}>
            {(id) => (
              <Select id={id} value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('projectId', ''); set('campaignId', ''); set('assigneeIds', []); }} invalid={!!errs.clientId}>
                <option value="">{t('work.task.noClient')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
            )}
          </Field>
        )}
        {!fixedProject && (
          <Field label={t('common.project')} hint={t('common.optional')} error={err('projectId')}>
            {(id) => (
              <Select id={id} value={f.projectId} onChange={(e) => set('projectId', e.target.value)} disabled={!f.clientId} invalid={!!errs.projectId}>
                <option value="">{t('work.task.noProject')}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        {!parentId && (
          <Field label={t('common.campaign')} hint={t('common.optional')} error={err('campaignId')}>
            {(id) => (
              <Select id={id} value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)} disabled={!f.clientId} invalid={!!errs.campaignId}>
                <option value="">{t('request.noCampaign')}</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label={t('tasks.assignees')} hint={t('common.optional')} error={err('assigneeIds')} className="sm:col-span-2">{() => <PeoplePicker value={f.assigneeIds} people={people} onChange={(ids) => set('assigneeIds', ids)} />}</Field>
        <Field label={t('common.priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => set('priority', e.target.value as typeof f.priority)}>{PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select>}</Field>
        <Field label={t('tasks.visibility')} hint={t('tasks.visibilityHint')} error={err('visibility')}>{(id) => <Select id={id} value={f.visibility} onChange={(e) => set('visibility', e.target.value as typeof f.visibility)}>{TASK_VISIBILITIES.map((s) => <option key={s} value={s}>{label('taskVisibility', s)}</option>)}</Select>}</Field>
        <Field label={t('tasks.startDate')} hint={t('common.optional')} error={err('startDate')}>{(id) => <Input id={id} type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />}</Field>
        <Field label={t('common.dueDate')} error={err('dueDate')} hint={t('common.optional')}>{(id) => <Input id={id} type="date" value={f.dueDate} min={f.startDate || undefined} onChange={(e) => set('dueDate', e.target.value)} invalid={!!errs.dueDate} />}</Field>
        <Field label={t('work.task.estimatedHours')} error={err('estimatedHours')} hint={t('common.optional')}>{(id) => <Input id={id} type="number" min={0} step="0.25" dir="ltr" value={f.estimatedHours} onChange={(e) => set('estimatedHours', e.target.value)} invalid={!!errs.estimatedHours} className="text-start" />}</Field>
        <Field label={t('tasks.tags')} hint={t('common.optional')}>{() => <TagInput value={f.tags} onChange={(v) => set('tags', v)} />}</Field>
        <Field label={t('common.description')} error={err('description')} className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
