import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Pencil, Phone, Plus, Globe, Building2, Tag, UserCog, Calendar, FolderKanban, Palette, LifeBuoy, FolderOpen,
} from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Campaign, Paged } from '@/api/types';
import type { ClientDetail } from '@/api/types.crm';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/Progress';
import { Tabs } from '@/components/ui/Tabs';
import { CompanyMark } from '@/components/shared/Media';
import { CampaignRowItem } from '@/components/shared/Rows';
import { CampaignFormModal } from '@/components/forms/CampaignFormModal';
import { ClientFormModal } from '@/components/forms/ClientFormModal';
import { ContactsPanel } from '@/components/panels/ContactsPanel';
import { ProjectsPanel } from '@/components/panels/ProjectsPanel';
import { TasksPanel } from '@/components/panels/TasksPanel';
import { DeliverablesPanel } from '@/components/panels/DeliverablesPanel';
import { RequestsPanel } from '@/components/panels/RequestsPanel';
import { ReportsPanel } from '@/components/panels/LazyReportsPanel';
import { FilesPanel } from '@/components/panels/FilesPanel';
import { InvoicesPanel } from '@/components/panels/InvoicesPanel';
import { ContractsPanel } from '@/components/panels/ContractsPanel';
import { OnboardingPanel } from '@/components/panels/OnboardingPanel';
import { InternalNotesPanel } from '@/components/panels/InternalNotesPanel';
import { ActivityFeed } from '@/components/panels/ActivityFeed';

type Tab =
  | 'overview' | 'contacts' | 'projects' | 'campaigns' | 'tasks' | 'deliverables' | 'requests'
  | 'reports' | 'files' | 'invoices' | 'contracts' | 'onboarding' | 'notes' | 'activity';

function Info({ label, children, icon: Icon }: { label: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-start gap-2.5">
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-zinc-400" />}
      <div className="min-w-0">
        <dt className="text-[12px] font-medium text-zinc-500">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-medium text-zinc-900">{children || '—'}</dd>
      </div>
    </div>
  );
}

