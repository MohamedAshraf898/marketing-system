import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { api } from '@/api/client';
import type { NotificationsResponse } from '@/api/types';
import { useI18n } from '@/i18n';
import { IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { useOutsideClose } from '@/components/ui/Popover';
import { NotificationItem, notificationLink } from '@/components/shared/NotificationItem';

export function NotificationBell() {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));

  const { data } = useQuery({
    queryKey: ['api', '/notifications', { pageSize: 8, bell: true }],
    queryFn: () => api.get<NotificationsResponse>('/notifications', { pageSize: 8 }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const unread = data?.unreadCount ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ['api', '/notifications'] });

  const openItem = async (id: string, link: string | null, read: boolean) => {
    setOpen(false);
    if (!read) await api.patch(`/notifications/${id}/read`, {}).catch(() => undefined);
    void refresh();
    if (link) nav(link);
  };
  const markAll = async () => { await api.post('/notifications/read-all'); void refresh(); };

  return (
    <div ref={ref} className="relative">
      <IconButton label={t('notif.title')} onClick={() => setOpen((o) => !o)} className="relative">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute end-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-white tabular">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="og-pop fixed inset-x-3 top-[4.25rem] z-50 overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:end-0 sm:top-12 sm:w-[24rem]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold">{t('notif.title')}</h3>
            {unread > 0 && <button onClick={markAll} className="text-xs font-medium text-brand-600 hover:underline">{t('notif.markAllRead')}</button>}
          </div>
          <div className="max-h-[26rem] divide-y divide-line overflow-y-auto">
            {data && data.items.length === 0 ? (
              <EmptyState compact icon={BellOff} title={t('notif.empty')} description={t('notif.emptyHint')} />
            ) : (
              data?.items.map((n) => <NotificationItem key={n.id} n={n} compact onClick={() => openItem(n.id, notificationLink(n), !!n.readAt)} />)
            )}
          </div>
          <button onClick={() => { setOpen(false); nav('/notifications'); }} className="block w-full border-t border-line px-4 py-3 text-center text-[13px] font-medium text-zinc-600 hover:bg-zinc-50">
            {t('notif.viewAll')}
          </button>
        </div>
      )}
    </div>
  );
}
