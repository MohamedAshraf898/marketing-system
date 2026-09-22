import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  BarChart3, Building2, CalendarDays, CheckSquare, Contact, FileSignature, Flag, FolderKanban, History, LifeBuoy, ListChecks, Megaphone, MessageSquare,
  Palette, Paperclip, Receipt, Settings, StickyNote, User, type LucideIcon,
} from 'lucide-react';
import { api } from '@/api/client';
import type { Paged } from '@/api/types';
import type { ActivityRow } from '@/api/types.crm';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';

const ICONS: Record<string, LucideIcon> = {
  client: Building2, contact: Contact, internal_note: StickyNote, onboarding_item: ListChecks, project: FolderKanban, milestone: Flag, task: CheckSquare,
  campaign: Megaphone, content: CalendarDays, deliverable: Palette, proofing: MessageSquare, request: LifeBuoy, report: BarChart3, file: Paperclip,
  contract: FileSignature, invoice: Receipt, user: User, settings: Settings,
};

// which enum group translates the from/to values of a status change, per entity
const STATUS_GROUP: Record<string, string> = {
  client: 'clientStatus', project: 'projectStatus', task: 'taskStatus', campaign: 'campaignStatus', content: 'contentStatus', deliverable: 'deliverableStatus',
  request: 'requestStatus', contract: 'contractStatus', invoice: 'invoiceStatus',
};

const LINKS: Record<string, string> = { deliverable: '/deliverables', request: '/requests', campaign: '/campaigns', project: '/projects' };

/**
 * Timeline of what happened for a client (or one project). The server only sends a sanitised summary
 * (name / title / status change / version), and CLIENT users only get the rows meant for them.
 */
export function ActivityFeed({ clientId, projectId, pageSize = 20 }: { clientId?: string; projectId?: string; pageSize?: number }) {
  const { t, fmt, label } = useI18n();
  const q = useInfiniteQuery({
    queryKey: ['api', '/activity', { clientId: clientId ?? '', projectId: projectId ?? '', pageSize, infinite: true }],
    queryFn: ({ pageParam }) => api.get<Paged<ActivityRow>>('/activity', { clientId, projectId, pageSize, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  if (!rows.length) return <EmptyState compact icon={History} title={t('crm.activity.empty')} description={t('crm.activity.emptyHint')} />;

  return (
    <div>
      <ol className="relative space-y-1 before:absolute before:inset-y-2 before:start-[19px] before:w-px before:bg-line">
        {rows.map((r) => {
          const Icon = ICONS[r.entity] ?? History;
          const detail = r.summary.title ?? r.summary.name;
          const group = STATUS_GROUP[r.entity];
          const transition = r.summary.from && r.summary.to ? `${group ? label(group, r.summary.from) : r.summary.from} → ${group ? label(group, r.summary.to) : r.summary.to}` : null;
          const href = r.entityId && LINKS[r.entity] && !r.action.endsWith('_DELETED') ? `${LINKS[r.entity]}/${r.entityId}` : null;
          const text = <span className="font-medium text-zinc-900">{label('auditAction', r.action)}</span>;
          return (
            <li key={r.id} className="relative flex gap-3.5 rounded-xl px-1 py-2.5">
              <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-zinc-500 shadow-sm">
                <Icon className="size-[18px]" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm leading-snug text-zinc-700">
                  {href ? <Link to={href} className="hover:text-brand-700">{text}</Link> : text}
                  {detail && <span className="text-zinc-500"> · {detail}</span>}
                  {r.summary.version !== undefined && <span className="text-zinc-400"> · v{r.summary.version}</span>}
                </p>
                {(transition || r.summary.status) && <p className="mt-0.5 text-[13px] text-zinc-500">{transition ?? (group && r.summary.status ? label(group, r.summary.status) : r.summary.status)}</p>}
                <p className="mt-0.5 text-xs text-zinc-400">
                  <span>{label('auditEntity', r.entity)}</span>
                  {r.actor && <span> · {r.actor.name}</span>}
                  <span> · </span>
                  <time dateTime={r.createdAt} title={fmt.dateTime(r.createdAt)}>{fmt.relative(r.createdAt)}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {q.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t('crm.activity.loadMore')}</Button>
        </div>
      )}
    </div>
  );
}
