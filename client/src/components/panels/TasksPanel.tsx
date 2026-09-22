import { useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { Task } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Pagination } from '@/components/ui/Pagination';
import { TaskFormModal } from '@/components/forms/TaskFormModal';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';

/** Owner: Projects & tasks group. Compact task list scoped to a client and/or a project (embedded in their detail pages). */
export function TasksPanel({ clientId, projectId }: { clientId?: string; projectId?: string }) {
  const { t, fmt } = useI18n();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const list = useApi<Paged<Task>>('/tasks', { clientId, projectId, page, pageSize: 10, sort: 'dueDate', dir: 'asc' });

  return (
    <div>
      {can('tasks.create') && (
        <div className="mb-4 flex justify-end">
          <Button variant="brand" size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('work.task.new')}</Button>
        </div>
      )}
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows rows={3} /> : !list.data?.items.length ? (
        <EmptyState icon={ClipboardList} title={t('work.task.empty')} description={t('work.task.emptyHint')} compact />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(tk) => tk.id}
            onRowClick={(tk) => setOpenTaskId(tk.id)}
            columns={[
              { key: 'title', header: t('work.task.title'), primary: true, cell: (tk) => <p className="font-medium text-zinc-900">{tk.title}</p> },
              { key: 'assignee', header: t('common.assignee'), hideOnTablet: true, cell: (tk) => tk.assignedTo ? <span className="inline-flex items-center gap-2"><Avatar name={tk.assignedTo.name} size="xs" />{tk.assignedTo.name}</span> : <span className="text-zinc-400">{t('common.unassigned')}</span> },
              { key: 'status', header: t('common.status'), cell: (tk) => <StatusBadge group="taskStatus" value={tk.status} /> },
              { key: 'due', header: t('common.dueDate'), cell: (tk) => tk.dueDate ? <span className={tk.overdue ? 'font-medium text-rose-600' : 'text-zinc-500'}>{fmt.date(tk.dueDate)}</span> : <span className="text-zinc-400">—</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {creating && <TaskFormModal open onClose={() => setCreating(false)} defaultClientId={clientId} defaultProjectId={projectId} onCreated={(tk) => setOpenTaskId(tk.id)} />}
      <TaskDrawer taskId={openTaskId} open={!!openTaskId} onClose={() => setOpenTaskId(null)} onDeleted={() => setOpenTaskId(null)} />
    </div>
  );
}
