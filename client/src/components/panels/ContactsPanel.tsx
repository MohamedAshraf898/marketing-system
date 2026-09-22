import { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, MessageCircle, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { ContactRow } from '@/api/types.crm';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { cx } from '@/components/ui/cx';

const whatsappHref = (n: string) => {
  const digits = n.replace(/[^\d]/g, '');
  return digits ? `https://wa.me/${digits}` : null;
};

/** People at the client company. Staff manage them; client users only see the ones flagged visible (never the notes). */
export function ContactsPanel({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const canManage = staff && can('contacts.manage');
  const [editing, setEditing] = useState<ContactRow | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<ContactRow | null>(null);
  const list = useApi<Paged<ContactRow>>(`/clients/${clientId}/contacts`, { pageSize: 100 });
  const makePrimary = useAction((c: ContactRow) => api.patch(`/contacts/${c.id}`, { isPrimary: true }), { success: t('crm.contact.primarySet') });
  const remove = useAction((c: ContactRow) => api.del(`/contacts/${c.id}`), { success: t('crm.contact.deleted'), onSuccess: () => setToDelete(null) });

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{t('crm.contact.add')}</Button>
        </div>
      )}
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : !list.data?.items.length ? (
        <EmptyState icon={Users} title={t('crm.contact.empty')} description={canManage ? t('crm.contact.emptyHint') : undefined} action={canManage ? <Button variant="brand" onClick={() => setEditing('new')}>{t('crm.contact.add')}</Button> : undefined} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.items.map((c) => {
            const wa = c.whatsapp ? whatsappHref(c.whatsapp) : null;
            return (
              <Card key={c.id} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={c.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-zinc-900">
                      <span className="truncate">{c.name}</span>
                      {c.isPrimary && <Star className="size-4 shrink-0 fill-amber-400 text-amber-500" aria-label={t('crm.contact.primary')} />}
                    </p>
                    {c.jobTitle && <p className="truncate text-[13px] text-zinc-500">{c.jobTitle}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {c.isPrimary && <Badge tone="amber" dot={false}>{t('crm.contact.primary')}</Badge>}
                      {staff && (c.visibleToClient === false
                        ? <Badge dot={false}><EyeOff className="size-3" />{t('crm.contact.hiddenFromClient')}</Badge>
                        : <Badge tone="green" dot={false}><Eye className="size-3" />{t('crm.contact.visibleToClient')}</Badge>)}
                    </div>
                  </div>
                  {canManage && (
                    <div className="-me-2 -mt-1 flex shrink-0">
                      {!c.isPrimary && <IconButton label={t('crm.contact.makePrimary')} className="size-9" onClick={() => makePrimary.mutate(c)}><Star className="size-[18px]" /></IconButton>}
                      <IconButton label={t('common.edit')} className="size-9" onClick={() => setEditing(c)}><Pencil className="size-[18px]" /></IconButton>
                      <IconButton label={t('common.delete')} className="size-9 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(c)}><Trash2 className="size-[18px]" /></IconButton>
                    </div>
                  )}
                </div>
                <div className="mt-4 space-y-1.5 text-sm">
                  {c.email && <a href={`mailto:${c.email}`} dir="ltr" className="flex items-center gap-2 text-start text-zinc-700 hover:text-brand-700"><Mail className="size-4 shrink-0 text-zinc-400" /><span className="truncate">{c.email}</span></a>}
                  {c.phone && <a href={`tel:${c.phone}`} dir="ltr" className="flex items-center gap-2 text-start text-zinc-700 hover:text-brand-700"><Phone className="size-4 shrink-0 text-zinc-400" /><span className="truncate">{c.phone}</span></a>}
                  {c.whatsapp && (wa
                    ? <a href={wa} target="_blank" rel="noopener noreferrer" dir="ltr" className="flex items-center gap-2 text-start text-zinc-700 hover:text-brand-700"><MessageCircle className="size-4 shrink-0 text-zinc-400" /><span className="truncate">{c.whatsapp}</span></a>
                    : <span dir="ltr" className="flex items-center gap-2 text-start text-zinc-700"><MessageCircle className="size-4 shrink-0 text-zinc-400" />{c.whatsapp}</span>)}
                </div>
                {staff && c.notes && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800"><Lock className="size-3" />{t('crm.internalLabel')}</p>
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">{c.notes}</p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editing && <ContactFormModal clientId={clientId} contact={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete)} loading={remove.isPending} title={t('crm.contact.deleteTitle')} message={t('crm.contact.deleteMessage', { name: toDelete?.name ?? '' })} confirmLabel={t('common.delete')} />
    </div>
  );
}

function ContactFormModal({ clientId, contact, onClose }: { clientId: string; contact?: ContactRow; onClose: () => void }) {
  const { t } = useI18n();
  const editing = !!contact;
  const [f, setF] = useState({
    name: contact?.name ?? '', jobTitle: contact?.jobTitle ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '', whatsapp: contact?.whatsapp ?? '',
    notes: contact?.notes ?? '', isPrimary: contact?.isPrimary ?? false, visibleToClient: contact?.visibleToClient ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useAction(
    () => {
      const body = { name: f.name, jobTitle: f.jobTitle || null, email: f.email || null, phone: f.phone || null, whatsapp: f.whatsapp || null, notes: f.notes || null, visibleToClient: f.visibleToClient, ...(f.isPrimary ? { isPrimary: true } : {}) };
      return editing ? api.patch(`/contacts/${contact.id}`, body) : api.post(`/clients/${clientId}/contacts`, body);
    },
    { success: editing ? t('crm.contact.updated') : t('crm.contact.created'), onSuccess: onClose },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open onClose={onClose} title={editing ? t('crm.contact.edit') : t('crm.contact.add')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.name.trim()} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('common.add')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} required error={err('name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} maxLength={120} />}</Field>
        <Field label={t('crm.contact.jobTitle')} hint={t('common.optional')} error={err('jobTitle')}>{(id) => <Input id={id} value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} maxLength={120} />}</Field>
        <Field label={t('common.email')} hint={t('common.optional')} error={err('email')}>{(id) => <Input id={id} type="email" dir="ltr" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errs.email} />}</Field>
        <Field label={t('common.phone')} hint={t('common.optional')} error={err('phone')}>{(id) => <Input id={id} type="tel" dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} />}</Field>
        <Field label={t('crm.contact.whatsapp')} hint={t('common.optional')} error={err('whatsapp')} className="sm:col-span-2">{(id) => <Input id={id} type="tel" dir="ltr" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} maxLength={40} />}</Field>
        <div className="space-y-2.5 sm:col-span-2">
          <Checkbox label={t('crm.contact.isPrimary')} checked={f.isPrimary} disabled={contact?.isPrimary} onChange={(e) => set('isPrimary', e.target.checked)} />
          <Checkbox label={t('crm.contact.showToClient')} checked={f.visibleToClient} onChange={(e) => set('visibleToClient', e.target.checked)} />
        </div>
        <Field label={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-amber-600" />{t('crm.contact.internalNotes')}</span>} hint={t('crm.contact.internalNotesHint')} error={err('notes')} className={cx('sm:col-span-2')}>
          {(id) => <Textarea id={id} rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} />}
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
