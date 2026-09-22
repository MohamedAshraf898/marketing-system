import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { CONTRACT_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { ContractRow } from '@/api/types.finance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Checkbox, Select } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Attachments, DetailRow, ExpiryHint, SharedBadge } from './FinanceShared';
import { ContractFormModal } from './ContractFormModal';

/** Details of one contract (drawer). Staff with contracts.manage can edit / share / change the status; clients get a read-only view. */
export function ContractDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, fmt, label } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const manage = can('contracts.manage');
  const q = useApi<{ item: ContractRow }>(id ? `/contracts/${id}` : null, undefined, { keepPrevious: false });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'terminate' | null>(null);
  const c = q.data?.item;

  const patch = useAction((body: Record<string, unknown>) => api.patch(`/contracts/${id}`, body), { success: t('finance.contractUpdated'), onSuccess: () => setConfirm(null) });
  const del = useAction(() => api.del(`/contracts/${id}`), { success: t('finance.contractDeleted'), onSuccess: () => { setConfirm(null); onClose(); } });

  return (
    <Drawer
      open={!!id} onClose={onClose} width="lg"
      title={c ? c.name : t('finance.contract')}
      subtitle={c ? <span dir="ltr" className="tabular">{c.contractNumber}</span> : undefined}
      footer={c && staff && manage ? (
        <>
          {c.status === 'DRAFT'
            ? <Button variant="secondary" className="text-rose-600" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('delete')}>{t('common.delete')}</Button>
            : c.status !== 'TERMINATED' && <Button variant="secondary" onClick={() => setConfirm('terminate')}>{t('finance.terminate')}</Button>}
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{t('common.edit')}</Button>
        </>
      ) : undefined}
    >
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} message={t('common.notFoundHint')} /> : !c ? (
        <div className="space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-32 w-full" /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge group="contractStatus" value={c.status} />
            <ExpiryHint status={c.status} endDate={c.endDate} />
            {staff && <SharedBadge shared={c.visibleToClient} />}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            {staff && c.client && <DetailRow label={t('common.client')}><Link to={`/clients/${c.client.id}`} className="font-medium text-brand-700 hover:underline">{c.client.companyName}</Link></DetailRow>}
            <DetailRow label={t('finance.contractValue')}><span className="font-semibold tabular">{fmt.money(c.value, { decimals: 2 })}</span></DetailRow>
            <DetailRow label={t('finance.startDate')}>{fmt.date(c.startDate)}</DetailRow>
            <DetailRow label={t('finance.endDate')}>{fmt.date(c.endDate)}</DetailRow>
            <DetailRow label={t('finance.renewalDate')}>{fmt.date(c.renewalDate)}</DetailRow>
            {staff && c.createdBy && <DetailRow label={t('finance.createdBy')}>{c.createdBy.name}</DetailRow>}
          </dl>

          {staff && manage && (
            <div className="rounded-xl border border-line bg-zinc-50 p-4">
              <label className="mb-3 block text-[13px] font-medium text-zinc-700">{t('finance.changeStatus')}</label>
              <Select value={c.status} disabled={patch.isPending} onChange={(e) => (e.target.value === 'TERMINATED' ? setConfirm('terminate') : patch.mutate({ status: e.target.value }))}>
                {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{label('contractStatus', s)}</option>)}
              </Select>
              <div className="mt-4">
                <Checkbox checked={!!c.visibleToClient} disabled={patch.isPending} onChange={(e) => patch.mutate({ visibleToClient: e.target.checked })} label={<span className="font-medium">{t('finance.shareWithClient')}</span>} />
                <p className="mt-1.5 ps-6 text-xs leading-relaxed text-zinc-500">{c.status === 'DRAFT' ? t('finance.shareDraftHint') : t('finance.shareExplain')}</p>
              </div>
            </div>
          )}

          {staff && c.notes && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-zinc-700">{t('finance.internalNotes')} <span className="ms-1 text-xs font-normal text-zinc-400">{t('common.internalOnly')}</span></h3>
              <p className="whitespace-pre-wrap rounded-xl bg-amber-50/60 p-3.5 text-sm leading-relaxed text-zinc-800 ring-1 ring-inset ring-amber-100">{c.notes}</p>
            </section>
          )}

          <section>
            <h3 className="mb-3 text-[13px] font-semibold text-zinc-700">{t('finance.attachments')}</h3>
            <Attachments field="contractId" parentId={c.id} files={c.files ?? []} canManage={staff && manage} />
          </section>
        </div>
      )}
      {editing && c && <ContractFormModal open onClose={() => setEditing(false)} contract={c} />}
      <ConfirmDialog
        open={confirm === 'delete'} onClose={() => setConfirm(null)} onConfirm={() => del.mutate(undefined)} loading={del.isPending}
        title={t('finance.deleteContractTitle')} message={t('finance.deleteContractMessage')} confirmLabel={t('common.delete')}
      />
      <ConfirmDialog
        open={confirm === 'terminate'} onClose={() => setConfirm(null)} onConfirm={() => patch.mutate({ status: 'TERMINATED' })} loading={patch.isPending}
        title={t('finance.terminateTitle')} message={t('finance.terminateMessage')} confirmLabel={t('finance.terminate')}
      />
    </Drawer>
  );
}
