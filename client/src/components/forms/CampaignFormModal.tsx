import { useState } from 'react';
import { CAMPAIGN_STATUSES, OBJECTIVES, PLATFORMS } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { Campaign } from '@/api/types';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useClientOptions } from '@/components/shared/options';

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

export function CampaignFormModal({ open, onClose, campaign, defaultClientId }: { open: boolean; onClose: () => void; campaign?: Campaign; defaultClientId?: string }) {
  const { t, label } = useI18n();
  const editing = !!campaign;
  const { clients } = useClientOptions(open);
  const [f, setF] = useState(() => init(campaign, defaultClientId));
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = useAction(
    () => {
      const body = {
        name: f.name, platform: f.platform, objective: f.objective, status: f.status,
        startDate: f.startDate || null, endDate: f.endDate || null,
        budget: Number(f.budget || 0), description: f.description || null, campaignExternalId: f.campaignExternalId || null,
        ...(editing ? { spent: Number(f.spent || 0) } : { clientId: f.clientId }),
      };
      return editing ? api.patch(`/campaigns/${campaign!.id}`, body) : api.post('/campaigns', body);
    },
    { success: editing ? t('campaign.updated') : t('campaign.created'), onSuccess: onClose, silentError: false },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg"
      title={editing ? t('campaign.edit') : t('campaign.new')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.name || (!editing && !f.clientId)}>{editing ? t('common.saveChanges') : t('campaign.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('campaign.name')} error={err('name')} required className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} />}</Field>
        <Field label={t('client.title')} error={err('clientId')} required>
          {(id) => (
            <Select id={id} value={f.clientId} onChange={(e) => set('clientId', e.target.value)} disabled={editing} invalid={!!errs.clientId}>
              <option value="">{t('common.select')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('campaign.status')} error={err('status')}>{(id) => <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value)}>{CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{label('campaignStatus', s)}</option>)}</Select>}</Field>
        <Field label={t('campaign.platform')}>{(id) => <Select id={id} value={f.platform} onChange={(e) => set('platform', e.target.value)}>{PLATFORMS.map((s) => <option key={s} value={s}>{label('platform', s)}</option>)}</Select>}</Field>
        <Field label={t('campaign.objective')}>{(id) => <Select id={id} value={f.objective} onChange={(e) => set('objective', e.target.value)}>{OBJECTIVES.map((s) => <option key={s} value={s}>{label('objective', s)}</option>)}</Select>}</Field>
        <Field label={t('campaign.startDate')} error={err('startDate')}>{(id) => <Input id={id} type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />}</Field>
        <Field label={t('campaign.endDate')} error={err('endDate')}>{(id) => <Input id={id} type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} invalid={!!errs.endDate} />}</Field>
        <Field label={t('campaign.budget')} error={err('budget')}>{(id) => <Input id={id} type="number" inputMode="decimal" min="0" step="any" value={f.budget} onChange={(e) => set('budget', e.target.value)} />}</Field>
        {editing ? (
          <Field label={t('campaign.spent')} hint={t('campaign.spentHint')} error={err('spent')}>{(id) => <Input id={id} type="number" inputMode="decimal" min="0" step="any" value={f.spent} onChange={(e) => set('spent', e.target.value)} />}</Field>
        ) : (
          <Field label={t('campaign.externalId')} hint={t('campaign.externalIdHint')}>{(id) => <Input id={id} dir="ltr" value={f.campaignExternalId} onChange={(e) => set('campaignExternalId', e.target.value)} />}</Field>
        )}
        {editing && <Field label={t('campaign.externalId')} hint={t('campaign.externalIdHint')} className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" value={f.campaignExternalId} onChange={(e) => set('campaignExternalId', e.target.value)} />}</Field>}
        <Field label={t('common.description')} className="sm:col-span-2" error={err('description')}>{(id) => <Textarea id={id} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function init(c?: Campaign, clientId?: string) {
  return {
    name: c?.name ?? '', clientId: c?.clientId ?? clientId ?? '', platform: c?.platform ?? 'META', objective: c?.objective ?? 'SALES', status: c?.status ?? 'PLANNING',
    startDate: day(c?.startDate), endDate: day(c?.endDate), budget: c ? String(c.budget) : '', spent: c ? String(c.spent) : '0',
    description: c?.description ?? '', campaignExternalId: c?.campaignExternalId ?? '',
  };
}
