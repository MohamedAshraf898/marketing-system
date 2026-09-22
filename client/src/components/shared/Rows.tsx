import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight } from 'lucide-react';
import type { Campaign, Deliverable, RequestRow } from '@/api/types';
import { useI18n } from '@/i18n';
import { StatusBadge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/cx';
import { BudgetBar, DeliverablePreview } from './Media';

/** Compact list rows used on dashboards and detail tabs. */

export function DeliverableRowItem({ d, showClient }: { d: Deliverable; showClient?: boolean }) {
  const { t, fmt, label } = useI18n();
  return (
    <Link to={`/deliverables/${d.id}`} className="group flex items-center gap-3.5 px-5 py-3.5 transition hover:bg-zinc-50 sm:px-6">
      <DeliverablePreview fileId={d.previewFileId} previewUrl={d.previewUrl} name={d.name} className="size-14 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900">{d.name}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {[showClient ? d.client?.companyName : null, d.campaign?.name, label('deliverableType', d.type), `v${d.version}`].filter(Boolean).join(' · ')}
        </p>
        {d.dueDate && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400"><CalendarClock className="size-3" />{t('common.due', { date: fmt.date(d.dueDate) })}</p>
        )}
      </div>
      <span className="hidden sm:block"><StatusBadge group="deliverableStatus" value={d.status} /></span>
      <ChevronRight className="size-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 rtl:rotate-180" />
    </Link>
  );
}

export function RequestRowItem({ r, showClient }: { r: RequestRow; showClient?: boolean }) {
  const { fmt, label } = useI18n();
  return (
    <Link to={`/requests/${r.id}`} className="group flex items-center gap-3.5 px-5 py-3.5 transition hover:bg-zinc-50 sm:px-6">
      <span className={cx('size-2 shrink-0 rounded-full', r.priority === 'URGENT' ? 'bg-rose-500' : r.priority === 'HIGH' ? 'bg-orange-500' : r.priority === 'NORMAL' ? 'bg-sky-500' : 'bg-zinc-300')} title={label('priority', r.priority)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900">{r.title}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {[showClient ? r.client?.companyName : null, label('requestType', r.type), fmt.relative(r.createdAt)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <span className="hidden sm:block"><StatusBadge group="requestStatus" value={r.status} /></span>
      <ChevronRight className="size-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 rtl:rotate-180" />
    </Link>
  );
}

export function CampaignRowItem({ c, showClient }: { c: Campaign; showClient?: boolean }) {
  const { fmt, label } = useI18n();
  return (
    <Link to={`/campaigns/${c.id}`} className="group block px-5 py-3.5 transition hover:bg-zinc-50 sm:px-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900">{c.name}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{[showClient ? c.client?.companyName : null, label('platform', c.platform), label('objective', c.objective)].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="hidden sm:block"><StatusBadge group="campaignStatus" value={c.status} /></span>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <BudgetBar spent={c.spent} budget={c.budget} />
        <span className="shrink-0 text-xs text-zinc-500 tabular">{fmt.money(c.spent, { compact: true })} / {fmt.money(c.budget, { compact: true })}</span>
      </div>
    </Link>
  );
}
