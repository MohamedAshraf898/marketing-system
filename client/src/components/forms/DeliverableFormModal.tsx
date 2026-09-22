import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DELIVERABLE_TYPES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useCampaignOptions, useClientOptions } from '@/components/shared/options';
import type { Deliverable } from '@/api/types';

export function DeliverableFormModal({ open, onClose, deliverable, defaultCampaignId, defaultClientId }: { open: boolean; onClose: () => void; deliverable?: Deliverable; defaultCampaignId?: string; defaultClientId?: string }) {
  const { t, label } = useI18n();
  const nav = useNavigate();
  const editing = !!deliverable;
  const [f, setF] = useState({
    name: deliverable?.name ?? '', type: deliverable?.type ?? 'DESIGN', clientId: deliverable?.clientId ?? defaultClientId ?? '',
    campaignId: deliverable?.campaignId ?? defaultCampaignId ?? '', description: deliverable?.description ?? '', previewUrl: deliverable?.previewUrl ?? '',
    dueDate: deliverable?.dueDate?.slice(0, 10) ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const { clients } = useClientOptions(open && !editing);
  const { campaigns } = useCampaignOptions(f.clientId || undefined, open && (editing || !!f.clientId || !!defaultCampaignId));

  const save = useAction(
    () => {
      const common = { name: f.name, type: f.type, description: f.description || null, previewUrl: f.previewUrl || null, dueDate: f.dueDate || null };
      return editing
        ? api.patch<{ item: { id: string } }>(`/deliverables/${deliverable!.id}`, common)
        : api.post<{ item: { id: string } }>('/deliverables', { ...common, clientId: f.clientId || undefined, campaignId: f.campaignId || null });
    },
    { success: editing ? t('deliverable.updated') : t('deliverable.created'), onSuccess: (res) => { onClose(); if (!editing) nav(`/deliverables/${res.item.id}`); } },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={editing ? t('deliverable.edit') : t('deliverable.new')} description={editing ? undefined : t('deliverable.newHint')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.name.trim() || (!editing && !f.clientId && !f.campaignId)} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('deliverable.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('deliverable.name')} required error={err('name')} className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} maxLength={160} />}</Field>
        {!editing && (
          <>
            <Field label={t('client.title')} required error={err('clientId')}>
              {(id) => (
                <Select id={id} value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('campaignId', ''); }} invalid={!!errs.clientId}>
                  <option value="">{t('common.select')}</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('deliverable.campaign')} error={err('campaignId')}>
              {(id) => (
                <Select id={id} value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)} disabled={!f.clientId && !defaultCampaignId} invalid={!!errs.campaignId}>
                  <option value="">{t('request.noCampaign')}</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </Field>
          </>
        )}
        <Field label={t('deliverable.type')}>{(id) => <Select id={id} value={f.type} onChange={(e) => set('type', e.target.value)}>{DELIVERABLE_TYPES.map((s) => <option key={s} value={s}>{label('deliverableType', s)}</option>)}</Select>}</Field>
        <Field label={t('deliverable.dueDate')} hint={t('common.optional')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}</Field>
        <Field label={t('deliverable.previewUrl')} hint={t('deliverable.previewUrlHint')} error={err('previewUrl')} className="sm:col-span-2">{(id) => <Input id={id} type="url" dir="ltr" value={f.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} placeholder="https://" invalid={!!errs.previewUrl} className="text-start" />}</Field>
        <Field label={t('common.description')} error={err('description')} className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={t('deliverable.descriptionPlaceholder')} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
