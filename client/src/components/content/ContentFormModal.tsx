import { useState } from 'react';
import { CONTENT_TYPES, SOCIAL_PLATFORMS } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { ContentItem } from '@/api/types.content';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useCampaignOptions, useClientOptions, useProjectOptions, useTeamMembers } from '@/components/shared/options';

/** A brand-new item may only start life as an idea or a draft; the rest of the workflow is system-controlled. */
const CREATE_STATUSES = ['IDEA', 'DRAFT'] as const;

const toInputDate = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

function init(item?: ContentItem, defaultClientId?: string) {
  return {
    title: item?.title ?? '',
    clientId: item?.clientId ?? defaultClientId ?? '',
    campaignId: item?.campaignId ?? '',
    projectId: item?.projectId ?? '',
    platform: item?.platform ?? 'INSTAGRAM',
    contentType: item?.contentType ?? 'POST',
    caption: item?.caption ?? '',
    status: item?.status ?? 'IDEA',
    publishDate: toInputDate(item?.publishDate),
    assignedToId: item?.assignedToId ?? '',
    notes: item?.notes ?? '',
  };
}

export function ContentFormModal({ open, onClose, item, defaultClientId }: { open: boolean; onClose: () => void; item?: ContentItem; defaultClientId?: string }) {
  const { t, label } = useI18n();
  const editing = !!item;
  const locked = !!item?.creativeLocked;
  const [f, setF] = useState(() => init(item, defaultClientId));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const { clients } = useClientOptions(open && !editing);
  const { campaigns } = useCampaignOptions(f.clientId || undefined, open && !!f.clientId);
  const { projects } = useProjectOptions(f.clientId || undefined, open && !!f.clientId);
  const members = useTeamMembers(f.clientId || undefined, open && !!f.clientId);

  const statusOptions: string[] = editing ? Array.from(new Set([item!.status, ...item!.allowedStatuses])) : [...CREATE_STATUSES];

  const save = useAction(
    () => {
      const body: Record<string, unknown> = editing
        ? {
            title: f.title, campaignId: f.campaignId || null, projectId: f.projectId || null, platform: f.platform, contentType: f.contentType,
            caption: f.caption || null, status: f.status, publishDate: f.publishDate || null, assignedToId: f.assignedToId || null, notes: f.notes || null,
          }
        : {
            title: f.title, clientId: f.clientId, campaignId: f.campaignId || null, projectId: f.projectId || null, platform: f.platform, contentType: f.contentType,
            caption: f.caption || null, status: f.status, publishDate: f.publishDate || null, assignedToId: f.assignedToId || null, notes: f.notes || null,
          };
      return editing ? api.patch(`/content/${item!.id}`, body) : api.post('/content', body);
    },
    { success: editing ? t('content.updated') : t('content.created'), onSuccess: onClose, silentError: false },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg"
      title={editing ? t('content.edit') : t('content.new')}
      description={locked ? t('content.lockedHint') : undefined}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.title || (!editing && !f.clientId)} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('content.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('content.titleField')} error={err('title')} required className="sm:col-span-2">
          {(id) => <Input id={id} value={f.title} maxLength={160} onChange={(e) => set('title', e.target.value)} disabled={locked} invalid={!!errs.title} />}
        </Field>
        <Field label={t('common.client')} error={err('clientId')} required>
          {(id) => (
            <Select id={id} value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('campaignId', ''); set('projectId', ''); set('assignedToId', ''); }} disabled={editing} invalid={!!errs.clientId}>
              <option value="">{t('common.select')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('content.platform')}>
          {(id) => <Select id={id} value={f.platform} onChange={(e) => set('platform', e.target.value as typeof f.platform)} disabled={locked}>{SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{label('socialPlatform', p)}</option>)}</Select>}
        </Field>
        <Field label={t('content.type')}>
          {(id) => <Select id={id} value={f.contentType} onChange={(e) => set('contentType', e.target.value as typeof f.contentType)} disabled={locked}>{CONTENT_TYPES.map((ty) => <option key={ty} value={ty}>{label('contentType', ty)}</option>)}</Select>}
        </Field>
        <Field label={t('common.status')} error={err('status')}>
          {(id) => (
            <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value as typeof f.status)}>
              {statusOptions.map((s) => <option key={s} value={s}>{label('contentStatus', s)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.campaign')} hint={t('common.optionalField')}>
          {(id) => (
            <Select id={id} value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)} disabled={!f.clientId}>
              <option value="">{t('content.noCampaign')}</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.project')} hint={t('common.optionalField')}>
          {(id) => (
            <Select id={id} value={f.projectId} onChange={(e) => set('projectId', e.target.value)} disabled={!f.clientId}>
              <option value="">{t('content.noProject')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.assignee')} hint={t('common.optionalField')}>
          {(id) => (
            <Select id={id} value={f.assignedToId} onChange={(e) => set('assignedToId', e.target.value)} disabled={!f.clientId}>
              <option value="">{t('common.unassigned')}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('content.publishDate')} hint={t('common.optionalField')}>
          {(id) => <Input id={id} type="date" value={f.publishDate} onChange={(e) => set('publishDate', e.target.value)} />}
        </Field>
        <Field label={t('content.caption')} className="sm:col-span-2" error={err('caption')} hint={t('content.captionHint')}>
          {(id) => <Textarea id={id} rows={4} value={f.caption} maxLength={5000} onChange={(e) => set('caption', e.target.value)} disabled={locked} invalid={!!errs.caption} />}
        </Field>
        <Field label={t('content.internalNotes')} className="sm:col-span-2" hint={t('common.internalOnly')}>
          {(id) => <Textarea id={id} rows={3} value={f.notes} maxLength={5000} onChange={(e) => set('notes', e.target.value)} />}
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
