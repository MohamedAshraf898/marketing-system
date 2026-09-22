import { useRef, useState, type KeyboardEvent } from 'react';
import { Lock, X } from 'lucide-react';
import { CLIENT_STATUSES, CLIENT_TYPES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { Client } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { CompanyMark } from '@/components/shared/Media';
import { useTeamMembers } from '@/components/shared/options';

const dayInput = (d: string | null | undefined) => (d ? d.slice(0, 10) : '');

/** Chip input: Enter or comma adds a tag, Backspace on an empty field removes the last one. */
function TagsInput({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; id: string }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim().replace(/,+$/, '').slice(0, 30);
    if (v && !value.includes(v) && value.length < 20) onChange([...value, v]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-line-strong bg-white px-2.5 py-1.5 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 ps-2.5 pe-1 text-xs font-medium text-zinc-700">
          {tag}
          <button type="button" aria-label={tag} onClick={() => onChange(value.filter((x) => x !== tag))} className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"><X className="size-3" /></button>
        </span>
      ))}
      <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} placeholder={value.length ? '' : placeholder} maxLength={31} className="min-w-24 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-zinc-400" />
    </div>
  );
}

const SectionTitle = ({ children, internal }: { children: string; internal?: boolean }) => (
  <h3 className="flex items-center gap-1.5 border-b border-line pb-2 pt-1 text-[12px] font-semibold uppercase tracking-wide text-zinc-500 sm:col-span-2">
    {internal && <Lock className="size-3.5 text-amber-600" />}{children}
  </h3>
);

