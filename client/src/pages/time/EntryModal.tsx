import { useState } from 'react';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { TimeEntry } from '@/api/types.time';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { TargetSelect, type TimeTarget } from '@/components/shared/TimeTarget';
import { formatHM, localDateStr, localTimeStr } from '@/components/shared/timer';

function initial(entry: TimeEntry | null) {
  if (entry) {
    const s = new Date(entry.startedAt);
    return { date: localDateStr(s), start: localTimeStr(s), end: entry.endedAt ? localTimeStr(new Date(entry.endedAt)) : '', notes: entry.notes ?? '' };
  }
  const now = new Date();
  const start = new Date(now.getTime() - 3600_000);
  const sameDay = localDateStr(start) === localDateStr(now);
  return { date: localDateStr(start), start: localTimeStr(start), end: sameDay ? localTimeStr(now) : '23:59', notes: '' };
}

const targetOf = (e: TimeEntry | null): TimeTarget => ({ taskId: e?.taskId ?? '', projectId: e?.taskId ? '' : (e?.projectId ?? ''), clientId: e?.taskId ? '' : (e?.clientId ?? '') });

/** Manual time entry (create) or correction of a finished entry (edit). The owner is always the signed-in user (set by the server). */
export function EntryModal({ open, onClose, entry }: { open: boolean; onClose: () => void; entry: TimeEntry | null }) {
  const { t } = useI18n();
  const [f, setF] = useState(() => initial(entry));
  const [target, setTarget] = useState<TimeTarget>(() => targetOf(entry));
  const [localErr, setLocalErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const startDate = new Date(`${f.date}T${f.start || '00:00'}:00`);
  const endDate = new Date(`${f.date}T${f.end || '00:00'}:00`);
  const sec = f.start && f.end ? Math.round((endDate.getTime() - startDate.getTime()) / 1000) : 0;

  const save = useAction(
    async () => {
      const body: Record<string, unknown> = { startedAt: startDate.toISOString(), endedAt: endDate.toISOString(), notes: f.notes.trim() || null };
      if (!entry) {
        const tb = target.taskId ? { taskId: target.taskId } : target.projectId ? { projectId: target.projectId } : target.clientId ? { clientId: target.clientId } : {};
        return api.post('/time/entries', { ...body, ...tb });
      }
      // only re-send the target when it was changed: the server re-checks every id against the caller's scope
      const before = targetOf(entry);
      if (before.taskId !== target.taskId || before.projectId !== target.projectId || before.clientId !== target.clientId) {
        Object.assign(body, { taskId: target.taskId || null, projectId: target.taskId ? null : target.projectId || null, clientId: target.taskId || target.projectId ? null : target.clientId || null });
      }
      return api.patch(`/time/entries/${entry.id}`, body);
    },
    { success: t(entry ? 'time.entrySaved' : 'time.entryAdded'), onSuccess: onClose },
  );
  const errs = { ...fieldErrors(save.error), ...localErr };
  const err = (k: string) => fieldText(t, errs[k]);

  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.date) e.startedAt = 'required';
    if (!f.start) e.startedAt = 'required';
    if (!f.end) e.endedAt = 'required';
    else if (sec <= 0) e.endedAt = 'end_before_start';
    else if (sec < 60) e.endedAt = 'too_small';
    setLocalErr(e);
    if (Object.keys(e).length === 0) save.mutate(undefined);
  };

  return (
    <Modal
      open={open} onClose={onClose} size="md" title={t(entry ? 'time.editEntry' : 'time.addEntry')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button variant="brand" onClick={submit} loading={save.isPending} className="max-sm:h-11">{t('common.saveChanges')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <TargetSelect value={target} onChange={setTarget} enabled={open} currentTask={entry?.task} />
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('common.date')} error={err('startedAt')} className="col-span-3 sm:col-span-1">{(id) => <Input id={id} type="date" value={f.date} max={localDateStr(new Date())} onChange={(e) => set('date', e.target.value)} invalid={!!errs.startedAt} />}</Field>
          <Field label={t('time.from')} className="col-span-3 sm:col-span-1">{(id) => <Input id={id} type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />}</Field>
          <Field label={t('time.until')} error={err('endedAt')} className="col-span-3 sm:col-span-1">{(id) => <Input id={id} type="time" value={f.end} onChange={(e) => set('end', e.target.value)} invalid={!!errs.endedAt} />}</Field>
        </div>
        {sec > 0 && <p className="text-sm text-zinc-600">{t('time.duration')}: <span className="font-semibold tabular text-zinc-900">{formatHM(sec)}</span> {t('time.hoursShort')}</p>}
        <Field label={t('common.notes')} hint={t('common.optional')} error={err('notes')}>{(id) => <Textarea id={id} rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} placeholder={t('time.notesPlaceholder')} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
