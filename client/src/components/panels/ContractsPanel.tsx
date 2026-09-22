import { useState } from 'react';
import { FileSignature, Plus } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { ContractRow } from '@/api/types.finance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/Badge';
import { ContractDrawer } from '@/components/finance/ContractDrawer';
import { ContractFormModal } from '@/components/finance/ContractFormModal';
import { ExpiryHint, SharedBadge } from '@/components/finance/FinanceShared';

/**
 * Compact contracts list embedded in the client detail page. A CLIENT user only ever sees their own shared, non-draft
 * contracts (enforced server-side by contractWhere). A TEAM member missing contracts.view gets a restricted empty state
 * instead of a 403 (the list is never fetched for them).
 */
export function ContractsPanel({ clientId }: { clientId: string }) {
  const { t, fmt } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const view = !staff || can('contracts.view');
  const manage = staff && can('contracts.manage');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useApi<Paged<ContractRow>>('/contracts', { clientId, sort: 'endDate', pageSize: 5, page }, { enabled: view });

  return (
    <div>
      {manage && (
        <div className="mb-4 flex justify-end">
          <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('finance.newContract')}</Button>
        </div>
      )}
      {!view ? (
        <EmptyState icon={FileSignature} title={t('finance.noContracts')} description={t('finance.noContractsRestricted')} />
      ) : list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState
          icon={FileSignature} title={t('finance.noContracts')}
          description={staff ? (manage ? t('finance.noContractsHint') : t('finance.noContractsRestricted')) : t('finance.noContractsClient')}
          action={manage ? <Button variant="brand" onClick={() => setCreating(true)}>{t('finance.newContract')}</Button> : undefined}
        />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(c) => c.id}
            onRowClick={(c) => setOpenId(c.id)}
            columns={[
              {
                key: 'name', header: t('finance.contract'), primary: true,
                cell: (c) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">{c.name}</p>
                    <p className="text-xs font-normal text-zinc-500"><span dir="ltr" className="tabular">{c.contractNumber}</span></p>
                  </div>
                ),
              },
              {
                key: 'status', header: t('common.status'),
                cell: (c) => <div className="flex flex-col items-start gap-1"><StatusBadge group="contractStatus" value={c.status} /><ExpiryHint status={c.status} endDate={c.endDate} /></div>,
              },
              { key: 'value', header: t('finance.contractValue'), align: 'end', hideOnMobile: true, cell: (c) => <span className="font-medium tabular text-zinc-900">{fmt.money(c.value)}</span> },
              ...(staff ? [{ key: 'vis', header: t('finance.visibility'), hideOnTablet: true, cell: (c: ContractRow) => <SharedBadge shared={c.visibleToClient} /> }] : []),
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      <ContractDrawer id={openId} onClose={() => setOpenId(null)} />
      {creating && <ContractFormModal open onClose={() => setCreating(false)} defaultClientId={clientId} onSaved={(c) => setOpenId(c.id)} />}
    </div>
  );
}
