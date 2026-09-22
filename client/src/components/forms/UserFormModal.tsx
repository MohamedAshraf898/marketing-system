import { useState } from 'react';
import { LOCALES, ROLES, USER_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Campaign, Paged, UserRow } from '@/api/types';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useClientOptions } from '@/components/shared/options';

type Role = (typeof ROLES)[number];

/** Admin-only: create or edit a user. TEAM users also get a client / campaign assignment picker. */
export function UserFormModal({ open, onClose, user }: { open: boolean; onClose: () => void; user?: UserRow }) {
  const { t, label } = useI18n();
  const editing = !!user;
  const { clients } = useClientOptions(open);
  const campaignsQ = useApi<Paged<Campaign>>('/campaigns', { pageSize: 100 }, { enabled: open });
  const detail = useApi<{ item: UserRow }>(editing ? `/users/${user!.id}` : null, undefined, { enabled: open && editing });
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', password: '', role: (user?.role ?? 'TEAM') as Role, clientId: user?.clientId ?? '', status: user?.status ?? 'ACTIVE', locale: user?.locale ?? 'en' });
  const [clientIds, setClientIds] = useState<string[] | null>(null);
  const [campaignIds, setCampaignIds] = useState<string[] | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  // assignments: while editing they come from the detail request until the admin changes them
  const selClients = clientIds ?? detail.data?.item.clients?.map((c) => c.id) ?? [];
  const selCampaigns = campaignIds ?? detail.data?.item.campaigns?.map((c) => c.id) ?? [];
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = useAction(
    async () => {
      if (editing) {
        const body: Record<string, unknown> = { name: f.name, email: f.email, role: f.role, status: f.status, locale: f.locale, clientId: f.role === 'CLIENT' ? f.clientId : null };
        if (f.password) body.password = f.password;
        await api.patch(`/users/${user!.id}`, body);
        if (f.role === 'TEAM' && (clientIds || campaignIds)) await api.put(`/users/${user!.id}/assignments`, { clientIds: selClients, campaignIds: selCampaigns });
        return;
      }
      await api.post('/users', {
        name: f.name, email: f.email, password: f.password, role: f.role, locale: f.locale,
        ...(f.role === 'CLIENT' ? { clientId: f.clientId } : {}),
        ...(f.role === 'TEAM' ? { clientIds: selClients, campaignIds: selCampaigns } : {}),
      });
    },
    { success: editing ? t('user.updated') : t('user.created'), onSuccess: onClose },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);
  const campaigns = (campaignsQ.data?.items ?? []).filter((c) => !selClients.includes(c.clientId));

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={editing ? t('user.edit') : t('user.new')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.name || !f.email || (!editing && !f.password) || (f.role === 'CLIENT' && !f.clientId)} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('user.create')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2" autoComplete="off">
        <Field label={t('common.name')} required error={err('name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} maxLength={100} />}</Field>
        <Field label={t('common.email')} required error={err('email')}>{(id) => <Input id={id} type="email" dir="ltr" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errs.email} />}</Field>
        <Field label={editing ? t('user.newPassword') : t('auth.password')} required={!editing} hint={editing ? t('user.newPasswordHint') : t('user.passwordRules')} error={err('password')}>
          {(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} invalid={!!errs.password} />}
        </Field>
        <Field label={t('user.role')} error={err('role')}>{(id) => <Select id={id} value={f.role} onChange={(e) => set('role', e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{label('role', r)}</option>)}</Select>}</Field>
        {f.role === 'CLIENT' && (
          <Field label={t('client.title')} required error={err('clientId')} className="sm:col-span-2">
            {(id) => (
              <Select id={id} value={f.clientId} onChange={(e) => set('clientId', e.target.value)} invalid={!!errs.clientId}>
                <option value="">{t('common.select')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label={t('settings.language')}>{(id) => <Select id={id} value={f.locale} onChange={(e) => set('locale', e.target.value)}>{LOCALES.map((l) => <option key={l} value={l}>{l === 'ar' ? 'العربية' : 'English'}</option>)}</Select>}</Field>
        {editing && <Field label={t('common.status')}>{(id) => <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value)}>{USER_STATUSES.map((s) => <option key={s} value={s}>{label('userStatus', s)}</option>)}</Select>}</Field>}

        {f.role === 'TEAM' && (
          <div className="space-y-4 sm:col-span-2">
            <div>
              <p className="text-[13px] font-medium text-zinc-700">{t('user.assignedClients')}</p>
              <p className="mb-2 text-xs text-zinc-500">{t('user.assignedClientsHint')}</p>
              <div className="grid max-h-40 gap-2 overflow-y-auto rounded-xl border border-line p-3 sm:grid-cols-2">
                {clients.length === 0 && <p className="text-sm text-zinc-500">{t('common.none')}</p>}
                {clients.map((c) => <Checkbox key={c.id} checked={selClients.includes(c.id)} onChange={() => setClientIds(toggle(selClients, c.id))} label={c.companyName} />)}
              </div>
            </div>
            <div>
              <p className="text-[13px] font-medium text-zinc-700">{t('user.assignedCampaigns')}</p>
              <p className="mb-2 text-xs text-zinc-500">{t('user.assignedCampaignsHint')}</p>
              <div className="grid max-h-40 gap-2 overflow-y-auto rounded-xl border border-line p-3">
                {campaigns.length === 0 && <p className="text-sm text-zinc-500">{t('common.none')}</p>}
                {campaigns.map((c) => <Checkbox key={c.id} checked={selCampaigns.includes(c.id)} onChange={() => setCampaignIds(toggle(selCampaigns, c.id))} label={<span>{c.name} <span className="text-zinc-400">· {c.client?.companyName}</span></span>} />)}
              </div>
            </div>
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
