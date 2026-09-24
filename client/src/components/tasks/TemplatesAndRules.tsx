import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, CUSTOM_FIELD_TYPES, PRIORITIES, TASK_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Automation, AutomationConfig, CustomField, SpaceTree, TaskTemplate } from '@/api/types.tasks';
import type { Task } from '@/api/types.work';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useClientOptions } from '@/components/shared/options';
import { useAssignable } from './taskUi';

/** Pick a template and where the new task goes. The created tasks go through the normal (scoped) create checks. */
export function ApplyTemplateModal({ listId, onClose, onCreated }: { listId?: string; onClose: () => void; onCreated?: (id: string) => void }) {
  const { t } = useI18n();
  const templates = useApi<{ items: TaskTemplate[] }>('/task-templates');
  const tree = useApi<SpaceTree>('/spaces/tree');
  const { clients } = useClientOptions();
  const [f, setF] = useState({ templateId: '', title: '', listId: listId ?? '', clientId: '', startDate: '', assigneeIds: [] as string[], assignSubtasks: false });
  const tpl = templates.data?.items.find((x) => x.id === f.templateId);
  const lists = (tree.data?.items ?? []).flatMap((s) => [...s.lists, ...s.folders.flatMap((x) => x.lists)].map((l) => ({ id: l.id, name: `${s.name} / ${l.name}`, fixed: !!s.clientId || !!l.projectId })));
  const listFixed = lists.find((l) => l.id === f.listId)?.fixed;
  const people = useAssignable(f.clientId || undefined);
  const save = useAction(() => api.post<{ item: Task }>(`/task-templates/${f.templateId}/apply`, {
    title: f.title || undefined, listId: f.listId || null, clientId: listFixed ? undefined : f.clientId || null, startDate: f.startDate || null,
    assigneeIds: f.assigneeIds, assignSubtasks: f.assignSubtasks,
  }), { success: t('tasks.templateApplied'), onSuccess: (r) => { onClose(); onCreated?.(r.item.id); } });
  const errs = fieldErrors(save.error);
  return (
    <Modal open onClose={onClose} size="lg" title={t('tasks.fromTemplate')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!f.templateId} loading={save.isPending} onClick={() => save.mutate(undefined)}>{t('tasks.createFromTemplate')}</Button></>}>
      {templates.data && templates.data.items.length === 0 ? <p className="text-sm text-zinc-500">{t('tasks.noTemplates')}</p> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('tasks.template')} required className="sm:col-span-2">{(id) => <Select id={id} value={f.templateId} onChange={(e) => setF((s) => ({ ...s, templateId: e.target.value }))}><option value="">—</option>{(templates.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          {tpl && <p className="text-xs text-zinc-500 sm:col-span-2">{t('tasks.templateCreates', { title: tpl.taskTitle, n: tpl.items.length })}: {tpl.items.map((i) => i.title).join(', ')}</p>}
          <Field label={t('work.task.title')} hint={t('common.optional')} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} placeholder={tpl?.taskTitle} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} maxLength={200} />}</Field>
          <Field label={t('tasks.list')} error={fieldText(t, errs.listId)}>{(id) => <Select id={id} value={f.listId} onChange={(e) => setF((s) => ({ ...s, listId: e.target.value }))}><option value="">{t('tasks.noList')}</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
          {!listFixed && <Field label={t('common.client')} error={fieldText(t, errs.clientId)}>{(id) => <Select id={id} value={f.clientId} onChange={(e) => setF((s) => ({ ...s, clientId: e.target.value, assigneeIds: [] }))}><option value="">{t('work.task.noClient')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select>}</Field>}
          <Field label={t('tasks.startDate')} hint={t('tasks.templateStartHint')}>{(id) => <Input id={id} type="date" value={f.startDate} onChange={(e) => setF((s) => ({ ...s, startDate: e.target.value }))} />}</Field>
          <Field label={t('tasks.assignees')} error={fieldText(t, errs.assigneeIds)}>{(id) => <Select id={id} value={f.assigneeIds[0] ?? ''} onChange={(e) => setF((s) => ({ ...s, assigneeIds: e.target.value ? [e.target.value] : [] }))}><option value="">{t('common.unassigned')}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
          <Checkbox className="sm:col-span-2" label={t('tasks.assignSubtasksToo')} checked={f.assignSubtasks} onChange={(e) => setF((s) => ({ ...s, assignSubtasks: e.target.checked }))} />
        </div>
      )}
    </Modal>
  );
}

