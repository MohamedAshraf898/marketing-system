import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cx } from './cx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** on phones the primary column becomes the card title */
  primary?: boolean;
  /** hide this column on phones */
  hideOnMobile?: boolean;
  /** hide below the lg breakpoint (tablet portrait) */
  hideOnTablet?: boolean;
  align?: 'start' | 'end';
  className?: string;
  /** shown as the label in the mobile card (defaults to header) */
  mobileLabel?: ReactNode;
}

/**
 * Modern table on md+ screens; on phones each row becomes a tappable card
 * (primary column = title, the rest = label / value pairs).
 */
export function DataList<T>({ columns, rows, rowKey, href, onRowClick, leading }: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  href?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** optional leading visual (thumbnail / avatar) rendered in both layouts */
  leading?: (row: T) => ReactNode;
}) {
  const navigate = useNavigate();
  const open = (row: T) => (href ? navigate(href(row)) : onRowClick?.(row));
  const clickable = !!(href || onRowClick);
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);

  return (
    <>
      {/* ── tablet / desktop ── */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-white shadow-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-zinc-50/70 text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500">
                {leading && <th className="w-16 ps-5" />}
                {columns.map((c) => (
                  <th key={c.key} className={cx('whitespace-nowrap px-4 py-3 text-start first:ps-5 last:pe-5', c.align === 'end' && 'text-end', c.hideOnTablet && 'max-lg:hidden', c.className)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={clickable ? () => open(row) : undefined}
                  onKeyDown={clickable ? (e) => e.key === 'Enter' && open(row) : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  className={cx('transition-colors', clickable && 'cursor-pointer hover:bg-zinc-50/80 focus-visible:bg-zinc-50')}
                >
                  {leading && <td className="ps-5 py-3">{leading(row)}</td>}
                  {columns.map((c) => (
                    <td key={c.key} className={cx('px-4 py-3.5 align-middle first:ps-5 last:pe-5', c.align === 'end' && 'text-end', c.hideOnTablet && 'max-lg:hidden', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── phones ── */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              onClick={clickable ? () => open(row) : undefined}
              className={cx('rounded-2xl border border-line bg-white p-4 shadow-card', clickable && 'cursor-pointer active:bg-zinc-50')}
            >
              <div className="flex items-start gap-3">
                {leading && <div className="shrink-0">{leading(row)}</div>}
                <div className="min-w-0 flex-1 font-medium text-zinc-900">{primary.cell(row)}</div>
              </div>
              {rest.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-3">
                  {rest.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{c.mobileLabel ?? c.header}</dt>
                      <dd className="mt-0.5 truncate text-[13px] text-zinc-800">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
