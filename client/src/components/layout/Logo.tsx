import { useState } from 'react';
import { cx } from '@/components/ui/cx';
import { useBranding } from './BrandingProvider';

/** The agency logo when one was uploaded (Settings > Branding), otherwise the built-in OG mark. */
export function LogoMark({ className }: { className?: string }) {
  const { logoUrl } = useBranding();
  const [failed, setFailed] = useState<string | null>(null);
  if (logoUrl && failed !== logoUrl) {
    return <img src={logoUrl} alt="" onError={() => setFailed(logoUrl)} className={cx('size-9 shrink-0 rounded-xl bg-white object-contain p-1', className)} />;
  }
  return (
    <svg viewBox="0 0 64 64" className={cx('size-9', className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#1b1c23" />
      <circle cx="32" cy="33" r="14" fill="none" stroke="#8b83ff" strokeWidth="7" />
      <circle cx="47" cy="17" r="5" fill="#8b83ff" />
    </svg>
  );
}

export function Wordmark({ dark }: { dark?: boolean }) {
  const { agencyName, customName } = useBranding();
  if (customName) {
    return <span className={cx('max-w-[11rem] truncate text-[17px] font-semibold tracking-tight', dark ? 'text-white' : 'text-zinc-900')} title={agencyName}>{agencyName}</span>;
  }
  return (
    <span className={cx('whitespace-nowrap text-[17px] font-semibold tracking-tight', dark ? 'text-white' : 'text-zinc-900')}>
      OG <span className={dark ? 'text-brand-400' : 'text-brand-600'}>System</span>
    </span>
  );
}
