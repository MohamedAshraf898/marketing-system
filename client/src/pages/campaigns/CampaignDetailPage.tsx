import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { CAMPAIGN_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Campaign } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { StatusBadge } from '@/components/ui/Badge';
import { BudgetBar } from '@/components/shared/Media';
import { MetricTiles } from '@/components/shared/Metrics';
import { DeliverablesPanel } from '@/components/panels/DeliverablesPanel';
import { FilesPanel } from '@/components/panels/FilesPanel';
import { ReportsPanel } from '@/components/panels/LazyReportsPanel';
import { RequestsPanel } from '@/components/panels/RequestsPanel';
import { CampaignFormModal } from '@/components/forms/CampaignFormModal';
import { DeliverableFormModal } from '@/components/forms/DeliverableFormModal';
import { ReportFormModal } from '@/components/forms/ReportFormModal';
import { RequestFormModal } from '@/components/forms/RequestFormModal';
import { UploadFileModal } from '@/components/forms/UploadFileModal';

type Tab = 'overview' | 'deliverables' | 'reports' | 'files' | 'requests';
const TABS: Tab[] = ['overview', 'deliverables', 'reports', 'files', 'requests'];
type Modal = 'edit' | 'delete' | 'deliverable' | 'report' | 'upload' | 'request' | null;

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900">{children || '—'}</dd>
    </div>
  );
}

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<Modal>(null);
  const q = useApi<{ item: Campaign }>(`/campaigns/${id}`);
  const staff = user?.role !== 'CLIENT';
  const isAdmin = user?.role === 'ADMIN';
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview';
  const close = () => setModal(null);

  const setStatus = useAction((status: string) => api.patch(`/campaigns/${id}`, { status }), { success: t('campaign.updated') });
  const remove = useAction(() => api.del(`/campaigns/${id}`), { success: t('campaign.deleted'), onSuccess: () => nav('/campaigns', { replace: true }) });

  const back = <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"><ArrowLeft className="size-4 rtl:rotate-180" />{t('nav.campaigns')}</Link>;
  if (q.isError) return <div><div className="mb-4">{back}</div><ErrorState onRetry={() => void q.refetch()} message={t('common.notFoundHint')} /></div>;
  const c = q.data?.item;
  if (!c) return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-72 w-full" /></div>;

  const counts = c.counts;
  return (
    <div>
      <div className="mb-3">{back}</div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 sm:text-2xl">{c.name}</h1>
            <StatusBadge group="campaignStatus" value={c.status} />
          </div>
          <p className="mt-1.5 text-sm text-zinc-500">
            {staff && c.client && <Link to={`/clients/${c.client.id}`} className="font-medium text-zinc-700 hover:text-brand-700">{c.client.companyName}</Link>}
            {staff && c.client && ' · '}{label('platform', c.platform)} · {label('objective', c.objective)}
          </p>
        </div>
        {staff && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-52">
              <Select aria-label={t('campaign.status')} value={c.status} onChange={(e) => setStatus.mutate(e.target.value)} disabled={setStatus.isPending}>
                {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{label('campaignStatus', s)}</option>)}
              </Select>
            </div>
            {isAdmin && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setModal('edit')}>{t('common.edit')}</Button>}
            {isAdmin && <Button variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="size-4" />} onClick={() => setModal('delete')}>{t('common.delete')}</Button>}
          </div>
        )}
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}
        className="mb-6"
        tabs={[
          { id: 'overview', label: t('campaign.tabOverview') },
          { id: 'deliverables', label: t('nav.deliverables'), count: counts?.deliverables },
          { id: 'reports', label: t('nav.reports'), count: counts?.reports },
          { id: 'files', label: t('nav.files'), count: counts?.files },
          { id: 'requests', label: t('nav.requests'), count: counts?.requests },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-5">
          {c.metrics && (counts?.reports ?? 0) > 0 ? <MetricTiles m={c.metrics} /> : (
            <Card><CardBody className="text-sm text-zinc-500">{t('campaign.noReportsYet')}</CardBody></Card>
          )}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title={t('campaign.details')} />
              <CardBody>
                <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <Info label={t('campaign.platform')}>{label('platform', c.platform)}</Info>
                  <Info label={t('campaign.objective')}>{label('objective', c.objective)}</Info>
                  <Info label={t('campaign.startDate')}>{c.startDate ? fmt.date(c.startDate) : null}</Info>
                  <Info label={t('campaign.endDate')}>{c.endDate ? fmt.date(c.endDate) : null}</Info>
                  {staff && <Info label={t('campaign.externalId')}>{c.campaignExternalId ? <span dir="ltr" className="font-mono text-[13px]">{c.campaignExternalId}</span> : null}</Info>}
                </dl>
                {c.description && <p className="mt-6 whitespace-pre-line border-t border-line pt-5 text-sm leading-relaxed text-zinc-600">{c.description}</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('campaign.budgetSpent')} />
              <CardBody>
                <p className="text-2xl font-semibold tracking-tight text-zinc-900 tabular">{fmt.money(c.spent)}</p>
                <p className="mt-1 text-sm text-zinc-500 tabular">{t('campaign.ofBudget', { budget: fmt.money(c.budget) })}</p>
                <div className="mt-4"><BudgetBar spent={c.spent} budget={c.budget} /></div>
                <p className="mt-2 text-xs text-zinc-500 tabular">{c.budget > 0 ? t('campaign.percentUsed', { pct: fmt.number(Math.round((c.spent / c.budget) * 100)) }) : ''}</p>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === 'deliverables' && <DeliverablesPanel campaignId={id} toolbar={staff && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setModal('deliverable')}>{t('deliverable.new')}</Button>} />}
      {tab === 'reports' && <ReportsPanel campaignId={id} toolbar={staff && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setModal('report')}>{t('report.new')}</Button>} />}
      {tab === 'files' && <FilesPanel campaignId={id} toolbar={staff && <Button variant="brand" icon={<Upload className="size-4" />} onClick={() => setModal('upload')}>{t('file.upload')}</Button>} />}
      {tab === 'requests' && <RequestsPanel campaignId={id} toolbar={<Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setModal('request')}>{t('request.new')}</Button>} />}

      {modal === 'edit' && <CampaignFormModal open onClose={close} campaign={c} />}
      {modal === 'deliverable' && <DeliverableFormModal open onClose={close} defaultCampaignId={c.id} defaultClientId={c.clientId} />}
      {modal === 'report' && <ReportFormModal open onClose={close} defaultCampaignId={c.id} />}
      {modal === 'upload' && <UploadFileModal open onClose={close} target={{ campaignId: c.id, clientId: c.clientId }} />}
      {modal === 'request' && <RequestFormModal open onClose={close} defaultCampaignId={c.id} defaultClientId={c.clientId} />}
      <ConfirmDialog open={modal === 'delete'} onClose={close} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} title={t('campaign.deleteTitle')} message={t('campaign.deleteMessage', { name: c.name })} confirmLabel={t('common.delete')} />
    </div>
  );
}
