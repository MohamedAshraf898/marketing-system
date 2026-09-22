import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Download, ExternalLink, Pencil, Send, Trash2, Upload } from 'lucide-react';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import { isStaffContentItem, type ClientContentItem, type ContentItem } from '@/api/types.content';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { FileTypeIcon } from '@/components/shared/Media';
import { UploadFileModal } from '@/components/forms/UploadFileModal';
import { ContentFormModal } from './ContentFormModal';

export function ContentDetailDrawer({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const { t, fmt, label } = useI18n();
  const { user, can } = useAuth();
  const manage = can('content.manage');
  const canSend = manage && can('deliverables.create');
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'send' | 'upload' | null>(null);
  const q = useApi<{ item: ContentItem | ClientContentItem }>(open ? `/content/${id}` : null);
  const close = () => setDialog(null);

  const del = useAction(() => api.del(`/content/${id}`), { success: t('content.deleted'), onSuccess: () => { close(); onClose(); } });
  const send = useAction(() => api.post(`/content/${id}/send-for-approval`), { success: t('content.sentForApproval'), onSuccess: close });

  const item = q.data?.item;
  const isStaff = !!item && isStaffContentItem(item);
  const canDelete = isStaff && !item.deliverable?.submittedAt;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={item?.title ?? t('content.details')}
        width="lg"
        footer={
          isStaff && item ? (
            <>
              {manage && !item.creativeLocked && <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDialog('delete')} disabled={!canDelete} title={!canDelete ? t('content.hasHistoryHint') : undefined} className="max-sm:h-11 sm:me-auto">{t('common.delete')}</Button>}
              {manage && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setDialog('edit')} className="max-sm:h-11">{t('common.edit')}</Button>}
              {canSend && item.canSendForApproval && <Button variant="brand" icon={<Send className="size-4" />} onClick={() => setDialog('send')} className="max-sm:h-11">{t('content.sendForApproval')}</Button>}
            </>
          ) : undefined
        }
      >
        {q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !item ? (
          <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge group="contentStatus" value={item.status} />
              {item.deliverableId ? (
                <Link to={`/deliverables/${item.deliverableId}`}><StatusBadge group="approvalStatus" value={item.approvalStatus} className="cursor-pointer hover:ring-2 hover:ring-brand-200" /></Link>
              ) : (
                <StatusBadge group="approvalStatus" value={item.approvalStatus} />
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('content.platform')}</dt><dd className="mt-0.5 text-zinc-800">{label('socialPlatform', item.platform)}</dd></div>
              <div><dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('content.type')}</dt><dd className="mt-0.5 text-zinc-800">{label('contentType', item.contentType)}</dd></div>
              {isStaff && item.client && <div><dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('common.client')}</dt><dd className="mt-0.5"><Link to={`/clients/${item.client.id}`} className="text-brand-600 hover:text-brand-700">{item.client.companyName}</Link></dd></div>}
              {isStaff && item.campaign && <div><dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('common.campaign')}</dt><dd className="mt-0.5"><Link to={`/campaigns/${item.campaign.id}`} className="text-brand-600 hover:text-brand-700">{item.campaign.name}</Link></dd></div>}
              {isStaff && item.assignedTo && <div><dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('common.assignee')}</dt><dd className="mt-0.5 text-zinc-800">{item.assignedTo.name}</dd></div>}
              {item.publishDate && <div><dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('content.publishDate')}</dt><dd className="mt-0.5 inline-flex items-center gap-1.5 text-zinc-800"><CalendarClock className="size-3.5" />{fmt.date(item.publishDate)}</dd></div>}
            </dl>

            {item.caption && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">{t('content.caption')}</p>
                <p className="whitespace-pre-line rounded-xl bg-zinc-50 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-700">{item.caption}</p>
              </div>
            )}

            {isStaff && item.notes && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">{t('content.internalNotes')}</p>
                <p className="whitespace-pre-line rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-sm leading-relaxed text-zinc-600">{item.notes}</p>
              </div>
            )}

            {isStaff && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('content.files')}</p>
                  {manage && !item.creativeLocked && <Button variant="ghost" size="sm" icon={<Upload className="size-3.5" />} onClick={() => setDialog('upload')}>{t('file.upload')}</Button>}
                </div>
                {!item.files?.length ? (
                  <p className="text-sm text-zinc-400">{t('content.noFiles')}</p>
                ) : (
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {item.files.map((f) => (
                      <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"><FileTypeIcon mime={f.fileType} className="size-4" /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-900">{f.fileName}</p><p className="text-xs text-zinc-500">{fmt.bytes(f.size)}</p></div>
                        <a href={fileUrl(f.id)} aria-label={t('file.download')} title={t('file.download')} className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"><Download className="size-4" /></a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {isStaff && item.deliverableId && (
              <Link to={`/deliverables/${item.deliverableId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
                {t('content.openInReview')}<ExternalLink className="size-3.5" />
              </Link>
            )}
          </div>
        )}
      </Drawer>

      {isStaff && item && dialog === 'edit' && <ContentFormModal open onClose={close} item={item} />}
      {isStaff && item && dialog === 'upload' && <UploadFileModal open onClose={close} target={{ contentItemId: item.id }} title={t('file.upload')} />}
      <ConfirmDialog open={dialog === 'delete'} onClose={close} onConfirm={() => del.mutate(undefined)} loading={del.isPending} title={t('content.deleteTitle')} message={t('content.deleteMessage')} confirmLabel={t('common.delete')} />
      <ConfirmDialog open={dialog === 'send'} onClose={close} tone="primary" onConfirm={() => send.mutate(undefined)} loading={send.isPending} title={t('content.sendForApprovalTitle')} message={t('content.sendForApprovalMessage')} confirmLabel={t('content.sendForApproval')} />
    </>
  );
}
