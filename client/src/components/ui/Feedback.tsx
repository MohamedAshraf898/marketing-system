import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from './Button';
import { cx } from './cx';

export const Skeleton = ({ className }: { className?: string }) => <div className={cx('og-skeleton', className)} aria-hidden />;
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx('size-5 animate-spin text-zinc-400', className)} />;

export function SkeletonCards({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cx('grid gap-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-white p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-4 h-8 w-2/3" />
          <Skeleton className="mt-3 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-white">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, compact }: { icon: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-16')}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500 ring-8 ring-zinc-50">
        <Icon className="size-6" strokeWidth={1.6} />
      </div>
      <h3 className="text-[15px] font-semibold text-zinc-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/50 px-6 py-12 text-center">
      <AlertTriangle className="mb-3 size-8 text-rose-500" strokeWidth={1.6} />
      <h3 className="text-[15px] font-semibold text-zinc-900">{t('common.loadFailed')}</h3>
      <p className="mt-1 max-w-sm text-sm text-zinc-600">{message ?? t('common.loadFailedHint')}</p>
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}
