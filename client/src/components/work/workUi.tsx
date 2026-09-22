import { useMemo, type ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import { TASK_STATUSES, type Priority, type TaskStatus } from '@shared/enums';
import type { Tone } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';
import { Select } from '@/components/ui/Form';
import { useI18n } from '@/i18n';

/** Date-only helpers. The API stores due dates as UTC midnight, so every comparison here is done on the UTC day. */
export const utcDayKey = (d: Date = new Date()) => d.toISOString().slice(0, 10);
export const addDaysKey = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDayKey(d);
};
/** ISO string from the API -> value for <input type="date"> */
export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export const TASK_TONE: Record<TaskStatus, Tone> = { TODO: 'neutral', IN_PROGRESS: 'blue', REVIEW: 'violet', BLOCKED: 'red', DONE: 'green' };

const PRIORITY_DOT: Record<Priority, string> = { LOW: 'bg-zinc-300', NORMAL: 'bg-sky-500', HIGH: 'bg-orange-500', URGENT: 'bg-rose-500' };

export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  const { label } = useI18n();
  return <span className={cx('inline-block size-2 shrink-0 rounded-full', PRIORITY_DOT[priority], className)} title={label('priority', priority)} role="img" aria-label={label('priority', priority)} />;
}

/** Due date with the calendar icon; red when overdue. `overdue` is computed by the API for tasks. */
export function DueLabel({ date, overdue, className }: { date: string | null; overdue?: boolean; className?: string }) {
  const { fmt } = useI18n();
  if (!date) return <span className={cx('text-xs text-zinc-400', className)}>—</span>;
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap text-xs tabular', overdue ? 'font-medium text-rose-600' : 'text-zinc-500', className)}>
      <CalendarClock className="size-3.5" aria-hidden />
      {fmt.date(date)}
    </span>
  );
}

export function AssigneeAvatar({ user, size = 'xs', showName }: { user: { name: string; avatar?: string | null } | null | undefined; size?: 'xs' | 'sm'; showName?: boolean }) {
  const { t } = useI18n();
  if (!user) return <span className="text-xs text-zinc-400">{showName ? t('common.unassigned') : '—'}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={user.name}>
      <Avatar name={user.name} size={size} />
      {showName && <span className="truncate text-[13px] text-zinc-700">{user.name}</span>}
    </span>
  );
}

/** Translated status <select>: the keyboard / touch friendly way to change a task's status (also used next to the board). */
export function TaskStatusSelect({ value, onChange, disabled, compact, label: ariaLabel }: { value: TaskStatus; onChange: (s: TaskStatus) => void; disabled?: boolean; compact?: boolean; label?: string }) {
  const { label } = useI18n();
  return (
    <Select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as TaskStatus)}
      className={cx(compact && 'h-8 rounded-lg py-0 ps-2.5 text-[12.5px]')}
    >
      {TASK_STATUSES.map((s) => <option key={s} value={s}>{label('taskStatus', s)}</option>)}
    </Select>
  );
}

export function useOptions<T extends string>(group: string, values: readonly T[]) {
  const { label } = useI18n();
  return useMemo(() => values.map((v) => ({ value: v, label: label(group, v) })), [group, values, label]);
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm font-medium text-zinc-900">{children || '—'}</dd>
    </div>
  );
}
