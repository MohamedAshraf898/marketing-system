import { useState, type ReactNode } from 'react';
import { LifeBuoy } from 'lucide-react';
import { REQUEST_PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged, RequestRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { Pagination } from '@/components/ui/Pagination';
import { useClientOptions } from '@/components/shared/options';

export function RequestsPanel({ campaignId, toolbar }: { campaignId?: string; toolbar?: ReactNode }) {
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [type, setType] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const list = useApi<Paged<RequestRow>>('/requests', { q, status, priority, type, clientId, campaignId, page });
  const statusOptions = useEnumOptions('requestStatus', REQUEST_STATUSES);
  const priorityOptions = useEnumOptions('priority', REQUEST_PRIORITIES);
  const typeOptions = useEnumOptions('requestType', REQUEST_TYPES);
  const { clients } = useClientOptions(staff && !campaignId);
  const reset = () => setPage(1);

  return (
    <div>
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('request.search')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        <FilterSelect value={priority} onChange={(v) => { setPriority(v); reset(); }} allLabel={t('request.allPriorities')} options={priorityOptions} />
        <FilterSelect value={type} onChange={(v) => { setType(v); reset(); }} allLabel={t('request.allTypes')} options={typeOptions} />
        {staff && !campaignId && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        {toolbar && <div className="col-span-2 sm:ms-auto">{toolbar}</div>}
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState icon={LifeBuoy} title={t('request.empty')} description={search || status || priority || type || clientId ? t('common.noResultsHint') : staff ? t('request.emptyStaffHint') : t('request.emptyHint')} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(r) => r.id}
            href={(r) => `/requests/${r.id}`}
            columns={[
              { key: 'title', header: t('request.title'), primary: true, cell: (r) => <div><p className="font-medium text-zinc-900">{r.title}</p><p className="text-xs font-normal text-zinc-500">{[staff ? r.client?.companyName : null, r.campaign?.name].filter(Boolean).join(' · ') || label('requestType', r.type)}</p></div> },
              { key: 'type', header: t('request.type'), hideOnTablet: true, cell: (r) => label('requestType', r.type) },
              { key: 'priority', header: t('request.priority'), cell: (r) => <StatusBadge group="priority" value={r.priority} /> },
              { key: 'status', header: t('common.status'), cell: (r) => <StatusBadge group="requestStatus" value={r.status} /> },
              { key: 'assignee', header: t('request.assignedTo'), hideOnTablet: true, hideOnMobile: true, cell: (r) => r.assignedTo?.name ?? <span className="text-zinc-400">{t('request.unassigned')}</span> },
              { key: 'created', header: t('common.created'), hideOnTablet: true, cell: (r) => <span className="text-zinc-500">{fmt.date(r.createdAt)}</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
