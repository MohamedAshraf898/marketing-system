import { AtSign, CalendarCheck2, CheckCircle2, Eye, GitBranch, MessageSquare, Palmtree, PencilLine, Send, UserPlus, LifeBuoy, RefreshCw, Bell, Workflow, AlarmClock, type LucideIcon } from 'lucide-react';
import type { NotificationRow } from '@/api/types';
import { useI18n, type TKey } from '@/i18n';
import { cx } from '@/components/ui/cx';

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  NEW_REQUEST: { icon: LifeBuoy, tone: 'bg-sky-50 text-sky-700' },
  DELIVERABLE_SUBMITTED: { icon: Send, tone: 'bg-amber-50 text-amber-700' },
  DELIVERABLE_APPROVED: { icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700' },
  CHANGES_REQUESTED: { icon: PencilLine, tone: 'bg-rose-50 text-rose-700' },
  REQUEST_STATUS_CHANGED: { icon: RefreshCw, tone: 'bg-violet-50 text-violet-700' },
  REQUEST_ASSIGNED: { icon: UserPlus, tone: 'bg-teal-50 text-teal-700' },
  NEW_COMMENT: { icon: MessageSquare, tone: 'bg-zinc-100 text-zinc-700' },
  TASK_ASSIGNED: { icon: UserPlus, tone: 'bg-teal-50 text-teal-700' },
  TASK_COMMENT: { icon: MessageSquare, tone: 'bg-zinc-100 text-zinc-700' },
  TASK_MENTION: { icon: AtSign, tone: 'bg-brand-50 text-brand-700' },
  TASK_STATUS_CHANGED: { icon: RefreshCw, tone: 'bg-violet-50 text-violet-700' },
  TASK_REVIEW: { icon: Eye, tone: 'bg-violet-50 text-violet-700' },
  TASK_DEPENDENCY_DONE: { icon: GitBranch, tone: 'bg-emerald-50 text-emerald-700' },
  TASK_DUE_SOON: { icon: AlarmClock, tone: 'bg-amber-50 text-amber-700' },
  TASK_OVERDUE: { icon: AlarmClock, tone: 'bg-rose-50 text-rose-700' },
  TASK_AUTOMATION: { icon: Workflow, tone: 'bg-violet-50 text-violet-700' },
  TASK_APPROVAL_REQUESTED: { icon: Send, tone: 'bg-amber-50 text-amber-700' },
  LEAVE_REQUESTED: { icon: Palmtree, tone: 'bg-violet-50 text-violet-700' },
  LEAVE_APPROVED: { icon: Palmtree, tone: 'bg-emerald-50 text-emerald-700' },
  LEAVE_REJECTED: { icon: Palmtree, tone: 'bg-rose-50 text-rose-700' },
  ATTENDANCE_CORRECTED: { icon: CalendarCheck2, tone: 'bg-amber-50 text-amber-700' },
};

/** Where a notification leads. `?open=<id>` opens the item's details panel on list pages. */
export const notificationLink = (n: Pick<NotificationRow, 'entity' | 'entityId'>): string | null => {
  const id = n.entityId;
  if (!id) return n.entity === 'report' ? '/reports' : null;
  switch (n.entity) {
    case 'deliverable': return `/deliverables/${id}`;
    case 'request': return `/requests/${id}`;
    case 'campaign': return `/campaigns/${id}`;
    case 'project': return `/projects/${id}`;
    case 'client': return `/clients/${id}`;
    case 'task': return `/tasks?open=${id}`;
    case 'content': return `/content?open=${id}`;
    case 'contract': return `/contracts?open=${id}`;
    case 'invoice': return `/invoices?open=${id}`;
    case 'report': return '/reports';
    case 'leave': return '/attendance?tab=leave';
    case 'attendance': return '/attendance';
    default: return null;
  }
};

export function useNotificationText() {
  const { t, label, has } = useI18n();
  return (n: NotificationRow) => {
    const key = `notif.${n.type}` as TKey;
    if (!has(key)) return n.type;
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(n.data ?? {})) {
      params[k] = k === 'status' ? label('requestStatus', String(v)) : k === 'taskStatus' || (k === 'from' && n.type === 'TASK_STATUS_CHANGED') ? label('taskStatus', String(v)) : v;
    }
    return t(key, params);
  };
}

export function NotificationItem({ n, onClick, compact }: { n: NotificationRow; onClick?: () => void; compact?: boolean }) {
  const { fmt } = useI18n();
  const text = useNotificationText()(n);
  const meta = ICONS[n.type] ?? { icon: Bell, tone: 'bg-zinc-100 text-zinc-700' };
  const Icon = meta.icon;
  return (
    <button onClick={onClick} className={cx('flex w-full items-start gap-3 text-start transition hover:bg-zinc-50', compact ? 'px-4 py-3' : 'px-5 py-4', !n.readAt && 'bg-brand-50/40')}>
      <span className={cx('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl', meta.tone)}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block text-[13.5px] leading-snug', n.readAt ? 'text-zinc-600' : 'font-medium text-zinc-900')}>{text}</span>
        <span className="mt-1 block text-xs text-zinc-400">{fmt.relative(n.createdAt)}</span>
      </span>
      {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden />}
    </button>
  );
}
