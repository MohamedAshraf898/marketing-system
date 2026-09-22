import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, FileSignature, FolderKanban, History, ListChecks, Rocket, Users } from 'lucide-react';
import { CLIENT_STATUSES, CONTENT_STATUSES } from '@shared/enums';
import type { DashActivity, DashClientProject, DashboardExtras } from '@/api/types.admin';
import { useI18n } from '@/i18n';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/Feedback';
import { ProgressBar } from '@/components/ui/Progress';

const rowCls = 'flex items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 sm:px-6';

/** Dashboard card: title, optional "view all" link, divided rows. */
export function Section({ title, to, children, subtitle }: { title: string; to?: string; children: ReactNode; subtitle?: string }) {
  const { t } = useI18n();
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} subtitle={subtitle} action={to && <Link to={to} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700">{t('common.viewAll')}<ArrowRight className="size-3.5 rtl:rotate-180" /></Link>} />
      <div className="mt-3 divide-y divide-line border-t border-line">{children}</div>
    </Card>
  );
}

const Empty = ({ icon, title }: { icon: typeof History; title: string }) => <EmptyState compact icon={icon} title={title} />;

/** 3725 -> "1h 2m" */
export function useHoursFormat() {
  const { t, fmt } = useI18n();
  return (sec: number) => {
    const m = Math.round(sec / 60);
    return m < 60 ? t('dash.minutes', { n: fmt.number(m) }) : t('dash.hoursMinutes', { h: fmt.number(Math.floor(m / 60)), m: fmt.number(m % 60) });
  };
}

// ───────────────────────── staff widgets ─────────────────────────

export function MyTasksCard({ d }: { d: NonNullable<DashboardExtras['myTasks']> }) {
  const { t, fmt } = useI18n();
  return (
    <Section title={t('dash.myTasks')} to="/tasks" subtitle={t('dash.myTasksSummary', { open: fmt.number(d.open), overdue: fmt.number(d.overdue), today: fmt.number(d.dueToday) })}>
      {d.next.length === 0 ? <Empty icon={ListChecks} title={t('dash.noTasks')} /> : d.next.map((task) => {
        const late = !!task.dueDate && new Date(task.dueDate).getTime() < Date.now() - 86_400_000;
        return (
          <Link key={task.id} to="/tasks" className={rowCls}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-900">{task.title}</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">{[task.project?.name, task.client?.companyName].filter(Boolean).join(' · ') || t('common.unassigned')}</p>
            </div>
            <StatusBadge group="priority" value={task.priority} />
            <span className={cx('shrink-0 text-xs tabular', late ? 'font-medium text-rose-600' : 'text-zinc-500')}>{fmt.date(task.dueDate)}</span>
          </Link>
        );
      })}
    </Section>
  );
}

const DEADLINE_LINK = { TASK: () => '/tasks', PROJECT: (id: string) => `/projects/${id}`, MILESTONE: (_id: string, p?: string | null) => (p ? `/projects/${p}` : '/projects'), CONTENT: () => '/content' } as const;

export function DeadlinesCard({ items }: { items: NonNullable<DashboardExtras['upcomingDeadlines']> }) {
  const { t, fmt } = useI18n();
  return (
    <Section title={t('dash.deadlines')} to="/calendar">
      {items.length === 0 ? <Empty icon={CalendarClock} title={t('dash.noDeadlines')} /> : items.map((x) => (
        <Link key={`${x.kind}-${x.id}`} to={DEADLINE_LINK[x.kind](x.id, x.projectId)} className={rowCls}>
          <Badge dot={false} tone={x.kind === 'PROJECT' ? 'violet' : x.kind === 'CONTENT' ? 'teal' : x.kind === 'MILESTONE' ? 'amber' : 'blue'}>{t(`dash.kind.${x.kind}` as 'dash.kind.TASK')}</Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">{x.title}</p>
            {x.clientName && <p className="truncate text-xs text-zinc-500">{x.clientName}</p>}
          </div>
          <span className="shrink-0 text-xs text-zinc-500 tabular">{fmt.date(x.date)}</span>
        </Link>
      ))}
    </Section>
  );
}

const PIPELINE_COLOR: Record<string, string> = {
  IDEA: 'bg-zinc-300', DRAFT: 'bg-sky-400', IN_REVIEW: 'bg-violet-400', CLIENT_APPROVAL: 'bg-amber-400', APPROVED: 'bg-emerald-400', SCHEDULED: 'bg-teal-500', PUBLISHED: 'bg-emerald-600', REJECTED: 'bg-rose-400',
};

