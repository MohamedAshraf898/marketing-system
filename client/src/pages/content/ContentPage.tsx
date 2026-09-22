// Owner: Content & proofing group.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange, Plus } from 'lucide-react';
import { CONTENT_APPROVAL_STATUSES, CONTENT_STATUSES, CONTENT_TYPES, SOCIAL_PLATFORMS, type ContentApprovalStatus, type ContentStatus } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import { isStaffContentItem, type ClientContentItem, type ContentItem, type ContentView } from '@/api/types.content';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Badge, StatusBadge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CalendarGrid, dayKey, visibleRange, type CalendarEvent } from '@/components/ui/CalendarGrid';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { Kanban, type KanbanColumn } from '@/components/ui/Kanban';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Tabs';
import { useCampaignOptions, useClientOptions, useTeamMembers } from '@/components/shared/options';
import { ContentDetailDrawer } from '@/components/content/ContentDetailDrawer';
import { ContentFormModal } from '@/components/content/ContentFormModal';

type Row = ContentItem | ClientContentItem;

const CONTENT_TONE: Record<ContentStatus, Tone> = {
  IDEA: 'neutral', DRAFT: 'blue', IN_REVIEW: 'violet', CLIENT_APPROVAL: 'amber', APPROVED: 'green', SCHEDULED: 'teal', PUBLISHED: 'green', REJECTED: 'red',
};