export function TemplateEditor({ template, onClose }: { template?: TaskTemplate; onClose: () => void }) {
  const { t, label } = useI18n();
  const [f, setF] = useState({
    name: template?.name ?? '', description: template?.description ?? '', taskTitle: template?.taskTitle ?? '', taskDescription: template?.taskDescription ?? '',
    priority: template?.priority ?? 'NORMAL', estimatedHours: template?.estimatedHours?.toString() ?? '', checklist: (template?.checklist ?? []).join('\n'), tags: (template?.tags ?? []).join(', '),
    items: template?.items.map((i) => ({ title: i.title, dueOffsetDays: i.dueOffsetDays?.toString() ?? '', estimatedHours: i.estimatedHours?.toString() ?? '' })) ?? [{ title: '', dueOffsetDays: '', estimatedHours: '' }],
  });
  const body = () => ({
    name: f.name, description: f.description || null, taskTitle: f.taskTitle, taskDescription: f.taskDescription || null, priority: f.priority,
    estimatedHours: f.estimatedHours ? Number(f.estimatedHours) : null, checklist: f.checklist.split('\n').map((x) => x.trim()).filter(Boolean),
    tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean),
    items: f.items.filter((i) => i.title.trim()).map((i) => ({ title: i.title.trim(), dueOffsetDays: i.dueOffsetDays ? Number(i.dueOffsetDays) : null, estimatedHours: i.estimatedHours ? Number(i.estimatedHours) : null })),
  });
  const save = useAction(() => (template ? api.patch(`/task-templates/${template.id}`, body()) : api.post('/task-templates', body())), { success: t('tasks.templateSaved'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  const setItem = (i: number, patch: Partial<(typeof f.items)[number]>) => setF((s) => ({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <Modal open onClose={onClose} size="xl" title={template ? t('tasks.editTemplate') : t('tasks.newTemplate')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim() || !f.taskTitle.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('tasks.templateName')} required error={fieldText(t, errs.name)}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} maxLength={100} />}</Field>
        <Field label={t('tasks.parentTitle')} required error={fieldText(t, errs.taskTitle)}>{(id) => <Input id={id} value={f.taskTitle} onChange={(e) => setF((s) => ({ ...s, taskTitle: e.target.value }))} maxLength={200} />}</Field>
        <Field label={t('common.priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value as typeof f.priority }))}>{PRIORITIES.map((p) => <option key={p} value={p}>{label('priority', p)}</option>)}</Select>}</Field>
        <Field label={t('work.task.estimatedHours')}>{(id) => <Input id={id} type="number" min={0} step="0.25" value={f.estimatedHours} onChange={(e) => setF((s) => ({ ...s, estimatedHours: e.target.value }))} />}</Field>
        <Field label={t('common.description')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.taskDescription} onChange={(e) => setF((s) => ({ ...s, taskDescription: e.target.value }))} />}</Field>
        <Field label={t('tasks.templateChecklist')} hint={t('tasks.onePerLine')}>{(id) => <Textarea id={id} rows={4} value={f.checklist} onChange={(e) => setF((s) => ({ ...s, checklist: e.target.value }))} />}</Field>
        <Field label={t('tasks.tags')} hint={t('tasks.commaSeparated')}>{(id) => <Input id={id} value={f.tags} onChange={(e) => setF((s) => ({ ...s, tags: e.target.value }))} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium text-zinc-700">{t('tasks.subtasks')}</p>
          <ul className="space-y-2">
            {f.items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder={t('work.task.title')} className="min-w-48 flex-1" maxLength={200} />
                <Input type="number" min={0} value={it.dueOffsetDays} onChange={(e) => setItem(i, { dueOffsetDays: e.target.value })} placeholder={t('tasks.dueAfterDays')} className="w-32" aria-label={t('tasks.dueAfterDays')} />
                <Input type="number" min={0} step="0.25" value={it.estimatedHours} onChange={(e) => setItem(i, { estimatedHours: e.target.value })} placeholder={t('tasks.hoursShortLabel')} className="w-24" aria-label={t('work.task.estimatedHours')} />
                <IconButton label={t('common.delete')} className="size-9 hover:text-rose-600" onClick={() => setF((s) => ({ ...s, items: s.items.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setF((s) => ({ ...s, items: [...s.items, { title: '', dueOffsetDays: '', estimatedHours: '' }] }))}>{t('tasks.addSubtaskRow')}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function AutomationEditor({ rule, onClose }: { rule?: Automation; onClose: () => void }) {
  const { t, label } = useI18n();
  const tree = useApi<SpaceTree>('/spaces/tree');
  const people = useAssignable(undefined);
  const [f, setF] = useState({
    name: rule?.name ?? '', enabled: rule?.enabled ?? true, trigger: rule?.trigger ?? 'STATUS_CHANGED', triggerStatus: rule?.triggerStatus ?? 'DONE',
    action: rule?.action ?? 'NOTIFY_ASSIGNEES', spaceId: rule?.spaceId ?? '', listId: rule?.listId ?? '', config: (rule?.config ?? {}) as AutomationConfig,
  });
  const cfg = (patch: Partial<AutomationConfig>) => setF((s) => ({ ...s, config: { ...s.config, ...patch } }));
  const lists = (tree.data?.items ?? []).filter((s) => !f.spaceId || s.id === f.spaceId).flatMap((s) => [...s.lists, ...s.folders.flatMap((x) => x.lists)]);
  const body = () => ({
    name: f.name, enabled: f.enabled, trigger: f.trigger, triggerStatus: f.trigger === 'STATUS_CHANGED' ? f.triggerStatus || null : null, action: f.action,
    spaceId: f.spaceId || null, listId: f.listId || null, config: Object.fromEntries(Object.entries(f.config).filter(([, v]) => v !== '' && v !== undefined)),
  });
  const save = useAction(() => (rule ? api.patch(`/task-automations/${rule.id}`, body()) : api.post('/task-automations', body())), { success: t('tasks.ruleSaved'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  const needsUser = f.action === 'NOTIFY_USER' || f.action === 'ASSIGN_USER' || (f.action === 'CREATE_TASK' && f.config.assign === 'user');
  return (
    <Modal open onClose={onClose} size="lg" title={rule ? t('tasks.editRule') : t('tasks.newRule')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} required className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} maxLength={100} />}</Field>
        <Field label={t('tasks.when')}>{(id) => <Select id={id} value={f.trigger} onChange={(e) => setF((s) => ({ ...s, trigger: e.target.value as typeof f.trigger }))}>{AUTOMATION_TRIGGERS.map((x) => <option key={x} value={x}>{label('autoTrigger', x)}</option>)}</Select>}</Field>
        {f.trigger === 'STATUS_CHANGED' && <Field label={t('tasks.toStatus')} error={fieldText(t, errs.triggerStatus)}>{(id) => <Select id={id} value={f.triggerStatus ?? ''} onChange={(e) => setF((s) => ({ ...s, triggerStatus: e.target.value as typeof f.triggerStatus }))}><option value="">{t('tasks.anyStatus')}</option>{TASK_STATUSES.map((x) => <option key={x} value={x}>{label('taskStatus', x)}</option>)}</Select>}</Field>}
        <Field label={t('tasks.then')} className="sm:col-span-2" error={fieldText(t, errs.action)}>{(id) => <Select id={id} value={f.action} onChange={(e) => setF((s) => ({ ...s, action: e.target.value as typeof f.action }))}>{AUTOMATION_ACTIONS.map((x) => <option key={x} value={x}>{label('autoAction', x)}</option>)}</Select>}</Field>
        {f.action === 'SET_PRIORITY' && <Field label={t('common.priority')} error={fieldText(t, errs['config.priority'])}>{(id) => <Select id={id} value={f.config.priority ?? ''} onChange={(e) => cfg({ priority: (e.target.value || undefined) as AutomationConfig['priority'] })}><option value="">—</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label('priority', p)}</option>)}</Select>}</Field>}
        {f.action === 'CREATE_TASK' && (
          <>
            <Field label={t('tasks.newTaskTitle')} hint={t('tasks.titlePlaceholderHint')} className="sm:col-span-2">{(id) => <Input id={id} value={f.config.title ?? ''} placeholder="Publish: {title}" onChange={(e) => cfg({ title: e.target.value })} maxLength={200} />}</Field>
            <Field label={t('tasks.dueInDays')}>{(id) => <Input id={id} type="number" min={0} max={365} value={f.config.dueInDays ?? ''} onChange={(e) => cfg({ dueInDays: e.target.value === '' ? undefined : Number(e.target.value) })} />}</Field>
            <Field label={t('tasks.assignTo')}>{(id) => <Select id={id} value={f.config.assign ?? 'none'} onChange={(e) => cfg({ assign: e.target.value as AutomationConfig['assign'] })}><option value="none">{t('common.unassigned')}</option><option value="same">{t('tasks.sameAssignees')}</option><option value="user">{t('tasks.specificPerson')}</option></Select>}</Field>
            <Checkbox className="sm:col-span-2" label={t('tasks.createAsSubtask')} checked={!!f.config.asSubtask} onChange={(e) => cfg({ asSubtask: e.target.checked })} />
          </>
        )}
        {needsUser && <Field label={t('tasks.person')} error={fieldText(t, errs['config.userId'])}>{(id) => <Select id={id} value={f.config.userId ?? ''} onChange={(e) => cfg({ userId: e.target.value || undefined })}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>}
        {(f.action === 'NOTIFY_ASSIGNEES' || f.action === 'NOTIFY_USER') && <Field label={t('tasks.message')} hint={t('common.optional')} className="sm:col-span-2">{(id) => <Input id={id} value={f.config.message ?? ''} onChange={(e) => cfg({ message: e.target.value })} maxLength={200} />}</Field>}
        <Field label={t('tasks.onlyInSpace')}>{(id) => <Select id={id} value={f.spaceId} onChange={(e) => setF((s) => ({ ...s, spaceId: e.target.value, listId: '' }))}><option value="">{t('tasks.everywhere')}</option>{(tree.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
        <Field label={t('tasks.onlyInList')}>{(id) => <Select id={id} value={f.listId} onChange={(e) => setF((s) => ({ ...s, listId: e.target.value }))}><option value="">{t('tasks.anyList')}</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
        <Checkbox className="sm:col-span-2" label={t('tasks.ruleEnabled')} checked={f.enabled} onChange={(e) => setF((s) => ({ ...s, enabled: e.target.checked }))} />
      </div>
    </Modal>
  );
}

export function CustomFieldEditor({ field, onClose }: { field?: CustomField; onClose: () => void }) {
  const { t, label } = useI18n();
  const tree = useApi<SpaceTree>('/spaces/tree');
  const [f, setF] = useState({ name: field?.name ?? '', type: field?.type ?? 'TEXT', options: (field?.options ?? []).join('\n'), spaceId: field?.spaceId ?? '' });
  const options = f.options.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = useAction(() => (field
    ? api.patch(`/task-fields/${field.id}`, { name: f.name, ...(f.type === 'SELECT' ? { options } : {}) })
    : api.post('/task-fields', { name: f.name, type: f.type, spaceId: f.spaceId || null, ...(f.type === 'SELECT' ? { options } : {}) })), { success: t('tasks.saved'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  return (
    <Modal open onClose={onClose} size="sm" title={field ? t('tasks.editField') : t('tasks.newField')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('common.name')} required>{(id) => <Input id={id} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} maxLength={60} />}</Field>
        {!field && <Field label={t('tasks.fieldType')}>{(id) => <Select id={id} value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value as typeof f.type }))}>{CUSTOM_FIELD_TYPES.map((x) => <option key={x} value={x}>{label('fieldType', x)}</option>)}</Select>}</Field>}
        {f.type === 'SELECT' && <Field label={t('tasks.fieldOptions')} hint={t('tasks.onePerLine')} error={fieldText(t, errs.options)}>{(id) => <Textarea id={id} rows={4} value={f.options} onChange={(e) => setF((s) => ({ ...s, options: e.target.value }))} />}</Field>}
        {!field && <Field label={t('tasks.fieldSpace')} error={fieldText(t, errs.spaceId)}>{(id) => <Select id={id} value={f.spaceId} onChange={(e) => setF((s) => ({ ...s, spaceId: e.target.value }))}><option value="">{t('tasks.allSpaces')}</option>{(tree.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>}
      </div>
    </Modal>
  );
}
