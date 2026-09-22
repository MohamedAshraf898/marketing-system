import { useState } from 'react';
import { ArrowRight, CalendarClock, ClipboardCheck } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Approval, Deliverable, Paged } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Tabs } from '@/components/ui/Tabs';
import { DeliverablePreview } from '@/components/shared/Media';
import { LinkButton } from '@/components/ui/Button';

type Tab = 'pending' | 'history';

function PendingList() {
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const isClient = user?.role === 'CLIENT';
  const [page, setPage] = useState(1);
  const list = useApi<Paged<Deliverable>>('/deliverables', { status: 'PENDING_APPROVAL', page, pageSize: 12 });
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  if (list.isLoading) return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>;
  if (!list.data?.items.length) return <EmptyState icon={ClipboardCheck} title={t('approvals.nonePending')} description={isClient ? t('approvals.nonePendingClient') : t('approvals.nonePendingStaff')} />;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {list.data.items.map((d) => (
          <div key={d.id} className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 shadow-card sm:flex-row sm:items-center">
            <DeliverablePreview fileId={d.previewFileId} previewUrl={d.previewUrl} name={d.name} className="aspect-[16/10] w-full shrink-0 rounded-xl sm:size-24 sm:aspect-square sm:w-24" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><p className="truncate text-[15px] font-semibold text-zinc-900">{d.name}</p><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 tabular">v{d.version}</span></div>
              <p className="mt-0.5 truncate text-[13px] text-zinc-500">{[!isClient ? d.client?.companyName : null, d.campaign?.name, label('deliverableType', d.type)].filter(Boolean).join(' · ')}</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-zinc-400"><CalendarClock className="size-3.5" />{d.submittedAt ? t('approvals.submittedAgo', { when: fmt.relative(d.submittedAt) }) : ''}</p>
            </div>
            <LinkButton to={`/deliverables/${d.id}`} variant={isClient ? 'brand' : 'secondary'} className="max-sm:h-11" icon={undefined}>{isClient ? t('approvals.review') : t('approvals.view')}<ArrowRight className="size-4 rtl:rotate-180" /></LinkButton>
          </div>
        ))}
      </div>
      <Pagination meta={list.data.meta} onPage={setPage} />
    </>
  );
}

function HistoryList() {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [decision, setDecision] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Paged<Approval>>('/approvals', { decision, page });
  return (
    <div>
      <FilterBar>
        <FilterSelect value={decision} onChange={(v) => { setDecision(v); setPage(1); }} allLabel={t('approvals.allDecisions')} options={[{ value: 'APPROVED', label: t('decision.APPROVED') }, { value: 'CHANGES_REQUESTED', label: t('decision.CHANGES_REQUESTED') }]} />
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState icon={ClipboardCheck} title={t('approvals.noHistory')} description={t('approvals.noHistoryHint')} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(a) => a.id}
            href={(a) => `/deliverables/${a.deliverableId}`}
            columns={[
              { key: 'name', header: t('deliverable.name'), primary: true, cell: (a) => <div><p className="font-medium text-zinc-900">{a.deliverable?.name}</p><p className="text-xs font-normal text-zinc-500">{[staff ? a.client?.companyName : null, a.deliverable?.campaign?.name].filter(Boolean).join(' · ')}</p></div> },
              { key: 'version', header: t('review.version'), cell: (a) => <span className="tabular">v{a.version}</span> },
              { key: 'decision', header: t('approvals.decision'), cell: (a) => <StatusBadge group="decision" value={a.decision} /> },
              { key: 'comment', header: t('approvals.comment'), hideOnTablet: true, hideOnMobile: true, cell: (a) => <span className="line-clamp-2 max-w-xs whitespace-normal text-zinc-600">{a.comment ?? '—'}</span> },
              { key: 'by', header: t('approvals.by'), hideOnTablet: true, cell: (a) => a.user.name },
              { key: 'date', header: t('common.date'), cell: (a) => <span className="text-zinc-500">{fmt.date(a.decidedAt ?? a.createdAt)}</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function ApprovalsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('pending');
  const count = useApi<Paged<Deliverable>>('/deliverables', { status: 'PENDING_APPROVAL', pageSize: 1 });
  return (
    <div>
      <PageHeader title={t('nav.approvals')} subtitle={t('approvals.subtitle')} />
      <Tabs<Tab> value={tab} onChange={setTab} className="mb-6" tabs={[{ id: 'pending', label: t('approvals.tabPending'), count: count.data?.meta.total }, { id: 'history', label: t('approvals.tabHistory') }]} />
      {tab === 'pending' ? <PendingList /> : <HistoryList />}
    </div>
  );
}
