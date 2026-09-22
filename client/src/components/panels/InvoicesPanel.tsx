import { useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { InvoiceRow } from '@/api/types.finance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/Badge';
import { DueHint, SharedBadge } from '@/components/finance/FinanceShared';
import { InvoiceDrawer } from '@/components/finance/InvoiceDrawer';
import { InvoiceFormModal } from '@/components/finance/InvoiceFormModal';

/**
 * Compact invoices list embedded in the client detail page. A CLIENT user only ever sees their own shared, non-draft
 * invoices (enforced server-side by invoiceWhere). A TEAM member missing invoices.view gets a restricted empty state
 * instead of a 403 (the list is never fetched for them).
 */
export function InvoicesPanel({ clientId }: { clientId: string }) {
  const { t, fmt } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const view = !staff || can('invoices.view');
  const manage = staff && can('invoices.manage');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useApi<Paged<InvoiceRow>>('/invoices', { clientId, sort: 'dueDate', pageSize: 5, page }, { enabled: view });

  return (
    <div>
      {manage && (
        <div className="mb-4 flex justify-end">
          <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('finance.newInvoice')}</Button>
        </div>
      )}
      {!view ? (
        <EmptyState icon={Receipt} title={t('finance.noInvoices')} description={t('finance.noInvoicesRestricted')} />
      ) : list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState
          icon={Receipt} title={t('finance.noInvoices')}
          description={staff ? (manage ? t('finance.noInvoicesHint') : t('finance.noInvoicesRestricted')) : t('finance.noInvoicesClient')}
          action={manage ? <Button variant="brand" onClick={() => setCreating(true)}>{t('finance.newInvoice')}</Button> : undefined}
        />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(i) => i.id}
            onRowClick={(i) => setOpenId(i.id)}
            columns={[
              {
                key: 'number', header: t('finance.invoice'), primary: true,
                cell: (i) => (
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900"><span dir="ltr" className="tabular">{i.invoiceNumber}</span></p>
                    <p className="truncate text-xs font-normal text-zinc-500">{i.project?.name ?? i.description}</p>
                  </div>
                ),
              },
              { key: 'status', header: t('common.status'), cell: (i) => <div className="flex flex-col items-start gap-1"><StatusBadge group="invoiceStatus" value={i.status} /><DueHint status={i.status} dueDate={i.dueDate} /></div> },
              { key: 'total', header: t('common.total'), align: 'end', hideOnMobile: true, cell: (i) => <span className="font-semibold tabular text-zinc-900">{fmt.money(i.total, { decimals: 2 })}</span> },
              ...(staff ? [{ key: 'vis', header: t('finance.visibility'), hideOnTablet: true, cell: (i: InvoiceRow) => <SharedBadge shared={i.visibleToClient} /> }] : []),
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} />
      {creating && <InvoiceFormModal open onClose={() => setCreating(false)} defaultClientId={clientId} onSaved={(i) => setOpenId(i.id)} />}
    </div>
  );
}
