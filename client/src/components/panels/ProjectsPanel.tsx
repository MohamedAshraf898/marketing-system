import { useState } from 'react';
import { FolderKanban, Plus } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { Project } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Pagination } from '@/components/ui/Pagination';
import { ProgressBar } from '@/components/ui/Progress';
import { ProjectFormModal } from '@/components/forms/ProjectFormModal';

/** Owner: Projects & tasks group. Compact project list for a client's detail page. */
export function ProjectsPanel({ clientId }: { clientId: string }) {
  const { t, fmt } = useI18n();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useApi<Paged<Project>>('/projects', { clientId, page, pageSize: 10 });

  return (
    <div>
      {can('projects.create') && (
        <div className="mb-4 flex justify-end">
          <Button variant="brand" size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('work.project.new')}</Button>
        </div>
      )}
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows rows={3} /> : !list.data?.items.length ? (
        <EmptyState icon={FolderKanban} title={t('work.project.empty')} description={t('work.project.emptyHint')} compact />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(p) => p.id}
            href={(p) => `/projects/${p.id}`}
            columns={[
              { key: 'name', header: t('work.project.name'), primary: true, cell: (p) => <p className="font-medium text-zinc-900">{p.name}</p> },
              { key: 'status', header: t('common.status'), cell: (p) => <StatusBadge group="projectStatus" value={p.status} /> },
              { key: 'progress', header: t('work.project.progress'), cell: (p) => <div className="min-w-28"><ProgressBar value={p.progress} label={`${fmt.number(p.progress)}%`} size="sm" /></div> },
              { key: 'due', header: t('common.dueDate'), hideOnTablet: true, cell: (p) => p.dueDate ? <span className={p.overdue ? 'font-medium text-rose-600' : 'text-zinc-500'}>{fmt.date(p.dueDate)}</span> : <span className="text-zinc-400">—</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {creating && <ProjectFormModal open onClose={() => setCreating(false)} defaultClientId={clientId} />}
    </div>
  );
}
