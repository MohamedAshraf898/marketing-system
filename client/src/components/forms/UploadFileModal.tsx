import { useState } from 'react';
import { useAction } from '@/api/hooks';
import { uploadFile, type UploadTarget } from '@/api/upload';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { FilePicker } from '@/components/ui/FilePicker';
import { Checkbox, Field, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useCampaignOptions, useClientOptions } from '@/components/shared/options';

/** Upload for staff: to a client/campaign, or (when opened from a page) straight to a deliverable / request / project / task / content item. */
export function UploadFileModal({ open, onClose, target, title }: { open: boolean; onClose: () => void; target?: Pick<UploadTarget, 'deliverableId' | 'requestId' | 'campaignId' | 'clientId' | 'projectId' | 'taskId' | 'contentItemId'>; title?: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const fixed = !!(target?.deliverableId || target?.requestId || target?.projectId || target?.taskId || target?.contentItemId);
  const [file, setFile] = useState<File | null>(null);
  const [clientId, setClientId] = useState(target?.clientId ?? '');
  const [campaignId, setCampaignId] = useState(target?.campaignId ?? '');
  const [visible, setVisible] = useState(true);
  const { clients } = useClientOptions(open && !fixed && user?.role !== 'CLIENT');
  const { campaigns } = useCampaignOptions(clientId || undefined, open && !fixed && (!!clientId || !!target?.campaignId));

  const save = useAction(
    () => uploadFile(file!, fixed ? { deliverableId: target?.deliverableId, requestId: target?.requestId, projectId: target?.projectId, taskId: target?.taskId, contentItemId: target?.contentItemId } : { clientId: campaignId ? undefined : clientId, campaignId: campaignId || undefined, visibleToClient: visible }),
    { success: t('file.uploaded'), onSuccess: onClose },
  );
  const errs = fieldErrors(save.error);

  return (
    <Modal
      open={open} onClose={onClose} title={title ?? t('file.upload')} description={target?.deliverableId ? t('file.uploadDraftHint') : undefined}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!file || (!fixed && !clientId && !campaignId)} className="max-sm:h-11">{t('file.upload')}</Button></>}
    >
      <div className="space-y-4">
        {!fixed && (
          <>
            <Field label={t('client.title')} required error={fieldText(t, errs.clientId)}>
              {(id) => (
                <Select id={id} value={clientId} onChange={(e) => { setClientId(e.target.value); setCampaignId(''); }}>
                  <option value="">{t('common.select')}</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('file.campaign')} hint={t('common.optional')} error={fieldText(t, errs.campaignId)}>
              {(id) => (
                <Select id={id} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!clientId && !target?.campaignId}>
                  <option value="">{t('request.noCampaign')}</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </Field>
          </>
        )}
        <FilePicker file={file} onChange={setFile} />
        {!fixed && <Checkbox checked={visible} onChange={(e) => setVisible(e.target.checked)} label={t('file.visibleToClient')} />}
      </div>
    </Modal>
  );
}
