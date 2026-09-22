import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { TimerResponse, TimerStartBody, TimerStartResponse, TimerStopResponse } from '@/api/types.time';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { useToast } from '@/components/ui/Toast';

export const MAX_RUNNING_SEC = 16 * 3600;

const pad = (n: number) => String(n).padStart(2, '0');

/** 75 -> "01:15", 3725 -> "1:02:05" (live timer). */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** 5400 -> "1:30" (hours:minutes, Latin digits; used in tables). */
export function formatHM(totalSec: number): string {
  const min = Math.round(Math.max(0, totalSec) / 60);
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

/** Minutes the browser's zone is ahead of UTC (sent as `tz` so the server cuts days / weeks the same way the user sees them). */
export const tzOffsetMin = () => -new Date().getTimezoneOffset();

/** Elapsed seconds since `startedAt`, ticking every second. `skewMs` = serverTime - clientTime, so a wrong device clock does not matter. */
export function useElapsedSec(startedAt: string | null | undefined, skewMs = 0): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return 0;
  return Math.max(0, Math.min(MAX_RUNNING_SEC, Math.floor((Date.now() + skewMs - new Date(startedAt).getTime()) / 1000)));
}

/** The signed-in user's running timer + start / stop actions. `enabled` is false for CLIENT users and members without time.track. */
export function useTimer() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const enabled = !!user && user.role !== 'CLIENT' && can('time.track');
  const q = useApi<TimerResponse>(enabled ? '/time/timer' : null);
  const skewMs = useMemo(() => (q.data ? new Date(q.data.serverNow).getTime() - q.dataUpdatedAt : 0), [q.data, q.dataUpdatedAt]);
  const start = useAction((body: TimerStartBody) => api.post<TimerStartResponse>('/time/timer/start', body), {
    onSuccess: (res) => toast.success(res.stopped ? t('time.switched') : t('time.started')),
  });
  const stop = useAction(() => api.post<TimerStopResponse>('/time/timer/stop'), {
    onSuccess: (res) => toast.success(res.capped ? t('time.stoppedCapped') : t('time.stopped')),
  });
  return { enabled, running: q.data?.item ?? null, loading: q.isLoading, skewMs, start, stop };
}

const intlTag = (locale: string) => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US');

/** Formatters for plain 'YYYY-MM-DD' days (rendered in UTC so the day never shifts) and for instants in the user's own zone. */
export function useTimeFormat() {
  const { locale } = useI18n();
  const day = useCallback(
    (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlTag(locale), { ...o, timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)),
    [locale],
  );
  const clock = useCallback(
    (iso: string) => new Intl.DateTimeFormat(intlTag(locale), { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
    [locale],
  );
  return { day, clock };
}

/** Local yyyy-mm-dd of a Date (not UTC). */
export const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTimeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Adds days to a 'YYYY-MM-DD' string (calendar arithmetic, no time zones involved). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
