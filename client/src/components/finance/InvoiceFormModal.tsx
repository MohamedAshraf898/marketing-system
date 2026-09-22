import { useState } from 'react';
import { INVOICE_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { InvoiceRow } from '@/api/types.finance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useClientOptions } from '@/components/shared/options';
import { dayStr, round2, todayStr } from './FinanceShared';

const CREATE_STATUSES = INVOICE_STATUSES.filter((s) => s === 'DRAFT' || s === 'SENT' || s === 'PENDING');
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Create / edit an invoice (internal agency invoicing: no payment provider). The total is always computed by the server. */
export function InvoiceFormModal({ open, onClose, invoice, defaultClientId, onSaved }: {
  open: boolean; onClose: () => void; invoice?: InvoiceRow; defaultClientId?: string; onSaved?: (i: InvoiceRow) => void;
}) {
  const { t, fmt, label } = useI18n();
  const { can } = useAuth();
  const editing = !!invoice;
  const { clients } = useClientOptions(open);
  const [f, setF] = useState(() => ({
    clientId: invoice?.clientId ?? defaultClientId ?? '', projectId: invoice?.project?.id ?? '', status: 'DRAFT' as InvoiceRow['status'],
    issueDate: dayStr(invoice?.issueDate) || todayStr(), dueDate: dayStr(invoice?.dueDate) || addDays(todayStr(), 30),
    amount: invoice ? String(invoice.amount) : '', tax: invoice ? String(invoice.tax) : '0',
    description: invoice?.description ?? '', notes: invoice?.notes ?? '', visibleToClient: invoice?.visibleToClient ?? false,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const projects = useApi<Paged<{ id: string; name: string }>>('/projects', { clientId: f.clientId, pageSize: 100 }, { enabled: open && !!f.clientId && can('projects.view') });

  const amount = Number(f.amount || 0);
  const tax = Number(f.tax || 0);
  const total = round2((Number.isFinite(amount) ? amount : 0) + (Number.isFinite(tax) ? tax : 0));

  const save = useAction(
    async () => {
      const body = {
        projectId: f.projectId || null, issueDate: f.issueDate, dueDate: f.dueDate, amount, tax,
        description: f.description.trim() || null, notes: f.notes.trim() || null, visibleToClient: f.visibleToClient,
      };
      const res = editing
        ? await api.patch<{ item: InvoiceRow }>(`/invoices/${invoice!.id}`, body)
        : await api.post<{ item: InvoiceRow }>('/invoices', { ...body, clientId: f.clientId, status: f.status });
      return res.item;
    },
    { success: editing ? t('finance.invoiceUpdated') : t('finance.invoiceCreated'), onSuccess: (item) => { onClose(); onSaved?.(item); } },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open={open} onClose={onClose} size="lg"
      title={editing ? t('finance.editInvoice') : t('finance.newInvoice')}
      description={editing ? invoice!.invoiceNumber : t('finance.numberAuto')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button variant="brand" onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.amount || (!editing && !f.clientId)} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('finance.createInvoice')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.client')} error={err('clientId')} required>
          {(id) => (
            <Select id={id} value={f.clientId} onChange={(e) => { set('clientId', e.target.value); set('projectId', ''); }} disabled={editing} invalid={!!errs.clientId}>
              <option value="">{t('common.select')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.project')} hint={t('common.optional')} error={err('projectId')}>
          {(id) => (
            <Select id={id} value={f.projectId} onChange={(e) => set('projectId', e.target.value)} disabled={!f.clientId || !can('projects.view')} invalid={!!errs.projectId}>
              <option value="">{t('finance.noProject')}</option>
              {(projects.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('finance.issueDate')} error={err('issueDate')} required>{(id) => <Input id={id} type="date" value={f.issueDate} onChange={(e) => set('issueDate', e.target.value)} invalid={!!errs.issueDate} />}</Field>
        <Field label={t('finance.dueDate')} error={err('dueDate')} required>{(id) => <Input id={id} type="date" value={f.dueDate} min={f.issueDate} onChange={(e) => set('dueDate', e.target.value)} invalid={!!errs.dueDate} />}</Field>
        <Field label={t('finance.amount')} hint={t('finance.amountHint')} error={err('amount')} required>{(id) => <Input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} invalid={!!errs.amount} />}</Field>
        <Field label={t('finance.tax')} hint={t('finance.taxHint')} error={err('tax')}>{(id) => <Input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={f.tax} onChange={(e) => set('tax', e.target.value)} invalid={!!errs.tax} />}</Field>
        <div className="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 text-white sm:col-span-2">
          <span className="text-sm text-zinc-300">{t('finance.totalPreview')}</span>
          <span className="text-lg font-semibold tabular">{fmt.money(total, { decimals: 2 })}</span>
        </div>
        {!editing && (
          <Field label={t('common.status')} error={err('status')} className="sm:col-span-2">{(id) => <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value as InvoiceRow['status'])}>{CREATE_STATUSES.map((s) => <option key={s} value={s}>{label('invoiceStatus', s)}</option>)}</Select>}</Field>
        )}
        <Field label={t('common.description')} hint={t('finance.descriptionHint')} error={err('description')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} maxLength={2000} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
        <Field label={t('finance.internalNotes')} hint={t('common.internalOnly')} error={err('notes')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} maxLength={4000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
        <div className="rounded-xl border border-line bg-zinc-50 p-4 sm:col-span-2">
          <Checkbox checked={f.visibleToClient} onChange={(e) => set('visibleToClient', e.target.checked)} label={<span className="font-medium">{t('finance.shareWithClient')}</span>} />
          <p className="mt-1.5 ps-6 text-xs leading-relaxed text-zinc-500">{t('finance.shareInvoiceExplain')}</p>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
