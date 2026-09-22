import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileSignature, Paperclip, Plus } from 'lucide-react';
import { CONTRACT_STATUSES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { ContractRow } from '@/api/types.finance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/Badge';
import { useClientOptions } from '@/components/shared/options';
import { ContractDrawer } from '@/components/finance/ContractDrawer';
import { ContractFormModal } from '@/components/finance/ContractFormModal';
import { ExpiryHint, SharedBadge } from '@/components/finance/FinanceShared';

export function ContractsPage() {
  const { t, fmt } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const manage = can('contracts.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState(params.get('clientId') ?? '');
  const [expiring, setExpiring] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const openId = params.get('open');
  const q = useDebounced(search);
  const list = useApi<Paged<ContractRow>>('/contracts', { q, status, clientId, expiringWithinDays: expiring, sort, page });
  const { clients } = useClientOptions(staff);
  const statusOptions = useEnumOptions('contractStatus', CONTRACT_STATUSES);
  const reset = () => setPage(1);
  const filtered = !!(q || status || clientId || expiring);
  const openDrawer = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('open', id); else next.delete('open');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={t('nav.contracts')} subtitle={staff ? t('finance.contractsSubtitle') : t('finance.contractsSubtitleClient')}
        actions={staff && manage && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('finance.newContract')}</Button>}
      />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('finance.searchContracts')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        {staff && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        <FilterSelect value={expiring} onChange={(v) => { setExpiring(v); reset(); }} allLabel={t('finance.anyEndDate')} options={[30, 60, 90].map((n) => ({ value: String(n), label: t('finance.expiringIn', { n }) }))} />
        <FilterSelect value={sort} onChange={(v) => { setSort(v); reset(); }} allLabel={t('finance.sortNewest')} options={[{ value: 'endDate', label: t('finance.sortEnding') }, { value: '-value', label: t('finance.sortValue') }, { value: 'name', label: t('finance.sortName') }]} />
      </FilterBar>

      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState
          icon={FileSignature} title={t('finance.noContracts')}
          description={filtered ? t('common.noResultsHint') : staff ? (manage ? t('finance.noContractsHint') : t('finance.noContractsRestricted')) : t('finance.noContractsClient')}
          action={staff && manage && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('finance.newContract')}</Button> : undefined}
        />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(c) => c.id}
            onRowClick={(c) => openDrawer(c.id)}
            columns={[
              {
                key: 'name', header: t('finance.contract'), primary: true,
                cell: (c) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">{c.name}</p>
                    <p className="text-xs font-normal text-zinc-500"><span dir="ltr" className="tabular">{c.contractNumber}</span>{staff && c.client ? ` · ${c.client.companyName}` : ''}</p>
                  </div>
                ),
              },
              {
                key: 'status', header: t('common.status'),
                cell: (c) => <div className="flex flex-col items-start gap-1"><StatusBadge group="contractStatus" value={c.status} /><ExpiryHint status={c.status} endDate={c.endDate} /></div>,
              },
              { key: 'dates', header: t('finance.period'), hideOnTablet: true, cell: (c) => <span className="text-xs text-zinc-500">{c.startDate ? fmt.date(c.startDate) : '—'} → {c.endDate ? fmt.date(c.endDate) : '—'}</span> },
              { key: 'value', header: t('finance.contractValue'), align: 'end', cell: (c) => <span className="font-medium tabular text-zinc-900">{fmt.money(c.value)}</span> },
              ...(staff ? [
                { key: 'vis', header: t('finance.visibility'), hideOnMobile: true, hideOnTablet: true, cell: (c: ContractRow) => <SharedBadge shared={c.visibleToClient} /> },
                { key: 'files', header: <span className="sr-only">{t('finance.attachments')}</span>, hideOnMobile: true, hideOnTablet: true, align: 'end' as const, cell: (c: ContractRow) => (c.filesCount ? <span className="inline-flex items-center gap-1 text-xs text-zinc-500 tabular"><Paperclip className="size-3.5" />{c.filesCount}</span> : null) },
              ] : []),
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}

      <ContractDrawer id={openId} onClose={() => openDrawer(null)} />
      {creating && <ContractFormModal open onClose={() => setCreating(false)} defaultClientId={clientId || undefined} onSaved={(c) => openDrawer(c.id)} />}
    </div>
  );
}
