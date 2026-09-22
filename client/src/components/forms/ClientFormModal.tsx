import { useRef, useState } from 'react';
import { CLIENT_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { Client } from '@/api/types';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { CompanyMark } from '@/components/shared/Media';

/** Admin-only: create / edit a client company (+ optional logo). */
export function ClientFormModal({ open, onClose, client, onCreated }: { open: boolean; onClose: () => void; client?: Client; onCreated?: (id: string) => void }) {
  const { t, label } = useI18n();
  const toast = useToast();
  const editing = !!client;
  const [f, setF] = useState({ companyName: client?.companyName ?? '', name: client?.name ?? '', email: client?.email ?? '', phone: client?.phone ?? '', status: client?.status ?? 'ACTIVE' });
  const [logo, setLogo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = useAction(
    async () => {
      const body = { companyName: f.companyName, name: f.name, email: f.email, phone: f.phone || null, status: f.status };
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
        <Field label={t('client.companyName')} required error={err('companyName')} className="sm:col-span-2">{(id) => <Input id={id} value={f.companyName} onChange={(e) => set('companyName', e.target.value)} invalid={!!errs.companyName} maxLength={160} />}</Field>
        <Field label={t('client.contactName')} required error={err('name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} maxLength={120} />}</Field>
        <Field label={t('common.email')} required error={err('email')}>{(id) => <Input id={id} type="email" dir="ltr" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errs.email} />}</Field>
        <Field label={t('common.phone')} hint={t('common.optional')} error={err('phone')}>{(id) => <Input id={id} type="tel" dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
        <Field label={t('common.status')}>{(id) => <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value)}>{CLIENT_STATUSES.map((s) => <option key={s} value={s}>{label('clientStatus', s)}</option>)}</Select>}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
