import { useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { Field, Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';

function ProfileCard() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const save = useAction(() => api.patch('/me', { name }), { success: t('settings.profileSaved'), onSuccess: () => void refresh() });
  const errs = fieldErrors(save.error);
  if (!user) return null;
  return (
    <Card>
      <CardHeader title={t('settings.profile')} />
      <CardBody>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={user.name} size="xl" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-zinc-900">{user.name}</p>
            <p dir="ltr" className="truncate text-start text-sm text-zinc-500">{user.email}</p>
            <div className="mt-1.5 flex items-center gap-2"><StatusBadge group="role" value={user.role} />{user.client && <span className="text-xs text-zinc-500">{user.client.companyName}</span>}</div>
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(undefined); }} className="grid gap-4 sm:max-w-md">
          <Field label={t('common.name')} error={fieldText(t, errs.name)}>{(id) => <Input id={id} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} invalid={!!errs.name} />}</Field>
          <div><Button type="submit" loading={save.isPending} disabled={!name.trim() || name.trim() === user.name}>{t('common.saveChanges')}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

function LanguageCard() {
  const { t, locale } = useI18n();
  const { updateLocale } = useAuth();
  const options: Array<{ id: 'en' | 'ar'; name: string; hint: string }> = [
    { id: 'en', name: 'English', hint: 'Left-to-right' },
    { id: 'ar', name: 'العربية', hint: 'من اليمين إلى اليسار' },
  ];
  return (
    <Card>
      <CardHeader title={t('settings.language')} subtitle={t('settings.languageHint')} />
      <CardBody>
        <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
          {options.map((o) => (
            <button key={o.id} onClick={() => updateLocale(o.id)} lang={o.id} aria-pressed={locale === o.id}
              className={cx('flex items-center justify-between rounded-xl border px-4 py-3 text-start transition', locale === o.id ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-100' : 'border-line-strong bg-white hover:bg-zinc-50')}>
              <span><span className="block text-sm font-semibold text-zinc-900">{o.name}</span><span className="block text-xs text-zinc-500">{o.hint}</span></span>
              {locale === o.id && <Check className="size-5 text-brand-600" />}
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useI18n();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const mismatch = f.confirm !== '' && f.next !== f.confirm;
  const save = useAction(() => api.patch('/me', { currentPassword: f.current, newPassword: f.next }), { success: t('settings.passwordChanged'), onSuccess: () => setF({ current: '', next: '', confirm: '' }) });
  const errs = fieldErrors(save.error);
  return (
    <Card>
      <CardHeader title={t('settings.password')} subtitle={t('settings.passwordHint')} />
      <CardBody>
        <form onSubmit={(e) => { e.preventDefault(); if (!mismatch) save.mutate(undefined); }} className="grid gap-4 sm:max-w-md" autoComplete="off">
          <Field label={t('settings.currentPassword')} error={fieldText(t, errs.currentPassword)}>{(id) => <Input id={id} type="password" dir="ltr" autoComplete="current-password" value={f.current} onChange={(e) => set('current', e.target.value)} invalid={!!errs.currentPassword} />}</Field>
          <Field label={t('settings.newPassword')} hint={t('user.passwordRules')} error={fieldText(t, errs.newPassword)}>{(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={f.next} onChange={(e) => set('next', e.target.value)} invalid={!!errs.newPassword} />}</Field>
          <Field label={t('settings.confirmPassword')} error={mismatch ? t('settings.passwordMismatch') : undefined}>{(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} invalid={mismatch} />}</Field>
          <div><Button type="submit" loading={save.isPending} disabled={!f.current || !f.next || !f.confirm || mismatch}>{t('settings.changePassword')}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="space-y-5"><ProfileCard /><LanguageCard /><PasswordCard /></div>
    </div>
  );
}
