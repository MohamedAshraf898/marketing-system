import type { ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { cx } from './cx';

export type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'orange' | 'teal';

const TONES: Record<Tone, { chip: string; dot: string }> = {
  neutral: { chip: 'bg-zinc-100 text-zinc-700 ring-zinc-200', dot: 'bg-zinc-400' },
  blue: { chip: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500' },
  green: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500' },
  amber: { chip: 'bg-amber-50 text-amber-900 ring-amber-200', dot: 'bg-amber-500' },
  red: { chip: 'bg-rose-50 text-rose-800 ring-rose-200', dot: 'bg-rose-500' },
  violet: { chip: 'bg-violet-50 text-violet-800 ring-violet-200', dot: 'bg-violet-500' },
  orange: { chip: 'bg-orange-50 text-orange-900 ring-orange-200', dot: 'bg-orange-500' },
  teal: { chip: 'bg-teal-50 text-teal-800 ring-teal-200', dot: 'bg-teal-500' },
};

export function Badge({ tone = 'neutral', dot = true, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  const c = TONES[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', c.chip, className)}>
      {dot && <span className={cx('size-1.5 rounded-full', c.dot)} />}
      {children}
    </span>
  );
}

const TONE_MAP: Record<string, Record<string, Tone>> = {
  clientStatus: { ACTIVE: 'green', PAUSED: 'amber', ARCHIVED: 'neutral' },
  userStatus: { ACTIVE: 'green', INACTIVE: 'neutral' },
  campaignStatus: { PLANNING: 'neutral', PENDING_APPROVAL: 'amber', RUNNING: 'green', PAUSED: 'orange', COMPLETED: 'blue' },
  deliverableStatus: { DRAFT: 'neutral', PENDING_APPROVAL: 'amber', APPROVED: 'green', CHANGES_REQUESTED: 'red', PUBLISHED: 'violet' },
  decision: { PENDING: 'amber', APPROVED: 'green', CHANGES_REQUESTED: 'red' },
  requestStatus: { NEW: 'blue', IN_PROGRESS: 'violet', WAITING_CLIENT: 'amber', COMPLETED: 'green', CANCELLED: 'neutral' },
  priority: { LOW: 'neutral', NORMAL: 'blue', HIGH: 'orange', URGENT: 'red' },
  role: { ADMIN: 'violet', TEAM: 'blue', CLIENT: 'teal' },
};

/** Status badge: colour comes from the value, text is translated. */
export function StatusBadge({ group, value, className }: { group: keyof typeof TONE_MAP | string; value: string; className?: string }) {
  const { label } = useI18n();
  return (
    <Badge tone={TONE_MAP[group]?.[value] ?? 'neutral'} className={className}>
      {label(group, value)}
    </Badge>
  );
}
