import { useState } from 'react';
import { File as FileIcon, FileText, Image as ImageIcon, Film, Music, Sheet, Archive, Building2 } from 'lucide-react';
import { clientLogoUrl, fileUrl } from '@/api/client';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';

export function FileTypeIcon({ mime, className }: { mime: string; className?: string }) {
  const c = cx('size-5', className);
  if (mime.startsWith('image/')) return <ImageIcon className={c} />;
  if (mime.startsWith('video/')) return <Film className={c} />;
  if (mime.startsWith('audio/')) return <Music className={c} />;
  if (mime === 'application/pdf' || mime.startsWith('text/plain')) return <FileText className={c} />;
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv') return <Sheet className={c} />;
  if (mime.includes('zip')) return <Archive className={c} />;
  return <FileIcon className={c} />;
}

/** Company logo (uploaded) or initials fallback. */
export function CompanyMark({ clientId, name, hasLogo, size = 'md' }: { clientId: string; name: string; hasLogo?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const [failed, setFailed] = useState(false);
  const sz = { sm: 'size-8', md: 'size-10', lg: 'size-12', xl: 'size-16' }[size];
  if (hasLogo && !failed) {
    return <img src={clientLogoUrl(clientId)} alt="" onError={() => setFailed(true)} className={cx('shrink-0 rounded-xl border border-line bg-white object-contain p-1', sz)} />;
  }
  if (!hasLogo) return <Avatar name={name} size={size === 'sm' ? 'sm' : size === 'md' ? 'md' : size === 'lg' ? 'lg' : 'xl'} className="rounded-xl" />;
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500', sz)}>
      <Building2 className="size-5" />
    </span>
  );
}

/** Image thumbnail/preview for a deliverable (uploaded image or external image URL) or a neutral placeholder. */
export function DeliverablePreview({ fileId, previewUrl, name, className, large }: { fileId?: string | null; previewUrl?: string | null; name: string; className?: string; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const looksLikeImage = previewUrl ? /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(previewUrl) : false;
  const src = fileId ? fileUrl(fileId, true) : looksLikeImage ? previewUrl! : null;
  return (
    <div className={cx('relative overflow-hidden bg-gradient-to-br from-zinc-100 to-zinc-200', className)}>
      {src && !broken ? (
        <img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cx('size-full', large ? 'object-contain' : 'object-cover')} />
      ) : (
        <div className="flex size-full items-center justify-center text-zinc-400">
          <ImageIcon className={large ? 'size-14' : 'size-6'} strokeWidth={1.4} />
        </div>
      )}
    </div>
  );
}

export function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const tone = pct >= 100 ? 'bg-rose-500' : pct >= 85 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}
