import { useState } from 'react';
import { Check, Palmtree, Plus, X } from 'lucide-react';
import { LEAVE_STATUSES, LEAVE_TYPES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { LeaveResponse, LeaveRow } from '@/api/types.attendance';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterSelect, useEnumOptions } from '@/components/ui/Filters';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';

function LeaveList({ rows, showPerson, onReject }: { rows: LeaveRow[]; showPerson: boolean; onReject: (r: LeaveRow) => void }) {
  const { t, fmt, label } = useI18n();
  const [cancelling, setCancelling] = useState<LeaveRow | null>(null);
  const approve = useAction((id: string) => api.post(`/leave/${id}/approve`, {}), { success: t('leave.approved') });
  const cancel = useAction((id: string) => api.post(`/leave/${id}/cancel`, {}), { success: t('leave.cancelled'), onSuccess: () => setCancelling(null) });
  const d = (k: string) => fmt.date(`${k}T00:00:00Z`);
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
          {showPerson && <Avatar name={r.user.name} size="sm" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-900">{showPerson && <span>{r.user.name} · </span>}{label('leaveType', r.type)} · {r.startDate === r.endDate ? d(r.startDate) : `${d(r.startDate)} – ${d(r.endDate)}`}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{t('leave.days', { n: fmt.number(r.days) })}{r.reason ? ` · ${r.reason}` : ''}</p>
            {r.status === 'REJECTED' && r.rejectionReason && <p className="mt-1 text-xs text-rose-700">{t('leave.rejectedBecause', { reason: r.rejectionReason })}</p>}
            {r.reviewedBy && <p className="mt-0.5 text-xs text-zinc-400">{t('leave.reviewedBy', { name: r.reviewedBy.name, when: fmt.dateTime(r.reviewedAt) })}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge group="leaveStatus" value={r.status} />
            {r.permissions.canDecide && (
              <>
                <Button size="sm" variant="success" icon={<Check className="size-3.5" />} loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>{t('leave.approve')}</Button>
                <Button size="sm" variant="secondary" icon={<X className="size-3.5" />} onClick={() => onReject(r)}>{t('leave.reject')}</Button>
              </>
            )}
            {r.permissions.canCancel && <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>{t('leave.cancel')}</Button>}
          </div>
        </li>
      ))}
      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(null)} onConfirm={() => cancelling && cancel.mutate(cancelling.id)} loading={cancel.isPending} title={t('leave.cancelTitle')} message={t('leave.cancelMessage')} confirmLabel={t('leave.cancel')} />
    </ul>
  );
}

/** My leave requests + (for approvers) the review queue. Approval automatically marks attendance ON_LEAVE. */
export function LeaveTab() {
  const { t } = useI18n();
  const { can } = useAuth();
  const approver = can('leave.approve') || can('attendance.view_all');
  const [page, setPage] = useState(1);
  const [teamPage, setTeamPage] = useState(1);
  const [status, setStatus] = useState(can('leave.approve') ? 'PENDING' : '');
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveRow | null>(null);
  const mine = useApi<LeaveResponse>(can('attendance.track') ? '/leave' : null, { mine: 1, page });
  const team = useApi<LeaveResponse>(approver ? '/leave' : null, { status, page: teamPage });
  const statusOptions = useEnumOptions('leaveStatus', LEAVE_STATUSES);

  return (
    <div className="space-y-6">
      {can('attendance.track') && (
        <Card className="overflow-hidden">
          <CardHeader title={t('leave.mine')} action={<Button size="sm" variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('leave.request')}</Button>} />
          <div className="mt-3 border-t border-line">
            {mine.isError ? <ErrorState onRetry={() => void mine.refetch()} /> : mine.isLoading ? <SkeletonRows rows={2} /> : !mine.data?.items.length ? <EmptyState compact icon={Palmtree} title={t('leave.none')} /> : (
              <>
                <LeaveList rows={mine.data.items} showPerson={false} onReject={setRejecting} />
                <div className="px-5 pb-4"><Pagination meta={mine.data.meta} onPage={setPage} /></div>
              </>
            )}
          </div>
        </Card>
      )}
      {approver && (
        <Card className="overflow-hidden">
          <CardHeader title={t('leave.team')} subtitle={team.data?.pendingCount ? t('leave.pendingCount', { n: team.data.pendingCount }) : undefined} action={<FilterSelect value={status} onChange={(v) => { setStatus(v); setTeamPage(1); }} allLabel={t('common.allStatuses')} options={statusOptions} />} />
          <div className="mt-3 border-t border-line">
            {team.isError ? <ErrorState onRetry={() => void team.refetch()} /> : team.isLoading ? <SkeletonRows rows={3} /> : !team.data?.items.length ? <EmptyState compact icon={Palmtree} title={t('leave.noneToReview')} /> : (
              <>
                <LeaveList rows={team.data.items} showPerson onReject={setRejecting} />
                <div className="px-5 pb-4"><Pagination meta={team.data.meta} onPage={setTeamPage} /></div>
              </>
            )}
          </div>
        </Card>
      )}
      {creating && <LeaveRequestModal onClose={() => setCreating(false)} />}
      {rejecting && <RejectModal row={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function LeaveRequestModal({ onClose }: { onClose: () => void }) {
  const { t, label } = useI18n();
  const [f, setF] = useState({ type: 'VACATION' as (typeof LEAVE_TYPES)[number], startDate: '', endDate: '', reason: '' });
  const save = useAction(() => api.post('/leave', { ...f, endDate: f.endDate || f.startDate, reason: f.reason || null }), { success: t('leave.requested'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);
  return (
    <Modal open onClose={onClose} title={t('leave.request')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.startDate} onClick={() => save.mutate(undefined)}>{t('leave.submit')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('leave.type')} className="sm:col-span-2">{(id) => <Select id={id} value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value as typeof f.type }))}>{LEAVE_TYPES.map((x) => <option key={x} value={x}>{label('leaveType', x)}</option>)}</Select>}</Field>
        <Field label={t('leave.start')} required error={err('startDate')}>{(id) => <Input id={id} type="date" value={f.startDate} onChange={(e) => setF((s) => ({ ...s, startDate: e.target.value }))} invalid={!!errs.startDate} />}</Field>
        <Field label={t('leave.end')} error={err('endDate')}>{(id) => <Input id={id} type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF((s) => ({ ...s, endDate: e.target.value }))} invalid={!!errs.endDate} />}</Field>
        <Field label={t('leave.reason')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={f.reason} maxLength={1000} onChange={(e) => setF((s) => ({ ...s, reason: e.target.value }))} />}</Field>
      </div>
    </Modal>
  );
}

function RejectModal({ row, onClose }: { row: LeaveRow; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const save = useAction(() => api.post(`/leave/${row.id}/reject`, { reason }), { success: t('leave.rejected'), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} size="sm" title={t('leave.rejectTitle', { name: row.user.name })} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" loading={save.isPending} disabled={!reason.trim()} onClick={() => save.mutate(undefined)}>{t('leave.reject')}</Button></>}>
      <Field label={t('leave.rejectReason')} required>{(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />}</Field>
    </Modal>
  );
}
