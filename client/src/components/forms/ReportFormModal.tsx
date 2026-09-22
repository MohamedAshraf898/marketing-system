import { useState } from 'react';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useCampaignOptions } from '@/components/shared/options';

const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => (s === '' ? 0 : Number(s));

/** Staff enter the raw numbers; CTR / CPC / CPM / ROAS are calculated by the server (preview only here). */
export function ReportFormModal({ open, onClose, defaultCampaignId }: { open: boolean; onClose: () => void; defaultCampaignId?: string }) {
  const { t, fmt } = useI18n();
  const { campaigns } = useCampaignOptions(undefined, open);
  const [f, setF] = useState({ campaignId: defaultCampaignId ?? '', date: today(), spend: '', reach: '', impressions: '', clicks: '', conversions: '', conversionValue: '', notes: '' });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = useAction(
    () =>
      api.post('/reports', {
        campaignId: f.campaignId, date: f.date, spend: num(f.spend), reach: Math.round(num(f.reach)), impressions: Math.round(num(f.impressions)),
        clicks: Math.round(num(f.clicks)), conversions: Math.round(num(f.conversions)), conversionValue: num(f.conversionValue), notes: f.notes || null,
      }),
    { success: t('report.created'), onSuccess: onClose },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  const spend = num(f.spend), impressions = num(f.impressions), clicks = num(f.clicks), value = num(f.conversionValue);
  const preview = [
    { label: t('metric.ctr'), v: impressions > 0 ? fmt.percent((clicks / impressions) * 100) : '—' },
    { label: t('metric.cpc'), v: clicks > 0 ? fmt.money(spend / clicks, { decimals: 2 }) : '—' },
    { label: t('metric.cpm'), v: impressions > 0 ? fmt.money((spend / impressions) * 1000, { decimals: 2 }) : '—' },
    { label: t('metric.roas'), v: spend > 0 ? fmt.ratio(value / spend) : '—' },
  ];
  const numInput = (k: keyof typeof f, label: string, step = '1') => (
    <Field label={label} error={err(k)}>
      {(id) => <Input id={id} type="number" inputMode="decimal" min="0" step={step} value={f[k]} onChange={(e) => set(k, e.target.value)} invalid={!!errs[k]} />}
    </Field>
  );

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={t('report.new')} description={t('report.newHint')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.campaignId || !f.date} className="max-sm:h-11">{t('report.save')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('nav.campaigns')} required error={err('campaignId')}>
          {(id) => (
            <Select id={id} value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)} invalid={!!errs.campaignId}>
              <option value="">{t('common.select')}</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.client ? `${c.client.companyName} · ${c.name}` : c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('report.date')} required error={err('date')}>{(id) => <Input id={id} type="date" max={today()} value={f.date} onChange={(e) => set('date', e.target.value)} invalid={!!errs.date} />}</Field>
        {numInput('spend', t('metric.spend'), 'any')}
        {numInput('reach', t('metric.reach'))}
        {numInput('impressions', t('metric.impressions'))}
        {numInput('clicks', t('metric.clicks'))}
        {numInput('conversions', t('metric.conversions'))}
        {numInput('conversionValue', t('metric.conversionValue'), 'any')}
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-zinc-50 p-4 sm:col-span-2 sm:grid-cols-4">
          {preview.map((p) => (
            <div key={p.label}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{p.label}</p>
              <p className="mt-0.5 text-[15px] font-semibold text-zinc-800 tabular">{p.v}</p>
            </div>
          ))}
          <p className="col-span-full text-xs text-zinc-500">{t('report.calculatedHint')}</p>
        </div>
        <Field label={t('common.notes')} hint={t('common.optional')} className="sm:col-span-2" error={err('notes')}>{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
