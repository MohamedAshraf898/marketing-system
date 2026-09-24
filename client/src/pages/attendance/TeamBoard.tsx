import { useMemo, useState } from 'react';
import { AlarmClock, Briefcase, Clock3, Coffee, Download, Home, LogOut, Palmtree, Plus, TimerReset, UserX, Users } from 'lucide-react';
import { ATTENDANCE_STATUSES } from '@shared/enums';
import { qs } from '@/api/client';
import { useApi } from '@/api/hooks';
import type { AttendanceMember, AttendanceRecord, AttendanceSummary, RecordsResponse } from '@/api/types.attendance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, useEnumOptions } from '@/components/ui/Filters';
import { Field, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';
import { Segmented } from '@/components/ui/Tabs';
import { CorrectionModal, localKey, PersonCell, RecordDrawer, useClockTime, useMinutes } from '@/components/attendance/attendanceUi';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function presetRange(p: Preset, custom: { from: string; to: string }) {
  const now = new Date();
  const today = localKey(now);
  if (p === 'today') return { from: today, to: today };
  if (p === 'yesterday') { const y = localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)); return { from: y, to: y }; }
  if (p === 'week') return { from: localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))), to: today };
  if (p === 'month') return { from: localKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  return custom;
}

/** Admin attendance dashboard: live KPIs, the daily / period table with filters, CSV export and manual entries. */
export function TeamBoard() {
  const { t, fmt } = useI18n();
  const { can } = useAuth();
  const mins = useMinutes();
  const clock = useClockTime();
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState(() => presetRange('week', { from: '', to: '' }));
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const range = useMemo(() => presetRange(preset, custom), [preset, custom]);
  const single = range.from === range.to;
  const params = { ...range, userId, status };
  const summary = useApi<AttendanceSummary>('/attendance/summary', { ...range, userId });
  const records = useApi<RecordsResponse>('/attendance/records', { ...params, page, pageSize: 25 });
  const members = useApi<{ items: AttendanceMember[] }>('/attendance/members');
  const statusOptions = useEnumOptions('attendanceStatus', ATTENDANCE_STATUSES);
  const s = summary.data;
  const live = s && s.range.from <= s.today && s.today <= s.range.to;
  const reset = () => setPage(1);

  const kpis = [
    { label: t('att.kpi.working'), value: (s?.presence.WORKING ?? 0) + (s?.presence.ON_BREAK ?? 0), icon: Briefcase, tone: 'emerald' as const, show: live },
    { label: t('att.kpi.onBreak'), value: s?.presence.ON_BREAK ?? 0, icon: Coffee, tone: 'amber' as const, show: live },
    { label: t('att.kpi.checkedOut'), value: s?.presence.CHECKED_OUT ?? 0, icon: LogOut, tone: 'sky' as const, show: live },
    { label: t('att.kpi.late'), value: s?.statusCounts.LATE ?? 0, icon: AlarmClock, tone: 'amber' as const, show: true },
    { label: t('att.kpi.absent'), value: s?.statusCounts.ABSENT ?? 0, icon: UserX, tone: 'zinc' as const, show: true },
    { label: t('att.kpi.onLeave'), value: s?.statusCounts.ON_LEAVE ?? 0, icon: Palmtree, tone: 'brand' as const, show: true },
    { label: t('att.kpi.wfh'), value: s?.statusCounts.WFH ?? 0, icon: Home, tone: 'sky' as const, show: true },
    { label: t('att.kpi.members'), value: s?.members ?? 0, icon: Users, tone: 'zinc' as const, show: true },
  ].filter((k) => k.show);

  return (
    <div className="space-y-5">
      <FilterBar>
        <div className="col-span-2"><Segmented value={preset} onChange={(v) => { setPreset(v); reset(); }} options={(['today', 'yesterday', 'week', 'month', 'custom'] as const).map((id) => ({ id, label: t(`att.range.${id}`) }))} /></div>
        {preset === 'custom' && (
          <div className="col-span-2 flex items-center gap-2">
            <Input type="date" value={custom.from} max={custom.to} onChange={(e) => { setCustom((c) => ({ ...c, from: e.target.value })); reset(); }} className="w-40" aria-label={t('common.from')} />
            <span className="text-zinc-400">–</span>
            <Input type="date" value={custom.to} min={custom.from} onChange={(e) => { setCustom((c) => ({ ...c, to: e.target.value })); reset(); }} className="w-40" aria-label={t('common.to')} />
          </div>
        )}
        <FilterSelect value={userId} onChange={(v) => { setUserId(v); reset(); }} allLabel={t('att.allEmployees')} options={(members.data?.items ?? []).filter((m) => m.trackAttendance).map((m) => ({ value: m.id, label: m.name }))} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        <div className="col-span-2 flex gap-2 sm:ms-auto">
          <a className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50" href={`/api/attendance/records${qs({ ...params, format: 'csv' })}`}><Download className="size-4" />{t('common.exportCsv')}</a>
          {can('attendance.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('att.addRecord')}</Button>}
        </div>
      </FilterBar>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => <StatCard key={k.label} label={k.label} value={fmt.number(k.value)} icon={k.icon} tone={k.tone} loading={summary.isLoading} />)}
        <StatCard label={t('att.kpi.avgWorked')} value={mins(s?.totals.avgWorkedMinutes ?? 0)} icon={Clock3} tone="brand" loading={summary.isLoading} />
        <StatCard label={t('att.kpi.overtime')} value={mins(s?.totals.overtimeMinutes ?? 0)} icon={TimerReset} tone="emerald" loading={summary.isLoading} />
      </div>

      {records.isError ? <ErrorState onRetry={() => void records.refetch()} /> : records.isLoading ? <SkeletonRows /> : !records.data?.items.length ? <EmptyState icon={Users} title={t('att.noRecords')} /> : (
        <>
          <DataList
            rows={records.data.items}
            rowKey={(r) => r.id ?? `${r.userId}-${r.date}`}
            onRowClick={(r) => setOpen(r)}
            columns={[
              { key: 'who', header: t('att.employee'), primary: true, cell: (r) => <PersonCell r={r} /> },
              ...(!single ? [{ key: 'date', header: t('common.date'), cell: (r: AttendanceRecord) => fmt.date(`${r.date}T00:00:00Z`) }] : []),
              { key: 'status', header: t('common.status'), cell: (r) => <span className="inline-flex flex-wrap gap-1">{single && r.presence !== r.status && r.presence !== 'CHECKED_OUT' ? <StatusBadge group="presence" value={r.presence} /> : null}<StatusBadge group="attendanceStatus" value={r.status} /></span> },
              { key: 'in', header: t('att.checkIn'), cell: (r) => <span className="tabular">{clock(r.checkInAt)}</span> },
              { key: 'out', header: t('att.checkOut'), cell: (r) => <span className="tabular">{clock(r.checkOutAt)}{r.missingCheckout ? ' ⚠' : ''}</span> },
              { key: 'worked', header: t('att.worked'), cell: (r) => <span className="tabular">{mins(r.workedMinutes)}</span> },
              { key: 'break', header: t('att.break'), hideOnTablet: true, cell: (r) => <span className="tabular">{mins(r.breakMinutes)}</span> },
              { key: 'late', header: t('att.late'), cell: (r) => (r.lateMinutes ? <span className="tabular text-amber-700">{mins(r.lateMinutes)}</span> : '—') },
              { key: 'ot', header: t('att.overtime'), hideOnTablet: true, cell: (r) => (r.overtimeMinutes ? <span className="tabular text-emerald-700">{mins(r.overtimeMinutes)}</span> : '—') },
            ]}
          />
          <Pagination meta={records.data.meta} onPage={setPage} />
        </>
      )}
      <RecordDrawer id={open?.id ?? null} virtual={open && !open.id ? open : null} onClose={() => setOpen(null)} />
      {creating && <NewRecordModal members={members.data?.items ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Pick a person + day, then the normal correction form creates the missing record. */
function NewRecordModal({ members, onClose }: { members: AttendanceMember[]; onClose: () => void }) {
  const { t } = useI18n();
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(localKey(new Date()));
  const [next, setNext] = useState(false);
  const m = members.find((x) => x.id === userId);
  if (next && m) {
    const blank: AttendanceRecord = {
      id: null, userId: m.id, user: { id: m.id, name: m.name, avatar: m.avatar, jobTitle: m.jobTitle }, date, checkInAt: null, checkOutAt: null, remote: false, status: 'PRESENT',
      statusLocked: false, breakMinutes: 0, workedMinutes: 0, expectedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, open: false, onBreak: false,
      missingCheckout: false, presence: 'NOT_CHECKED_IN', notes: null, isManual: false, correctedBy: null, correctedAt: null, leaveRequestId: null, breaks: [], schedule: m.schedule,
    };
    return <CorrectionModal record={blank} onClose={onClose} />;
  }
  return (
    <Modal open onClose={onClose} title={t('att.addRecord')} size="sm" footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!userId || !date} onClick={() => setNext(true)}>{t('common.next')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('att.employee')}>{(id) => <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">—</option>{members.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label={t('common.date')}>{(id) => <Input id={id} type="date" value={date} max={localKey(new Date())} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
