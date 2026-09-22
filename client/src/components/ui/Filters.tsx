import { useEffect, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Select } from './Form';
import { cx } from './cx';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mb-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-3', className)}>{children}</div>;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <div className="relative col-span-2 w-full sm:w-72">
      <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('common.search')}
        className="h-10 w-full rounded-xl border border-line-strong bg-white ps-10 pe-9 text-sm shadow-sm placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button onClick={() => onChange('')} aria-label={t('common.clear')} className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-700">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({ value, onChange, allLabel, options, className }: { value: string; onChange: (v: string) => void; allLabel: string; options: Array<{ value: string; label: string }>; className?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={cx('sm:w-auto sm:min-w-40', className)} aria-label={allLabel}>
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );
}

/** Options for an enum filter, translated. */
export function useEnumOptions(group: string, values: readonly string[]) {
  const { label } = useI18n();
  return values.map((v) => ({ value: v, label: label(group, v) }));
}
