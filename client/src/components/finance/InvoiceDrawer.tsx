import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Pencil, Send, Trash2, Undo2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { InvoiceRow } from '@/api/types.finance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Attachments, DetailRow, DueHint, SharedBadge, todayStr } from './FinanceShared';
import { InvoiceFormModal } from './InvoiceFormModal';

type Action = 'paid' | 'cancel' | 'delete' | 'reverse' | null;
const OPEN = ['SENT', 'PENDING', 'OVERDUE'];
const LOCKED = ['PAID', 'CANCELLED'];

/**
 * Details of one invoice (drawer). "Mark as paid" is a manual status change (no payment provider is involved).
 * Paid / cancelled invoices are closed: only an administrator can reverse the status.
 */
export function InvoiceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, fmt, label } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const manage = can('invoices.manage');
  const isAdmin = user?.role === 'ADMIN';
  const q = useApi<{ item: InvoiceRow }>(id ? `/invoices/${id}` : null, undefined, { keepPrevious: false });
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [paidAt, setPaidAt] = useState(todayStr());
  const [reverseTo, setReverseTo] = useState('SENT');
  const i = q.data?.item;

  const patch = useAction((body: Record<string, unknown>) => api.patch(`/invoices/${id}`, body), { success: t('finance.invoiceUpdated'), onSuccess: () => setAction(null) });
  const del = useAction(() => api.del(`/invoices/${id}`), { success: t('finance.invoiceDeleted'), onSuccess: () => { setAction(null); onClose(); } });
  const paidErrs = fieldErrors(patch.error);

  const locked = !!i && LOCKED.includes(i.status);
  const canEdit = staff && manage && !locked;

  return (
    <Drawer
      open={!!id} onClose={onClose} width="lg"
      title={i ? <span dir="ltr" className="tabular">{i.invoiceNumber}</span> : t('finance.invoice')}
      subtitle={i && staff && i.client ? i.client.companyName : undefined}
      footer={i && staff && manage ? (
        <>
          {i.status === 'DRAFT' && <Button variant="secondary" className="text-rose-600" icon={<Trash2 className="size-4" />} onClick={() => setAction('delete')}>{t('common.delete')}</Button>}
          {canEdit && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
          {i.status === 'DRAFT' && <Button variant="brand" icon={<Send className="size-4" />} onClick={() => patch.mutate({ status: 'SENT' })} loading={patch.isPending}>{t('finance.markSent')}</Button>}
          {OPEN.includes(i.status) && <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => { setPaidAt(todayStr()); setAction('paid'); }}>{t('finance.markPaid')}</Button>}
          {locked && isAdmin && <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => { setReverseTo('SENT'); setAction('reverse'); }}>{t('finance.reverseStatus')}</Button>}
        </>
      ) : undefined}
    >
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} message={t('common.notFoundHint')} /> : !i ? (
        <div className="space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-32 w-full" /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge group="invoiceStatus" value={i.status} />
            <DueHint status={i.status} dueDate={i.dueDate} />
            {staff && <SharedBadge shared={i.visibleToClient} />}
          </div>

          <div className="rounded-2xl border border-line bg-zinc-50/60 p-4 sm:p-5">
            <div className="flex items-center justify-between text-sm text-zinc-600"><span>{t('finance.subtotal')}</span><span className="tabular">{fmt.money(i.amount, { decimals: 2 })}</span></div>
            <div className="mt-2 flex items-center justify-between text-sm text-zinc-600"><span>{t('finance.tax')}</span><span className="tabular">{fmt.money(i.tax, { decimals: 2 })}</span></div>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3"><span className="text-sm font-semibold text-zinc-900">{t('common.total')}</span><span className="text-xl font-semibold tabular text-zinc-900">{fmt.money(i.total, { decimals: 2 })}</span></div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            <DetailRow label={t('finance.issueDate')}>{fmt.date(i.issueDate)}</DetailRow>
            <DetailRow label={t('finance.dueDate')}>{fmt.date(i.dueDate)}</DetailRow>
            {i.paidAt && <DetailRow label={t('finance.paidOn')}>{fmt.date(i.paidAt)}</DetailRow>}
            {i.project && <DetailRow label={t('common.project')}>{staff ? <Link to={`/projects/${i.project.id}`} className="font-medium text-brand-700 hover:underline">{i.project.name}</Link> : i.project.name}</DetailRow>}
            {staff && i.client && <DetailRow label={t('common.client')}><Link to={`/clients/${i.client.id}`} className="font-medium text-brand-700 hover:underline">{i.client.companyName}</Link></DetailRow>}
            {staff && i.createdBy && <DetailRow label={t('finance.createdBy')}>{i.createdBy.name}</DetailRow>}
            {i.description && <DetailRow label={t('common.description')} className="col-span-2"><span className="whitespace-pre-wrap">{i.description}</span></DetailRow>}
          </dl>

          {staff && manage && (
            <div className="space-y-4 rounded-xl border border-line bg-zinc-50 p-4">
              {OPEN.includes(i.status) && (
                <div className="flex flex-wrap gap-2">
                  {i.status !== 'PENDING' && <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: 'PENDING' })} loading={patch.isPending}>{t('finance.markPending')}</Button>}
                  <Button size="sm" variant="secondary" className="text-rose-600" onClick={() => setAction('cancel')}>{t('finance.cancelInvoice')}</Button>
                </div>
              )}
              {i.status === 'DRAFT' && <Button size="sm" variant="secondary" className="text-rose-600" onClick={() => setAction('cancel')}>{t('finance.cancelInvoice')}</Button>}
              {canEdit ? (
                <div>
                  <Checkbox checked={!!i.visibleToClient} disabled={patch.isPending} onChange={(e) => patch.mutate({ visibleToClient: e.target.checked })} label={<span className="font-medium">{t('finance.shareWithClient')}</span>} />
                  <p className="mt-1.5 ps-6 text-xs leading-relaxed text-zinc-500">{i.status === 'DRAFT' ? t('finance.shareDraftHint') : t('finance.shareInvoiceExplain')}</p>
                </div>
              ) : <p className="text-xs leading-relaxed text-zinc-500">{isAdmin ? t('finance.lockedHintAdmin') : t('finance.lockedHint')}</p>}
            </div>
          )}

          {staff && i.notes && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-zinc-700">{t('finance.internalNotes')} <span className="ms-1 text-xs font-normal text-zinc-400">{t('common.internalOnly')}</span></h3>
              <p className="whitespace-pre-wrap rounded-xl bg-amber-50/60 p-3.5 text-sm leading-relaxed text-zinc-800 ring-1 ring-inset ring-amber-100">{i.notes}</p>
            </section>
          )}

          <section>
            <h3 className="mb-3 text-[13px] font-semibold text-zinc-700">{t('finance.attachments')}</h3>
            <Attachments field="invoiceId" parentId={i.id} files={i.files ?? []} canManage={staff && manage && !locked} />
          </section>
        </div>
      )}

      {editing && i && <InvoiceFormModal open onClose={() => setEditing(false)} invoice={i} />}

      <Modal
        open={action === 'paid'} onClose={() => setAction(null)} size="sm" title={t('finance.markPaidTitle')} description={t('finance.markPaidHint')}
        footer={<><Button variant="secondary" onClick={() => setAction(null)}>{t('common.cancel')}</Button><Button variant="success" loading={patch.isPending} onClick={() => patch.mutate({ status: 'PAID', paidAt })}>{t('finance.markPaid')}</Button></>}
      >
        <Field label={t('finance.paidOn')} error={fieldText(t, paidErrs.paidAt)}>{(fid) => <Input id={fid} type="date" value={paidAt} max={todayStr()} onChange={(e) => setPaidAt(e.target.value)} />}</Field>
      </Modal>
      <Modal
        open={action === 'reverse'} onClose={() => setAction(null)} size="sm" title={t('finance.reverseTitle')} description={t('finance.reverseHint')}
        footer={<><Button variant="secondary" onClick={() => setAction(null)}>{t('common.cancel')}</Button><Button loading={patch.isPending} onClick={() => patch.mutate({ status: reverseTo })}>{t('finance.reverseStatus')}</Button></>}
      >
        <Field label={t('finance.newStatus')}>
          {(fid) => (
            <Select id={fid} value={reverseTo} onChange={(e) => setReverseTo(e.target.value)}>
              {['DRAFT', 'SENT', 'PENDING', 'OVERDUE', 'PAID', 'CANCELLED'].filter((s) => s !== i?.status).map((s) => <option key={s} value={s}>{label('invoiceStatus', s)}</option>)}
            </Select>
          )}
        </Field>
      </Modal>
      <ConfirmDialog
        open={action === 'cancel'} onClose={() => setAction(null)} onConfirm={() => patch.mutate({ status: 'CANCELLED' })} loading={patch.isPending}
        title={t('finance.cancelTitle')} message={t('finance.cancelMessage')} confirmLabel={t('finance.cancelInvoice')}
      />
      <ConfirmDialog
        open={action === 'delete'} onClose={() => setAction(null)} onConfirm={() => del.mutate(undefined)} loading={del.isPending}
        title={t('finance.deleteInvoiceTitle')} message={t('finance.deleteInvoiceMessage')} confirmLabel={t('common.delete')}
      />
    </Drawer>
  );
}