export function ContentPipelineCard({ d }: { d: NonNullable<DashboardExtras['contentPipeline']> }) {
  const { t, fmt, label, locale } = useI18n();
  const weekday = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { weekday: 'short', timeZone: 'UTC' });
  const max = Math.max(1, ...d.next7Days.map((x) => x.count));
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t('dash.contentPipeline')} action={<Link to="/content" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700">{t('common.viewAll')}<ArrowRight className="size-3.5 rtl:rotate-180" /></Link>} />
      <div className="mt-3 space-y-5 border-t border-line px-5 py-5 sm:px-6">
        {d.total === 0 ? <Empty icon={CalendarDays} title={t('dash.noContent')} /> : (
          <>
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={t('dash.contentPipeline')}>
                {CONTENT_STATUSES.filter((s) => d.byStatus[s] > 0).map((s) => <div key={s} className={PIPELINE_COLOR[s]} style={{ width: `${(d.byStatus[s] / d.total) * 100}%` }} title={`${label('contentStatus', s)}: ${d.byStatus[s]}`} />)}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-600">
                {CONTENT_STATUSES.filter((s) => d.byStatus[s] > 0).map((s) => (
                  <li key={s} className="inline-flex items-center gap-1.5"><span className={cx('size-2 rounded-full', PIPELINE_COLOR[s])} />{label('contentStatus', s)} <span className="font-semibold tabular text-zinc-900">{fmt.number(d.byStatus[s])}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[12px] font-medium text-zinc-500">{t('dash.next7Days')}</p>
              <div className="grid grid-cols-7 gap-1.5">
                {d.next7Days.map((day) => (
                  <div key={day.date} className="flex flex-col items-center gap-1">
                    <div className="flex h-12 w-full items-end rounded-md bg-zinc-50"><div className={cx('w-full rounded-md', day.count ? 'bg-brand-500' : 'bg-transparent')} style={{ height: `${(day.count / max) * 100}%` }} /></div>
                    <span className="text-[11px] font-semibold text-zinc-800 tabular">{fmt.number(day.count)}</span>
                    <span className="text-[10px] text-zinc-400">{weekday.format(new Date(`${day.date}T00:00:00Z`))}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export function WaitingLongestCard({ d }: { d: NonNullable<DashboardExtras['approvalsWaiting']> }) {
  const { t, fmt } = useI18n();
  return (
    <Section title={t('dash.waitingLongest')} to="/approvals" subtitle={t('dash.waitingCount', { n: fmt.number(d.count) })}>
      {d.oldest.length === 0 ? <Empty icon={CheckCircle2} title={t('dashboard.noPending')} /> : d.oldest.map((x) => (
        <Link key={x.id} to={`/deliverables/${x.id}`} className={rowCls}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">{x.name}</p>
            <p className="truncate text-xs text-zinc-500">{x.client.companyName}</p>
          </div>
          <span className="shrink-0 text-xs text-amber-700 tabular">{x.submittedAt ? fmt.relative(x.submittedAt) : ''}</span>
        </Link>
      ))}
    </Section>
  );
}

export function OnboardingCard({ d }: { d: NonNullable<DashboardExtras['onboarding']> }) {
  const { t, fmt } = useI18n();
  return (
    <Section title={t('dash.onboarding')} to="/onboarding" subtitle={t('dash.onboardingCount', { n: fmt.number(d.inProgress) })}>
      {d.lowest.length === 0 ? <Empty icon={Rocket} title={t('dash.noOnboarding')} /> : d.lowest.map((c) => (
        <Link key={c.clientId} to={`/clients/${c.clientId}`} className={rowCls}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">{c.companyName}</p>
            <ProgressBar value={c.progress} size="sm" className="mt-1.5" label={`${fmt.number(c.done)}/${fmt.number(c.total)}`} />
          </div>
          <span className="w-10 shrink-0 text-end text-xs font-semibold text-zinc-700 tabular">{fmt.percent(c.progress, 0)}</span>
        </Link>
      ))}
    </Section>
  );
}

export function ClientsStatusCard({ d }: { d: NonNullable<DashboardExtras['clientsByStatus']> }) {
  const { t, fmt } = useI18n();
  const shown = CLIENT_STATUSES.filter((s) => d[s] > 0);
  return (
    <Section title={t('dash.clientsByStatus')} to="/clients">
      {shown.length === 0 ? <Empty icon={Users} title={t('dash.noClients')} /> : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3 sm:px-6">
          {shown.map((s) => (
            <Link key={s} to={`/clients?status=${s}`} className="rounded-xl p-2 transition hover:bg-zinc-50">
              <p className="text-xl font-semibold tracking-tight text-zinc-900 tabular">{fmt.number(d[s])}</p>
              <StatusBadge group="clientStatus" value={s} className="mt-1" />
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

export function ContractsExpiringCard({ d, showClient = true }: { d: NonNullable<DashboardExtras['contractsExpiring']>; showClient?: boolean }) {
  const { t, fmt } = useI18n();
  return (
    <Section title={t('dash.contractsExpiring')} to="/contracts" subtitle={t('dash.contractsExpiringHint', { n: fmt.number(d.count) })}>
      {d.items.length === 0 ? <Empty icon={FileSignature} title={t('dash.noContractsExpiring')} /> : d.items.map((c) => (
        <Link key={c.id} to="/contracts" className={rowCls}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">{c.name}</p>
            {showClient && c.client && <p className="truncate text-xs text-zinc-500">{c.client.companyName}</p>}
          </div>
          <span className="shrink-0 text-xs text-amber-700 tabular">{fmt.date(c.endDate)}</span>
        </Link>
      ))}
    </Section>
  );
}

export function InvoicesCard({ d }: { d: NonNullable<DashboardExtras['invoices']> }) {
  const { t, fmt } = useI18n();
  const cells: Array<{ label: string; value: string; hint?: string; tone?: string }> = [
    { label: t('dash.invOutstanding'), value: fmt.money(d.outstandingTotal, { compact: true }), hint: t('dash.invCount', { n: fmt.number(d.outstandingCount) }) },
    { label: t('dash.invOverdue'), value: fmt.money(d.overdueTotal, { compact: true }), hint: t('dash.invCount', { n: fmt.number(d.overdueCount) }), tone: d.overdueCount > 0 ? 'text-rose-600' : undefined },
    ...(d.paidThisMonth !== undefined ? [{ label: t('dash.invPaidMonth'), value: fmt.money(d.paidThisMonth, { compact: true }), hint: t('dash.invCount', { n: fmt.number(d.paidThisMonthCount ?? 0) }), tone: 'text-emerald-700' }] : []),
  ];
  return (
    <Section title={t('dash.invoices')} to="/invoices">
      <div className={cx('grid gap-4 px-5 py-5 sm:px-6', cells.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <p className="truncate text-[12px] font-medium text-zinc-500">{c.label}</p>
            <p className={cx('mt-1 truncate text-xl font-semibold tracking-tight tabular', c.tone ?? 'text-zinc-900')}>{c.value}</p>
            {c.hint && <p className="mt-0.5 text-xs text-zinc-500">{c.hint}</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ───────────────────────── activity (staff + client) ─────────────────────────

const ACTIVITY_LINK: Record<string, (a: DashActivity, staff: boolean) => string | null> = {
  deliverable: (a) => (a.entityId ? `/deliverables/${a.entityId}` : '/deliverables'),
  project: (a) => (a.entityId ? `/projects/${a.entityId}` : '/projects'),
  milestone: (a) => (a.projectId ? `/projects/${a.projectId}` : null),
  campaign: (a) => (a.entityId ? `/campaigns/${a.entityId}` : '/campaigns'),
  request: (a) => (a.entityId ? `/requests/${a.entityId}` : '/requests'),
  client: (a, staff) => (staff && a.entityId ? `/clients/${a.entityId}` : null),
  task: (_a, staff) => (staff ? '/tasks' : null),
  content: () => '/content',
  invoice: () => '/invoices',
  contract: () => '/contracts',
  report: () => '/reports',
  file: () => '/files',
};

const summaryText = (s: DashActivity['summary']) => {
  if (!s) return '';
  const v = s.name ?? s.title ?? s.companyName ?? s.invoiceNumber ?? s.contractNumber ?? s.fileName ?? s.file;
  return v === undefined ? '' : String(v);
};

export function ActivityCard({ items, staff }: { items: DashActivity[]; staff: boolean }) {
  const { t, fmt, label } = useI18n();
  return (
    <Section title={t('dash.recentActivity')}>
      {items.length === 0 ? <Empty icon={History} title={t('dash.noActivity')} /> : items.map((a) => {
        const to = ACTIVITY_LINK[a.entity]?.(a, staff) ?? null;
        const body = (
          <>
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500"><History className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-900">{label('auditAction', a.action)}</p>
              <p className="truncate text-xs text-zinc-500">{[summaryText(a.summary), a.actorName].filter(Boolean).join(' · ')}</p>
            </div>
            <span className="shrink-0 text-xs text-zinc-400 tabular">{fmt.relative(a.createdAt)}</span>
          </>
        );
        return to ? <Link key={a.id} to={to} className={rowCls}>{body}</Link> : <div key={a.id} className={rowCls.replace('transition hover:bg-zinc-50', '')}>{body}</div>;
      })}
    </Section>
  );
}

// ───────────────────────── client widgets ─────────────────────────

export function ClientProjectsCard({ items }: { items: DashClientProject[] }) {
  const { t, fmt } = useI18n();
  return (
    <Section title={t('dash.yourProjects')} to="/projects">
      {items.length === 0 ? <Empty icon={FolderKanban} title={t('dash.noProjects')} /> : items.map((p) => (
        <Link key={p.id} to={`/projects/${p.id}`} className={rowCls}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><p className="truncate text-sm font-medium text-zinc-900">{p.name}</p><StatusBadge group="projectStatus" value={p.status} /></div>
            <ProgressBar value={p.progress} size="sm" className="mt-2" tone={p.progress >= 100 ? 'green' : 'brand'} label={fmt.percent(p.progress, 0)} />
          </div>
          {p.dueDate && <span className="hidden shrink-0 text-xs text-zinc-500 tabular sm:block">{fmt.date(p.dueDate)}</span>}
        </Link>
      ))}
    </Section>
  );
}

export function UpcomingContentCard({ items }: { items: NonNullable<DashboardExtras['upcomingContent']> }) {
  const { t, fmt, label } = useI18n();
  return (
    <Section title={t('dash.upcomingContent')} to="/content" subtitle={t('dash.next14Days')}>
      {items.length === 0 ? <Empty icon={CalendarDays} title={t('dash.noUpcomingContent')} /> : items.map((c) => (
        <Link key={c.id} to="/content" className={rowCls}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">{c.title}</p>
            <p className="truncate text-xs text-zinc-500">{label('socialPlatform', c.platform)} · {label('contentType', c.contentType)}</p>
          </div>
          <span className="shrink-0 text-xs text-zinc-500 tabular">{fmt.date(c.publishDate)}</span>
        </Link>
      ))}
    </Section>
  );
}

export function ReportSnapshotCard({ d }: { d: NonNullable<DashboardExtras['reportSummary']> }) {
  const { t, fmt } = useI18n();
  const cells: Array<[string, string]> = [
    [t('metric.spend'), fmt.money(d.spend)],
    [t('metric.impressions'), fmt.compact(d.impressions)],
    [t('metric.clicks'), fmt.number(d.clicks)],
    [t('metric.conversions'), fmt.number(d.conversions)],
    ...(d.ctr !== null ? [[t('metric.ctr'), fmt.percent(d.ctr)] as [string, string]] : []),
    ...(d.roas !== null ? [[t('metric.roas'), fmt.ratio(d.roas)] as [string, string]] : []),
  ];
  return (
    <Section title={t('dash.performance')} to="/reports" subtitle={t('dash.performanceHint', { date: fmt.date(d.until) })}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-3 sm:px-6">
        {cells.map(([k, v]) => (
          <div key={k}><dt className="text-[12px] font-medium text-zinc-500">{k}</dt><dd className="mt-1 text-lg font-semibold tracking-tight text-zinc-900 tabular">{v}</dd></div>
        ))}
      </dl>
    </Section>
  );
}

/** Prominent "needs your approval" banner for CLIENT users (the list itself is rendered by the page). */
export function ApprovalsBanner({ count }: { count: number }) {
  const { t, fmt } = useI18n();
  if (count <= 0) return null;
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><ClipboardCheck className="size-5" /></span>
        <div>
          <p className="text-sm font-semibold text-amber-950">{t('dash.approvalsBannerTitle', { n: fmt.number(count) })}</p>
          <p className="text-[13px] text-amber-900/80">{t('dash.approvalsBannerHint')}</p>
        </div>
      </div>
      <Link to="/approvals" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">{t('dash.reviewNow')}<ArrowRight className="size-4 rtl:rotate-180" /></Link>
    </div>
  );
}

