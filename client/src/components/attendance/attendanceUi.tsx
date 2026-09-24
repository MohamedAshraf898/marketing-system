// Shared attendance UI: formatting helpers, the check-in card (attendance page + dashboard), the record drawer and the
// correction form. Times are always DECIDED by the server; this code only displays them and sends button presses.
import { useEffect, useState } from 'react';
import { Coffee, Home, LogIn, LogOut, PencilLine, Play } from 'lucide-react';
import { ATTENDANCE_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { AttendanceRecord, RecordDetail, TodayResponse } from '@/api/types.attendance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { cx } from '@/components/ui/cx';

/** 452 -> "7h 32m" */
export function useMinutes() {
  const { t, fmt } = useI18n();
  return (min: number) => {
    const m = Math.max(0, Math.round(min));
    if (m < 60) return t('att.min', { m: fmt.number(m) });
    return t('att.hm', { h: fmt.number(Math.floor(m / 60)), m: fmt.number(m % 60) });
  };
}

/** Local wall time of an instant, e.g. "09:05". */
export function useClockTime() {
  const { locale } = useI18n();
  const f = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  return (iso: string | null | undefined) => (iso ? f.format(new Date(iso)) : '—');
}

const pad = (n: number) => String(n).padStart(2, '0');
/** yyyy-mm-dd of a Date in the browser's zone. */
export const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** ISO -> value for <input type="datetime-local"> in the browser's zone. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** Re-renders every 30 s so open days keep counting. */
function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => set((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [active]);
}

/** Live worked minutes of an open day (server numbers + time since the last fetch). */
function liveWorked(r: AttendanceRecord, fetchedAt: number) {
  if (!r.open || r.onBreak) return r.workedMinutes;
  return r.workedMinutes + Math.max(0, Math.floor((Date.now() - fetchedAt) / 60_000));
}

// ───────────────────────── check-in card ─────────────────────────

export function CheckInCard({ compact }: { compact?: boolean }) {
  const { t, fmt } = useI18n();
  const mins = useMinutes();
  const clock = useClockTime();
  const q = useApi<TodayResponse>('/attendance/today');
  const [remote, setRemote] = useState(false);
  const checkIn = useAction(() => api.post('/attendance/check-in', { remote }), { success: t('att.checkedIn') });
  const checkOut = useAction(() => api.post('/attendance/check-out', {}), { success: t('att.checkedOut') });
  const breakStart = useAction(() => api.post('/attendance/break/start', {}), { success: t('att.breakStarted') });
  const breakEnd = useAction(() => api.post('/attendance/break/end', {}), { success: t('att.breakEnded') });
  useTick(!!q.data?.item.open);

  if (q.isLoading || !q.data) return <Card className="p-5"><Skeleton className="h-6 w-40" /><Skeleton className="mt-4 h-10 w-full" /></Card>;
  const d = q.data;
  if (!d.tracked && !d.item.checkInAt && !d.carryOver) {
    if (compact) return null;
    return <Card className="p-5 text-sm text-zinc-600">{t('att.notOnRoster')}</Card>;
  }
  const r = d.carryOver ?? d.item;
  const fetchedAt = q.dataUpdatedAt;
  const busy = checkIn.isPending || checkOut.isPending || breakStart.isPending || breakEnd.isPending;
  const checkedIn = !!r.checkInAt && !r.checkOutAt;
  const done = !!d.item.checkInAt && !!d.item.checkOutAt && !d.carryOver;

  return (
    <Card className={cx('overflow-hidden', compact ? 'p-4' : 'p-5 sm:p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-zinc-500">{t('att.today')} · {fmt.date(`${d.today}T00:00:00Z`)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge group="presence" value={r.presence} />
            {(r.checkInAt || r.status === 'ON_LEAVE' || r.status === 'HOLIDAY') && <StatusBadge group="attendanceStatus" value={r.status} />}
            {r.lateMinutes > 0 && <span className="text-xs font-medium text-amber-700">{t('att.lateBy', { d: mins(r.lateMinutes) })}</span>}
          </div>
          {d.holiday && <p className="mt-1 text-xs text-teal-700">{t('att.holidayToday', { name: d.holiday })}</p>}
          {d.leave && <p className="mt-1 text-xs text-violet-700">{t('att.onLeaveToday')}</p>}
        </div>
        <div className="text-end">
          <p className="text-[26px] font-semibold leading-none tracking-tight text-zinc-900 tabular">{mins(liveWorked(r, fetchedAt))}</p>
          <p className="mt-1 text-xs text-zinc-500">{t('att.workedOf', { d: mins(r.expectedMinutes) })}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-center">
        <div><dt className="text-[11px] uppercase tracking-wide text-zinc-400">{t('att.checkIn')}</dt><dd className="mt-0.5 text-sm font-semibold tabular text-zinc-800">{clock(r.checkInAt)}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wide text-zinc-400">{t('att.break')}</dt><dd className="mt-0.5 text-sm font-semibold tabular text-zinc-800">{mins(r.breakMinutes)}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wide text-zinc-400">{t('att.checkOut')}</dt><dd className="mt-0.5 text-sm font-semibold tabular text-zinc-800">{clock(r.checkOutAt)}</dd></div>
      </dl>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {!r.checkInAt && !done && (
          <>
            <Button variant="brand" size="lg" className="w-full sm:w-auto" icon={<LogIn className="size-4" />} loading={checkIn.isPending} disabled={busy} onClick={() => checkIn.mutate(undefined)}>{t('att.checkInNow')}</Button>
            <Checkbox label={<span className="inline-flex items-center gap-1.5"><Home className="size-4 text-zinc-400" />{t('att.workingFromHome')}</span>} checked={remote} onChange={(e) => setRemote(e.target.checked)} className="sm:ms-2" />
          </>
        )}
        {checkedIn && (
          <>
            {r.onBreak
              ? <Button variant="secondary" size="lg" className="w-full sm:w-auto" icon={<Play className="size-4" />} loading={breakEnd.isPending} disabled={busy} onClick={() => breakEnd.mutate(undefined)}>{t('att.endBreak')}</Button>
              : <Button variant="secondary" size="lg" className="w-full sm:w-auto" icon={<Coffee className="size-4" />} loading={breakStart.isPending} disabled={busy} onClick={() => breakStart.mutate(undefined)}>{t('att.startBreak')}</Button>}
            <Button variant="primary" size="lg" className="w-full sm:w-auto" icon={<LogOut className="size-4" />} loading={checkOut.isPending} disabled={busy} onClick={() => checkOut.mutate(undefined)}>{t('att.checkOutNow')}</Button>
          </>
        )}
        {done && <p className="text-sm text-zinc-600">{t('att.dayDone', { worked: mins(d.item.workedMinutes) })}{d.item.overtimeMinutes > 0 ? ` · ${t('att.overtimeOf', { d: mins(d.item.overtimeMinutes) })}` : ''}</p>}
      </div>
      {!compact && <p className="mt-3 text-xs text-zinc-400">{t('att.scheduleLine', { name: d.schedule.name, start: d.schedule.startTime, end: d.schedule.endTime, tz: d.schedule.timezone })}</p>}
    </Card>
  );
}

// ───────────────────────── record drawer + corrections ─────────────────────────

export function RecordDrawer({ id, virtual, onClose }: { id: string | null; virtual?: AttendanceRecord | null; onClose: () => void }) {
  const { t, fmt, label } = useI18n();
  const { can, user } = useAuth();
  const mins = useMinutes();
  const clock = useClockTime();
  const q = useApi<RecordDetail>(id ? `/attendance/${id}` : null);
  const [editing, setEditing] = useState(false);
  const r = id ? q.data?.item : virtual;
  const open = !!id || !!virtual;
  if (!open) return null;
  const canFix = can('attendance.manage') && !!r && (r.userId !== user?.id || user?.role === 'ADMIN');

  return (
    <Drawer open={open} onClose={onClose} title={r ? `${r.user?.name ?? ''} · ${fmt.date(`${r.date}T00:00:00Z`)}` : <Skeleton className="h-5 w-40" />} subtitle={r ? t('att.scheduleLine', { name: r.schedule.name, start: r.schedule.startTime, end: r.schedule.endTime, tz: r.schedule.timezone }) : undefined}
      footer={canFix ? <Button icon={<PencilLine className="size-4" />} onClick={() => setEditing(true)}>{r?.id ? t('att.correct') : t('att.createRecord')}</Button> : undefined}>
      {!r ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge group="attendanceStatus" value={r.status} />
            <StatusBadge group="presence" value={r.presence} />
            {r.remote && <StatusBadge group="attendanceStatus" value="WFH" />}
            {r.isManual && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">{t('att.corrected')}</span>}
            {r.missingCheckout && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200">{t('att.missingCheckout')}</span>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {([
              ['att.checkIn', clock(r.checkInAt)], ['att.checkOut', clock(r.checkOutAt)], ['att.worked', mins(r.workedMinutes)], ['att.expected', mins(r.expectedMinutes)],
              ['att.break', mins(r.breakMinutes)], ['att.late', mins(r.lateMinutes)], ['att.earlyLeave', mins(r.earlyLeaveMinutes)], ['att.overtime', mins(r.overtimeMinutes)],
            ] as const).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{t(k)}</dt><dd className="mt-0.5 text-sm font-semibold tabular text-zinc-800">{v}</dd></div>
            ))}
          </dl>
          {r.breaks.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">{t('att.breaks')}</h3>
              <ul className="space-y-1 text-sm text-zinc-700">{r.breaks.map((b) => <li key={b.id} className="tabular">{clock(b.startAt)} – {clock(b.endAt)}</li>)}</ul>
            </div>
          )}
          {r.notes && <div><h3 className="mb-1 text-sm font-semibold text-zinc-900">{t('common.notes')}</h3><p className="whitespace-pre-line text-sm text-zinc-700">{r.notes}</p></div>}
          {id && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">{t('att.correctionHistory')}</h3>
              {(q.data?.corrections ?? []).length === 0 ? <p className="text-xs text-zinc-400">{t('att.noCorrections')}</p> : (
                <ul className="space-y-3">
                  {q.data!.corrections.map((c) => (
                    <li key={c.id} className="rounded-xl border border-line p-3">
                      <p className="text-xs text-zinc-500">{c.user?.name ?? t('audit.system')} · {fmt.dateTime(c.createdAt)}</p>
                      {c.metadata?.reason && <p className="mt-1 text-sm text-zinc-800">“{c.metadata.reason}”</p>}
                      <ul className="mt-2 space-y-0.5 text-xs text-zinc-600">
                        {Object.entries(c.metadata?.changes ?? {}).map(([k, v]) => (
                          <li key={k}><span className="font-medium">{t(`att.field.${k}` as 'att.field.checkInAt')}</span>: {fmtVal(k, v.from, clock, label)} → {fmtVal(k, v.to, clock, label)}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {editing && r && <CorrectionModal record={r} onClose={() => setEditing(false)} />}
    </Drawer>
  );
}

function fmtVal(k: string, v: unknown, clock: (s: string | null) => string, label: (g: string, v: string) => string) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'checkInAt' || k === 'checkOutAt') return clock(String(v));
  if (k === 'status') return label('attendanceStatus', String(v));
  return String(v);
}

/** Correct an existing day, or create a missing one (record.id === null). A reason is always required. */
export function CorrectionModal({ record, onClose }: { record: AttendanceRecord; onClose: () => void }) {
  const { t, label } = useI18n();
  const [f, setF] = useState({
    checkInAt: toLocalInput(record.checkInAt), checkOutAt: toLocalInput(record.checkOutAt), remote: record.remote,
    status: record.statusLocked ? record.status : '', notes: record.notes ?? '', reason: '', clearBreaks: false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useAction(
    () => {
      const body: Record<string, unknown> = {
        checkInAt: fromLocalInput(f.checkInAt), checkOutAt: fromLocalInput(f.checkOutAt), remote: f.remote, status: f.status || null, notes: f.notes || null, reason: f.reason,
      };
      if (f.clearBreaks) body.breaks = [];
      return record.id ? api.patch(`/attendance/${record.id}`, body) : api.post('/attendance', { ...body, userId: record.userId, date: record.date });
    },
    { success: t('att.correctionSaved'), onSuccess: onClose },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);
  return (
    <Modal open onClose={onClose} title={record.id ? t('att.correctTitle') : t('att.createRecord')} description={`${record.user?.name ?? ''} · ${record.date}`}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={f.reason.trim().length < 3}>{t('common.save')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('att.checkIn')} error={err('checkInAt')}>{(id) => <Input id={id} type="datetime-local" value={f.checkInAt} onChange={(e) => set('checkInAt', e.target.value)} invalid={!!errs.checkInAt} />}</Field>
        <Field label={t('att.checkOut')} error={err('checkOutAt')}>{(id) => <Input id={id} type="datetime-local" value={f.checkOutAt} onChange={(e) => set('checkOutAt', e.target.value)} invalid={!!errs.checkOutAt} />}</Field>
        <Field label={t('att.statusOverride')} hint={t('att.statusOverrideHint')}>
          {(id) => <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">{t('att.statusAuto')}</option>{ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{label('attendanceStatus', s)}</option>)}</Select>}
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox label={t('att.workingFromHome')} checked={f.remote} onChange={(e) => set('remote', e.target.checked)} />
          {record.breaks.length > 0 && <Checkbox label={t('att.clearBreaks')} checked={f.clearBreaks} onChange={(e) => set('clearBreaks', e.target.checked)} />}
        </div>
        <Field label={t('common.notes')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
        <Field label={t('att.reason')} required hint={t('att.reasonHint')} error={err('reason') || err('breaks')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} invalid={!!errs.reason} maxLength={500} />}</Field>
      </div>
    </Modal>
  );
}

export function PersonCell({ r }: { r: Pick<AttendanceRecord, 'user'> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <Avatar name={r.user?.name ?? '?'} size="sm" />
      <span className="min-w-0"><span className="block truncate font-medium text-zinc-900">{r.user?.name}</span>{r.user?.jobTitle && <span className="block truncate text-xs text-zinc-500">{r.user.jobTitle}</span>}</span>
    </span>
  );
}
