import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Paperclip, XCircle } from 'lucide-react';
import { REQUEST_PRIORITIES, REQUEST_STATUSES } from '@shared/enums';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { RequestRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Modal';
import { CommentsCard } from '@/components/shared/Comments';
import { FileTypeIcon } from '@/components/shared/Media';
import { useTeamMembers } from '@/components/shared/options';
import { UploadFileModal } from '@/components/forms/UploadFileModal';

const OPEN = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-end font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

export function RequestDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const q = useApi<{ item: RequestRow }>(`/requests/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const isClient = user?.role === 'CLIENT';
  const r = q.data?.item;
  const team = useTeamMembers(r?.clientId, !isClient && !!r);
  const patch = useAction((body: Record<string, unknown>) => api.patch(`/requests/${id}`, body), { success: t('request.updated'), onSuccess: () => setCancelling(false) });

  const back = <Link to="/requests" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"><ArrowLeft className="size-4 rtl:rotate-180" />{t('nav.requests')}</Link>;
  if (q.isError) return <div><div className="mb-4">{back}</div><ErrorState onRetry={() => void q.refetch()} message={t('common.notFoundHint')} /></div>;
  if (!r) return <div className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-72 w-full" /></div>;

  const open = OPEN.includes(r.status);
  const files = r.files ?? [];

  return (
    <div>
      <div className="mb-3">{back}</div>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 sm:text-2xl">{r.title}</h1>
          <StatusBadge group="requestStatus" value={r.status} />
          <StatusBadge group="priority" value={r.priority} />
        </div>
        <p className="mt-1.5 text-sm text-zinc-500">{[label('requestType', r.type), !isClient ? r.client?.companyName : null, r.user?.name, fmt.dateTime(r.createdAt)].filter(Boolean).join(' · ')}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title={t('common.description')} />
            <CardBody><p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">{r.description}</p></CardBody>
          </Card>

          <Card>
            <CardHeader title={t('request.attachments')} action={(isClient ? open : true) && <Button variant="secondary" size="sm" icon={<Paperclip className="size-4" />} onClick={() => setAttaching(true)}>{t('request.attach')}</Button>} />
            <CardBody>
              {files.length === 0 ? <p className="text-sm text-zinc-500">{t('request.noAttachments')}</p> : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-3.5 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"><FileTypeIcon mime={f.fileType} className="size-[18px]" /></span>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-900">{f.fileName}</p><p className="text-xs text-zinc-500">{fmt.bytes(f.size)} · {f.uploadedBy.name} · {fmt.date(f.createdAt)}</p></div>
                      <a href={fileUrl(f.id)} aria-label={t('file.download')} title={t('file.download')} className="inline-flex size-9 items-center justify-center rounded-xl text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"><Download className="size-[18px]" /></a>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <CommentsCard basePath={`/requests/${id}`} />
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title={t('request.details')} />
            <CardBody className="pt-2">
              {isClient ? (
                <dl className="divide-y divide-line">
                  <Row label={t('common.status')}><StatusBadge group="requestStatus" value={r.status} /></Row>
                  <Row label={t('request.priority')}><StatusBadge group="priority" value={r.priority} /></Row>
                  <Row label={t('request.type')}>{label('requestType', r.type)}</Row>
                  <Row label={t('request.campaign')}>{r.campaign ? <Link to={`/campaigns/${r.campaign.id}`} className="text-brand-600 hover:text-brand-700">{r.campaign.name}</Link> : '—'}</Row>
                  <Row label={t('request.assignedTo')}>{r.assignedTo?.name ?? t('request.unassigned')}</Row>
                  <Row label={t('request.dueDate')}>{r.dueDate ? fmt.date(r.dueDate) : '—'}</Row>
                  {r.completedAt && <Row label={t('request.completedAt')}>{fmt.date(r.completedAt)}</Row>}
                </dl>
              ) : (
                <div className="space-y-4 pt-2">
                  <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{t('common.status')}</span>
                    <Select value={r.status} disabled={patch.isPending} onChange={(e) => patch.mutate({ status: e.target.value })}>{REQUEST_STATUSES.map((s) => <option key={s} value={s}>{label('requestStatus', s)}</option>)}</Select></label>
                  <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{t('request.priority')}</span>
                    <Select value={r.priority} disabled={patch.isPending} onChange={(e) => patch.mutate({ priority: e.target.value })}>{REQUEST_PRIORITIES.map((s) => <option key={s} value={s}>{label('priority', s)}</option>)}</Select></label>
                  <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{t('request.assignedTo')}</span>
                    <Select value={r.assignedToId ?? ''} disabled={patch.isPending} onChange={(e) => patch.mutate({ assignedToId: e.target.value || null })}>
                      <option value="">{t('request.unassigned')}</option>
                      {r.assignedTo && !team.some((m) => m.id === r.assignedTo!.id) && <option value={r.assignedTo.id}>{r.assignedTo.name}</option>}
                      {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select></label>
                  <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{t('request.dueDate')}</span>
                    <Input type="date" defaultValue={r.dueDate?.slice(0, 10) ?? ''} disabled={patch.isPending} onBlur={(e) => { if ((e.target.value || null) !== (r.dueDate?.slice(0, 10) ?? null)) patch.mutate({ dueDate: e.target.value || null }); }} /></label>
                  <dl className="divide-y divide-line border-t border-line">
                    <Row label={t('request.campaign')}>{r.campaign ? <Link to={`/campaigns/${r.campaign.id}`} className="text-brand-600 hover:text-brand-700">{r.campaign.name}</Link> : '—'}</Row>
                    <Row label={t('client.title')}>{r.client ? <Link to={`/clients/${r.client.id}`} className="text-brand-600 hover:text-brand-700">{r.client.companyName}</Link> : '—'}</Row>
                    {r.completedAt && <Row label={t('request.completedAt')}>{fmt.date(r.completedAt)}</Row>}
                  </dl>
                </div>
              )}
            </CardBody>
          </Card>
          {isClient && open && (
            <Button variant="secondary" className="w-full border-rose-200 text-rose-700 hover:bg-rose-50" icon={<XCircle className="size-4" />} onClick={() => setCancelling(true)}>{t('request.cancel')}</Button>
          )}
        </div>
      </div>

      {attaching && <UploadFileModal open onClose={() => setAttaching(false)} target={{ requestId: r.id }} title={t('request.attach')} />}
      <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} onConfirm={() => patch.mutate({ status: 'CANCELLED' })} loading={patch.isPending} title={t('request.cancelTitle')} message={t('request.cancelMessage')} confirmLabel={t('request.cancelConfirm')} />
    </div>
  );
}
