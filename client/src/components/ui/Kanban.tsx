import { useState, type DragEvent, type ReactNode } from 'react';
import { cx } from './cx';
import type { Tone } from './Badge';

export interface KanbanColumn { id: string; title: ReactNode; tone?: Tone }

const DOT: Record<Tone, string> = {
  neutral: 'bg-zinc-400', blue: 'bg-sky-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', violet: 'bg-violet-500', orange: 'bg-orange-500', teal: 'bg-teal-500',
};

/**
 * Generic board. Drag a card to another column to call onMove(item, columnId) (desktop). On phones the columns scroll
 * sideways; put a status <select> in your card (or open the item) to change status without dragging.
 * The board never mutates data itself: onMove should call the API and refetch.
 */
export function Kanban<T>({ columns, items, columnOf, keyOf, renderCard, onMove, canMove, empty }: {
  columns: KanbanColumn[];
  items: T[];
  columnOf: (item: T) => string;
  keyOf: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onMove?: (item: T, toColumn: string) => void;
  canMove?: (item: T) => boolean;
  empty?: ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const drop = (e: DragEvent, col: string) => {
    e.preventDefault();
    setOver(null);
    const key = e.dataTransfer.getData('text/plain') || dragging;
    setDragging(null);
    const item = items.find((i) => keyOf(i) === key);
    if (item && columnOf(item) !== col && (!canMove || canMove(item))) onMove?.(item, col);
  };

  return (
    <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
      {columns.map((col) => {
        const list = items.filter((i) => columnOf(i) === col.id);
        return (
          <section
            key={col.id}
            onDragOver={onMove ? (e) => { e.preventDefault(); setOver(col.id); } : undefined}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={onMove ? (e) => drop(e, col.id) : undefined}
            className={cx('flex w-72 shrink-0 snap-start flex-col rounded-2xl bg-zinc-100/70 p-2.5 transition-colors', over === col.id && 'bg-brand-50 ring-2 ring-brand-200')}
          >
            <header className="flex items-center gap-2 px-1.5 pb-2.5 pt-1">
              <span className={cx('size-2 rounded-full', DOT[col.tone ?? 'neutral'])} />
              <h3 className="text-[13px] font-semibold text-zinc-800">{col.title}</h3>
              <span className="ms-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-500 tabular">{list.length}</span>
            </header>
            <div className="flex min-h-16 flex-1 flex-col gap-2.5">
              {list.length === 0 && empty ? <div className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-xs text-zinc-400">{empty}</div> : null}
              {list.map((item) => {
                const key = keyOf(item);
                const draggable = !!onMove && (!canMove || canMove(item));
                return (
                  <div
                    key={key}
                    draggable={draggable}
                    onDragStart={draggable ? (e) => { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; setDragging(key); } : undefined}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={cx(draggable && 'cursor-grab active:cursor-grabbing', dragging === key && 'opacity-40')}
                  >
                    {renderCard(item)}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
