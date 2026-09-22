import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { CLIENT_STATUSES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Client, Paged } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/Badge';
import { CompanyMark } from '@/components/shared/Media';
import { ClientFormModal } from '@/components/forms/ClientFormModal';

export function ClientsPage() {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const list = useApi<Paged<Client>>('/clients', { q, status, page });
  const statusOptions = useEnumOptions('clientStatus', CLIENT_STATUSES);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div>
      <PageHeader title={t('nav.clients')} subtitle={t('client.subtitle')} actions={isAdmin && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('client.new')}</Button>} />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('client.search')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} allLabel={t('common.allStatuses')} options={statusOptions} />
      </FilterBar>

      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState icon={Building2} title={t('client.empty')} description={q || status ? t('common.noResultsHint') : isAdmin ? t('client.emptyHint') : t('client.emptyTeamHint')} action={isAdmin && !q && !status ? <Button variant="brand" onClick={() => setCreating(true)}>{t('client.new')}</Button> : undefined} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(c) => c.id}
            href={(c) => `/clients/${c.id}`}
            leading={(c) => <CompanyMark clientId={c.id} name={c.companyName} hasLogo={c.hasLogo} />}
            columns={[
              { key: 'name', header: t('client.companyName'), primary: true, cell: (c) => <div><p className="font-medium text-zinc-900">{c.companyName}</p><p className="text-xs font-normal text-zinc-500">{c.name}</p></div> },
              { key: 'status', header: t('common.status'), cell: (c) => <StatusBadge group="clientStatus" value={c.status} /> },
              { key: 'campaigns', header: t('nav.campaigns'), cell: (c) => <span className="tabular">{fmt.number(c._count?.campaigns ?? 0)}</span> },
              { key: 'email', header: t('common.email'), hideOnTablet: true, hideOnMobile: true, cell: (c) => <span dir="ltr" className="text-zinc-600">{c.email}</span> },
              { key: 'created', header: t('common.created'), hideOnTablet: true, cell: (c) => <span className="text-zinc-500">{fmt.date(c.createdAt)}</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {creating && <ClientFormModal open onClose={() => setCreating(false)} onCreated={(id) => nav(`/clients/${id}`)} />}
    </div>
  );
}
