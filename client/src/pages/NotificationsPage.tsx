import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { NotificationRow, NotificationsResponse } from '@/api/types';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Tabs';
import { NotificationItem, notificationLink } from '@/components/shared/NotificationItem';

export function NotificationsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const q = useApi<NotificationsResponse>('/notifications', { unread: filter === 'unread', page });
  const markAll = useAction(() => api.post('/notifications/read-all'), { success: t('notif.allRead') });
  const markOne = useAction((id: string) => api.patch(`/notifications/${id}/read`, {}), { silentError: true });

  const open = (n: NotificationRow) => {
    if (!n.readAt) markOne.mutate(n.id);
    const link = notificationLink(n);
    if (link) nav(link);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('notif.title')}
        subtitle={q.data ? t('notif.unreadCount', { n: q.data.unreadCount }) : undefined}
        actions={<Button variant="secondary" icon={<CheckCheck className="size-4" />} onClick={() => markAll.mutate(undefined)} loading={markAll.isPending} disabled={!q.data?.unreadCount}>{t('notif.markAllRead')}</Button>}
      />
      <div className="mb-4"><Segmented value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[{ id: 'all', label: t('notif.filterAll') }, { id: 'unread', label: t('notif.filterUnread') }]} /></div>
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonRows /> : !q.data?.items.length ? (
        <Card><EmptyState icon={Bell} title={t('notif.empty')} description={t('notif.emptyHint')} /></Card>
      ) : (
        <>
          <Card className="divide-y divide-line overflow-hidden">{q.data.items.map((n) => <NotificationItem key={n.id} n={n} onClick={() => open(n)} />)}</Card>
          <Pagination meta={q.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
