import { useState, type ReactNode } from 'react';
import { Download, Eye, EyeOff, FolderOpen, Trash2 } from 'lucide-react';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { FileRow, Paged } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced } from '@/components/ui/Filters';
import { IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { FileTypeIcon } from '@/components/shared/Media';
import { useClientOptions } from '@/components/shared/options';
import { Link } from 'react-router-dom';

export function FilesPanel({ campaignId, toolbar }: { campaignId?: string; toolbar?: ReactNode }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<FileRow | null>(null);
  const q = useDebounced(search);
  const list = useApi<Paged<FileRow>>('/files', { q, kind, clientId, campaignId, page });
  const { clients } = useClientOptions(staff && !campaignId);
  const del = useAction((id: string) => api.del(`/files/${id}`), { success: t('file.deleted'), onSuccess: () => setToDelete(null) });
  const reset = () => setPage(1);

  const canDelete = (f: FileRow) => !!user && (user.role === 'ADMIN' || (user.role === 'TEAM' && f.uploadedBy.id === user.id));

  return (
    <div>
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t('file.search')} />
        <FilterSelect value={kind} onChange={(v) => { setKind(v); reset(); }} allLabel={t('file.allTypes')} options={[{ value: 'image', label: t('file.kindImage') }, { value: 'video', label: t('file.kindVideo') }, { value: 'document', label: t('file.kindDocument') }]} />
        {staff && !campaignId && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        {toolbar && <div className="col-span-2 sm:ms-auto">{toolbar}</div>}
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState icon={FolderOpen} title={t('file.empty')} description={search || kind || clientId ? t('common.noResultsHint') : t('file.emptyHint')} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(f) => f.id}
            leading={(f) => <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><FileTypeIcon mime={f.fileType} /></span>}
            columns={[
              {
                key: 'name', header: t('file.name'), primary: true,
                cell: (f) => (
                  <div className="min-w-0">
                    <a href={fileUrl(f.id)} className="block truncate font-medium text-zinc-900 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{f.fileName}</a>
                    <p className="text-xs font-normal text-zinc-500">{fmt.bytes(f.size)}</p>
                  </div>
                ),
              },
              {
                key: 'context', header: t('file.attachedTo'), hideOnTablet: true,
                cell: (f) =>
                  f.deliverable ? <Link to={`/deliverables/${f.deliverable.id}`} className="text-zinc-700 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{f.deliverable.name} · v{f.version}</Link>
                  : f.request ? <Link to={`/requests/${f.request.id}`} className="text-zinc-700 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{f.request.title}</Link>
                  : f.campaign ? <Link to={`/campaigns/${f.campaign.id}`} className="text-zinc-700 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{f.campaign.name}</Link>
                  : <span className="text-zinc-400">—</span>,
              },
              { key: 'by', header: t('file.uploadedBy'), hideOnTablet: true, cell: (f) => f.uploadedBy.name },
              { key: 'date', header: t('common.created'), cell: (f) => <span className="text-zinc-500">{fmt.date(f.createdAt)}</span> },
              ...(staff ? [{ key: 'vis', header: t('file.visibility'), hideOnMobile: true, hideOnTablet: true, cell: (f: FileRow) => (f.visibleToClient ? <Badge tone="green" dot={false}><Eye className="size-3" />{t('file.visible')}</Badge> : <Badge dot={false}><EyeOff className="size-3" />{t('file.internal')}</Badge>) }] : []),
              {
                key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, align: 'end' as const,
                cell: (f) => (
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <a href={fileUrl(f.id)} aria-label={t('file.download')} title={t('file.download')} className="inline-flex size-9 items-center justify-center rounded-xl text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"><Download className="size-[18px]" /></a>
                    {canDelete(f) && <IconButton label={t('common.delete')} className="size-9 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(f)}><Trash2 className="size-[18px]" /></IconButton>}
                  </div>
                ),
              },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && del.mutate(toDelete.id)} loading={del.isPending} title={t('file.deleteTitle')} message={t('file.deleteMessage', { name: toDelete?.fileName ?? '' })} confirmLabel={t('common.delete')} />
    </div>
  );
}
