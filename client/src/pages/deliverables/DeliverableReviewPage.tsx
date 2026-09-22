import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, CheckCircle2, Download, ExternalLink, GitBranchPlus, Megaphone, Pencil, PencilLine, Rocket, Send, Upload } from 'lucide-react';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Approval, Deliverable, FileRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { CommentsCard } from '@/components/shared/Comments';
import { DeliverablePreview, FileTypeIcon } from '@/components/shared/Media';
import { DeliverableFormModal } from '@/components/forms/DeliverableFormModal';
import { UploadFileModal } from '@/components/forms/UploadFileModal';

type Dialog = 'approve' | 'changes' | 'submit' | 'newVersion' | 'publish' | 'edit' | 'upload' | null;

/** Approve (comment optional) or Request changes (comment required). */
function DecisionModal({ mode, deliverable, onClose }: { mode: 'approve' | 'changes'; deliverable: Deliverable; onClose: () => void }) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const approve = mode === 'approve';
  const save = useAction(
    () => api.post(`/deliverables/${deliverable.id}/${approve ? 'approve' : 'request-changes'}`, { comment: comment.trim() || undefined }),
    { success: approve ? t('review.approvedToast') : t('review.changesToast'), onSuccess: onClose },
  );
  const errs = fieldErrors(save.error);
  return (
    <Modal
      open onClose={onClose} size="md"
      title={approve ? t('review.approveTitle') : t('review.changesTitle')}
      description={t('review.decisionFor', { name: deliverable.name, version: deliverable.version })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button>
          <Button variant={approve ? 'success' : 'danger'} loading={save.isPending} onClick={() => save.mutate(undefined)} disabled={!approve && comment.trim().length < 3} className="max-sm:h-11">
            {approve ? t('review.approve') : t('review.sendChanges')}
          </Button>
        </>
      }
    >
      <Field label={approve ? t('review.commentOptional') : t('review.whatToChange')} required={!approve} error={fieldText(t, errs.comment)} hint={approve ? t('review.approveHint') : t('review.changesHint')}>
        {(id) => <Textarea id={id} rows={5} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder={approve ? t('review.approvePlaceholder') : t('review.changesPlaceholder')} invalid={!!errs.comment} />}
      </Field>
    </Modal>
  );
}

