import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REQUEST_PRIORITIES, REQUEST_TYPES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import { uploadFile } from '@/api/upload';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { FilePicker } from '@/components/ui/FilePicker';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useCampaignOptions, useClientOptions, useTeamMembers } from '@/components/shared/options';

export function RequestFormModal({ open, onClose, defaultCampaignId, defaultClientId }: { open: boolean; onClose: () => void; defaultCampaignId?: string; defaultClientId?: string }) {
  const { t, label } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const isClient = user?.role === 'CLIENT';
  const [f, setF] = useState({ title: '', type: 'DESIGN', clientId: defaultClientId ?? '', campaignId: defaultCampaignId ?? '', description: '', priority: 'NORMAL', assignedToId: '', dueDate: '' });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const { clients } = useClientOptions(open && !isClient);
  const { campaigns } = useCampaignOptions(isClient ? undefined : f.clientId || undefined, open && (isClient || !!f.clientId));
  const team = useTeamMembers(f.clientId || undefined, open && !isClient);

  const save = useAction(
    async () => {
      const body: Record<string, unknown> = { title: f.title, type: f.type, description: f.description, priority: f.priority, campaignId: f.campaignId || null };
      if (!isClient) Object.assign(body, { clientId: f.clientId || undefined, assignedToId: f.assignedToId || null, dueDate: f.dueDate || null });
      const res = await api.post<{ item: { id: string } }>('/requests', body);
      if (file) {
        try { await uploadFile(file, { requestId: res.item.id }); }
        catch { toast.error(t('request.attachmentFailed')); }
      }
      return res;
    },
    { success: t('request.created'), onSuccess: (res) => { onClose(); nav(`/requests/${res.item.id}`); } },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={t('request.new')} description={isClient ? t('request.newHint') : undefined}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={f.title.trim().length < 3 || f.description.trim().length < 3 || (!isClient && !f.clientId && !f.campaignId)} className="max-sm:h-11">{t('request.submit')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('request.title')} required error={err('title')} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} onChange={(e) => set('title', e.target.value)} invalid={!!errs.title} maxLength={160} />}</Field>
        {!isClient && (
          <Field label={t('client.title')} required error={err('clientId')}>
            {(id) => (
              <Select id={id} value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('campaignId', ''); set('assignedToId', ''); }}>
                <option value="">{t('common.select')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label={t('request.type')}>{(id) => <Select id={id} value={f.type} onChange={(e) => set('type', e.target.value)}>{REQUEST_TYPES.map((s) => <option key={s} value={s}>{label('requestType', s)}</option>)}</Select>}</Field>
        <Field label={t('request.campaign')} hint={t('common.optional')} error={err('campaignId')}>
          {(id) => (
            <Select id={id} value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)}>
              <option value="">{t('request.noCampaign')}</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('request.priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => set('priority', e.target.value)}>{REQUEST_PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select>}</Field>
        {!isClient && (
          <>
            <Field label={t('request.assignedTo')} hint={t('common.optional')} error={err('assignedToId')}>
              {(id) => (
                <Select id={id} value={f.assignedToId} onChange={(e) => set('assignedToId', e.target.value)}>
                  <option value="">{t('request.unassigned')}</option>
                  {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('request.dueDate')} hint={t('common.optional')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}</Field>
          </>
        )}
        <Field label={t('common.description')} required error={err('description')} className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} onChange={(e) => set('description', e.target.value)} invalid={!!errs.description} placeholder={t('request.descriptionPlaceholder')} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium text-zinc-700">{t('request.attachment')} <span className="font-normal text-zinc-400">· {t('common.optional')}</span></p>
          <FilePicker file={file} onChange={setFile} />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
