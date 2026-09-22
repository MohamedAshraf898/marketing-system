import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PRIORITIES, PROJECT_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { Project } from '@/api/types.work';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useClientOptions, useTeamMembers } from '@/components/shared/options';

/** Owner: Projects & tasks group. Create (clientId required) or edit (clientId locked) a project. */
export function ProjectFormModal({ open, onClose, project, defaultClientId }: { open: boolean; onClose: () => void; project?: Project; defaultClientId?: string }) {
  const { t, label } = useI18n();
  const nav = useNavigate();
  const editing = !!project;
  const [f, setF] = useState({
    clientId: project?.clientId ?? defaultClientId ?? '',
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'PLANNING',
    priority: project?.priority ?? 'NORMAL',
    startDate: project?.startDate?.slice(0, 10) ?? '',
    dueDate: project?.dueDate?.slice(0, 10) ?? '',
    projectManagerId: project?.projectManagerId ?? '',
    budget: project?.budget != null ? String(project.budget) : '',
    visibleToClient: project?.visibleToClient ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const { clients } = useClientOptions(open && !editing);
  const team = useTeamMembers(f.clientId || undefined, open && !!f.clientId);

  const save = useAction(
    () => {
      const common = {
        name: f.name, description: f.description || null, status: f.status, priority: f.priority,
        startDate: f.startDate || null, dueDate: f.dueDate || null,
        projectManagerId: f.projectManagerId || null,
        budget: f.budget !== '' ? Number(f.budget) : null,
        visibleToClient: f.visibleToClient,
      };
      return editing
        ? api.patch<{ item: Project }>(`/projects/${project!.id}`, common)
        : api.post<{ item: Project }>('/projects', { ...common, clientId: f.clientId });
    },
    { success: editing ? t('work.project.updated') : t('work.project.created'), onSuccess: (res) => { onClose(); if (!editing) nav(`/projects/${res.item.id}`); } },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={editing ? t('work.project.edit') : t('work.project.new')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.name.trim() || (!editing && !f.clientId)} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('work.project.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('work.project.name')} required error={err('name')} className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} maxLength={160} />}</Field>
        {!editing && (
          <Field label={t('common.client')} required error={err('clientId')}>
            {(id) => (
              <Select id={id} value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('projectManagerId', ''); }} invalid={!!errs.clientId}>
                <option value="">{t('common.select')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label={t('common.status')}>{(id) => <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value as typeof f.status)}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{label('projectStatus', s)}</option>)}</Select>}</Field>
        <Field label={t('common.priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => set('priority', e.target.value as typeof f.priority)}>{PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select>}</Field>
        <Field label={t('common.startDate')} hint={t('common.optional')}>{(id) => <Input id={id} type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />}</Field>
        <Field label={t('common.dueDate')} error={err('dueDate')} hint={t('common.optional')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} invalid={!!errs.dueDate} />}</Field>
        <Field label={t('work.project.manager')} error={err('projectManagerId')} hint={t('common.optional')}>
          {(id) => (
            <Select id={id} value={f.projectManagerId} onChange={(e) => set('projectManagerId', e.target.value)} disabled={!f.clientId} invalid={!!errs.projectManagerId}>
              <option value="">{t('common.unassigned')}</option>
              {team.filter((m) => m.role !== 'CLIENT').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('work.project.budget')} error={err('budget')} hint={t('common.optional')}>{(id) => <Input id={id} type="number" min={0} step="0.01" dir="ltr" value={f.budget} onChange={(e) => set('budget', e.target.value)} invalid={!!errs.budget} className="text-start" />}</Field>
        <div className="flex items-end pb-2.5"><Checkbox checked={f.visibleToClient} onChange={(e) => set('visibleToClient', e.target.checked)} label={t('work.project.visibleToClient')} /></div>
        <Field label={t('common.description')} error={err('description')} className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
