import { useMemo, useState } from 'react';
import { Download, FilterX, ScrollText } from 'lucide-react';
import { qs as queryString } from '@/api/client';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { AdminUserRow, AuditLogRow, AuditPage } from '@/api/types.admin';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced } from '@/components/ui/Filters';
import { Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useClientOptions } from '@/components/shared/options';
import { AUDIT_ACTIONS as ACTIONS, AUDIT_ENTITIES as ENTITIES } from '@/lib/audit';

const summarize = (m: Record<string, unknown> | null): string => {
  if (!m) return '';
  return Object.entries(m).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 border-b border-line py-2.5 text-sm last:border-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-900">{children}</dd>
    </div>
  );
}

function AuditDrawer({ row, clientName, onClose }: { row: AuditLogRow; clientName?: string; onClose: () => void }) {
  const { t, fmt, label } = useI18n();
  return (
    <Drawer open onClose={onClose} title={label('auditAction', row.action)} subtitle={fmt.dateTime(row.createdAt)}>
      <dl>
        <Detail label={t('audit.action')}><span className="font-medium">{label('auditAction', row.action)}</span> <span dir="ltr" className="ms-1 font-mono text-xs text-zinc-400">{row.action}</span></Detail>
        <Detail label={t('audit.user')}>{row.user ? <>{row.user.name} <span className="text-xs text-zinc-400">· {label('role', row.user.role)}</span><span dir="ltr" className="block text-start text-xs text-zinc-500">{row.user.email}</span></> : t('audit.system')}</Detail>
        <Detail label={t('audit.entity')}><Badge dot={false}>{label('auditEntity', row.entity)}</Badge>{row.entityId && <span dir="ltr" className="ms-2 break-all font-mono text-xs text-zinc-500">{row.entityId}</span>}</Detail>
        {row.clientId && <Detail label={t('common.client')}>{clientName ?? <span dir="ltr" className="break-all font-mono text-xs">{row.clientId}</span>}</Detail>}
        <Detail label="IP"><span dir="ltr" className="font-mono text-xs">{row.ip ?? '—'}</span></Detail>
        {row.clientId && <Detail label={t('admin.audit.clientVisible')}>{row.clientVisible ? t('common.yes') : t('common.no')}</Detail>}
        <Detail label={t('audit.when')}>{fmt.dateTime(row.createdAt)}</Detail>
      </dl>
      <h3 className="mb-2 mt-6 text-[13px] font-semibold text-zinc-800">{t('admin.audit.metadata')}</h3>
      {row.metadata && Object.keys(row.metadata).length ? (
        <pre dir="ltr" className="max-h-[50vh] overflow-auto rounded-xl bg-zinc-950 p-4 text-start text-xs leading-relaxed text-zinc-100">{JSON.stringify(row.metadata, null, 2)}</pre>
      ) : <p className="text-sm text-zinc-500">{t('admin.audit.noMetadata')}</p>}
      <p className="mt-3 text-xs text-zinc-400">{t('admin.audit.redactedNote')}</p>
    </Drawer>
  );
}

export function AuditLogPage() {
  const { t, fmt, label } = useI18n();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditLogRow | null>(null);
  const q = useDebounced(search);
  const { clients } = useClientOptions();
  const users = useApi<Paged<AdminUserRow>>('/users', { pageSize: 100 });
  const filters = { q, action, entity, userId, clientId, from, to };
  const list = useApi<AuditPage>('/audit-logs', { ...filters, page });
  const reset = () => setPage(1);
  const anyFilter = Object.values(filters).some(Boolean);
  const clientNames = useMemo(() => new Map(clients.map((c) => [c.id, c.companyName])), [clients]);
  const exportHref = `/api/audit-logs/export.csv${queryString(filters)}`;

  return (
    <div>
      <PageHeader
        title={t('nav.auditLog')}
        subtitle={t('audit.subtitle')}
        actions={<a href={exportHref} download className={buttonClass('secondary', 'md')}><Download className="size-4" />{t('admin.audit.export')}</a>}
      />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('audit.search')} />
        <FilterSelect value={userId} onChange={(v) => { setUserId(v); reset(); }} allLabel={t('admin.audit.allUsers')} options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        <FilterSelect value={action} onChange={(v) => { setAction(v); reset(); }} allLabel={t('audit.allActions')} options={ACTIONS.map((a) => ({ value: a, label: label('auditAction', a) }))} />
        <FilterSelect value={entity} onChange={(v) => { setEntity(v); reset(); }} allLabel={t('audit.allEntities')} options={ENTITIES.map((e) => ({ value: e, label: label('auditEntity', e) }))} />
        <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />
        <div className="col-span-2 flex items-center gap-2">
          <Input type="date" aria-label={t('report.from')} value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); reset(); }} className="sm:w-40" />
          <span className="text-zinc-400">–</span>
          <Input type="date" aria-label={t('report.to')} value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); reset(); }} className="sm:w-40" />
        </div>
        {anyFilter && <Button variant="ghost" size="sm" icon={<FilterX className="size-4" />} onClick={() => { setSearch(''); setAction(''); setEntity(''); setUserId(''); setClientId(''); setFrom(''); setTo(''); reset(); }}>{t('admin.audit.clearFilters')}</Button>}
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows rows={8} /> : !list.data?.items.length ? (
        <EmptyState icon={ScrollText} title={t('audit.empty')} description={t('common.noResultsHint')} />
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500 tabular">{t('admin.audit.total', { n: fmt.number(list.data.meta.total) })}</p>
          <DataList
            rows={list.data.items}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpen(r)}
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
      {open && <AuditDrawer row={open} clientName={open.clientId ? clientNames.get(open.clientId) : undefined} onClose={() => setOpen(null)} />}
    </div>
  );
}
