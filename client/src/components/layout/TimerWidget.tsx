import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Square } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cx } from '@/components/ui/cx';
import { useOutsideClose } from '@/components/ui/Popover';
import { TimerStarter } from '@/components/shared/TimeTarget';
import { formatClock, useElapsedSec, useTimer } from '@/components/shared/timer';

/** Top-bar timer: shows the running timer (live mm:ss from the SERVER start time) or a compact "start timer" popover. Renders nothing for CLIENT users / without time.track. */
export function TimerWidget() {
  const { t } = useI18n();
  const tm = useTimer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  const elapsed = useElapsedSec(tm.running?.startedAt, tm.skewMs);
  if (!tm.enabled) return null;

  const run = tm.running;
  const label = run ? (run.task?.title ?? run.project?.name ?? run.client?.companyName ?? t('time.noTask')) : '';

  return (
    <div ref={ref} className="relative shrink-0">
      {run ? (
        <div className="flex h-10 items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 ps-3 pe-1 text-emerald-900 shadow-sm">
          <span className="relative flex size-2 shrink-0"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>
          <Link to="/time" className="flex min-w-0 items-center gap-2 px-1" title={label}>
            <span className="tabular text-sm font-semibold" aria-live="off">{formatClock(elapsed)}</span>
            <span className="hidden max-w-40 truncate text-xs font-medium text-emerald-800 md:block">{label}</span>
          </Link>
          <button
            type="button"
            onClick={() => tm.stop.mutate(undefined)}
            disabled={tm.stop.isPending}
            aria-label={t('time.stop')}
            title={t('time.stop')}
            className="inline-flex size-8 items-center justify-center rounded-lg bg-white text-rose-600 shadow-sm transition hover:bg-rose-50 active:scale-95 disabled:opacity-50"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t('time.start')}
          className={cx('inline-flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 active:scale-[0.98]', open && 'bg-zinc-50')}
        >
          <Play className="size-4 text-brand-600 rtl:-scale-x-100" />
          <span className="max-md:hidden">{t('time.start')}</span>
        </button>
      )}
      {open && !run && (
        <div className="og-pop fixed inset-x-4 top-[4.5rem] z-50 rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-96">
          <p className="mb-3 text-sm font-semibold text-zinc-900">{t('time.startTitle')}</p>
          <TimerStarter loading={tm.start.isPending} onStart={(body) => tm.start.mutate(body, { onSuccess: () => setOpen(false) })} />
        </div>
      )}
    </div>
  );
}
