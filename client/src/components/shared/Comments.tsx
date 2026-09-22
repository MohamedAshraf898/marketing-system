import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { CommentRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { Skeleton } from '@/components/ui/Feedback';
import { Textarea } from '@/components/ui/Form';

/** Comment thread + composer for a deliverable or a request (`basePath` = /deliverables/:id or /requests/:id). */
export function CommentsCard({ basePath }: { basePath: string }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const list = useApi<{ items: CommentRow[] }>(`${basePath}/comments`);
  const post = useAction(() => api.post(`${basePath}/comments`, { comment: text.trim() }), { onSuccess: () => setText('') });
  const items = list.data?.items ?? [];
  return (
    <Card>
      <CardHeader title={t('review.comments')} subtitle={items.length ? undefined : t('review.commentsHint')} />
      <CardBody>
        {list.isLoading ? <Skeleton className="h-16 w-full" /> : (
          <ul className="space-y-4">
            {items.map((c) => {
              const mine = c.user.id === user?.id;
              return (
                <li key={c.id} className="flex gap-3">
                  <Avatar name={c.user.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{c.user.name}{mine && <span className="ms-1.5 text-xs font-normal text-zinc-400">({t('user.you')})</span>}</span>
                      <Badge tone={c.authorType === 'CLIENT' ? 'teal' : 'blue'} dot={false}>{c.authorType === 'CLIENT' ? t('review.authorClient') : t('review.authorTeam')}</Badge>
                      <span className="text-xs text-zinc-400">{fmt.relative(c.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-700">{c.comment}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) post.mutate(undefined); }} className={cx('flex flex-col gap-2', items.length > 0 && 'mt-5 border-t border-line pt-5')}>
          <Textarea rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={t('review.commentPlaceholder')} aria-label={t('review.addComment')} />
          <div className="flex justify-end"><Button type="submit" size="sm" icon={<MessageSquare className="size-4" />} loading={post.isPending} disabled={!text.trim()}>{t('review.postComment')}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

