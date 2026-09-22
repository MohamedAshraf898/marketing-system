import type { ReactNode } from 'react';
import { cx } from './cx';

const TONES = { brand: 'bg-brand-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', blue: 'bg-sky-500', zinc: 'bg-zinc-400' } as const;

/**
 * Horizontal progress / capacity bar. The fill is clamped to 100% but the label can show more (e.g. 120% workload).
 * `tone="auto"` = green under 70%, amber 70-100%, red above (useful for workload / budget).
 */
export function ProgressBar({ value, max = 100, tone = 'brand', label, size = 'md', className }: {
  value: number; max?: number; tone?: keyof typeof TONES | 'auto'; label?: ReactNode; size?: 'sm' | 'md'; className?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const shown = Math.max(0, Math.min(100, pct));
  const t = tone === 'auto' ? (pct > 100 ? 'red' : pct >= 70 ? 'amber' : 'green') : tone;
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <div className={cx('w-full overflow-hidden rounded-full bg-zinc-100', size === 'sm' ? 'h-1.5' : 'h-2.5')} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx('h-full rounded-full transition-[width] duration-300', TONES[t])} style={{ width: `${shown}%` }} />
      </div>
      {label !== undefined && <span className="shrink-0 text-xs font-medium text-zinc-600 tabular">{label}</span>}
    </div>
  );
}
