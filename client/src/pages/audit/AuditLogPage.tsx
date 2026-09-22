import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { AuditRow, Paged } from '@/api/types';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced } from '@/components/ui/Filters';
import { Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';

const ACTIONS = [
  'USER_LOGIN', 'USER_CREATED', 'USER_UPDATED', 'USER_ASSIGNMENTS_UPDATED', 'PASSWORD_CHANGED',
  'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_ARCHIVED', 'CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_DELETED',
  'DELIVERABLE_CREATED', 'DELIVERABLE_UPDATED', 'DELIVERABLE_SUBMITTED', 'DELIVERABLE_APPROVED', 'CHANGES_REQUESTED', 'DELIVERABLE_NEW_VERSION', 'DELIVERABLE_PUBLISHED',
  'REQUEST_CREATED', 'REQUEST_UPDATED', 'REQUEST_STATUS_CHANGED', 'REPORT_CREATED', 'REPORT_DELETED', 'FILE_UPLOADED', 'FILE_DELETED', 'COMMENT_CREATED',
];
const ENTITIES = ['user', 'client', 'campaign', 'deliverable', 'request', 'report', 'file'];

const summarize = (m: Record<string, unknown> | null): string => {
  if (!m) return '';
  return Object.entries(m).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
};

export function AuditLogPage() {
  const { t, fmt, label } = useI18n();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const list = useApi<Paged<AuditRow>>('/audit-logs', { q, action, entity, from, to, page });
  const reset = () => setPage(1);

  return (
    <div>
      <PageHeader title={t('nav.auditLog')} subtitle={t('audit.subtitle')} />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('audit.search')} />
        <FilterSelect value={action} onChange={(v) => { setAction(v); reset(); }} allLabel={t('audit.allActions')} options={ACTIONS.map((a) => ({ value: a, label: label('auditAction', a) }))} />
        <FilterSelect value={entity} onChange={(v) => { setEntity(v); reset(); }} allLabel={t('audit.allEntities')} options={ENTITIES.map((e) => ({ value: e, label: label('auditEntity', e) }))} />
        <div className="col-span-2 flex items-center gap-2">
          <Input type="date" aria-label={t('report.from')} value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); reset(); }} className="sm:w-40" />
          <span className="text-zinc-400">–</span>
          <Input type="date" aria-label={t('report.to')} value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); reset(); }} className="sm:w-40" />
        </div>
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows rows={8} /> : !list.data?.items.length ? (
        <EmptyState icon={ScrollText} title={t('audit.empty')} description={t('common.noResultsHint')} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(r) => r.id}
            columns={[
              { key: 'action', header: t('audit.action'), primary: true, cell: (r) => <span className="font-medium text-zinc-900">{label('auditAction', r.action)}</span> },
              { key: 'user', header: t('audit.user'), cell: (r) => (r.user ? <span>{r.user.name} <span className="text-xs text-zinc-400">· {label('role', r.user.role)}</span></span> : <span className="text-zinc-400">{t('audit.system')}</span>) },
              { key: 'entity', header: t('audit.entity'), hideOnMobile: true, cell: (r) => <div className="flex items-center gap-2"><Badge dot={false}>{label('auditEntity', r.entity)}</Badge>{r.entityId && <span dir="ltr" className="font-mono text-[11px] text-zinc-400">{r.entityId.slice(-6)}</span>}</div> },
              { key: 'details', header: t('audit.details'), hideOnTablet: true, hideOnMobile: true, cell: (r) => <span className="line-clamp-2 max-w-md whitespace-normal break-words text-xs text-zinc-500" dir="ltr">{summarize(r.metadata)}</span> },
              { key: 'ip', header: 'IP', hideOnTablet: true, hideOnMobile: true, cell: (r) => <span dir="ltr" className="font-mono text-xs text-zinc-400">{r.ip ?? '—'}</span> },
              { key: 'when', header: t('audit.when'), cell: (r) => <span className="text-zinc-500 tabular">{fmt.dateTime(r.createdAt)}</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
