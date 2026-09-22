import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Building2, CheckCircle2, ClipboardCheck, FilePlus2, FolderKanban, LifeBuoy, MessageSquareText, PencilLine, Plus, Upload, UserPlus, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { DashboardResponse } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/Feedback';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/Badge';
import { CompanyMark } from '@/components/shared/Media';
import { CampaignRowItem, DeliverableRowItem, RequestRowItem } from '@/components/shared/Rows';
import { CampaignFormModal } from '@/components/forms/CampaignFormModal';
import { ClientFormModal } from '@/components/forms/ClientFormModal';
import { DeliverableFormModal } from '@/components/forms/DeliverableFormModal';
import { ReportFormModal } from '@/components/forms/ReportFormModal';
import { RequestFormModal } from '@/components/forms/RequestFormModal';
import { UploadFileModal } from '@/components/forms/UploadFileModal';
import { UserFormModal } from '@/components/forms/UserFormModal';

type Modal = 'client' | 'user' | 'campaign' | 'deliverable' | 'upload' | 'request' | 'report' | null;

function Section({ title, to, children, empty }: { title: string; to?: string; children: ReactNode; empty?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} action={to && <Link to={to} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700">{t('common.viewAll')}<ArrowRight className="size-3.5 rtl:rotate-180" /></Link>} />
      <div className="mt-3 divide-y divide-line border-t border-line">{children ?? empty}</div>
    </Card>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-zinc-800 shadow-card transition hover:border-line-strong hover:bg-zinc-50 active:scale-[0.98]">
      <span className="flex size-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon className="size-4" /></span>
      {label}
    </button>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { t, fmt } = useI18n();
  const q = useApi<DashboardResponse>('/dashboard');
  const [modal, setModal] = useState<Modal>(null);
  const close = () => setModal(null);
  if (!user) return null;
  const role = user.role;
  const d = q.data;
  const k = d?.kpis ?? {};
  const first = user.name.split(' ')[0];

  const kpis: Array<{ label: string; value: string; icon: LucideIcon; tone: 'zinc' | 'brand' | 'amber' | 'emerald' | 'sky' }> =
    role === 'CLIENT'
      ? [
          { label: t('kpi.activeCampaigns'), value: fmt.number(k.activeCampaigns ?? 0), icon: FolderKanban, tone: 'brand' },
          { label: t('kpi.pendingApprovals'), value: fmt.number(k.pendingApprovals ?? 0), icon: ClipboardCheck, tone: 'amber' },
          { label: t('kpi.openRequests'), value: fmt.number(k.openRequests ?? 0), icon: LifeBuoy, tone: 'sky' },
          { label: t('kpi.totalSpend'), value: fmt.money(k.totalSpend ?? 0, { compact: true }), icon: Wallet, tone: 'emerald' },
        ]
      : role === 'ADMIN'
        ? [
            { label: t('kpi.totalClients'), value: fmt.number(k.totalClients ?? 0), icon: Building2, tone: 'zinc' },
            { label: t('kpi.activeClients'), value: fmt.number(k.activeClients ?? 0), icon: Users, tone: 'emerald' },
            { label: t('kpi.activeCampaigns'), value: fmt.number(k.activeCampaigns ?? 0), icon: FolderKanban, tone: 'brand' },
            { label: t('kpi.pendingApprovals'), value: fmt.number(k.pendingApprovals ?? 0), icon: ClipboardCheck, tone: 'amber' },
            { label: t('kpi.openRequests'), value: fmt.number(k.openRequests ?? 0), icon: LifeBuoy, tone: 'sky' },
            { label: t('kpi.totalSpend'), value: fmt.money(k.totalSpend ?? 0, { compact: true }), icon: Wallet, tone: 'emerald' },
          ]
        : [
            { label: t('kpi.assignedClients'), value: fmt.number(k.assignedClients ?? 0), icon: Building2, tone: 'zinc' },
            { label: t('kpi.assignedCampaigns'), value: fmt.number(k.assignedCampaigns ?? 0), icon: FolderKanban, tone: 'brand' },
            { label: t('kpi.pendingDeliverables'), value: fmt.number(k.pendingDeliverables ?? 0), icon: PencilLine, tone: 'zinc' },
            { label: t('kpi.pendingApprovals'), value: fmt.number(k.pendingApprovals ?? 0), icon: ClipboardCheck, tone: 'amber' },
            { label: t('kpi.openRequests'), value: fmt.number(k.openRequests ?? 0), icon: LifeBuoy, tone: 'sky' },
          ];

  const isClient = role === 'CLIENT';
  const showClient = !isClient;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {isClient && user.client && <CompanyMark clientId={user.client.id} name={user.client.companyName} hasLogo={user.client.hasLogo} size="lg" />}
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900 sm:text-2xl">{t('dashboard.welcome', { name: first })}</h1>
            <p className="mt-0.5 text-sm text-zinc-500">{isClient ? t('dashboard.clientSubtitle', { company: user.client?.companyName ?? '' }) : role === 'ADMIN' ? t('dashboard.adminSubtitle') : t('dashboard.teamSubtitle')}</p>
          </div>
        </div>
        {isClient && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setModal('request')} className="max-sm:h-11">{t('request.new')}</Button>}
      </div>

      {!isClient && (
        <div className="mb-6 flex flex-wrap gap-2.5" aria-label={t('dashboard.quickActions')}>
          {role === 'ADMIN' && <QuickAction icon={Building2} label={t('client.new')} onClick={() => setModal('client')} />}
          {role === 'ADMIN' && <QuickAction icon={UserPlus} label={t('user.new')} onClick={() => setModal('user')} />}
          {role === 'ADMIN' && <QuickAction icon={FolderKanban} label={t('campaign.new')} onClick={() => setModal('campaign')} />}
          <QuickAction icon={FilePlus2} label={t('deliverable.new')} onClick={() => setModal('deliverable')} />
          <QuickAction icon={Upload} label={t('file.upload')} onClick={() => setModal('upload')} />
          <QuickAction icon={LifeBuoy} label={t('request.new')} onClick={() => setModal('request')} />
          <QuickAction icon={BarChart3} label={t('report.new')} onClick={() => setModal('report')} />
        </div>
      )}

      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <>
          <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${role === 'ADMIN' ? 'lg:grid-cols-3 xl:grid-cols-6' : role === 'TEAM' ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
            {kpis.map((c) => <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} loading={q.isLoading} />)}
          </div>

          {q.isLoading || !d ? <SkeletonCards count={4} className="mt-6 lg:grid-cols-2" /> : (
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <Section title={isClient ? t('dashboard.needsYourApproval') : t('dashboard.pendingApprovals')} to="/approvals">
                {d.pendingApprovals.length === 0
                  ? <EmptyState compact icon={CheckCircle2} title={t('dashboard.noPending')} description={isClient ? t('dashboard.noPendingClient') : undefined} />
                  : d.pendingApprovals.map((x) => <DeliverableRowItem key={x.id} d={x} showClient={showClient} />)}
              </Section>

              <Section title={t('dashboard.activeCampaigns')} to="/campaigns">
                {d.activeCampaigns.length === 0
                  ? <EmptyState compact icon={FolderKanban} title={t('dashboard.noActiveCampaigns')} />
                  : d.activeCampaigns.map((c) => <CampaignRowItem key={c.id} c={c} showClient={showClient} />)}
              </Section>

              <Section title={isClient ? t('dashboard.yourRequests') : t('dashboard.openRequests')} to="/requests">
                {d.requests.length === 0
                  ? <EmptyState compact icon={LifeBuoy} title={t('dashboard.noRequests')} action={isClient ? <Button size="sm" variant="secondary" onClick={() => setModal('request')}>{t('request.new')}</Button> : undefined} />
                  : d.requests.map((r) => <RequestRowItem key={r.id} r={r} showClient={showClient} />)}
              </Section>

              {role === 'TEAM' && d.recentFeedback ? (
                <Section title={t('dashboard.clientFeedback')}>
                  {d.recentFeedback.length === 0
                    ? <EmptyState compact icon={MessageSquareText} title={t('dashboard.noFeedback')} />
                    : d.recentFeedback.map((f) => (
                        <Link key={f.id} to={`/deliverables/${f.deliverable.id}`} className="block px-5 py-3.5 transition hover:bg-zinc-50 sm:px-6">
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            {f.kind === 'CHANGES_REQUESTED' ? <StatusBadge group="decision" value="CHANGES_REQUESTED" /> : <span className="inline-flex items-center gap-1"><MessageSquareText className="size-3.5" />{t('dashboard.commented')}</span>}
                            <span className="truncate">{f.deliverable.name} · {f.company}</span>
                            <span className="ms-auto shrink-0">{fmt.relative(f.at)}</span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-sm text-zinc-700">{f.text}</p>
                        </Link>
                      ))}
                </Section>
              ) : (
                <Section title={t('dashboard.recentReports')} to="/reports">
                  {d.recentReports.length === 0
                    ? <EmptyState compact icon={BarChart3} title={t('dashboard.noReports')} />
                    : d.recentReports.map((r) => (
                        <Link key={r.id} to={`/campaigns/${r.campaignId}`} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 sm:px-6">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-900">{r.campaign?.name}</p>
                            <p className="mt-0.5 text-xs text-zinc-500">{fmt.date(r.date)}{showClient && r.client ? ` · ${r.client.companyName}` : ''}</p>
                          </div>
                          <div className="text-end text-xs tabular text-zinc-600">
                            <p className="font-medium text-zinc-900">{fmt.money(r.spend)}</p>
                            <p>{fmt.number(r.clicks)} {t('metric.clicks').toLowerCase()}</p>
                          </div>
                        </Link>
                      ))}
                </Section>
              )}
            </div>
          )}
        </>
      )}

      {modal === 'client' && <ClientFormModal open onClose={close} />}
      {modal === 'user' && <UserFormModal open onClose={close} />}
      {modal === 'campaign' && <CampaignFormModal open onClose={close} />}
      {modal === 'deliverable' && <DeliverableFormModal open onClose={close} />}
      {modal === 'upload' && <UploadFileModal open onClose={close} />}
      {modal === 'request' && <RequestFormModal open onClose={close} />}
      {modal === 'report' && <ReportFormModal open onClose={close} />}
    </div>
  );
}
