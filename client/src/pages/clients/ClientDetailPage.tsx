import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, Pencil, Phone, Plus } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Campaign, Client, Paged } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/Badge';
import { CompanyMark } from '@/components/shared/Media';
import { CampaignRowItem } from '@/components/shared/Rows';
import { CampaignFormModal } from '@/components/forms/CampaignFormModal';
import { ClientFormModal } from '@/components/forms/ClientFormModal';
import { FolderKanban, Palette, LifeBuoy, FolderOpen } from 'lucide-react';

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const q = useApi<{ item: Client }>(`/clients/${id}`);
  const camps = useApi<Paged<Campaign>>('/campaigns', { clientId: id, pageSize: 50 });
  const [editing, setEditing] = useState(false);
  const [newCampaign, setNewCampaign] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

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
          {isAdmin && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
          {isAdmin && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setNewCampaign(true)}>{t('campaign.new')}</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('nav.campaigns')} value={fmt.number(c._count?.campaigns ?? 0)} icon={FolderKanban} tone="brand" />
        <StatCard label={t('nav.deliverables')} value={fmt.number(c._count?.deliverables ?? 0)} icon={Palette} tone="zinc" />
        <StatCard label={t('nav.requests')} value={fmt.number(c._count?.requests ?? 0)} icon={LifeBuoy} tone="sky" />
        <StatCard label={t('nav.files')} value={fmt.number(c._count?.files ?? 0)} icon={FolderOpen} tone="zinc" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title={t('nav.campaigns')} />
          <div className="mt-3 divide-y divide-line border-t border-line">
            {camps.isLoading ? <Skeleton className="m-5 h-24" /> : !camps.data?.items.length ? <EmptyState compact icon={FolderKanban} title={t('campaign.empty')} /> : camps.data.items.map((x) => <CampaignRowItem key={x.id} c={x} />)}
          </div>
        </Card>
        <div className="space-y-5">
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
          {isAdmin && (
            <Card>
              <CardHeader title={t('client.assignedTeam')} />
              <ul className="divide-y divide-line px-5 pb-3 pt-2 sm:px-6">
                {c.team?.length ? c.team.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 py-3"><Avatar name={u.name} size="sm" /><div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-900">{u.name}</p><p dir="ltr" className="truncate text-start text-xs text-zinc-500">{u.email}</p></div></li>
                )) : <li className="py-4 text-sm text-zinc-500">{t('client.noTeam')}</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {editing && <ClientFormModal open onClose={() => setEditing(false)} client={c} />}
      {newCampaign && <CampaignFormModal open onClose={() => setNewCampaign(false)} defaultClientId={c.id} />}
    </div>
  );
}
