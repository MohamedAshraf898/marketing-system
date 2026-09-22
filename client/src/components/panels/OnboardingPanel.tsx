import { useState } from 'react';
import { Check, ClipboardList, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { OnboardingItemRow, OnboardingResponse } from '@/api/types.crm';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/Progress';
import { cx } from '@/components/ui/cx';
import { useTeamMembers } from '@/components/shared/options';
import { useOnboardingTitle } from './onboardingTitle';

const dayInput = (d: string | null) => (d ? d.slice(0, 10) : '');
const isOverdue = (i: OnboardingItemRow) => !i.done && !!i.dueDate && new Date(i.dueDate).getTime() < new Date().setUTCHours(0, 0, 0, 0);

/** The onboarding checklist of a client. INTERNAL: renders nothing for client users (and the API refuses them anyway). */
export function OnboardingPanel({ clientId }: { clientId: string }) {
  const { t, fmt } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const canManage = staff && can('onboarding.manage');
  const title = useOnboardingTitle();
  const [editing, setEditing] = useState<OnboardingItemRow | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<OnboardingItemRow | null>(null);
  const q = useApi<OnboardingResponse>(`/clients/${clientId}/onboarding`, undefined, { enabled: staff });
  const start = useAction(() => api.post(`/clients/${clientId}/onboarding/start`, {}), { success: t('crm.onb.started') });
  const toggle = useAction((i: OnboardingItemRow) => api.patch(`/onboarding/${i.id}`, { done: !i.done }));
  const remove = useAction((i: OnboardingItemRow) => api.del(`/onboarding/${i.id}`), { success: t('crm.onb.deleted'), onSuccess: () => setToDelete(null) });

  if (!staff) return null;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  const { items, progress, onboardingStatus } = q.data;

  if (!items.length) {
    return (
      <EmptyState
        icon={ClipboardList} title={t('crm.onb.empty')} description={t('crm.onb.emptyHint')}
        action={canManage ? <div className="flex flex-wrap justify-center gap-2"><Button variant="brand" loading={start.isPending} onClick={() => start.mutate(undefined)}>{t('crm.onb.start')}</Button><Button variant="secondary" onClick={() => setEditing('new')}>{t('crm.onb.addItem')}</Button></div> : undefined}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <h3 className="text-[15px] font-semibold text-zinc-900">{t('crm.onb.progress')}</h3>
              <StatusBadge group="onboardingStatus" value={onboardingStatus} />
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800"><Lock className="size-3.5" />{t('crm.internalLabel')}</span>
          </div>
          <ProgressBar value={progress.percent} tone={progress.percent === 100 ? 'green' : 'brand'} label={`${fmt.number(progress.percent)}%`} />
          <p className="text-[13px] text-zinc-500 tabular">
            {t('crm.onb.doneOf', { done: fmt.number(progress.done), total: fmt.number(progress.total) })}
            {progress.overdue > 0 && <span className="ms-2 font-medium text-rose-600">{t('crm.onb.overdueCount', { n: fmt.number(progress.overdue) })}</span>}
          </p>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-3.5 px-4 py-3.5 sm:px-5">
              <button
                type="button" disabled={!canManage || toggle.isPending} onClick={() => toggle.mutate(i)} aria-pressed={i.done} aria-label={i.done ? t('crm.onb.markUndone') : t('crm.onb.markDone')}
                className={cx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition', i.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-300 bg-white text-transparent hover:border-brand-500', !canManage && 'cursor-default opacity-70')}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <p className={cx('text-sm font-medium', i.done ? 'text-zinc-400 line-through' : 'text-zinc-900')}>{title(i.title)}</p>
                {i.description && <p className="mt-0.5 text-[13px] text-zinc-500">{i.description}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                  <span>{i.assignedTo ? t('crm.onb.assignedTo', { name: i.assignedTo.name }) : t('common.unassigned')}</span>
                  {i.dueDate && <span className={cx(isOverdue(i) && 'font-medium text-rose-600')}>{isOverdue(i) ? t('crm.onb.overdueOn', { date: fmt.date(i.dueDate) }) : t('common.due', { date: fmt.date(i.dueDate) })}</span>}
                  {i.done && i.completedAt && <span className="text-emerald-700">{t('crm.onb.completedBy', { name: i.completedBy?.name ?? '—', date: fmt.date(i.completedAt) })}</span>}
                </p>
                {i.notes && <p className="mt-1.5 whitespace-pre-line rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-xs text-zinc-600">{i.notes}</p>}
              </div>
              {canManage && (
                <div className="-me-1 flex shrink-0">
                  <IconButton label={t('common.edit')} className="size-9" onClick={() => setEditing(i)}><Pencil className="size-[18px]" /></IconButton>
                  <IconButton label={t('common.delete')} className="size-9 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(i)}><Trash2 className="size-[18px]" /></IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canManage && <div className="border-t border-line bg-zinc-50/60 px-4 py-3 sm:px-5"><Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{t('crm.onb.addItem')}</Button></div>}
      </Card>

      {editing && <OnboardingItemModal clientId={clientId} item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete)} loading={remove.isPending} title={t('crm.onb.deleteTitle')} message={t('crm.onb.deleteMessage', { title: toDelete ? title(toDelete.title) : '' })} confirmLabel={t('common.delete')} />
    </div>
  );
}

function OnboardingItemModal({ clientId, item, onClose }: { clientId: string; item?: OnboardingItemRow; onClose: () => void }) {
  const { t } = useI18n();
  const editing = !!item;
  const team = useTeamMembers(clientId);
  const [f, setF] = useState({ title: item?.title ?? '', description: item?.description ?? '', assignedToId: item?.assignedToId ?? '', dueDate: dayInput(item?.dueDate ?? null), notes: item?.notes ?? '' });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = useAction(
    () => {
      const body = { title: f.title, description: f.description || null, assignedToId: f.assignedToId || null, dueDate: f.dueDate || null, notes: f.notes || null };
      return editing ? api.patch(`/onboarding/${item.id}`, body) : api.post(`/clients/${clientId}/onboarding`, body);
    },
    { success: editing ? t('crm.onb.updated') : t('crm.onb.added'), onSuccess: onClose },
  );
  const errs = fieldErrors(save.error);
  const err = (k: string) => fieldText(t, errs[k]);

  return (
    <Modal
      open onClose={onClose} title={editing ? t('crm.onb.editItem') : t('crm.onb.addItem')} description={t('crm.internalHint')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!f.title.trim()} className="max-sm:h-11">{editing ? t('common.saveChanges') : t('common.add')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (f.title.trim()) save.mutate(undefined); }} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('crm.onb.itemTitle')} required error={err('title')} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} onChange={(e) => set('title', e.target.value)} invalid={!!errs.title} maxLength={200} />}</Field>
        <Field label={t('common.description')} hint={t('common.optional')} error={err('description')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} />}</Field>
        <Field label={t('common.assignee')} error={err('assignedToId')}>
          {(id) => (
            <Select id={id} value={f.assignedToId} onChange={(e) => set('assignedToId', e.target.value)}>
              <option value="">{t('common.unassigned')}</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.dueDate')} hint={t('common.optional')} error={err('dueDate')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}</Field>
        <Field label={t('common.notes')} hint={t('common.optional')} error={err('notes')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
