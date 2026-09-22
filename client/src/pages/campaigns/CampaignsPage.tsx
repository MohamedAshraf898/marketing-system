import { useState } from 'react';
import { FolderKanban, Plus } from 'lucide-react';
import { CAMPAIGN_STATUSES, OBJECTIVES, PLATFORMS } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Campaign, Paged } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/Badge';
import { BudgetBar } from '@/components/shared/Media';
import { useClientOptions } from '@/components/shared/options';
import { CampaignFormModal } from '@/components/forms/CampaignFormModal';

export function CampaignsPage() {
  const { t, fmt, label } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const isAdmin = user?.role === 'ADMIN';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [objective, setObjective] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const list = useApi<Paged<Campaign>>('/campaigns', { q, status, platform, objective, clientId, page });
  const { clients } = useClientOptions(staff);
  const statusOptions = useEnumOptions('campaignStatus', CAMPAIGN_STATUSES);
  const platformOptions = useEnumOptions('platform', PLATFORMS);
  const objectiveOptions = useEnumOptions('objective', OBJECTIVES);
  const reset = () => setPage(1);
  const filtered = !!(q || status || platform || objective || clientId);

  return (
    <div>
      <PageHeader title={t('nav.campaigns')} subtitle={t('campaign.subtitle')} actions={isAdmin && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('campaign.new')}</Button>} />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('campaign.search')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        <FilterSelect value={platform} onChange={(v) => { setPlatform(v); reset(); }} allLabel={t('campaign.allPlatforms')} options={platformOptions} />
        <FilterSelect value={objective} onChange={(v) => { setObjective(v); reset(); }} allLabel={t('campaign.allObjectives')} options={objectiveOptions} />
        {staff && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState icon={FolderKanban} title={t('campaign.empty')} description={filtered ? t('common.noResultsHint') : isAdmin ? t('campaign.emptyHint') : t('campaign.emptyRestrictedHint')} action={isAdmin && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('campaign.new')}</Button> : undefined} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(c) => c.id}
            href={(c) => `/campaigns/${c.id}`}
            columns={[
              { key: 'name', header: t('campaign.name'), primary: true, cell: (c) => <div><p className="font-medium text-zinc-900">{c.name}</p>{staff && <p className="text-xs font-normal text-zinc-500">{c.client?.companyName}</p>}</div> },
              { key: 'platform', header: t('campaign.platform'), hideOnTablet: true, cell: (c) => <div><p>{label('platform', c.platform)}</p><p className="text-xs text-zinc-500">{label('objective', c.objective)}</p></div> },
              { key: 'status', header: t('common.status'), cell: (c) => <StatusBadge group="campaignStatus" value={c.status} /> },
              { key: 'budget', header: t('campaign.budgetSpent'), cell: (c) => (<div className="min-w-36"><p className="mb-1.5 text-xs tabular text-zinc-600">{fmt.money(c.spent, { compact: true })} / {fmt.money(c.budget, { compact: true })}</p><BudgetBar spent={c.spent} budget={c.budget} /></div>) },
              { key: 'dates', header: t('campaign.dates'), hideOnTablet: true, cell: (c) => <span className="text-xs text-zinc-500">{c.startDate ? fmt.date(c.startDate) : '—'} → {c.endDate ? fmt.date(c.endDate) : '—'}</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {creating && <CampaignFormModal open onClose={() => setCreating(false)} />}
    </div>
  );
}
