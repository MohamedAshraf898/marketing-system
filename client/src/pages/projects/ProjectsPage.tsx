import { useState } from 'react';
import { FolderKanban, Plus } from 'lucide-react';
import { PRIORITIES, PROJECT_STATUSES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { Project } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ProgressBar } from '@/components/ui/Progress';
import { useClientOptions } from '@/components/shared/options';
import { ProjectFormModal } from '@/components/forms/ProjectFormModal';

export function ProjectsPage() {
  const { t, fmt } = useI18n();
  const { user, can } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const isAdmin = user?.role === 'ADMIN';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [clientId, setClientId] = useState('');
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const list = useApi<Paged<Project>>('/projects', { q, status, priority, clientId, mine: staff && mine ? 1 : undefined, overdue: overdue ? 1 : undefined, page });
  const { clients } = useClientOptions(staff);
  const statusOptions = useEnumOptions('projectStatus', PROJECT_STATUSES);
  const priorityOptions = useEnumOptions('priority', PRIORITIES);
  const reset = () => setPage(1);
  const filtered = !!(q || status || priority || clientId || mine || overdue);

  return (
    <div>
      <PageHeader
        title={t('nav.projects')}
        subtitle={t('work.project.subtitle')}
        actions={can('projects.create') && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('work.project.new')}</Button>}
      />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('work.project.search')} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); reset(); }} allLabel={t('common.allStatuses')} options={statusOptions} />
        <FilterSelect value={priority} onChange={(v) => { setPriority(v); reset(); }} allLabel={t('common.priority')} options={priorityOptions} />
        {staff && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        {staff && <Button variant={mine ? 'brand' : 'secondary'} size="sm" onClick={() => { setMine((v) => !v); reset(); }}>{t('work.project.myProjects')}</Button>}
        <Button variant={overdue ? 'brand' : 'secondary'} size="sm" onClick={() => { setOverdue((v) => !v); reset(); }}>{t('work.project.overdueOnly')}</Button>
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState
          icon={FolderKanban}
          title={t('work.project.empty')}
          description={filtered ? t('common.noResultsHint') : staff ? (isAdmin ? t('work.project.emptyHint') : t('work.project.emptyRestrictedHint')) : t('work.project.emptyClientHint')}
          action={can('projects.create') && !filtered ? <Button variant="brand" onClick={() => setCreating(true)}>{t('work.project.new')}</Button> : undefined}
        />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(p) => p.id}
            href={(p) => `/projects/${p.id}`}
            columns={[
              { key: 'name', header: t('work.project.name'), primary: true, cell: (p) => <div><p className="font-medium text-zinc-900">{p.name}</p>{staff && <p className="text-xs font-normal text-zinc-500">{p.client.companyName}</p>}</div> },
              { key: 'status', header: t('common.status'), cell: (p) => <StatusBadge group="projectStatus" value={p.status} /> },
              { key: 'priority', header: t('common.priority'), hideOnTablet: true, cell: (p) => <StatusBadge group="priority" value={p.priority} /> },
              { key: 'progress', header: t('work.project.progress'), cell: (p) => <div className="min-w-32"><ProgressBar value={p.progress} label={`${fmt.number(p.progress)}%`} size="sm" /></div> },
              ...(staff ? [{ key: 'manager', header: t('work.project.manager'), hideOnTablet: true, cell: (p: Project) => p.projectManager?.name ?? <span className="text-zinc-400">{t('common.unassigned')}</span> }] : []),
              { key: 'due', header: t('common.dueDate'), cell: (p) => p.dueDate ? <span className={p.overdue ? 'font-medium text-rose-600' : 'text-zinc-500'}>{fmt.date(p.dueDate)}</span> : <span className="text-zinc-400">—</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {creating && <ProjectFormModal open onClose={() => setCreating(false)} defaultClientId={clientId || undefined} />}
    </div>
  );
}
