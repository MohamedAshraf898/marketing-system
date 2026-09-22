import { useState } from 'react';
import { PRIORITIES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { Task } from '@/api/types.work';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useCampaignOptions, useClientOptions, useProjectOptions, useTeamMembers } from '@/components/shared/options';

/** Owner: Projects & tasks group. Create a task, optionally pre-linked to a client / project / campaign. */
export function TaskFormModal({ open, onClose, defaultClientId, defaultProjectId, onCreated }: {
  open: boolean; onClose: () => void; defaultClientId?: string; defaultProjectId?: string; onCreated?: (task: Task) => void;
}) {
  const { t, label } = useI18n();
  const [f, setF] = useState({
    title: '', description: '',
    clientId: defaultClientId ?? '', projectId: defaultProjectId ?? '', campaignId: '',
    assignedToId: '', priority: 'NORMAL' as (typeof PRIORITIES)[number], dueDate: '', estimatedHours: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const fixedProject = !!defaultProjectId;
  const fixedClient = !!defaultClientId;
  const { clients } = useClientOptions(open && !fixedClient && !fixedProject);
  const { projects } = useProjectOptions(f.clientId || undefined, open && !fixedProject && !!f.clientId);
  const { campaigns } = useCampaignOptions(f.clientId || undefined, open && !!f.clientId);
  const team = useTeamMembers(f.clientId || undefined, open);

  const save = useAction(
    () => api.post<{ item: Task }>('/tasks', {
      title: f.title, description: f.description || null,
      projectId: f.projectId || null, clientId: f.projectId ? undefined : (f.clientId || null), campaignId: f.campaignId || null,
      assignedToId: f.assignedToId || null, priority: f.priority, dueDate: f.dueDate || null,
      estimatedHours: f.estimatedHours !== '' ? Number(f.estimatedHours) : null,
    }),
    { success: t('work.task.created'), onSuccess: (res) => { onClose(); onCreated?.(res.item); } },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={t('work.task.new')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.title.trim()} className="max-sm:h-11">{t('work.task.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('work.task.title')} required error={err('title')} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} onChange={(e) => set('title', e.target.value)} invalid={!!errs.title} maxLength={200} />}</Field>
        {!fixedClient && !fixedProject && (
          <Field label={t('common.client')} hint={t('common.optional')} error={err('clientId')}>
            {(id) => (
              <Select id={id} value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('projectId', ''); set('campaignId', ''); set('assignedToId', ''); }}>
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
        <Field label={t('common.campaign')} hint={t('common.optional')} error={err('campaignId')}>
          {(id) => (
            <Select id={id} value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)} disabled={!f.clientId} invalid={!!errs.campaignId}>
              <option value="">{t('request.noCampaign')}</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.assignee')} hint={t('common.optional')} error={err('assignedToId')}>
          {(id) => (
            <Select id={id} value={f.assignedToId} onChange={(e) => set('assignedToId', e.target.value)} invalid={!!errs.assignedToId}>
              <option value="">{t('common.unassigned')}</option>
              {team.filter((m) => m.role !== 'CLIENT').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => set('priority', e.target.value as typeof f.priority)}>{PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select>}</Field>
        <Field label={t('common.dueDate')} error={err('dueDate')} hint={t('common.optional')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} invalid={!!errs.dueDate} />}</Field>
        <Field label={t('work.task.estimatedHours')} error={err('estimatedHours')} hint={t('common.optional')}>{(id) => <Input id={id} type="number" min={0} step="0.25" dir="ltr" value={f.estimatedHours} onChange={(e) => set('estimatedHours', e.target.value)} invalid={!!errs.estimatedHours} className="text-start" />}</Field>
        <Field label={t('common.description')} error={err('description')} className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
