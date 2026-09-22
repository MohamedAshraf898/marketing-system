import { Play, Square } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { EntriesResponse } from '@/api/types.time';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { formatClock, formatHM, useElapsedSec, useTimer } from './timer';

/** Start / stop the timer for one task. Renders nothing for CLIENT users and members without time.track. */
export function TaskTimerButton({ taskId, compact, showTotal }: { taskId: string; compact?: boolean; showTotal?: boolean }) {
  const { t } = useI18n();
  const tm = useTimer();
  const mine = tm.running?.taskId === taskId;
  const elapsed = useElapsedSec(mine ? tm.running?.startedAt : null, tm.skewMs);
  const total = useApi<EntriesResponse>('/time/entries', { taskId, pageSize: 1 }, { enabled: tm.enabled && !!showTotal });
  if (!tm.enabled) return null;

  const busy = tm.start.isPending || tm.stop.isPending;
  return (
    <span className="inline-flex items-center gap-2">
      {mine ? (
        <Button variant="secondary" size={compact ? 'sm' : 'md'} loading={tm.stop.isPending} onClick={(e) => { e.stopPropagation(); tm.stop.mutate(undefined); }} aria-label={t('time.stop')} title={t('time.stop')}
          className={cx('border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100', compact && 'px-2')} icon={<Square className="size-3.5 fill-current text-rose-600" />}>
          <span className="tabular">{formatClock(elapsed)}</span>
        </Button>
      ) : (
        <Button variant="secondary" size={compact ? 'sm' : 'md'} disabled={busy} loading={tm.start.isPending} onClick={(e) => { e.stopPropagation(); tm.start.mutate({ taskId }); }}
          aria-label={t('time.startTask')} title={t('time.startTask')} className={cx(compact && 'px-2')} icon={<Play className="size-3.5 text-brand-600 rtl:-scale-x-100" />}>
          {!compact && t('time.startTask')}
        </Button>
      )}
      {showTotal && total.data && total.data.totals.seconds > 0 && (
        <span className="tabular text-xs text-zinc-500" title={t('time.loggedTotal')}>{formatHM(total.data.totals.seconds)} {t('time.hoursShort')}</span>
      )}
    </span>
  );
}
