import { useState } from 'react';
import { Lock, Pencil, Pin, PinOff, StickyNote, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Paged } from '@/api/types';
import type { InternalNoteRow } from '@/api/types.crm';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Checkbox, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { cx } from '@/components/ui/cx';

/** Staff-only notes about a client (optionally one project). Renders nothing for client users; the API refuses them anyway. */
export function InternalNotesPanel({ clientId, projectId }: { clientId: string; projectId?: string }) {
  const { t, fmt } = useI18n();
  const { user, can } = useAuth();
  const allowed = !!user && user.role !== 'CLIENT' && can('notes.internal');
  const [page, setPage] = useState(1);
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<InternalNoteRow | null>(null);
  const [toDelete, setToDelete] = useState<InternalNoteRow | null>(null);
  const list = useApi<Paged<InternalNoteRow>>(`/clients/${clientId}/internal-notes`, { projectId, page, pageSize: 20 }, { enabled: allowed });
  const add = useAction(() => api.post(`/clients/${clientId}/internal-notes`, { body, pinned, projectId: projectId ?? null }), { success: t('crm.note.added'), onSuccess: () => { setBody(''); setPinned(false); setPage(1); } });
  const pin = useAction((n: InternalNoteRow) => api.patch(`/internal-notes/${n.id}`, { pinned: !n.pinned }));
  const remove = useAction((n: InternalNoteRow) => api.del(`/internal-notes/${n.id}`), { success: t('crm.note.deleted'), onSuccess: () => setToDelete(null) });

  if (!allowed) return null;
  const canChange = (n: InternalNoteRow) => user?.role === 'ADMIN' || n.authorId === user?.id;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-amber-700" />
        <div>
          <p className="text-sm font-semibold text-amber-900">{t('crm.note.bannerTitle')}</p>
          <p className="text-[13px] text-amber-800/90">{t('crm.note.bannerHint')}</p>
        </div>
      </div>

      <Card>
        <CardBody className="space-y-3">
          <Textarea aria-label={t('crm.note.placeholder')} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('crm.note.placeholder')} maxLength={8000} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox label={t('crm.note.pinIt')} checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <Button variant="brand" loading={add.isPending} disabled={!body.trim()} onClick={() => add.mutate(undefined)}>{t('crm.note.add')}</Button>
          </div>
        </CardBody>
      </Card>

      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div> : !list.data?.items.length ? (
        <EmptyState compact icon={StickyNote} title={t('crm.note.empty')} description={t('crm.note.emptyHint')} />
      ) : (
        <>
          <ul className="space-y-3">
            {list.data.items.map((n) => (
              <li key={n.id}>
                <Card className={cx('p-4 sm:p-5', n.pinned && 'border-amber-300 bg-amber-50/30')}>
                  <div className="flex items-start gap-3">
                    <Avatar name={n.author.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-zinc-500">
                        <span className="font-medium text-zinc-900">{n.author.name}</span>
                        <time dateTime={n.createdAt} title={fmt.dateTime(n.createdAt)}>{fmt.relative(n.createdAt)}</time>
                        {n.updatedAt !== n.createdAt && new Date(n.updatedAt).getTime() - new Date(n.createdAt).getTime() > 1000 && <span className="text-zinc-400">· {t('crm.note.edited')}</span>}
                        {n.pinned && <Badge tone="amber" dot={false}><Pin className="size-3" />{t('crm.note.pinned')}</Badge>}
                        {!projectId && n.project && <Badge dot={false}>{n.project.name}</Badge>}
                      </p>
                      <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-zinc-800">{n.body}</p>
                    </div>
                    {canChange(n) && (
                      <div className="-me-2 -mt-1 flex shrink-0">
                        <IconButton label={n.pinned ? t('crm.note.unpin') : t('crm.note.pin')} className="size-9" onClick={() => pin.mutate(n)}>{n.pinned ? <PinOff className="size-[18px]" /> : <Pin className="size-[18px]" />}</IconButton>
                        <IconButton label={t('common.edit')} className="size-9" onClick={() => setEditing(n)}><Pencil className="size-[18px]" /></IconButton>
                        <IconButton label={t('common.delete')} className="size-9 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(n)}><Trash2 className="size-[18px]" /></IconButton>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {editing && <EditNoteModal note={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete)} loading={remove.isPending} title={t('crm.note.deleteTitle')} message={t('crm.note.deleteMessage')} confirmLabel={t('common.delete')} />
    </div>
  );
}

function EditNoteModal({ note, onClose }: { note: InternalNoteRow; onClose: () => void }) {
  const { t } = useI18n();
  const [body, setBody] = useState(note.body);
  const save = useAction(() => api.patch(`/internal-notes/${note.id}`, { body }), { success: t('crm.note.updated'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  return (
    <Modal
      open onClose={onClose} title={t('crm.note.edit')} description={t('crm.note.bannerHint')}
      footer={<><Button variant="secondary" onClick={onClose} className="max-sm:h-11">{t('common.cancel')}</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!body.trim()} className="max-sm:h-11">{t('common.saveChanges')}</Button></>}
    >
      <Textarea aria-label={t('crm.note.edit')} rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} invalid={!!errs.body} />
      {errs.body && <p className="mt-1.5 text-xs font-medium text-rose-600" role="alert">{fieldText(t, errs.body)}</p>}
    </Modal>
  );
}