export function ContentPage() {
  const { t, fmt, label } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const manage = can('content.manage');
  const [params, setParams] = useSearchParams();
  const requestedView = params.get('view');
  const view: ContentView = requestedView === 'list' ? 'list' : requestedView === 'kanban' && staff ? 'kanban' : 'calendar';
  const setView = (v: ContentView) => { const next = new URLSearchParams(params); next.set('view', v); setParams(next, { replace: true }); };
  const openId = params.get('open');
  const openDrawer = (id: string | null) => { const next = new URLSearchParams(params); if (id) next.set('open', id); else next.delete('open'); setParams(next, { replace: true }); };

  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [platform, setPlatform] = useState('');
  const [contentType, setContentType] = useState('');
  const [status, setStatus] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [cursor, setCursor] = useState(new Date());
  const [calView, setCalView] = useState<'month' | 'week'>('month');
  const q = useDebounced(search);

  const { clients } = useClientOptions(staff);
  const { campaigns } = useCampaignOptions(clientId || undefined, staff && !!clientId);
  const members = useTeamMembers(clientId || undefined, staff);
  const platformOptions = useEnumOptions('socialPlatform', SOCIAL_PLATFORMS);
  const typeOptions = useEnumOptions('contentType', CONTENT_TYPES);
  const statusOptions = useEnumOptions('contentStatus', CONTENT_STATUSES);
  const approvalOptions = useEnumOptions('approvalStatus', CONTENT_APPROVAL_STATUSES);

  const baseFilters = {
    q, clientId, campaignId, platform, contentType, approvalStatus,
    ...(staff ? { status, assignedToId } : {}),
  };

  const range = useMemo(() => visibleRange(cursor, calView, 1), [cursor, calView]);
  const calendarQuery = useApi<Paged<Row>>('/content', { ...baseFilters, from: dayKey(range.from), to: dayKey(range.to) }, { enabled: view === 'calendar' });
  const kanbanQuery = useApi<Paged<Row>>('/content', { ...baseFilters, page: 1, pageSize: 100 }, { enabled: view === 'kanban' && staff });
  const listQuery = useApi<Paged<Row>>('/content', { ...baseFilters, page, pageSize: 20 }, { enabled: view === 'list' });

  const move = useAction(
    (vars: { id: string; status: ContentStatus }) => api.patch(`/content/${vars.id}`, { status: vars.status }),
    { success: t('content.statusUpdated') },
  );

  const reset = () => setPage(1);
  const filtered = !!(q || clientId || campaignId || platform || contentType || status || approvalStatus || assignedToId);

  const events: CalendarEvent[] = useMemo(
    () => (calendarQuery.data?.items ?? [])
      .filter((r) => r.publishDate)
      .map((r) => ({
        id: r.id,
        date: r.publishDate!,
        title: r.title,
        tone: CONTENT_TONE[r.status],
        meta: label('socialPlatform', r.platform),
        onClick: () => openDrawer(r.id),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarQuery.data],
  );

  const kanbanColumns: KanbanColumn[] = CONTENT_STATUSES.map((s) => ({ id: s, title: label('contentStatus', s), tone: CONTENT_TONE[s] }));
  const kanbanItems = (kanbanQuery.data?.items ?? []).filter(isStaffContentItem);

  const columns = [
    {
      key: 'title', header: t('content.titleField'), primary: true,
      cell: (r: Row) => (
        <div>
          <p className="font-medium text-zinc-900">{r.title}</p>
          <p className="text-xs font-normal text-zinc-500">{isStaffContentItem(r) ? [r.client?.companyName, r.campaign?.name].filter(Boolean).join(' · ') : label('contentType', r.contentType)}</p>
        </div>
      ),
    },
    { key: 'platform', header: t('content.platform'), hideOnTablet: true, cell: (r: Row) => <span>{label('socialPlatform', r.platform)} · {label('contentType', r.contentType)}</span> },
    { key: 'status', header: t('common.status'), cell: (r: Row) => <StatusBadge group="contentStatus" value={r.status} /> },
    { key: 'approval', header: t('content.approval'), cell: (r: Row) => <StatusBadge group="approvalStatus" value={r.approvalStatus} /> },
    ...(staff ? [{ key: 'assignee', header: t('common.assignee'), hideOnTablet: true, cell: (r: Row) => <span>{isStaffContentItem(r) ? (r.assignedTo?.name ?? t('common.unassigned')) : '—'}</span> }] : []),
    { key: 'publishDate', header: t('content.publishDate'), align: 'end' as const, cell: (r: Row) => <span className="text-xs text-zinc-500">{r.publishDate ? fmt.date(r.publishDate) : '—'}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={t('nav.content')}
        subtitle={staff ? t('content.subtitle') : t('content.subtitleClient')}
        actions={manage && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('content.new')}</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { id: 'calendar', label: t('common.calendar') },
            ...(staff ? [{ id: 'kanban' as ContentView, label: t('common.board') }] : []),
            { id: 'list', label: t('common.list') },
          ]}
        />
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('content.search')} />
        {staff && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); setCampaignId(''); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        {staff && clientId && <FilterSelect value={campaignId} onChange={(v) => { setCampaignId(v); reset(); }} allLabel={t('common.campaign')} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />}
        <FilterSelect value={platform} onChange={(v) => { setPlatform(v); reset(); }} allLabel={t('content.allPlatforms')} options={platformOptions} />
        <FilterSelect value={contentType} onChange={(v) => { setContentType(v); reset(); }} allLabel={t('content.allTypes')} options={typeOptions} />
        {staff && <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />}
        <FilterSelect value={approvalStatus} onChange={(v) => { setApprovalStatus(v); reset(); }} allLabel={t('content.allApprovalStatuses')} options={approvalOptions} />
        {staff && <FilterSelect value={assignedToId} onChange={(v) => { setAssignedToId(v); reset(); }} allLabel={t('common.assignee')} options={members.map((m) => ({ value: m.id, label: m.name }))} />}
      </FilterBar>

      {view === 'calendar' && (
        calendarQuery.isError ? <ErrorState onRetry={() => void calendarQuery.refetch()} /> : (
          <CalendarGrid cursor={cursor} onCursorChange={setCursor} view={calView} onViewChange={setCalView} events={events} />
        )
      )}

      {view === 'kanban' && staff && (
        kanbanQuery.isError ? <ErrorState onRetry={() => void kanbanQuery.refetch()} /> : kanbanQuery.isLoading ? <SkeletonRows /> : (
          <Kanban<ContentItem>
            columns={kanbanColumns}
            items={kanbanItems}
            columnOf={(it) => it.status}
            keyOf={(it) => it.id}
            canMove={(it) => manage && it.allowedStatuses.length > 0}
            onMove={manage ? (it, col) => move.mutate({ id: it.id, status: col as ContentStatus }) : undefined}
            empty={t('content.emptyColumn')}
            renderCard={(it) => (
              <button type="button" onClick={() => openDrawer(it.id)} className="w-full rounded-xl border border-line bg-white p-3 text-start shadow-card transition hover:shadow-[var(--shadow-pop)]">
                <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-zinc-900">{it.title}</p>
                <p className="mt-1 truncate text-[11.5px] text-zinc-500">{[it.client?.companyName, it.campaign?.name].filter(Boolean).join(' · ')}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral" dot={false} className="px-1.5 py-0.5 text-[10.5px]">{label('socialPlatform', it.platform)}</Badge>
                  {it.deliverableId && <Badge tone={CONTENT_TONE[it.status] === 'red' ? 'red' : 'blue'} dot={false} className="px-1.5 py-0.5 text-[10.5px]">{label('approvalStatus', it.approvalStatus)}</Badge>}
                  {it.publishDate && <span className="ms-auto text-[10.5px] text-zinc-400">{fmt.date(it.publishDate)}</span>}
                </div>
              </button>
            )}
          />
        )
      )}

      {view === 'list' && (
        listQuery.isError ? <ErrorState onRetry={() => void listQuery.refetch()} /> : listQuery.isLoading ? <SkeletonRows /> : !listQuery.data?.items.length ? (
          <EmptyState icon={CalendarRange} title={t('content.empty')} description={filtered ? t('common.noResultsHint') : staff ? t('content.emptyHint') : t('content.emptyClientHint')} action={manage && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('content.new')}</Button> : undefined} />
        ) : (
          <>
            <DataList rows={listQuery.data.items} rowKey={(r) => r.id} onRowClick={(r) => openDrawer(r.id)} columns={columns} />
            <Pagination meta={listQuery.data.meta} onPage={setPage} />
          </>
        )
      )}

      {creating && <ContentFormModal open onClose={() => setCreating(false)} defaultClientId={clientId || undefined} />}
      {openId && <ContentDetailDrawer id={openId} open onClose={() => openDrawer(null)} />}
    </div>
  );
}