function OverviewTab({ c, staff }: { c: ClientDetail; staff: boolean }) {
  const { t, fmt, label } = useI18n();
  const camps = useApi<Paged<Campaign>>('/campaigns', { clientId: c.id, pageSize: 5 });
  const tags = c.tags ?? [];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('nav.campaigns')} value={fmt.number(c.summary.campaigns)} icon={FolderKanban} tone="brand" />
        <StatCard label={t('nav.deliverables')} value={fmt.number(c.summary.deliverables)} icon={Palette} tone="zinc" hint={c.summary.deliverablesPending ? t('crm.client.pendingCount', { n: c.summary.deliverablesPending }) : undefined} />
        <StatCard label={t('nav.requests')} value={fmt.number(c.summary.requests)} icon={LifeBuoy} tone="sky" hint={c.summary.openRequests ? t('crm.client.openCount', { n: c.summary.openRequests }) : undefined} />
        <StatCard label={t('nav.files')} value={fmt.number(c.summary.files)} icon={FolderOpen} tone="zinc" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('crm.client.details')} />
          <CardBody>
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Info label={t('crm.field.industry')} icon={Building2}>{c.industry}</Info>
              <Info label={t('crm.field.website')} icon={Globe}>{c.website ? <a href={c.website} target="_blank" rel="noreferrer" dir="ltr" className="text-brand-700 hover:underline">{c.website}</a> : t('crm.client.noWebsite')}</Info>
              <Info label={t('crm.field.address')}>{[c.address, c.city, c.country].filter(Boolean).join(', ') || null}</Info>
              <Info label={t('crm.field.clientType')} icon={Tag}>{c.clientType ? label('clientType', c.clientType) : null}</Info>
              {staff && <Info label={t('crm.field.leadSource')}>{c.leadSource}</Info>}
              {staff && <Info label={t('crm.field.accountManager')} icon={UserCog}>{c.accountManager?.name}</Info>}
              <Info label={t('crm.field.clientSince')} icon={Calendar}>{c.clientSince ? fmt.date(c.clientSince) : null}</Info>
              {staff && <Info label={t('crm.field.contractStart')}>{c.contractStart ? fmt.date(c.contractStart) : null}</Info>}
              {staff && <Info label={t('crm.field.contractEnd')}>{c.contractEnd ? fmt.date(c.contractEnd) : null}</Info>}
              {staff && c.monthlyRetainer != null && <Info label={t('crm.field.retainer')}>{fmt.money(c.monthlyRetainer)}</Info>}
            </dl>
            <div className="mt-5 border-t border-line pt-5">
              <p className="text-[12px] font-medium text-zinc-500">{t('crm.client.tags')}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.length ? tags.map((tg) => (
                  <span key={tg} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">{tg}</span>
                )) : <span className="text-sm text-zinc-400">{t('crm.client.noTags')}</span>}
              </div>
            </div>
            {c.notes && <p className="mt-5 whitespace-pre-line border-t border-line pt-5 text-sm leading-relaxed text-zinc-600">{c.notes}</p>}
          </CardBody>
        </Card>

        <div className="space-y-5">
          {staff && c.onboarding && (
            <Card>
              <CardHeader title={t('crm.client.onboardingProgress')} />
              <CardBody>
                <p className="text-2xl font-semibold tracking-tight text-zinc-900 tabular">{c.onboarding.percent}%</p>
                <div className="mt-3"><ProgressBar value={c.onboarding.percent} tone="auto" /></div>
                <p className="mt-2 text-xs text-zinc-500">{t('crm.onb.doneOf', { done: c.onboarding.done, total: c.onboarding.total })}</p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title={t('client.portalUsers')} subtitle={t('client.portalUsersHint')} />
            <ul className="divide-y divide-line px-5 pb-3 pt-2 sm:px-6">
              {c.users?.length ? c.users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-3">
                  <Avatar name={u.name} size="sm" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-900">{u.name}</p><p dir="ltr" className="truncate text-start text-xs text-zinc-500">{u.email}</p></div>
                  <StatusBadge group="userStatus" value={u.status} />
                </li>
              )) : <li className="py-4 text-sm text-zinc-500">{t('client.noUsers')}</li>}
            </ul>
          </Card>
          {staff && (
            <Card>
              <CardHeader title={t('client.assignedTeam')} />
              <ul className="divide-y divide-line px-5 pb-3 pt-2 sm:px-6">
                {c.team?.length ? c.team.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 py-3"><Avatar name={u.name} size="sm" /><div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-900">{u.name}</p><p dir="ltr" className="truncate text-start text-xs text-zinc-500">{u.email}</p></div></li>
                )) : <li className="py-4 text-sm text-zinc-500">{t('client.noTeam')}</li>}
              </ul>
            </Card>
          )}
          {staff && (
            <Card>
              <CardHeader title={t('crm.client.internalPreview')} />
              <CardBody>
                {c.internalNotes ? <p className="whitespace-pre-line text-sm text-zinc-600">{c.internalNotes}</p> : <p className="text-sm text-zinc-400">{t('crm.client.internalNoNotes')}</p>}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title={t('nav.campaigns')} />
        <div className="divide-y divide-line border-t border-line">
          {camps.isLoading ? <Skeleton className="m-5 h-24" /> : !camps.data?.items.length ? <EmptyState compact icon={FolderKanban} title={t('campaign.empty')} /> : camps.data.items.map((x) => <CampaignRowItem key={x.id} c={x} />)}
        </div>
      </Card>
    </div>
  );
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = useApi<{ item: ClientDetail }>(`/clients/${id}`);
  const [editing, setEditing] = useState(false);
  const [newCampaign, setNewCampaign] = useState(false);
  const isAdmin = user?.role === 'ADMIN';
  const staff = user?.role !== 'CLIENT';

  const TABS: Tab[] = [
    'overview', 'contacts', 'projects', 'campaigns',
    ...(staff ? (['tasks'] as Tab[]) : []),
    'deliverables', 'requests', 'reports', 'files', 'invoices', 'contracts',
    ...(staff ? (['onboarding', 'notes'] as Tab[]) : []),
    'activity',
  ];
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview';
  const setTab = (v: Tab) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true });

  if (q.isError) return <div><Link to="/clients" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="size-4 rtl:rotate-180" />{t('nav.clients')}</Link><ErrorState onRetry={() => void q.refetch()} message={t('common.notFoundHint')} /></div>;
  const c = q.data?.item;
  if (!c) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <div>
      <Link to="/clients" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"><ArrowLeft className="size-4 rtl:rotate-180" />{t('nav.clients')}</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <CompanyMark clientId={c.id} name={c.companyName} hasLogo={c.hasLogo} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900 sm:text-2xl">{c.companyName}</h1>
              <StatusBadge group="clientStatus" value={c.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
              <span>{c.name}</span>
              <a href={`mailto:${c.email}`} dir="ltr" className="inline-flex items-center gap-1.5 hover:text-zinc-800"><Mail className="size-3.5" />{c.email}</a>
              {c.phone && <a href={`tel:${c.phone}`} dir="ltr" className="inline-flex items-center gap-1.5 hover:text-zinc-800"><Phone className="size-3.5" />{c.phone}</a>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {(isAdmin || can('clients.edit')) && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
          {can('campaigns.create') && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setNewCampaign(true)}>{t('campaign.new')}</Button>}
        </div>
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { id: 'overview', label: t('crm.client.tabOverview') },
          { id: 'contacts', label: t('crm.client.tabContacts') },
          { id: 'projects', label: t('crm.client.tabProjects'), count: c.summary.projects },
          { id: 'campaigns', label: t('crm.client.tabCampaigns'), count: c.summary.campaigns },
          ...(staff ? [{ id: 'tasks' as Tab, label: t('crm.client.tabTasks'), count: c.summary.openTasks }] : []),
          { id: 'deliverables', label: t('crm.client.tabDeliverables'), count: c.summary.deliverables },
          { id: 'requests', label: t('crm.client.tabRequests'), count: c.summary.openRequests },
          { id: 'reports', label: t('crm.client.tabReports') },
          { id: 'files', label: t('crm.client.tabFiles'), count: c.summary.files },
          { id: 'invoices', label: t('crm.client.tabInvoices'), count: c.summary.unpaidInvoices },
          { id: 'contracts', label: t('crm.client.tabContracts') },
          ...(staff ? [{ id: 'onboarding' as Tab, label: t('crm.client.tabOnboarding') }] : []),
          ...(staff ? [{ id: 'notes' as Tab, label: t('crm.client.tabNotes') }] : []),
          { id: 'activity', label: t('crm.client.tabActivity') },
        ]}
      />

      {tab === 'overview' && <OverviewTab c={c} staff={staff} />}
      {tab === 'contacts' && <ContactsPanel clientId={c.id} />}
      {tab === 'projects' && <ProjectsPanel clientId={c.id} />}
      {tab === 'campaigns' && (
        <Card>
          <CardBody>
            <CampaignsList clientId={c.id} />
          </CardBody>
        </Card>
      )}
      {tab === 'tasks' && staff && <TasksPanel clientId={c.id} />}
      {tab === 'deliverables' && <DeliverablesPanel clientId={c.id} />}
      {tab === 'requests' && <RequestsPanel clientId={c.id} />}
      {tab === 'reports' && <ReportsPanel clientId={c.id} />}
      {tab === 'files' && <FilesPanel clientId={c.id} />}
      {tab === 'invoices' && <InvoicesPanel clientId={c.id} />}
      {tab === 'contracts' && <ContractsPanel clientId={c.id} />}
      {tab === 'onboarding' && staff && <OnboardingPanel clientId={c.id} />}
      {tab === 'notes' && staff && <InternalNotesPanel clientId={c.id} />}
      {tab === 'activity' && <ActivityFeed clientId={c.id} />}

      {editing && <ClientFormModal open onClose={() => setEditing(false)} client={c} />}
      {newCampaign && <CampaignFormModal open onClose={() => setNewCampaign(false)} defaultClientId={c.id} />}
    </div>
  );
}

function CampaignsList({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const camps = useApi<Paged<Campaign>>('/campaigns', { clientId, pageSize: 50 });
  if (camps.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!camps.data?.items.length) return <EmptyState compact icon={FolderKanban} title={t('campaign.empty')} />;
  return <div className="divide-y divide-line">{camps.data.items.map((x) => <CampaignRowItem key={x.id} c={x} />)}</div>;
}
