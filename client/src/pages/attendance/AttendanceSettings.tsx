import { useState } from 'react';
import { CalendarX2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { AttendanceMember, Holiday, Schedule } from '@/api/types.attendance';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { cx } from '@/components/ui/cx';
import { useMinutes } from '@/components/attendance/attendanceUi';

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
})();

function useWeekdayNames() {
  const { locale } = useI18n();
  const f = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', timeZone: 'UTC' });
  return (d: number) => f.format(new Date(Date.UTC(2024, 0, 7 + d))); // 2024-01-07 is a Sunday
}

function ScheduleModal({ initial, onClose }: { initial?: Schedule; onClose: () => void }) {
  const { t } = useI18n();
  const wd = useWeekdayNames();
  const [f, setF] = useState({
    name: initial?.name ?? '', timezone: initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC', workDays: initial?.workDays ?? [1, 2, 3, 4, 5],
    startTime: initial?.startTime ?? '09:00', endTime: initial?.endTime ?? '17:00', breakMinutes: String(initial?.breakMinutes ?? 60), graceMinutes: String(initial?.graceMinutes ?? 10),
    minimumMinutes: String(initial?.minimumMinutes ?? 240),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useAction(() => {
    const body = { ...f, breakMinutes: Number(f.breakMinutes), graceMinutes: Number(f.graceMinutes), minimumMinutes: Number(f.minimumMinutes) };
    return initial ? api.patch(`/work-schedules/${initial.id}`, body) : api.post('/work-schedules', body);
  }, { success: t('att.scheduleSaved'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);
  return (
    <Modal open onClose={onClose} size="lg" title={initial ? t('att.editSchedule') : t('att.newSchedule')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} required error={err('name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />}</Field>
        <Field label={t('att.timezone')} error={err('timezone')}>{(id) => <Select id={id} value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>{(ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES]).map((z) => <option key={z} value={z}>{z}</option>)}</Select>}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium text-zinc-700">{t('att.workDays')}</p>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = f.workDays.includes(d);
              return <button key={d} type="button" onClick={() => set('workDays', on ? f.workDays.filter((x) => x !== d) : [...f.workDays, d])} className={cx('h-9 min-w-12 rounded-lg px-3 text-sm font-medium ring-1 ring-inset transition', on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-zinc-600 ring-line-strong hover:bg-zinc-50')}>{wd(d)}</button>;
            })}
          </div>
        </div>
        <Field label={t('att.startTime')} error={err('startTime')}>{(id) => <Input id={id} type="time" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} />}</Field>
        <Field label={t('att.endTime')} error={err('endTime')}>{(id) => <Input id={id} type="time" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} invalid={!!errs.endTime} />}</Field>
        <Field label={t('att.breakMinutes')} error={err('breakMinutes')}>{(id) => <Input id={id} type="number" min={0} value={f.breakMinutes} onChange={(e) => set('breakMinutes', e.target.value)} />}</Field>
        <Field label={t('att.graceMinutes')} hint={t('att.graceHint')} error={err('graceMinutes')}>{(id) => <Input id={id} type="number" min={0} value={f.graceMinutes} onChange={(e) => set('graceMinutes', e.target.value)} />}</Field>
        <Field label={t('att.minimumMinutes')} hint={t('att.minimumHint')} error={err('minimumMinutes')}>{(id) => <Input id={id} type="number" min={0} value={f.minimumMinutes} onChange={(e) => set('minimumMinutes', e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

/** Schedules, holidays and the attendance roster (attendance.manage). */
export function AttendanceSettings() {
  const { t, fmt } = useI18n();
  const mins = useMinutes();
  const wd = useWeekdayNames();
  const schedules = useApi<{ items: Schedule[] }>('/work-schedules');
  const members = useApi<{ items: AttendanceMember[] }>('/attendance/members');
  const year = new Date().getFullYear();
  const holidays = useApi<{ items: Holiday[] }>('/holidays', { year });
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const makeDefault = useAction((id: string) => api.post(`/work-schedules/${id}/default`, {}), { success: t('att.scheduleSaved') });
  const remove = useAction((id: string) => api.del(`/work-schedules/${id}`), { success: t('att.scheduleDeleted'), onSuccess: () => setDeleting(null) });
  const addHoliday = useAction(() => api.post('/holidays', holiday), { success: t('att.holidayAdded'), onSuccess: () => setHoliday({ date: '', name: '' }) });
  const delHoliday = useAction((id: string) => api.del(`/holidays/${id}`));
  const updateMember = useAction((v: { id: string; body: Record<string, unknown> }) => api.patch(`/attendance/members/${v.id}`, v.body), { success: t('att.memberSaved') });
  const hErr = fieldErrors(addHoliday.error);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('att.schedules')} subtitle={t('att.schedulesHint')} action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{t('att.newSchedule')}</Button>} />
        <CardBody className="grid gap-3 md:grid-cols-2">
          {(schedules.data?.items ?? []).map((s) => (
            <div key={s.id} className="rounded-xl border border-line p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-zinc-900">{s.name} {s.isDefault && <Badge tone="violet" dot={false} className="ms-1">{t('att.default')}</Badge>}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{s.workDays.map(wd).join(' · ')} · {s.startTime}–{s.endTime} · {s.timezone}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{t('att.scheduleMeta', { brk: mins(s.breakMinutes), grace: mins(s.graceMinutes), min: mins(s.minimumMinutes), n: fmt.number(s.memberCount ?? 0) })}</p>
                </div>
                {!s.isDefault && <IconButton label={t('att.makeDefault')} className="size-8" onClick={() => s.id && makeDefault.mutate(s.id)}><Star className="size-4" /></IconButton>}
                <IconButton label={t('common.edit')} className="size-8" onClick={() => setEditing(s)}><Pencil className="size-4" /></IconButton>
                {!s.isDefault && <IconButton label={t('common.delete')} className="size-8 hover:text-rose-600" onClick={() => setDeleting(s)}><Trash2 className="size-4" /></IconButton>}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('att.members')} subtitle={t('att.membersHint')} />
        <CardBody className="!pt-2">
          {members.isLoading ? <SkeletonRows rows={3} /> : (
            <ul className="divide-y divide-line">
              {(members.data?.items ?? []).map((m) => (
                <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 flex-1 items-center gap-2.5"><Avatar name={m.name} size="sm" /><span className="min-w-0"><span className="block truncate text-sm font-medium text-zinc-900">{m.name}</span><span className="block truncate text-xs text-zinc-500">{m.jobTitle ?? m.role}</span></span></span>
                  <Select value={m.workScheduleId ?? ''} onChange={(e) => updateMember.mutate({ id: m.id, body: { workScheduleId: e.target.value || null } })} className="sm:w-56" aria-label={t('att.schedule')}>
                    <option value="">{t('att.defaultSchedule')}</option>
                    {(schedules.data?.items ?? []).map((s) => <option key={s.id} value={s.id ?? ''}>{s.name}</option>)}
                  </Select>
                  <Checkbox label={t('att.tracked')} checked={m.trackAttendance} onChange={(e) => updateMember.mutate({ id: m.id, body: { trackAttendance: e.target.checked } })} className="sm:w-36" />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('att.holidays', { year })} />
        <CardBody className="space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); addHoliday.mutate(undefined); }} className="flex flex-col gap-2 sm:flex-row">
            <Input type="date" value={holiday.date} onChange={(e) => setHoliday((h) => ({ ...h, date: e.target.value }))} className="sm:w-44" aria-label={t('common.date')} invalid={!!hErr.date} />
            <Input value={holiday.name} onChange={(e) => setHoliday((h) => ({ ...h, name: e.target.value }))} placeholder={t('att.holidayName')} maxLength={120} />
            <Button type="submit" icon={<Plus className="size-4" />} loading={addHoliday.isPending} disabled={!holiday.date || !holiday.name.trim()}>{t('common.add')}</Button>
          </form>
          {hErr.date && <p className="text-xs text-rose-600">{fieldText(t, hErr.date)}</p>}
          {(holidays.data?.items ?? []).length === 0 ? <EmptyState compact icon={CalendarX2} title={t('att.noHolidays')} /> : (
            <ul className="divide-y divide-line">
              {holidays.data!.items.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-32 shrink-0 tabular text-zinc-500">{fmt.date(`${h.date}T00:00:00Z`)}</span>
                  <span className="flex-1 font-medium text-zinc-900">{h.name}</span>
                  <IconButton label={t('common.delete')} className="size-8 hover:text-rose-600" onClick={() => delHoliday.mutate(h.id)}><Trash2 className="size-4" /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {editing && <ScheduleModal initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting?.id && remove.mutate(deleting.id)} loading={remove.isPending} title={t('att.deleteSchedule')} message={t('att.deleteScheduleMessage', { name: deleting?.name ?? '' })} confirmLabel={t('common.delete')} />
    </div>
  );
}