/** Create / edit a client company (+ optional logo). Fields are limited to what the signed-in user may change. */
export function ClientFormModal({ open, onClose, client, onCreated }: { open: boolean; onClose: () => void; client?: Client; onCreated?: (id: string) => void }) {
  const { t, label } = useI18n();
  const { user, can } = useAuth();
  const toast = useToast();
  const editing = !!client;
  const isAdmin = user?.role === 'ADMIN';
  const canMoney = can('invoices.manage') || can('contracts.manage');
  const canInternal = can('notes.internal');
  const [f, setF] = useState({
    companyName: client?.companyName ?? '', name: client?.name ?? '', email: client?.email ?? '', phone: client?.phone ?? '', status: client?.status ?? 'ACTIVE',
    industry: client?.industry ?? '', website: client?.website ?? '', clientType: client?.clientType ?? 'BUSINESS', address: client?.address ?? '', city: client?.city ?? '', country: client?.country ?? '',
    leadSource: client?.leadSource ?? '', accountManagerId: client?.accountManagerId ?? '', clientSince: dayInput(client?.clientSince), contractStart: dayInput(client?.contractStart), contractEnd: dayInput(client?.contractEnd),
    monthlyRetainer: client?.monthlyRetainer != null ? String(client.monthlyRetainer) : '', notes: client?.notes ?? '', internalNotes: client?.internalNotes ?? '',
  });
  const [tags, setTags] = useState<string[]>(client?.tags ?? []);
  const [logo, setLogo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  // an administrator can pick any team member; everybody else only administrators or themselves (the API enforces the same rule)
  const members = useTeamMembers(isAdmin ? undefined : client?.id, open);
  const managers = isAdmin ? members : members.filter((m) => m.role === 'ADMIN' || m.id === user?.id);
  const canArchive = can('clients.delete');

  const save = useAction(
    async () => {
      const blank = (v: string) => v.trim() || null;
      const body: Record<string, unknown> = {
        companyName: f.companyName, name: f.name, email: f.email, phone: blank(f.phone), status: f.status,
        industry: blank(f.industry), website: blank(f.website), clientType: f.clientType, address: blank(f.address), city: blank(f.city), country: blank(f.country),
        leadSource: blank(f.leadSource), accountManagerId: f.accountManagerId || null, tags, notes: blank(f.notes),
        clientSince: f.clientSince || null, contractStart: f.contractStart || null, contractEnd: f.contractEnd || null,
        ...(canMoney ? { monthlyRetainer: f.monthlyRetainer === '' ? null : Number(f.monthlyRetainer) } : {}),
        ...(canInternal ? { internalNotes: blank(f.internalNotes) } : {}),
      };
      const res = editing ? await api.patch<{ item: Client }>(`/clients/${client!.id}`, body) : await api.post<{ item: Client }>('/clients', body);
      if (logo) {
        const form = new FormData();
        form.append('file', logo);
        try { await api.upload(`/clients/${res.item.id}/logo`, form); } catch { toast.error(t('client.logoFailed')); }
      }
      return res;
    },
    { success: editing ? t('client.updated') : t('client.created'), onSuccess: (res) => { onClose(); if (!editing) onCreated?.(res.item.id); } },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);
  const preview = logo ? URL.createObjectURL(logo) : null;
  const statuses = CLIENT_STATUSES.filter((s) => s !== 'ARCHIVED' || canArchive || f.status === 'ARCHIVED');
  const statusLocked = !canArchive && client?.status === 'ARCHIVED';

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={editing ? t('client.edit') : t('client.new')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.companyName || !f.name || !f.email} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('client.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-4 sm:col-span-2">
          {preview ? <img src={preview} alt="" className="size-16 rounded-xl border border-line bg-white object-contain p-1" /> : <CompanyMark clientId={client?.id ?? 'new'} name={f.companyName || '?'} hasLogo={client?.hasLogo} size="xl" />}
          <div>
            <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.gif" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) setLogo(file); e.target.value = ''; }} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>{t('client.uploadLogo')}</Button>
            <p className="mt-1.5 text-xs text-zinc-500">{t('client.logoHint')}</p>
          </div>
        </div>

        <SectionTitle>{t('crm.form.sectionCompany')}</SectionTitle>
        <Field label={t('client.companyName')} required error={err('companyName')} className="sm:col-span-2">{(id) => <Input id={id} value={f.companyName} onChange={(e) => set('companyName', e.target.value)} invalid={!!errs.companyName} maxLength={160} />}</Field>
        <Field label={t('client.contactName')} required error={err('name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} maxLength={120} />}</Field>
        <Field label={t('common.email')} required error={err('email')}>{(id) => <Input id={id} type="email" dir="ltr" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errs.email} />}</Field>
        <Field label={t('common.phone')} hint={t('common.optional')} error={err('phone')}>{(id) => <Input id={id} type="tel" dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
        <Field label={t('crm.field.website')} hint={t('common.optional')} error={err('website')}>{(id) => <Input id={id} type="url" dir="ltr" placeholder="https://" value={f.website} onChange={(e) => set('website', e.target.value)} invalid={!!errs.website} maxLength={300} />}</Field>
        <Field label={t('crm.field.industry')} hint={t('common.optional')} error={err('industry')}>{(id) => <Input id={id} value={f.industry} onChange={(e) => set('industry', e.target.value)} maxLength={120} />}</Field>
        <Field label={t('crm.field.clientType')}>{(id) => <Select id={id} value={f.clientType} onChange={(e) => set('clientType', e.target.value)}>{CLIENT_TYPES.map((v) => <option key={v} value={v}>{label('clientType', v)}</option>)}</Select>}</Field>
        <Field label={t('crm.field.country')} hint={t('common.optional')} error={err('country')}>{(id) => <Input id={id} value={f.country} onChange={(e) => set('country', e.target.value)} maxLength={80} />}</Field>
        <Field label={t('crm.field.city')} hint={t('common.optional')} error={err('city')}>{(id) => <Input id={id} value={f.city} onChange={(e) => set('city', e.target.value)} maxLength={80} />}</Field>
        <Field label={t('crm.field.address')} hint={t('common.optional')} error={err('address')} className="sm:col-span-2">{(id) => <Input id={id} value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={300} />}</Field>
        <Field label={t('crm.field.noteForClient')} hint={t('crm.field.noteForClientHint')} error={err('notes')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} />}</Field>

        <SectionTitle internal>{t('crm.form.sectionRelationship')}</SectionTitle>
        <Field label={t('common.status')} error={err('status')}>{(id) => <Select id={id} value={f.status} disabled={statusLocked} onChange={(e) => set('status', e.target.value)}>{statuses.map((s) => <option key={s} value={s}>{label('clientStatus', s)}</option>)}</Select>}</Field>
        <Field label={t('crm.field.accountManager')} error={err('accountManagerId')}>
          {(id) => (
            <Select id={id} value={f.accountManagerId} onChange={(e) => set('accountManagerId', e.target.value)} invalid={!!errs.accountManagerId}>
              <option value="">{t('common.unassigned')}</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('crm.field.leadSource')} hint={t('common.optional')} error={err('leadSource')}>{(id) => <Input id={id} value={f.leadSource} onChange={(e) => set('leadSource', e.target.value)} maxLength={120} />}</Field>
        <Field label={t('crm.field.clientSince')} hint={t('common.optional')} error={err('clientSince')}>{(id) => <Input id={id} type="date" value={f.clientSince} onChange={(e) => set('clientSince', e.target.value)} />}</Field>
        <Field label={t('crm.field.contractStart')} hint={t('common.optional')} error={err('contractStart')}>{(id) => <Input id={id} type="date" value={f.contractStart} max={f.contractEnd || undefined} onChange={(e) => set('contractStart', e.target.value)} />}</Field>
        <Field label={t('crm.field.contractEnd')} hint={t('common.optional')} error={err('contractEnd')}>{(id) => <Input id={id} type="date" value={f.contractEnd} min={f.contractStart || undefined} onChange={(e) => set('contractEnd', e.target.value)} invalid={!!errs.contractEnd} />}</Field>
        {canMoney && <Field label={t('crm.field.retainer')} hint={t('common.optional')} error={err('monthlyRetainer')}>{(id) => <Input id={id} type="number" min={0} step="0.01" dir="ltr" value={f.monthlyRetainer} onChange={(e) => set('monthlyRetainer', e.target.value)} invalid={!!errs.monthlyRetainer} />}</Field>}
        <Field label={t('crm.field.tags')} hint={t('crm.field.tagsHint')} error={err('tags')} className="sm:col-span-2">{(id) => <TagsInput id={id} value={tags} onChange={setTags} placeholder={t('crm.field.tagsPlaceholder')} />}</Field>
        {canInternal && <Field label={t('crm.field.internalNotes')} hint={t('crm.internalHint')} error={err('internalNotes')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={f.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} maxLength={8000} />}</Field>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
