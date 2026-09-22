import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { useOutsideClose } from '@/components/ui/Popover';

export function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl p-1 transition hover:bg-zinc-100" aria-label={t('user.menu')} aria-expanded={open}>
        <Avatar name={user.name} size="md" />
      </button>
      {open && (
        <div className="og-pop absolute end-0 top-12 z-50 w-72 overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)]">
          <div className="border-b border-line p-4">
            <div className="flex items-center gap-3">
              <Avatar name={user.name} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">{user.name}</p>
                <p className="truncate text-xs text-zinc-500"><span className="ltr-num">{user.email}</span></p>
              </div>
            </div>
            <div className="mt-3"><StatusBadge group="role" value={user.role} /></div>
          </div>
          <div className="p-1.5">
            <button onClick={() => { setOpen(false); nav('/settings'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-100">
              <Settings className="size-4" /> {t('nav.settings')}
            </button>
            <button onClick={() => void logout()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50">
              <LogOut className="size-4 rtl:-scale-x-100" /> {t('auth.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
