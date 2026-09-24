import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, Send } from 'lucide-react';
import { TASK_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { SharedTaskDetail, SharedTasksResponse } from '@/api/types.tasks';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { Textarea } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ProgressBar } from '@/components/ui/Progress';

/** CLIENT view: only the tasks the agency explicitly shared (the API never returns anything else). */
export function ClientTasksPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const list = useApi<SharedTasksResponse>('/client-tasks', { q, status, page });
  const statusOptions = useEnumOptions('taskStatus', TASK_STATUSES);
  const open = params.get('open');
  const setOpen = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true });

  return (
    <div>
      <PageHeader title={t('nav.tasks')} subtitle={t('tasks.clientSubtitle')} />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} allLabel={t('common.allStatuses')} options={statusOptions} />
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? <EmptyState icon={ClipboardList} title={t('tasks.clientEmpty')} description={t('tasks.clientEmptyHint')} /> : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(x) => x.id}
            onRowClick={(x) => setOpen(x.id)}
            columns={[
              { key: 'title', header: t('work.task.title'), primary: true, cell: (x) => <div><p className="font-medium text-zinc-900">{x.title}</p>{x.project && <p className="text-xs text-zinc-500">{x.project.name}</p>}</div> },
              { key: 'status', header: t('common.status'), cell: (x) => <StatusBadge group="taskStatus" value={x.status} /> },
              { key: 'progress', header: t('work.project.progress'), hideOnMobile: true, cell: (x) => (x.subtasks.total ? <ProgressBar value={x.subtasks.done} max={x.subtasks.total} size="sm" label={`${x.subtasks.done}/${x.subtasks.total}`} className="w-32" /> : '—') },
              { key: 'due', header: t('common.dueDate'), cell: (x) => (x.dueDate ? <span className={x.overdue ? 'font-medium text-rose-600' : 'text-zinc-600'}>{fmt.date(x.dueDate)}</span> : '—') },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {open && <SharedTaskDrawer id={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

function SharedTaskDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { t, fmt } = useI18n();
  const q = useApi<{ item: SharedTaskDetail }>(`/client-tasks/${id}`);
  const [text, setText] = useState('');
  const post = useAction(() => api.post(`/client-tasks/${id}/comments`, { comment: text.trim() }), { onSuccess: () => setText('') });
  const x = q.data?.item;
  return (
    <Drawer open onClose={onClose} width="lg" title={x?.title ?? <Skeleton className="h-5 w-40" />} subtitle={x?.project?.name}>
      {!x ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge group="taskStatus" value={x.status} />
            <StatusBadge group="priority" value={x.priority} />
            {x.dueDate && <span className={x.overdue ? 'text-sm font-medium text-rose-600' : 'text-sm text-zinc-600'}>{t('common.due', { date: fmt.date(x.dueDate) })}</span>}
          </div>
          {x.description && <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">{x.description}</p>}
          {x.subtasks.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">{t('tasks.subtasks')}</h3>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {x.subtasks.map((s) => <li key={s.id}><button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-zinc-50"><span className="flex-1">{s.title}</span><StatusBadge group="taskStatus" value={s.status} /></button></li>)}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900">{t('tasks.tab.comments')}</h3>
            <ul className="space-y-3">
              {x.comments.map((c) => (
                <li key={c.id} className="flex gap-2.5"><Avatar name={c.user.name} size="sm" /><div><p className="text-sm font-semibold text-zinc-900">{c.user.name} <span className="text-xs font-normal text-zinc-400">{fmt.relative(c.createdAt)}</span></p><p className="mt-0.5 whitespace-pre-line text-sm text-zinc-700">{c.comment}</p></div></li>
              ))}
              {x.comments.length === 0 && <p className="text-xs text-zinc-400">{t('review.commentsHint')}</p>}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) post.mutate(undefined); }} className="mt-3 space-y-2">
              <Textarea rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={t('review.commentPlaceholder')} />
              <div className="flex justify-end"><Button type="submit" size="sm" icon={<Send className="size-4" />} loading={post.isPending} disabled={!text.trim()}>{t('review.postComment')}</Button></div>
            </form>
          </div>
        </div>
      )}
    </Drawer>
  );
}
