import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { CLIENT_STATUSES, CLIENT_TYPES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { ClientListItem } from '@/api/types.crm';
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
import { useTeamMembers } from '@/components/shared/options';
import { ClientFormModal } from '@/components/forms/ClientFormModal';

export function ClientsPage() {
  const { t, fmt, label } = useI18n();
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [manager, setManager] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const staff = user?.role !== 'CLIENT';
  const canCreate = can('clients.create');
  const list = useApi<Paged<ClientListItem>>('/clients', { q, status, clientType: type, accountManagerId: manager, page });
  const statusOptions = useEnumOptions('clientStatus', CLIENT_STATUSES);
  const typeOptions = useEnumOptions('clientType', CLIENT_TYPES);
  const team = useTeamMembers(undefined, staff);
  const filtered = !!(q || status || type || manager);
  const reset = () => setPage(1);

  return (
    <div>
      <PageHeader title={t('nav.clients')} subtitle={t('client.subtitle')} actions={canCreate && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('client.new')}</Button>} />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('crm.list.search')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        <FilterSelect value={type} onChange={(v) => { setType(v); reset(); }} allLabel={t('crm.list.allTypes')} options={typeOptions} />
        <FilterSelect value={manager} onChange={(v) => { setManager(v); reset(); }} allLabel={t('crm.list.allManagers')} options={team.map((m) => ({ value: m.id, label: m.name }))} />
      </FilterBar>

      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState icon={Building2} title={t('client.empty')} description={filtered ? t('common.noResultsHint') : canCreate ? t('client.emptyHint') : t('client.emptyTeamHint')} action={canCreate && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('client.new')}</Button> : undefined} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(c) => c.id}
            href={(c) => `/clients/${c.id}`}
            leading={(c) => <CompanyMark clientId={c.id} name={c.companyName} hasLogo={c.hasLogo} />}
            columns={[
              {
                key: 'name', header: t('client.companyName'), primary: true,
                cell: (c) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">{c.companyName}</p>
                    <p className="truncate text-xs font-normal text-zinc-500">{c.primaryContact?.name ?? c.name}{c.industry ? ` · ${c.industry}` : ''}</p>
                    {!!c.tags?.length && <p className="mt-1 hidden flex-wrap gap-1 md:flex">{c.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{tag}</span>)}</p>}
                  </div>
                ),
              },
              { key: 'status', header: t('common.status'), cell: (c) => <StatusBadge group="clientStatus" value={c.status} /> },
              ...(staff ? [
                { key: 'type', header: t('crm.field.clientType'), hideOnTablet: true, cell: (c: ClientListItem) => label('clientType', c.clientType) },
                { key: 'manager', header: t('crm.field.accountManager'), hideOnTablet: true, cell: (c: ClientListItem) => c.accountManager?.name ?? <span className="text-zinc-400">{t('common.unassigned')}</span> },
                { key: 'onboarding', header: t('nav.onboarding'), hideOnTablet: true, hideOnMobile: true, cell: (c: ClientListItem) => (c.onboardingStatus && c.onboardingStatus !== 'NOT_STARTED' ? <StatusBadge group="onboardingStatus" value={c.onboardingStatus} /> : <span className="text-zinc-400">—</span>) },
              ] : []),
              { key: 'campaigns', header: t('nav.campaigns'), cell: (c) => <span className="tabular">{fmt.number(c._count?.campaigns ?? 0)}</span> },
              { key: 'email', header: t('common.email'), hideOnTablet: true, hideOnMobile: true, cell: (c) => <span dir="ltr" className="text-zinc-600">{c.email}</span> },
              { key: 'created', header: t('common.created'), hideOnTablet: true, hideOnMobile: true, cell: (c) => <span className="text-zinc-500">{fmt.date(c.createdAt)}</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {creating && <ClientFormModal open onClose={() => setCreating(false)} onCreated={(id) => nav(`/clients/${id}`)} />}
    </div>
  );
}
