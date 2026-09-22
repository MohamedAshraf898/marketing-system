import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { MoreHorizontal, X, Menu } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/Button';
import { CompanyMark } from '@/components/shared/Media';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LogoMark, Wordmark } from './Logo';
import { GlobalSearch } from './GlobalSearch';
import { BOTTOM, navSections, type NavItem } from './nav';
import { TimerWidget } from './TimerWidget';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

function SideLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors',
          isActive ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-brand-400" />}
          <Icon className="size-[18px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
          {t(item.label)}
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, can } = useAuth();
  const { t } = useI18n();
  if (!user) return null;
  const sections = navSections(user.role, can);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-4 pt-6">
        <LogoMark />
        <Wordmark dark />
      </div>

      <div className="mx-4 mb-4 rounded-2xl border border-white/10 bg-white/5 p-3">
        {user.client ? (
          <div className="flex items-center gap-3">
            <CompanyMark clientId={user.client.id} name={user.client.companyName} hasLogo={user.client.hasLogo} size="md" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-white">{user.client.companyName}</p>
              <p className="text-[11px] text-zinc-400">{t('shell.clientPortal')}</p>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[13px] font-semibold text-white">{t('shell.agencyWorkspace')}</p>
            <p className="text-[11px] text-zinc-400">{user.role === 'ADMIN' ? t('shell.adminConsole') : t('shell.teamConsole')}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
        {sections.map((s, idx) => (
          <div key={idx} className="space-y-1">
            {s.title && <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t(s.title)}</p>}
            {s.items.map((i) => <SideLink key={i.to} item={i} onNavigate={onNavigate} />)}
          </div>
        ))}
      </nav>
      <p className="px-6 py-4 text-[11px] text-zinc-600">OG System · v1.0</p>
    </div>
  );
}

export function AppShell() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { setDrawer(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawer]);

  if (!user) return null;
  const all = navSections(user.role, can).flatMap((s) => s.items);
  const bottom = BOTTOM[user.role].map((to) => all.find((i) => i.to === to)).filter((i): i is NavItem => !!i);

  return (
    <div className="min-h-dvh">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 bg-sidebar lg:block">
        <SidebarContent />
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="og-fade absolute inset-0 bg-zinc-950/55" onClick={() => setDrawer(false)} />
          <aside className="og-drawer absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-sidebar shadow-2xl">
            <button onClick={() => setDrawer(false)} aria-label={t('common.close')} className="absolute end-3 top-5 rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white">
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-[88rem] items-center gap-2 px-4 sm:px-6 lg:px-8">
            <IconButton label={t('shell.openMenu')} className="lg:hidden" onClick={() => setDrawer(true)}>
              <Menu className="size-5" />
            </IconButton>
            <div className="flex items-center gap-2.5 lg:hidden">
              <LogoMark className="size-8" />
              <Wordmark />
            </div>
            <div className="flex flex-1 items-center justify-end gap-2 sm:justify-between">
              <GlobalSearch />
              <TimerWidget />
            </div>
            <LanguageSwitcher />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main className="mx-auto max-w-[88rem] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* phone bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur-md lg:hidden pb-safe" aria-label="Quick">
        <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }}>
          {bottom.map((i) => {
            const Icon = i.icon;
            return (
              <li key={i.to}>
                <NavLink to={i.to} end={i.end} className={({ isActive }) => cx('flex flex-col items-center gap-1 px-1 pb-1 pt-2.5 text-[11px] font-medium', isActive ? 'text-brand-600' : 'text-zinc-500')}>
                  {({ isActive }) => (
                    <>
                      <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-brand-50')}>
                        <Icon className="size-5" strokeWidth={isActive ? 2.2 : 1.8} />
                      </span>
                      <span className="max-w-full truncate">{t(i.label)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
          <li>
            <button onClick={() => setDrawer(true)} className="flex w-full flex-col items-center gap-1 px-1 pb-1 pt-2.5 text-[11px] font-medium text-zinc-500">
              <span className="flex h-7 w-12 items-center justify-center"><MoreHorizontal className="size-5" /></span>
              {t('shell.more')}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
