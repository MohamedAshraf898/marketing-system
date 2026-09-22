import type { ReactNode } from 'react';
import { cx } from './cx';

export interface TabDef<T extends string> { id: T; label: ReactNode; count?: number }

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<TabDef<T>>; value: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0', className)}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cx(
              'relative -mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm font-medium transition',
              active ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cx('rounded-full px-1.5 py-0.5 text-[11px] tabular', active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600')}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pill-style segmented control (used for small toggles). */
export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-zinc-100 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx('rounded-lg px-3 py-1.5 text-[13px] font-medium transition', o.id === value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
