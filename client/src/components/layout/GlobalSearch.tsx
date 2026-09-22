import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Building2, CalendarRange, ClipboardList, Contact, FileSignature, FileText, FolderKanban, LifeBuoy, Megaphone, Palette, Receipt, Search, type LucideIcon,
} from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { SearchHit, SearchResponse, SearchType } from '@/api/types.insights';
import { useI18n } from '@/i18n';
import { useDebounced } from '@/components/ui/Filters';
import { Spinner } from '@/components/ui/Feedback';
import { IconButton } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';

const TYPE_ICON: Record<SearchType, LucideIcon> = {
  client: Building2, contact: Contact, project: FolderKanban, task: ClipboardList, campaign: Megaphone,
  deliverable: Palette, content: CalendarRange, request: LifeBuoy, file: FileText, invoice: Receipt, contract: FileSignature,
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform ?? navigator.userAgent ?? '');

/** Flattened, grouped by type in the server's `types` order (already filtered to what this caller may search). */
function groupHits(items: SearchHit[], order: SearchType[]): Array<{ type: SearchType; hits: SearchHit[] }> {
  const byType = new Map<SearchType, SearchHit[]>();
  for (const h of items) (byType.get(h.type) ?? byType.set(h.type, []).get(h.type)!).push(h);
  return order.filter((t) => byType.has(t)).map((t) => ({ type: t, hits: byType.get(t)! }));
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const { t, label } = useI18n();
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState('');
  const query = useDebounced(raw, 250);
  const trimmed = query.trim();
  const enabled = trimmed.length >= 2;
  const q = useApi<SearchResponse>('/search', { q: trimmed, limit: 6 }, { enabled });
  const groups = useMemo(() => (q.data ? groupHits(q.data.items, q.data.types) : []), [q.data]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const [active, setActive] = useState(0);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [flat.length, trimmed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose]);

  const go = (url: string) => { onClose(); nav(url); };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const hit = flat[active]; if (hit) go(hit.url); else if (enabled) go(`/search?q=${encodeURIComponent(trimmed)}`); }
  };

  let rowIndex = -1;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-20 sm:pt-28" role="dialog" aria-modal="true" aria-label={t('nav.search')}>
      <div className="og-fade absolute inset-0 bg-zinc-950/45 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={boxRef} className="og-pop relative flex w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="size-[18px] shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t('insights.search.placeholder')}
            aria-label={t('nav.search')}
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-md border border-line bg-zinc-50 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-400 sm:inline">Esc</kbd>
        </div>

        <div className="max-h-[26rem] overflow-y-auto py-2">
          {!enabled ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">{t('insights.search.minChars')}</p>
          ) : q.isLoading ? (
            <div className="flex items-center justify-center py-10"><Spinner /></div>
          ) : q.isError ? (
            <p className="px-4 py-8 text-center text-sm text-rose-500">{t('common.loadFailed')}</p>
          ) : flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">{t('insights.search.noResults', { q: trimmed })}</p>
          ) : (
            groups.map((g) => {
              const Icon = TYPE_ICON[g.type];
              return (
                <div key={g.type} className="mb-1 last:mb-0">
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label('searchType', g.type)}</p>
                  {g.hits.map((h) => {
                    rowIndex += 1;
                    const idx = rowIndex;
                    return (
                      <button
                        key={`${h.type}:${h.id}`}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(h.url)}
                        className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors', idx === active ? 'bg-brand-50' : 'hover:bg-zinc-50')}
                      >
                        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg', idx === active ? 'bg-brand-100 text-brand-700' : 'bg-zinc-100 text-zinc-500')}>
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-900">{h.title}</span>
                          {(h.subtitle || h.clientName) && (
                            <span className="block truncate text-xs text-zinc-500">{[h.clientName, h.subtitle].filter(Boolean).join(' · ')}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {enabled && (
          <button type="button" onClick={() => go(`/search?q=${encodeURIComponent(trimmed)}`)} className="block w-full border-t border-line px-4 py-3 text-center text-[13px] font-medium text-zinc-600 hover:bg-zinc-50">
            {t('insights.search.viewAll', { q: trimmed })}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Header search trigger + Ctrl/Cmd+K command palette (mounted once in AppShell's header, so the shortcut always works). */
export function GlobalSearch() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden min-w-0 items-center gap-2 rounded-xl border border-line-strong bg-white px-3.5 py-2 text-sm text-zinc-500 shadow-sm transition hover:bg-zinc-50 sm:flex sm:w-64 lg:w-80"
      >
        <Search className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-start">{t('insights.search.placeholder')}</span>
        <kbd className="shrink-0 rounded-md border border-line bg-zinc-50 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-400">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <IconButton label={t('nav.search')} className="sm:hidden" onClick={() => setOpen(true)}>
        <Search className="size-5" />
      </IconButton>
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </>
  );
}
