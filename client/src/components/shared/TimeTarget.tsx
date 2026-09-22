import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { TaskLite, TimerStartBody } from '@/api/types.time';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { Segmented } from '@/components/ui/Tabs';
import { useClientOptions } from './options';

export interface TimeTarget { taskId: string; projectId: string; clientId: string }
export const EMPTY_TARGET: TimeTarget = { taskId: '', projectId: '', clientId: '' };

/** My open tasks for the picker. The tasks API belongs to another group: any failure just means "no task list". */
export function useMyTasks(enabled: boolean) {
  const q = useApi<{ items: TaskLite[] }>('/tasks', { mine: 1, pageSize: 50 }, { enabled });
  return { tasks: (q.data?.items ?? []).filter((x) => x.status !== 'DONE'), loading: q.isLoading, failed: q.isError };
}

/**
 * Picks what time is logged against: one of my tasks, or a client (+ optional project).
 * Only ids are produced; the server derives project / client from a task and re-checks every id against the caller's scope.
 */
export function TargetSelect({ value, onChange, enabled = true, currentTask }: { value: TimeTarget; onChange: (v: TimeTarget) => void; enabled?: boolean; currentTask?: { id: string; title: string } | null }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'task' | 'client'>(value.taskId || !(value.clientId || value.projectId) ? 'task' : 'client');
  const { tasks, loading, failed } = useMyTasks(enabled);
  const { clients } = useClientOptions(enabled);
  const projects = useApi<{ items: Array<{ id: string; name: string }> }>('/projects', { clientId: value.clientId, pageSize: 100 }, { enabled: enabled && mode === 'client' && !!value.clientId });
  const noTasks = !loading && (failed || tasks.length === 0) && !currentTask;
  useEffect(() => { if (noTasks && mode === 'task' && !value.taskId && clients.length > 0) setMode('client'); }, [noTasks, clients.length, mode, value.taskId]);

  const taskOptions = [...(currentTask && !tasks.some((x) => x.id === currentTask.id) ? [{ id: currentTask.id, title: currentTask.title } as TaskLite] : []), ...tasks];
  const canPickClient = clients.length > 0;

  return (
    <div className="space-y-3">
      {canPickClient && (
        <Segmented
          value={mode}
          onChange={(m) => { setMode(m); onChange(EMPTY_TARGET); }}
          options={[{ id: 'task', label: t('time.target.task') }, { id: 'client', label: t('time.target.client') }]}
        />
      )}
      {mode === 'task' ? (
        <Field label={t('time.target.task')} hint={noTasks ? t('time.target.noTasks') : undefined}>
          {(id) => (
            <Select id={id} value={value.taskId} onChange={(e) => onChange({ ...EMPTY_TARGET, taskId: e.target.value })}>
              <option value="">{t('time.target.noTask')}</option>
              {taskOptions.map((x) => (
                <option key={x.id} value={x.id}>{x.title}{x.project?.name ? ` · ${x.project.name}` : x.client?.companyName ? ` · ${x.client.companyName}` : ''}</option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.client')}>
            {(id) => (
              <Select id={id} value={value.clientId} onChange={(e) => onChange({ taskId: '', projectId: '', clientId: e.target.value })}>
                <option value="">{t('time.target.noClient')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('common.project')} hint={t('common.optional')}>
            {(id) => (
              <Select id={id} value={value.projectId} disabled={!value.clientId} onChange={(e) => onChange({ ...value, projectId: e.target.value })}>
                <option value="">{t('time.target.noProject')}</option>
                {(projects.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
      )}
    </div>
  );
}

/** Body for POST /time/timer/start or /time/entries: task wins, then project, then client (the server derives the rest). */
export function targetBody(v: TimeTarget): TimerStartBody {
  if (v.taskId) return { taskId: v.taskId };
  if (v.projectId) return { projectId: v.projectId };
  if (v.clientId) return { clientId: v.clientId };
  return {};
}

/** Target + notes + "start" button. Used by the top-bar popover and by the timer card on the time page. */
export function TimerStarter({ onStart, loading, enabled = true }: { onStart: (body: TimerStartBody) => void; loading?: boolean; enabled?: boolean }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<TimeTarget>(EMPTY_TARGET);
  const [notes, setNotes] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); onStart({ ...targetBody(target), ...(notes.trim() ? { notes: notes.trim() } : {}) }); }}
    >
      <TargetSelect value={target} onChange={setTarget} enabled={enabled} />
      <Field label={t('common.notes')} hint={t('common.optional')}>
        {(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder={t('time.notesPlaceholder')} />}
      </Field>
      <Button type="submit" variant="brand" loading={loading} icon={<Play className="size-4 rtl:-scale-x-100" />} className="w-full max-sm:h-11">{t('time.start')}</Button>
    </form>
  );
}
