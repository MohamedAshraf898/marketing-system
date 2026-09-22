import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cx } from './cx';

/** Side sheet (opens from the end edge; full width on phones). Esc / backdrop closes. Use it for "details" panels. */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: 'md' | 'lg' | 'xl';
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <div className="og-fade absolute inset-0 bg-zinc-950/45 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={cx('og-sheet absolute inset-y-0 end-0 flex w-full flex-col bg-white shadow-[var(--shadow-pop)]', width === 'md' && 'sm:max-w-lg', width === 'lg' && 'sm:max-w-2xl', width === 'xl' && 'sm:max-w-4xl')}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-zinc-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="-m-1.5 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line bg-zinc-50/60 px-5 py-4 sm:flex-row sm:justify-end sm:px-6 pb-safe">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
