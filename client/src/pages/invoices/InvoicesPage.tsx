import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Paperclip, Plus, Receipt, Wallet } from 'lucide-react';
import { INVOICE_STATUSES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { InvoiceRow, InvoiceSummary } from '@/api/types.finance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/Badge';
import { useClientOptions } from '@/components/shared/options';
import { DueHint, SharedBadge } from '@/components/finance/FinanceShared';
import { InvoiceDrawer } from '@/components/finance/InvoiceDrawer';
import { InvoiceFormModal } from '@/components/finance/InvoiceFormModal';

export function InvoicesPage() {
  const { t, fmt } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const manage = can('invoices.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState(params.get('clientId') ?? '');
  const [overdue, setOverdue] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const openId = params.get('open');
  const q = useDebounced(search);
  const list = useApi<Paged<InvoiceRow>>('/invoices', { q, status, clientId, overdue, from, to, sort, page });
  const summary = useApi<{ item: InvoiceSummary }>('/invoices/summary', undefined, { enabled: staff });
  const { clients } = useClientOptions(staff);
  const statusOptions = useEnumOptions('invoiceStatus', INVOICE_STATUSES);
  const reset = () => setPage(1);
  const filtered = !!(q || status || clientId || overdue || from || to);
  const s = summary.data?.item;
  const openDrawer = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('open', id); else next.delete('open');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={t('nav.invoices')} subtitle={staff ? t('finance.invoicesSubtitle') : t('finance.invoicesSubtitleClient')}
        actions={staff && manage && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('finance.newInvoice')}</Button>}
      />

      {staff && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label={t('finance.outstanding')} value={s ? fmt.money(s.outstanding.total, { decimals: 2 }) : '—'} icon={Wallet} tone="sky" loading={summary.isLoading} hint={s ? t('finance.invoiceCount', { n: s.outstanding.count }) : undefined} />
          <StatCard label={t('finance.overdueTotal')} value={s ? fmt.money(s.overdue.total, { decimals: 2 }) : '—'} icon={AlertTriangle} tone="amber" loading={summary.isLoading} hint={s ? t('finance.invoiceCount', { n: s.overdue.count }) : undefined} />
          <StatCard label={t('finance.paidThisMonth')} value={s ? fmt.money(s.paidThisMonth.total, { decimals: 2 }) : '—'} icon={CheckCircle2} tone="emerald" loading={summary.isLoading} hint={s ? t('finance.invoiceCount', { n: s.paidThisMonth.count }) : undefined} />
        </div>
      )}

      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('finance.searchInvoices')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        {staff && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        <FilterSelect value={overdue} onChange={(v) => { setOverdue(v); reset(); }} allLabel={t('finance.allInvoices')} options={[{ value: '1', label: t('finance.overdueOnly') }]} />
        <FilterSelect value={sort} onChange={(v) => { setSort(v); reset(); }} allLabel={t('finance.sortNewestIssued')} options={[{ value: 'dueDate', label: t('finance.sortDueSoon') }, { value: '-total', label: t('finance.sortAmount') }, { value: 'issueDate', label: t('finance.sortOldest') }]} />
        <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <Input type="date" value={from} max={to || undefined} aria-label={t('common.from')} onChange={(e) => { setFrom(e.target.value); reset(); }} className="sm:w-40" />
          <span className="text-zinc-400">→</span>
          <Input type="date" value={to} min={from || undefined} aria-label={t('common.to')} onChange={(e) => { setTo(e.target.value); reset(); }} className="sm:w-40" />
        </div>
      </FilterBar>

      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState
          icon={Receipt} title={t('finance.noInvoices')}
          description={filtered ? t('common.noResultsHint') : staff ? (manage ? t('finance.noInvoicesHint') : t('finance.noInvoicesRestricted')) : t('finance.noInvoicesClient')}
          action={staff && manage && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('finance.newInvoice')}</Button> : undefined}
        />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(i) => i.id}
            onRowClick={(i) => openDrawer(i.id)}
            columns={[
              {
                key: 'number', header: t('finance.invoice'), primary: true,
                cell: (i) => (
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900"><span dir="ltr" className="tabular">{i.invoiceNumber}</span></p>
                    <p className="truncate text-xs font-normal text-zinc-500">{[staff ? i.client?.companyName : null, i.project?.name ?? i.description].filter(Boolean).join(' · ')}</p>
                  </div>
                ),
              },
              { key: 'status', header: t('common.status'), cell: (i) => <div className="flex flex-col items-start gap-1"><StatusBadge group="invoiceStatus" value={i.status} /><DueHint status={i.status} dueDate={i.dueDate} /></div> },
              { key: 'issue', header: t('finance.issueDate'), hideOnTablet: true, cell: (i) => <span className="text-zinc-600">{fmt.date(i.issueDate)}</span> },
              { key: 'due', header: t('finance.dueDate'), cell: (i) => <span className={i.status === 'OVERDUE' ? 'font-medium text-rose-600' : 'text-zinc-600'}>{fmt.date(i.dueDate)}</span> },
              { key: 'total', header: t('common.total'), align: 'end', cell: (i) => <div><p className="font-semibold tabular text-zinc-900">{fmt.money(i.total, { decimals: 2 })}</p>{i.tax > 0 && <p className="text-xs font-normal text-zinc-400 tabular">{t('finance.inclTax', { tax: fmt.money(i.tax, { decimals: 2 }) })}</p>}</div> },
              ...(staff ? [
                { key: 'vis', header: t('finance.visibility'), hideOnMobile: true, hideOnTablet: true, cell: (i: InvoiceRow) => <SharedBadge shared={i.visibleToClient} /> },
                { key: 'files', header: <span className="sr-only">{t('finance.attachments')}</span>, hideOnMobile: true, hideOnTablet: true, align: 'end' as const, cell: (i: InvoiceRow) => (i.filesCount ? <span className="inline-flex items-center gap-1 text-xs text-zinc-500 tabular"><Paperclip className="size-3.5" />{i.filesCount}</span> : null) },
              ] : []),
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}

      <InvoiceDrawer id={openId} onClose={() => openDrawer(null)} />
      {creating && <InvoiceFormModal open onClose={() => setCreating(false)} defaultClientId={clientId || undefined} onSaved={(i) => openDrawer(i.id)} />}
    </div>
  );
}
