import { Languages } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { cx } from '@/components/ui/cx';

export function LanguageSwitcher({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { locale, setLocale } = useI18n();
  const { updateLocale, user } = useAuth();
  const next = locale === 'en' ? 'ar' : 'en';
  return (
    <button
      onClick={() => (user ? updateLocale(next) : setLocale(next))}
      className={cx(
        'inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition',
        tone === 'light' ? 'text-zinc-700 hover:bg-zinc-100' : 'text-zinc-300 hover:bg-white/10',
        className,
      )}
      aria-label={locale === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
      lang={next}
    >
      <Languages className="size-[18px]" />
      <span className="max-sm:hidden">{next === 'ar' ? 'العربية' : 'English'}</span>
    </button>
  );
}