function Timeline({ items }: { items: Approval[] }) {
  const { t, fmt } = useI18n();
  if (items.length === 0) return <p className="text-sm text-zinc-500">{t('review.noHistory')}</p>;
  return (
    <ol className="relative space-y-5 ps-6 before:absolute before:inset-y-1 before:start-[7px] before:w-px before:bg-line">
      {items.map((a) => {
        const tone = a.decision === 'APPROVED' ? 'bg-emerald-500' : a.decision === 'CHANGES_REQUESTED' ? 'bg-rose-500' : 'bg-amber-400';
        const title = a.decision === 'PENDING' ? t('review.tlSubmitted') : a.decision === 'APPROVED' ? t('review.tlApproved') : t('review.tlChanges');
        return (
          <li key={a.id} className="relative">
            <span className={cx('absolute -start-6 top-1.5 size-[15px] rounded-full ring-4 ring-white', tone)} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold text-zinc-900">{title}</p>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 tabular">v{a.version}</span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">{a.user.name} · {fmt.dateTime(a.decidedAt ?? a.submittedAt ?? a.createdAt)}</p>
            {a.comment && <p className="mt-2 whitespace-pre-line rounded-xl bg-zinc-50 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-700">{a.comment}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function FilesByVersion({ files }: { files: FileRow[] }) {
  const { t, fmt } = useI18n();
  const versions = [...new Set(files.map((f) => f.version))].sort((a, b) => b - a);
  return (
    <div className="space-y-4">
      {versions.map((v) => (
        <div key={v}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{t('review.versionN', { n: v })}</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {files.filter((f) => f.version === v).map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3.5 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"><FileTypeIcon mime={f.fileType} className="size-[18px]" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-900">{f.fileName}</p><p className="text-xs text-zinc-500">{fmt.bytes(f.size)} · {fmt.date(f.createdAt)}</p></div>
                <a href={fileUrl(f.id)} aria-label={t('file.download')} title={t('file.download')} className="inline-flex size-9 items-center justify-center rounded-xl text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"><Download className="size-[18px]" /></a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DeliverableReviewPage() {
  const { id = '' } = useParams();
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const q = useApi<{ item: Deliverable }>(`/deliverables/${id}`);
  const history = useApi<{ items: Approval[] }>(`/deliverables/${id}/approvals`);
  const close = () => setDialog(null);
  const workflow = (path: string, success: string) => useAction(() => api.post(`/deliverables/${id}/${path}`), { success, onSuccess: close }); // eslint-disable-line react-hooks/rules-of-hooks
  const submit = workflow('submit', t('review.submittedToast'));
  const newVersion = workflow('new-version', t('review.newVersionToast'));
  const publish = workflow('publish', t('review.publishedToast'));

  const back = <Link to={user?.role === 'CLIENT' ? '/approvals' : '/deliverables'} className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"><ArrowLeft className="size-4 rtl:rotate-180" />{user?.role === 'CLIENT' ? t('nav.approvals') : t('nav.deliverables')}</Link>;
  if (q.isError) return <div><div className="mb-4">{back}</div><ErrorState onRetry={() => void q.refetch()} message={t('common.notFoundHint')} /></div>;
  const d = q.data?.item;
  if (!d) return <div className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-96 w-full" /></div>;

  const p = d.permissions;
  const staff = user?.role !== 'CLIENT';
  const canDecide = !!p?.canDecide;
  const files = d.files ?? [];
  const latestFeedback = d.status === 'CHANGES_REQUESTED' ? d.clientComment : null;

  return (
    <div className={canDecide ? 'pb-28 lg:pb-0' : ''}>
      <div className="mb-3">{back}</div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 sm:text-2xl">{d.name}</h1>
            <StatusBadge group="deliverableStatus" value={d.status} />
            <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white tabular">v{d.version}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
            <span>{label('deliverableType', d.type)}</span>
            {staff && d.client && <Link to={`/clients/${d.client.id}`} className="hover:text-brand-700">{d.client.companyName}</Link>}
            {d.campaign && <Link to={`/campaigns/${d.campaign.id}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Megaphone className="size-3.5" />{d.campaign.name}</Link>}
            {d.dueDate && <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" />{t('common.due', { date: fmt.date(d.dueDate) })}</span>}
          </div>
        </div>

        {staff && p && (
          <div className="flex flex-wrap gap-2">
            {p.canEdit && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setDialog('edit')}>{t('common.edit')}</Button>}
            {p.canUploadFiles && <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setDialog('upload')}>{t('file.upload')}</Button>}
            {p.canSubmit && <Button variant="brand" icon={<Send className="size-4" />} onClick={() => setDialog('submit')}>{t('review.submitForApproval')}</Button>}
            {p.canStartNewVersion && <Button variant="brand" icon={<GitBranchPlus className="size-4" />} onClick={() => setDialog('newVersion')}>{t('review.startNewVersion')}</Button>}
            {p.canPublish && <Button variant="primary" icon={<Rocket className="size-4" />} onClick={() => setDialog('publish')}>{t('review.markPublished')}</Button>}
          </div>
        )}
      </div>

      {latestFeedback && (
        <div className="mb-5 flex gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <PencilLine className="mt-0.5 size-5 shrink-0 text-rose-600" />
          <div><p className="text-sm font-semibold text-rose-900">{t('review.changesRequestedBanner')}</p><p className="mt-1 whitespace-pre-line text-sm text-rose-900/80">{latestFeedback}</p></div>
        </div>
      )}
      {d.status === 'DRAFT' && staff && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">{t('review.draftBanner')}</div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card className="overflow-hidden">
            <DeliverablePreview fileId={d.previewFileId} previewUrl={d.previewUrl} name={d.name} large className="max-h-[34rem] min-h-56 w-full sm:min-h-80" />
            {d.previewUrl && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                <p className="truncate text-xs text-zinc-500" dir="ltr">{d.previewUrl}</p>
                <a href={d.previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:text-brand-700">{t('review.openPreview')}<ExternalLink className="size-3.5" /></a>
              </div>
            )}
          </Card>

          {(d.description || files.length > 0) && (
            <Card>
              {d.description && (<><CardHeader title={t('common.description')} /><CardBody><p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">{d.description}</p></CardBody></>)}
              {files.length > 0 && (<><CardHeader title={t('review.files')} className={d.description ? 'border-t border-line pt-5' : ''} /><CardBody><FilesByVersion files={files} /></CardBody></>)}
            </Card>
          )}

          <CommentsCard basePath={`/deliverables/${id}`} />
        </div>

        <div className="min-w-0 space-y-5">
          {canDecide && (
            <Card className="hidden border-brand-200 bg-brand-50/40 lg:block">
              <CardHeader title={t('review.yourDecision')} subtitle={t('review.yourDecisionHint')} />
              <CardBody className="grid gap-2.5">
                <Button variant="success" size="lg" icon={<CheckCircle2 className="size-5" />} onClick={() => setDialog('approve')}>{t('review.approve')}</Button>
                <Button variant="secondary" size="lg" icon={<PencilLine className="size-5" />} onClick={() => setDialog('changes')} className="border-rose-200 text-rose-700 hover:bg-rose-50">{t('review.requestChanges')}</Button>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title={t('review.history')} subtitle={t('review.historyHint')} />
            <CardBody>{history.isLoading ? <Skeleton className="h-24 w-full" /> : <Timeline items={history.data?.items ?? []} />}</CardBody>
          </Card>
        </div>
      </div>

      {canDecide && (
        <div className="fixed inset-x-0 bottom-[4.25rem] z-30 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.18)] backdrop-blur lg:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-2.5">
            <Button variant="secondary" className="h-12 border-rose-200 text-rose-700" onClick={() => setDialog('changes')}>{t('review.requestChanges')}</Button>
            <Button variant="success" className="h-12" onClick={() => setDialog('approve')}>{t('review.approve')}</Button>
          </div>
        </div>
      )}

      {(dialog === 'approve' || dialog === 'changes') && <DecisionModal mode={dialog} deliverable={d} onClose={close} />}
      {dialog === 'edit' && <DeliverableFormModal open onClose={close} deliverable={d} />}
      {dialog === 'upload' && <UploadFileModal open onClose={close} target={{ deliverableId: d.id }} title={t('review.uploadForVersion', { n: d.version })} />}
      <ConfirmDialog open={dialog === 'submit'} onClose={close} tone="primary" onConfirm={() => submit.mutate(undefined)} loading={submit.isPending} title={t('review.submitTitle')} message={t('review.submitMessage', { version: d.version })} confirmLabel={t('review.submitForApproval')} />
      <ConfirmDialog open={dialog === 'newVersion'} onClose={close} tone="primary" onConfirm={() => newVersion.mutate(undefined)} loading={newVersion.isPending} title={t('review.newVersionTitle')} message={t('review.newVersionMessage', { version: d.version + 1 })} confirmLabel={t('review.startNewVersion')} />
      <ConfirmDialog open={dialog === 'publish'} onClose={close} tone="primary" onConfirm={() => publish.mutate(undefined)} loading={publish.isPending} title={t('review.publishTitle')} message={t('review.publishMessage')} confirmLabel={t('review.markPublished')} />
    </div>
  );
}
