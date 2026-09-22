import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Palette } from 'lucide-react';
import { DELIVERABLE_STATUSES, DELIVERABLE_TYPES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Deliverable, Paged } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { Pagination } from '@/components/ui/Pagination';
import { DeliverablePreview } from '@/components/shared/Media';
import { useClientOptions } from '@/components/shared/options';

export function DeliverableCard({ d, showClient }: { d: Deliverable; showClient?: boolean }) {
  const { t, fmt, label } = useI18n();
  return (
    <Link to={`/deliverables/${d.id}`} className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <div className="relative">
        <DeliverablePreview fileId={d.previewFileId} previewUrl={d.previewUrl} name={d.name} className="aspect-[16/10] w-full" />
        <span className="absolute start-3 top-3"><StatusBadge group="deliverableStatus" value={d.status} className="bg-white/95 shadow-sm backdrop-blur" /></span>
        <span className="absolute end-3 top-3 rounded-full bg-zinc-900/80 px-2 py-0.5 text-[11px] font-semibold text-white tabular">v{d.version}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-zinc-900">{d.name}</p>
        <p className="mt-1 truncate text-[13px] text-zinc-500">{[showClient ? d.client?.companyName : null, d.campaign?.name].filter(Boolean).join(' · ') || label('deliverableType', d.type)}</p>
        <div className="mt-auto flex items-center justify-between pt-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><Palette className="size-3.5" />{label('deliverableType', d.type)}</span>
          {d.dueDate && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{t('common.due', { date: fmt.date(d.dueDate) })}</span>}
        </div>
      </div>
    </Link>
  );
}

export function DeliverablesPanel({ campaignId, toolbar, presetStatus }: { campaignId?: string; toolbar?: ReactNode; presetStatus?: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(presetStatus ?? '');
  const [type, setType] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const list = useApi<Paged<Deliverable>>('/deliverables', { q, status, type, clientId, campaignId, page, pageSize: 12 });
  const statusOptions = useEnumOptions('deliverableStatus', DELIVERABLE_STATUSES);
  const typeOptions = useEnumOptions('deliverableType', DELIVERABLE_TYPES);
  const { clients } = useClientOptions(staff && !campaignId);
  const reset = () => setPage(1);

  return (
    <div>
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('deliverable.search')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        <FilterSelect value={type} onChange={(v) => { setType(v); reset(); }} allLabel={t('deliverable.allTypes')} options={typeOptions} />
        {staff && !campaignId && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        {toolbar && <div className="col-span-2 sm:ms-auto">{toolbar}</div>}
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
      ) : !list.data?.items.length ? (
        <EmptyState icon={Palette} title={t('deliverable.empty')} description={search || status || type || clientId ? t('common.noResultsHint') : staff ? t('deliverable.emptyHint') : t('deliverable.emptyClientHint')} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.data.items.map((d) => <DeliverableCard key={d.id} d={d} showClient={staff && !campaignId} />)}</div>
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
