import { CheckCircle2, MessageSquare, PencilLine, Send, UserPlus, LifeBuoy, RefreshCw, Bell, type LucideIcon } from 'lucide-react';
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
};

export const notificationLink = (n: Pick<NotificationRow, 'entity' | 'entityId'>): string | null =>
  n.entity === 'deliverable' && n.entityId ? `/deliverables/${n.entityId}` : n.entity === 'request' && n.entityId ? `/requests/${n.entityId}` : null;

export function useNotificationText() {
  const { t, label, has } = useI18n();
  return (n: NotificationRow) => {
    const key = `notif.${n.type}` as TKey;
    if (!has(key)) return n.type;
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(n.data ?? {})) params[k] = k === 'status' ? label('requestStatus', String(v)) : v;
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
