import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, BarChart3, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { errorText, fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { LogoMark, Wordmark } from '@/components/layout/Logo';
import { useBranding } from '@/components/layout/BrandingProvider';

export function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuth();
  const { agencyName } = useBranding();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    try {
      await login(email.trim(), password);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setFields(fieldErrors(err));
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const points = [
    { icon: CheckCircle2, text: t('login.point1') },
    { icon: BarChart3, text: t('login.point2') },
    { icon: ShieldCheck, text: t('login.point3') },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <div className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -end-32 -top-32 size-[34rem] rounded-full bg-brand-600/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -start-24 size-[30rem] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-10" />
          <Wordmark dark />
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl font-semibold leading-[1.15] tracking-tight">{t('login.headline')}</h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-400">{t('login.subheadline')}</p>
          <ul className="mt-10 space-y-4">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px] text-zinc-200">
                <span className="flex size-9 items-center justify-center rounded-xl bg-white/10"><Icon className="size-[18px] text-brand-400" /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-zinc-500">© {new Date().getFullYear()} {agencyName}</p>
      </div>

      {/* form */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 sm:px-8">
          <div className="flex items-center gap-2.5 lg:invisible"><LogoMark className="size-9" /><Wordmark /></div>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">{t('login.title')}</h2>
            <p className="mt-1.5 text-sm text-zinc-500">{t('login.subtitle')}</p>

            {error && (
              <div role="alert" className="og-pop mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            )}

            <div className="mt-6 space-y-4">
              <Field label={t('auth.email')} error={fieldText(t, fields.email)}>
                {(id) => (
                  <div className="relative">
                    <Mail className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                    <Input id={id} type="email" autoComplete="email" inputMode="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="ps-10 text-start" invalid={!!fields.email} required />
                  </div>
                )}
              </Field>
              <Field label={t('auth.password')} error={fieldText(t, fields.password)}>
                {(id) => (
                  <div className="relative">
                    <Lock className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                    <Input id={id} type={show ? 'text' : 'password'} autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} className="px-10 text-start" invalid={!!fields.password} required />
                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')} className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 hover:text-zinc-700">
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                )}
              </Field>
            </div>

            <Button type="submit" size="lg" className="mt-6 w-full" loading={busy} disabled={!email || !password}>
              {t('auth.login')}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
            <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">{t('login.help')}</p>
          </form>
        </div>
      </div>
    </div>
  );
}
