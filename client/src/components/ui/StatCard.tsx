import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Skeleton } from './Feedback';
import { cx } from './cx';

export function StatCard({ label, value, icon: Icon, hint, tone = 'zinc', loading }: { label: ReactNode; value: ReactNode; icon: LucideIcon; hint?: ReactNode; tone?: 'zinc' | 'brand' | 'amber' | 'emerald' | 'sky'; loading?: boolean }) {
  const tones = {
    zinc: 'bg-zinc-100 text-zinc-600',
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    sky: 'bg-sky-50 text-sky-700',
  } as const;
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-zinc-500">{label}</p>
        <span className={cx('flex size-8 items-center justify-center rounded-lg', tones[tone])}>
          <Icon className="size-4" strokeWidth={2} />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-zinc-900 tabular sm:text-[30px]">{value}</p>
      )}
      {hint && <p className="mt-2 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
