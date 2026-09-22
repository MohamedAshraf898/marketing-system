import { cx } from './cx';

const COLORS = ['bg-violet-100 text-violet-700', 'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-800'];

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function Avatar({ name, src, size = 'md', className }: { name: string; src?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const hash = Array.from(name).reduce((a, c) => (a * 31 + c.codePointAt(0)!) >>> 0, 7);
  const sz = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-12 text-base', xl: 'size-16 text-xl' }[size];
  if (src) return <img src={src} alt="" className={cx('shrink-0 rounded-full object-cover ring-1 ring-black/5', sz, className)} />;
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', sz, COLORS[hash % COLORS.length], className)}>
      {initials(name)}
    </span>
  );
}
