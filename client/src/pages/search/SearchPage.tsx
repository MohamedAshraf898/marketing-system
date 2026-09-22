import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Building2, CalendarRange, ClipboardList, Contact, FileSignature, FileText, FolderKanban, LifeBuoy, Megaphone, Palette, Receipt, Search, SearchX, type LucideIcon,
} from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { SearchHit, SearchResponse, SearchType } from '@/api/types.insights';
import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput, useDebounced } from '@/components/ui/Filters';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { StatusBadge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/cx';

const TYPE_ICON: Record<SearchType, LucideIcon> = {
  client: Building2, contact: Contact, project: FolderKanban, task: ClipboardList, campaign: Megaphone,
  deliverable: Palette, content: CalendarRange, request: LifeBuoy, file: FileText, invoice: Receipt, contract: FileSignature,
};

const STATUS_GROUP: Partial<Record<SearchType, string>> = {
  client: 'clientStatus', project: 'projectStatus', task: 'taskStatus', campaign: 'campaignStatus',
  deliverable: 'deliverableStatus', content: 'contentStatus', request: 'requestStatus', invoice: 'invoiceStatus', contract: 'contractStatus',
};

function ResultRow({ hit }: { hit: SearchHit }) {
  const { label } = useI18n();
  const Icon = TYPE_ICON[hit.type];
  const statusGroup = STATUS_GROUP[hit.type];
  return (
    <Link to={hit.url} className="flex items-center gap-3.5 rounded-2xl border border-line bg-white p-4 shadow-card transition hover:border-brand-200 hover:shadow-md">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-900">{hit.title}</span>
        {(hit.subtitle || hit.clientName) && <span className="block truncate text-xs text-zinc-500">{[hit.clientName, hit.subtitle].filter(Boolean).join(' · ')}</span>}
      </span>
      {hit.status && statusGroup && <StatusBadge group={statusGroup} value={hit.status} className="shrink-0" />}
    </Link>
  );
}

/** Full search results page: `/search?q=...`. Reached from GlobalSearch's "view all results" link, or a direct URL. */
export function SearchPage() {
  const { t, label } = useI18n();
  const [params, setParams] = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [raw, setRaw] = useState(urlQ);
  const debounced = useDebounced(raw, 300);
  const trimmed = debounced.trim();
  const [activeType, setActiveType] = useState<SearchType | ''>('');

  // keep the URL in sync (shareable / bookmarkable, and restores on back navigation)
  useEffect(() => {
    if (trimmed === (params.get('q') ?? '')) return;
    setParams(trimmed ? { q: trimmed } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  const enabled = trimmed.length >= 2;
  const q = useApi<SearchResponse>('/search', { q: trimmed, limit: 10 }, { enabled });
  const items = q.data?.items ?? [];
  const shown = activeType ? items.filter((i) => i.type === activeType) : items;
  const counts = useMemo(() => {
    const m = new Map<SearchType, number>();
    for (const i of items) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    return m;
  }, [items]);

  return (
    <div>
      <PageHeader title={t('nav.search')} subtitle={t('insights.search.subtitle')} />
      <div className="mb-5 max-w-xl">
        <SearchInput value={raw} onChange={setRaw} placeholder={t('insights.search.placeholder')} />
      </div>

      {!enabled ? (
        <EmptyState icon={Search} title={t('insights.search.minChars')} description={t('insights.search.hint')} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        <EmptyState icon={SearchX} title={t('insights.search.noResults', { q: trimmed })} description={t('common.noResultsHint')} />
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveType('')}
              className={cx('rounded-full px-3 py-1.5 text-[13px] font-medium transition', !activeType ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200')}
            >
              {t('common.all')} <span className="tabular">({items.length})</span>
            </button>
            {(q.data?.types ?? []).filter((tp) => counts.has(tp)).map((tp) => (
              <button
                key={tp}
                onClick={() => setActiveType(tp)}
                className={cx('rounded-full px-3 py-1.5 text-[13px] font-medium transition', activeType === tp ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200')}
              >
                {label('searchType', tp)} <span className="tabular">({counts.get(tp)})</span>
              </button>
            ))}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {shown.map((hit) => <ResultRow key={`${hit.type}:${hit.id}`} hit={hit} />)}
          </div>
        </div>
      )}
    </div>
  );
}
