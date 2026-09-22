import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, MapPin, Play, Trash2 } from 'lucide-react';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { FileRow } from '@/api/types';
import type { ProofingListResponse } from '@/api/types.content';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { Select, Textarea } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/Feedback';

/**
 * Proofing = pinned (images) / timestamped (video) review comments on a deliverable's own files.
 * Never touches the approval record - purely additive feedback, resolved/deleted independently.
 */
export function ProofingPanel({ deliverableId, files }: { deliverableId: string; files: FileRow[] }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const q = useApi<ProofingListResponse>(`/deliverables/${deliverableId}/proofing`);
  const media = files.filter((f) => f.fileType.startsWith('image/') || f.fileType.startsWith('video/'));
  const [fileId, setFileId] = useState('');
  const [comment, setComment] = useState('');
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [pendingTime, setPendingTime] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selected = media.find((f) => f.id === fileId) ?? null;
  const isImage = selected?.fileType.startsWith('image/');
  const isVideo = selected?.fileType.startsWith('video/');

  useEffect(() => { setPendingPin(null); setPendingTime(null); }, [fileId]);

  const post = useAction(
    () => api.post(`/deliverables/${deliverableId}/proofing`, {
      fileId: selected?.id, comment: comment.trim(),
      ...(pendingPin ? { x: pendingPin.x, y: pendingPin.y } : {}),
      ...(pendingTime != null ? { timestampSec: pendingTime } : {}),
    }),
    { success: t('content.proofingPosted'), onSuccess: () => { setComment(''); setPendingPin(null); setPendingTime(null); } },
  );
  const resolve = useAction((vars: { id: string; resolved: boolean }) => api.patch(`/deliverables/${deliverableId}/proofing/${vars.id}`, { resolved: vars.resolved }));
  const del = useAction((id: string) => api.del(`/deliverables/${deliverableId}/proofing/${id}`));

  const items = q.data?.items ?? [];
  const shown = fileId ? items.filter((c) => c.fileId === fileId) : items;
  const canComment = q.data?.canComment ?? false;
  const canPost = canComment && comment.trim().length > 0 && !post.isPending;

  const pinClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canComment) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPendingPin({ x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) });
  };

  return (
    <Card>
      <CardHeader title={t('content.proofing')} subtitle={q.data ? t('content.proofingCount', { n: q.data.counts.total, unresolved: q.data.counts.unresolved }) : undefined} />
      <CardBody className="space-y-4">
        {q.isLoading ? <Skeleton className="h-24 w-full" /> : (
          <>
            {media.length > 0 && (
              <Select aria-label={t('content.proofingFile')} value={fileId} onChange={(e) => setFileId(e.target.value)}>
                <option value="">{t('content.proofingGeneral')}</option>
                {media.map((f) => <option key={f.id} value={f.id}>{f.fileName}</option>)}
              </Select>
            )}

            {isImage && (
              <div className="relative overflow-hidden rounded-xl border border-line bg-zinc-50" onClick={pinClick} role="presentation">
                <img src={fileUrl(selected!.id, true)} alt={selected!.fileName} className={cx('max-h-96 w-full object-contain', canComment && 'cursor-crosshair')} />
                {shown.filter((c) => c.x != null && c.y != null).map((c) => (
                  <span
                    key={c.id}
                    title={c.comment}
                    className={cx('absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white text-[10px] font-bold text-white shadow ring-1 ring-black/10', c.resolved ? 'bg-emerald-500' : 'bg-amber-500')}
                    style={{ left: `${(c.x ?? 0) * 100}%`, top: `${(c.y ?? 0) * 100}%` }}
                  >
                    <MapPin className="size-3.5 translate-x-[3px] translate-y-[1px]" />
                  </span>
                ))}
                {pendingPin && (
                  <span className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-600 shadow ring-1 ring-black/10" style={{ left: `${pendingPin.x * 100}%`, top: `${pendingPin.y * 100}%` }} />
                )}
              </div>
            )}
            {pendingPin && isImage && <p className="text-xs text-zinc-500">{t('content.proofingPinSet')}</p>}

            {isVideo && (
              <div className="space-y-2">
                <video ref={videoRef} controls src={fileUrl(selected!.id, true)} className="max-h-96 w-full rounded-xl border border-line bg-black" />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" icon={<Play className="size-3.5" />} disabled={!canComment} onClick={() => setPendingTime(videoRef.current?.currentTime ?? 0)}>{t('content.proofingUseTime')}</Button>
                  {pendingTime != null && <span className="text-xs font-medium text-zinc-600 tabular">{t('content.proofingAt', { time: fmt.number(pendingTime, { maximumFractionDigits: 1 }) })}</span>}
                </div>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); if (canPost) post.mutate(undefined); }} className="flex flex-col gap-2">
              <Textarea rows={2} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder={t('content.proofingPlaceholder')} disabled={!canComment} aria-label={t('content.proofingPlaceholder')} />
              <div className="flex items-center justify-between">
                {!canComment && <p className="text-xs text-zinc-400">{t('content.proofingClosed')}</p>}
                <Button type="submit" size="sm" className="ms-auto" loading={post.isPending} disabled={!canPost}>{t('content.proofingPost')}</Button>
              </div>
            </form>

            {shown.length === 0 ? (
              <p className="text-sm text-zinc-400">{t('content.proofingEmpty')}</p>
            ) : (
              <ul className="space-y-3 border-t border-line pt-4">
                {shown.map((c) => {
                  const mine = c.userId === user?.id;
                  const canResolve = user?.role !== 'CLIENT' || mine;
                  const canDelete = (mine || user?.role === 'ADMIN') && !c.resolved;
                  return (
                    <li key={c.id} className="flex gap-3">
                      <Avatar name={c.user.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900">{c.user.name}</span>
                          <Badge tone={c.authorType === 'CLIENT' ? 'teal' : 'blue'} dot={false}>{c.authorType === 'CLIENT' ? t('review.authorClient') : t('review.authorTeam')}</Badge>
                          {c.file && <Badge tone="neutral" dot={false}>{c.file.fileName}</Badge>}
                          {c.x != null && <Badge tone="amber" dot={false}>{t('content.proofingPin')}</Badge>}
                          {c.timestampSec != null && <Badge tone="violet" dot={false}>{t('content.proofingAt', { time: fmt.number(c.timestampSec, { maximumFractionDigits: 1 }) })}</Badge>}
                          {c.resolved && <Badge tone="green" dot={false}><CheckCircle2 className="size-3" />{t('content.proofingResolved')}</Badge>}
                          <span className="text-xs text-zinc-400">{fmt.relative(c.createdAt)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-700">{c.comment}</p>
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        {canResolve && (
                          <IconButton label={c.resolved ? t('content.proofingReopen') : t('content.proofingResolve')} className="size-8" onClick={() => resolve.mutate({ id: c.id, resolved: !c.resolved })}>
                            <CheckCircle2 className={cx('size-4', c.resolved ? 'text-emerald-600' : 'text-zinc-400')} />
                          </IconButton>
                        )}
                        {canDelete && (
                          <IconButton label={t('common.delete')} className="size-8 hover:text-rose-600" onClick={() => del.mutate(c.id)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
