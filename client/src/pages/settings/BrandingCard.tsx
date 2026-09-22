import { useRef, useState } from 'react';
import { ImagePlus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import { DEFAULT_BRANDING, type BrandingInfo } from '@/api/types.admin';
import { useI18n } from '@/i18n';
import { fieldErrors } from '@/i18n/errors';
import { brandScale } from '@/components/layout/BrandingProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_BYTES = 1024 * 1024;

/** WCAG contrast of white text on a colour (the primary colour carries white button text). */
function contrastWhite(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 1.05 / (0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2) + 0.05);
}

function ColorField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const valid = HEX.test(value);
  return (
    <Field label={label} error={error}>
      {(id) => (
        <div className="flex items-center gap-2">
          <input type="color" aria-label={label} value={valid ? value.toLowerCase() : '#000000'} onChange={(e) => onChange(e.target.value)}
            className="size-10 shrink-0 cursor-pointer rounded-xl border border-line-strong bg-white p-1" />
          <Input id={id} dir="ltr" value={value} maxLength={7} spellCheck={false} onChange={(e) => onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)} invalid={!valid || !!error} className="w-32 font-mono text-start uppercase" />
        </div>
      )}
    </Field>
  );
}

function ImageSlot({ slot, title, hint, accept, has, version, preview }: { slot: 'logo' | 'favicon'; title: string; hint: string; accept: string; has: boolean; version: string; preview: 'wide' | 'square' }) {
  const { t } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [broken, setBroken] = useState(false);
  const upload = useAction((file: File) => { const f = new FormData(); f.append('file', file); return api.upload(`/branding/${slot}`, f); }, { success: t('admin.brand.imageSaved'), onSuccess: () => setBroken(false) });
  const remove = useAction(() => api.del(`/branding/${slot}`), { success: t('admin.brand.imageRemoved'), onSuccess: () => setConfirm(false) });

  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!/\.(png|jpe?g|webp|ico)$/i.test(file.name)) return toast.error(t('error.FILE_TYPE_NOT_ALLOWED'));
    if (file.size > MAX_BYTES) return toast.error(t('admin.brand.tooLarge'));
    upload.mutate(file);
  };

  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-[13px] font-medium text-zinc-700">{title}</p>
      <div className="mt-3 flex items-center gap-4">
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-zinc-50 ${preview === 'wide' ? 'h-16 w-28' : 'size-16'}`}>
          {has && !broken ? <img src={`/api/branding/${slot}?v=${version}`} alt="" onError={() => setBroken(true)} className="size-full object-contain p-1.5" /> : <ImagePlus className="size-6 text-zinc-300" strokeWidth={1.5} />}
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-zinc-500">{hint}</p>
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept={accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-label={title} />
            <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>{has ? t('admin.brand.replace') : t('admin.brand.upload')}</Button>
            {has && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm(true)} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">{t('common.remove')}</Button>}
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} title={t('admin.brand.removeTitle', { name: title })} message={t('admin.brand.removeMessage')} confirmLabel={t('common.remove')} />
    </div>
  );
}

function BrandingForm({ data }: { data: BrandingInfo }) {
  const { t } = useI18n();
  const [name, setName] = useState(data.agencyName);
  const [primary, setPrimary] = useState(data.primaryColor);
  const [secondary, setSecondary] = useState(data.secondaryColor);
  const [resetting, setResetting] = useState(false);
  const validPrimary = HEX.test(primary);
  const validSecondary = HEX.test(secondary);
  const nameOk = name.trim().length >= 1 && name.trim().length <= 60;
  const dirty = name.trim() !== data.agencyName || primary.toLowerCase() !== data.primaryColor || secondary.toLowerCase() !== data.secondaryColor;
  const lowContrast = validPrimary && contrastWhite(primary) < 4.5;

  const save = useAction(
    (body: { agencyName: string; primaryColor: string; secondaryColor: string }) => api.put('/branding', body),
    { success: t('admin.brand.saved') },
  );
  const errs = fieldErrors(save.error);
  const colorErr = (k: string) => (errs[k] ? t('admin.brand.invalidColor') : undefined);
  const scale = brandScale(validPrimary ? primary : DEFAULT_BRANDING.primaryColor);
  const previewSidebar = validSecondary ? secondary : DEFAULT_BRANDING.secondaryColor;
  const version = String(new Date(data.updatedAt).getTime() || 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <form onSubmit={(e) => { e.preventDefault(); if (dirty && nameOk && validPrimary && validSecondary) save.mutate({ agencyName: name.trim(), primaryColor: primary.toLowerCase(), secondaryColor: secondary.toLowerCase() }); }} className="space-y-5">
        <Field label={t('admin.brand.agencyName')} hint={t('admin.brand.agencyNameHint')} error={errs.agencyName ? t('admin.brand.nameInvalid') : undefined}>
          {(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} invalid={!nameOk || !!errs.agencyName} className="sm:max-w-sm" />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <ColorField label={t('admin.brand.primary')} value={primary} onChange={setPrimary} error={colorErr('primaryColor')} />
          <ColorField label={t('admin.brand.secondary')} value={secondary} onChange={setSecondary} error={colorErr('secondaryColor')} />
        </div>
        <p className="-mt-2 text-xs text-zinc-500">{t('admin.brand.colorHint')}</p>
        {lowContrast && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />{t('admin.brand.contrastWarning')}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty || !nameOk || !validPrimary || !validSecondary}>{t('common.saveChanges')}</Button>
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setResetting(true)}
            disabled={data.agencyName === DEFAULT_BRANDING.agencyName && data.primaryColor === DEFAULT_BRANDING.primaryColor && data.secondaryColor === DEFAULT_BRANDING.secondaryColor}>{t('admin.brand.reset')}</Button>
        </div>

        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <ImageSlot slot="logo" title={t('admin.brand.logo')} hint={t('admin.brand.logoHint')} accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" has={data.hasLogo} version={version} preview="wide" />
          <ImageSlot slot="favicon" title={t('admin.brand.favicon')} hint={t('admin.brand.faviconHint')} accept=".png,.ico,.jpg,.jpeg,.webp,image/png,image/x-icon,image/jpeg,image/webp" has={data.hasFavicon} version={version} preview="square" />
        </div>
      </form>

      {/* live preview: drawn with inline styles from validated colours only */}
      <div aria-label={t('admin.brand.preview')} className="self-start">
        <p className="mb-2 text-[13px] font-medium text-zinc-700">{t('admin.brand.preview')}</p>
        <div className="overflow-hidden rounded-2xl border border-line shadow-card">
          <div className="p-4" style={{ background: previewSidebar }}>
            <div className="flex items-center gap-2.5">
              {data.hasLogo ? <img src={`/api/branding/logo?v=${version}`} alt="" className="size-8 rounded-lg bg-white object-contain p-0.5" /> : <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-white">{(name.trim()[0] ?? 'O').toUpperCase()}</span>}
              <span className="truncate text-sm font-semibold text-white">{name.trim() || DEFAULT_BRANDING.agencyName}</span>
            </div>
            <div className="mt-4 space-y-1.5">
              <div className="h-7 rounded-lg bg-white/10 px-2.5 text-xs leading-7 text-white">{t('nav.dashboard')}</div>
              <div className="h-7 rounded-lg px-2.5 text-xs leading-7 text-zinc-400">{t('nav.clients')}</div>
            </div>
          </div>
          <div className="space-y-3 bg-white p-4">
            <span className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-medium text-white" style={{ background: scale?.['600'] }}>{t('common.saveChanges')}</span>
            <div className="flex gap-1.5" aria-hidden>
              {(['50', '100', '200', '400', '500', '600', '700', '900'] as const).map((k) => <span key={k} className="h-5 flex-1 rounded" style={{ background: scale?.[k] }} />)}
            </div>
            <span className="inline-block rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: scale?.['50'], color: scale?.['700'] }}>{t('admin.brand.badge')}</span>
          </div>
        </div>
      </div>

      <ConfirmDialog open={resetting} onClose={() => setResetting(false)} tone="primary" loading={save.isPending}
        title={t('admin.brand.reset')} message={t('admin.brand.resetMessage')} confirmLabel={t('admin.brand.reset')}
        onConfirm={() => save.mutate({ agencyName: DEFAULT_BRANDING.agencyName, primaryColor: DEFAULT_BRANDING.primaryColor, secondaryColor: DEFAULT_BRANDING.secondaryColor }, {
          onSuccess: () => { setName(DEFAULT_BRANDING.agencyName); setPrimary(DEFAULT_BRANDING.primaryColor); setSecondary(DEFAULT_BRANDING.secondaryColor); setResetting(false); },
        })} />
    </div>
  );
}

/** ADMIN only (the page hides it for everyone else; the API refuses the writes anyway). */
export function BrandingCard() {
  const { t } = useI18n();
  const q = useApi<BrandingInfo>('/branding');
  return (
    <Card>
      <CardHeader title={t('admin.brand.title')} subtitle={t('admin.brand.subtitle')} />
      <CardBody>
        {q.data ? <BrandingForm key={q.data.updatedAt} data={q.data} /> : q.isError ? <p className="text-sm text-rose-600">{t('common.loadFailed')}</p> : <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-10 w-full max-w-md" /><Skeleton className="h-24 w-full" /></div>}
      </CardBody>
    </Card>
  );
}
