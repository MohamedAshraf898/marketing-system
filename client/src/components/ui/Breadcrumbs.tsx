import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface Crumb { label: ReactNode; to?: string }

/** Breadcrumb trail for detail pages: the last item is the current page (no link). Chevrons flip in RTL. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-500">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1.5">
              {c.to && !last ? <Link to={c.to} className="truncate font-medium hover:text-zinc-800">{c.label}</Link> : <span className={last ? 'truncate font-medium text-zinc-800' : 'truncate'} aria-current={last ? 'page' : undefined}>{c.label}</span>}
              {!last && <ChevronRight className="size-3.5 shrink-0 text-zinc-300 rtl:rotate-180" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
