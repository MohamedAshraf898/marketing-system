import { useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Pencil, Plus, Square, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { EntriesResponse, MyTimeResponse, TimeEntry } from '@/api/types.time';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect } from '@/components/ui/Filters';
import { Input } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/cx';
import { useClientOptions, useTeamMembers } from '@/components/shared/options';
import { TimerStarter } from '@/components/shared/TimeTarget';
import { addDays, formatClock, formatHM, tzOffsetMin, useElapsedSec, useTimeFormat, useTimer } from '@/components/shared/timer';
import { EntryModal } from './EntryModal';

const EMPTY = { from: '', to: '', clientId: '', projectId: '', userId: '' };

export function MyTimeTab({ viewAll, creating, setCreating }: { viewAll: boolean; creating: boolean; setCreating: (v: boolean) => void }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const tf = useTimeFormat();
  const tm = useTimer();
  const tz = tzOffsetMin();
  const [anchor, setAnchor] = useState(''); // '' = the current week, otherwise a date inside the shown week
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);

  const my = useApi<MyTimeResponse>('/time/my', { tz, week: anchor });
  const list = useApi<EntriesResponse>('/time/entries', { ...f, tz, page, pageSize: 20 });
  const { clients } = useClientOptions(true);
  const team = useTeamMembers(undefined, viewAll);
  const projects = useApi<Paged<{ id: string; name: string }>>('/projects', { clientId: f.clientId, pageSize: 100 });
  const elapsed = useElapsedSec(tm.running?.startedAt, tm.skewMs);

  const del = useAction((id: string) => api.del(`/time/entries/${id}`), { success: t('time.entryDeleted'), onSuccess: () => setDeleting(null) });
  const setFilter = (patch: Partial<typeof EMPTY>) => { setF((s) => ({ ...s, ...patch })); setPage(1); };
  const filtered = Object.values(f).some(Boolean);
  const canChange = (e: TimeEntry) => !e.running && (e.userId === user?.id || user?.role === 'ADMIN');

  const days = my.data?.days ?? [];
  const maxDay = Math.max(8 * 3600, ...days.map((d) => d.seconds));
  const weekStart = my.data?.week.start;
  const thisWeek = anchor === '';
  const run = tm.running;
  const runLabel = run ? (run.task?.title ?? run.project?.name ?? run.client?.companyName ?? t('time.noTask')) : '';

  return (
    <div className="space-y-6">
      {/* timer card */}
      <Card>
        <CardHeader title={t('time.timer')} subtitle={run ? t('time.timerRunning') : t('time.timerIdle')} />
        <CardBody>
          {run ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="tabular text-4xl font-semibold tracking-tight text-zinc-900">{formatClock(elapsed)}</p>
                <p className="mt-1 truncate text-sm font-medium text-zinc-700">{runLabel}</p>
                {(run.project || run.client) && <p className="truncate text-xs text-zinc-500">{[run.project?.name, run.client?.companyName].filter(Boolean).join(' · ')}</p>}
                {run.notes && <p className="mt-1 truncate text-xs text-zinc-500">{run.notes}</p>}
              </div>
              <Button variant="danger" size="lg" loading={tm.stop.isPending} onClick={() => tm.stop.mutate(undefined)} icon={<Square className="size-4 fill-current" />} className="max-sm:w-full">{t('time.stop')}</Button>
            </div>
          ) : (
            <div className="max-w-xl">
              <TimerStarter loading={tm.start.isPending} onStart={(body) => tm.start.mutate(body)} />
            </div>
          )}
        </CardBody>
      </Card>

      {/* totals */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label={t('time.today')} value={my.data ? `${formatHM(my.data.today.seconds)}` : '—'} icon={Clock} tone="brand" loading={my.isLoading} hint={my.data ? `${fmt.number(my.data.today.hours)} ${t('time.hoursShort')}` : undefined} />
        <StatCard label={t('time.thisWeek')} value={my.data ? formatHM(my.data.week.seconds) : '—'} icon={CalendarClock} tone="sky" loading={my.isLoading} hint={my.data ? `${fmt.number(my.data.week.hours)} ${t('time.hoursShort')}` : undefined} />
        <div className="col-span-2 lg:col-span-1">
          <StatCard label={t('time.filteredTotal')} value={list.data ? formatHM(list.data.totals.seconds) : '—'} icon={Clock} tone="zinc" loading={list.isLoading} hint={list.data ? t('time.entriesCount', { n: list.data.totals.count }) : undefined} />
        </div>
      </div>

      {/* week strip */}
      <Card>
        <CardHeader
          title={t('time.weekTitle')}
          subtitle={weekStart && my.data ? `${tf.day(weekStart, { month: 'short', day: 'numeric' })} – ${tf.day(my.data.week.end, { month: 'short', day: 'numeric' })}` : undefined}
          action={
            <div className="flex items-center gap-1">
              <IconButton label={t('calendar.prev')} className="size-9" onClick={() => weekStart && setAnchor(addDays(weekStart, -7))}><ChevronLeft className="size-4 rtl:rotate-180" /></IconButton>
              {!thisWeek && <Button size="sm" variant="secondary" onClick={() => setAnchor('')}>{t('time.thisWeek')}</Button>}
              <IconButton label={t('calendar.next')} className="size-9" onClick={() => weekStart && setAnchor(addDays(weekStart, 7))}><ChevronRight className="size-4 rtl:rotate-180" /></IconButton>
            </div>
          }
        />
        <CardBody>
          {my.isError ? <ErrorState onRetry={() => void my.refetch()} /> : my.isLoading ? <Skeleton className="h-28 w-full" /> : (
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5">
              {days.map((d) => {
                const selected = f.from === d.date && f.to === d.date;
                const today = d.date === my.data?.today.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => (selected ? setFilter({ from: '', to: '' }) : setFilter({ from: d.date, to: d.date }))}
                    aria-pressed={selected}
                    className={cx('flex flex-col items-center rounded-xl border px-1 py-2.5 text-center transition sm:py-3', selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-white hover:bg-zinc-50', today && !selected && 'border-zinc-400')}
                  >
                    <span className="text-[11px] font-medium uppercase text-zinc-500">{tf.day(d.date, { weekday: 'short' })}</span>
                    <span className="text-sm font-semibold text-zinc-900 tabular">{tf.day(d.date, { day: 'numeric' })}</span>
                    <span className="mt-2 flex h-14 w-full max-w-6 items-end sm:h-16">
                      <span className="w-full rounded-md bg-brand-500/80" style={{ height: `${Math.max(d.seconds > 0 ? 6 : 2, Math.round((d.seconds / maxDay) * 100))}%`, opacity: d.seconds > 0 ? 1 : 0.2 }} />
                    </span>
                    <span className="mt-1.5 text-[11px] font-medium text-zinc-700 tabular sm:text-xs">{d.seconds > 0 ? formatHM(d.seconds) : '–'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* entries */}
      <div>
        <FilterBar className="!mb-4">
          <label className="flex items-center gap-2 text-[13px] text-zinc-600"><span>{t('common.from')}</span><Input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} className="w-auto" /></label>
          <label className="flex items-center gap-2 text-[13px] text-zinc-600"><span>{t('common.to')}</span><Input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} className="w-auto" /></label>
          {clients.length > 0 && <FilterSelect value={f.clientId} onChange={(v) => setFilter({ clientId: v, projectId: '' })} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
          {(projects.data?.items.length ?? 0) > 0 && <FilterSelect value={f.projectId} onChange={(v) => setFilter({ projectId: v })} allLabel={t('time.allProjects')} options={projects.data!.items.map((p) => ({ value: p.id, label: p.name }))} />}
          {viewAll && <FilterSelect value={f.userId} onChange={(v) => setFilter({ userId: v })} allLabel={t('time.everyone')} options={team.map((m) => ({ value: m.id, label: m.name }))} />}
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setF(EMPTY); setPage(1); }}>{t('common.clear')}</Button>}
        </FilterBar>

        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows rows={4} /> : !list.data?.items.length ? (
          <Card><EmptyState icon={Clock} title={t('time.empty')} description={filtered ? t('common.noResultsHint') : t('time.emptyHint')} action={!filtered && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('time.addEntry')}</Button>} /></Card>
        ) : (
          <>
            <DataList
              rows={list.data.items}
              rowKey={(e) => e.id}
              columns={[
                {
                  key: 'what', header: t('time.what'), primary: true,
                  cell: (e) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-900">{e.task?.title ?? e.project?.name ?? e.client?.companyName ?? t('time.noTask')}</p>
                      {(e.task || e.project) && <p className="truncate text-xs font-normal text-zinc-500">{[e.task ? e.project?.name : null, e.client?.companyName].filter(Boolean).join(' · ')}</p>}
                    </div>
                  ),
                },
                {
                  key: 'when', header: t('time.when'),
                  cell: (e) => (
                    <div className="tabular">
                      <p>{fmt.date(e.startedAt)}</p>
                      <p className="text-xs text-zinc-500">{e.running ? <Badge tone="green">{t('time.running')}</Badge> : `${tf.clock(e.startedAt)} – ${e.endedAt ? tf.clock(e.endedAt) : ''}`}</p>
                    </div>
                  ),
                },
                ...(viewAll ? [{ key: 'who', header: t('time.person'), hideOnTablet: true, cell: (e: TimeEntry) => e.user?.name ?? '—' }] : []),
                { key: 'notes', header: t('common.notes'), hideOnTablet: true, cell: (e) => <span className="line-clamp-2 max-w-64 whitespace-normal text-zinc-600">{e.notes || '—'}</span>, hideOnMobile: true },
                { key: 'dur', header: t('time.duration'), align: 'end', cell: (e) => <span className="font-semibold tabular">{formatHM(e.durationSec)}</span> },
                {
                  key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, align: 'end', hideOnMobile: false,
                  cell: (e) => canChange(e) ? (
                    <div className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
                      <IconButton label={t('common.edit')} className="size-9" onClick={() => setEditing(e)}><Pencil className="size-4" /></IconButton>
                      <IconButton label={t('common.delete')} className="size-9 hover:text-rose-600" onClick={() => setDeleting(e)}><Trash2 className="size-4" /></IconButton>
                    </div>
                  ) : null,
                },
              ]}
            />
            <Pagination meta={list.data.meta} onPage={setPage} />
          </>
        )}
      </div>

      {(creating || editing) && <EntryModal open entry={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} loading={del.isPending} title={t('time.deleteTitle')} message={t('time.deleteMessage')} confirmLabel={t('common.delete')} />
    </div>
  );
}
