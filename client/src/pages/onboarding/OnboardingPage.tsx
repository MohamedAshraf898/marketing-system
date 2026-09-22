// Owner: CRM group.
import { useState } from 'react';
import { AlertTriangle, ClipboardCheck, ListChecks } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { OnboardingDashboard, OnboardingDashboardRow } from '@/api/types.crm';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Form';
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';
import { cx } from '@/components/ui/cx';
import { CompanyMark } from '@/components/shared/Media';
import { useTeamMembers } from '@/components/shared/options';
import { useOnboardingTitle } from '@/components/panels/onboardingTitle';

function OnboardingCard({ row }: { row: OnboardingDashboardRow }) {
  const { t, fmt } = useI18n();
  const title = useOnboardingTitle();
  const pct = row.progress.percent;
  return (
    <a href={`/clients/${row.id}`} className="block focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 rounded-2xl">
      <Card className="h-full transition hover:border-zinc-300 hover:shadow-md">
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <CompanyMark clientId={row.id} name={row.companyName} hasLogo={row.hasLogo} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-zinc-900">{row.companyName}</p>
              <p className="truncate text-[13px] text-zinc-500">{row.accountManager?.name ?? t('common.unassigned')}</p>
            </div>
            <StatusBadge group="onboardingStatus" value={row.onboardingStatus} />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
              <span className="text-zinc-500">{t('crm.onb.progress')}</span>
              <span className="font-medium tabular text-zinc-800">{t('crm.onb.doneOf', { done: fmt.number(row.progress.done), total: fmt.number(row.progress.total) })}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div className={cx('h-full rounded-full transition-[width] duration-300', pct === 100 ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>

          <div className="border-t border-line pt-3">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">{t('crm.dash.next')}</p>
            {row.nextItem ? (
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-zinc-800">{title(row.nextItem.title)}</p>
                {row.nextItem.dueDate && <span className="shrink-0 text-xs tabular text-zinc-500">{fmt.date(row.nextItem.dueDate)}</span>}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">{t('crm.dash.noNextItem')}</p>
            )}
          </div>

          {(row.overdueItems.length > 0 || row.myOpenItems > 0) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {row.overdueItems.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                  <AlertTriangle className="size-3.5" />
                  {t('crm.onb.overdueCount', { n: fmt.number(row.overdueItems.length) })}
                </span>
              )}
              {row.myOpenItems > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                  {t('crm.dash.myItemsBadge', { n: fmt.number(row.myOpenItems) })}
                </span>
              )}
            </div>
          )}

          {row.overdueItems.length > 0 && (
            <ul className="space-y-1 text-xs text-zinc-500">
              {row.overdueItems.slice(0, 3).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{title(i.title)}</span>
                  <span className="shrink-0 font-medium text-rose-600 tabular">{i.dueDate ? fmt.date(i.dueDate) : ''}</span>
                </li>
              ))}
              {row.overdueItems.length > 3 && <li className="text-zinc-400">{t('crm.dash.moreOverdue', { n: fmt.number(row.overdueItems.length - 3) })}</li>}
            </ul>
          )}
        </div>
      </Card>
    </a>
  );
}

/** Staff dashboard: every client being onboarded (or with unfinished checklist items), across the whole agency. */
export function OnboardingPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [mine, setMine] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const team = useTeamMembers(undefined, true);
  const reset = () => setPage(1);

  const list = useApi<OnboardingDashboard>('/onboarding', {
    q,
    assignedToId: mine ? undefined : assignee || undefined,
    mine: mine ? '1' : undefined,
    overdue: overdueOnly ? '1' : undefined,
    page,
  });

  const filtered = !!(q || assignee || mine || overdueOnly);

  return (
    <div>
      <PageHeader title={t('nav.onboarding')} subtitle={t('crm.dash.subtitle')} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
        <StatCard label={t('crm.dash.myOpenItems')} value={list.data ? list.data.summary.myOpenItems : '—'} icon={ListChecks} tone="brand" loading={list.isLoading} />
        <StatCard label={t('crm.dash.overdueItems')} value={list.data ? list.data.summary.overdueItems : '—'} icon={AlertTriangle} tone="amber" loading={list.isLoading} />
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('crm.dash.search')} />
        <FilterSelect
          value={mine ? '' : assignee}
          onChange={(v) => { setAssignee(v); reset(); }}
          allLabel={t('crm.dash.allAssignees')}
          options={team.filter((m) => m.id !== user?.id).map((m) => ({ value: m.id, label: m.name }))}
          className={mine ? 'pointer-events-none opacity-50' : undefined}
        />
        <Checkbox label={t('crm.dash.mineOnly')} checked={mine} onChange={(e) => { setMine(e.target.checked); reset(); }} />
        <Checkbox label={t('crm.dash.overdueOnly')} checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); reset(); }} />
      </FilterBar>

      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonCards count={6} className="sm:grid-cols-2 xl:grid-cols-3" /> : !list.data?.items.length ? (
        <Card><EmptyState icon={ClipboardCheck} title={t('crm.dash.empty')} description={filtered ? t('common.noResultsHint') : t('crm.dash.emptyHint')} /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.data.items.map((row) => <OnboardingCard key={row.id} row={row} />)}
          </div>
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
