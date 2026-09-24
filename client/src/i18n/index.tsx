import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type TKey } from './en';
import { ar } from './ar';
import type { Locale } from '@shared/enums';

export type { TKey };
const dicts: Record<Locale, Record<string, string>> = { en, ar };
const STORAGE_KEY = 'og_locale';

// Arabic UI, but Western digits (0-9) so numbers match charts, IDs and phone numbers.
// Switch to 'ar-EG' here if you prefer Arabic-Indic digits (٠-٩).
const INTL_TAG: Record<Locale, string> = { en: 'en-US', ar: 'ar-EG-u-nu-latn' };

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export interface Formatters {
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  compact: (n: number) => string;
  money: (n: number, opts?: { compact?: boolean; decimals?: number }) => string;
  percent: (n: number, decimals?: number) => string;
  ratio: (n: number) => string;
  date: (d: string | Date | null | undefined) => string;
  dateTime: (d: string | Date | null | undefined) => string;
  relative: (d: string | Date) => string;
  bytes: (n: number) => string;
}

interface I18nValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  isRtl: boolean;
  t: (key: TKey, params?: Record<string, string | number>) => string;
  /** Translate an enum value, e.g. label('campaignStatus', 'RUNNING'). Falls back to the raw value. */
  label: (group: string, value: string | null | undefined) => string;
  has: (key: string) => boolean;
  setLocale: (l: Locale) => void;
  setCurrency: (c: string) => void;
  fmt: Formatters;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitial);
  const [currency, setCurrency] = useState('USD');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    document.title = dicts[locale]['app.name'] ?? 'Famolya';
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = dicts[locale];
    const tag = INTL_TAG[locale];
    const t: I18nValue['t'] = (key, params) => {
      let s = dict[key] ?? en[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    const asDate = (d: string | Date) => (d instanceof Date ? d : new Date(d));
    // Money / percentages / ratios use Latin formatting even in Arabic ("$12.9K", "2.32%") and are bidi-isolated so
    // the symbol never jumps to the wrong side inside right-to-left text.
    const latin = 'en-US';
    const iso = (str: string) => (locale === 'ar' ? `\u2066${str}\u2069` : str);
    const dfShort = new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', day: 'numeric' });
    const dfLong = new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
    const fmt: Formatters = {
      number: (n, opts) => new Intl.NumberFormat(tag, opts).format(n),
      compact: (n) => iso(new Intl.NumberFormat(latin, { notation: 'compact', maximumFractionDigits: 1 }).format(n)),
      money: (n, o) =>
        iso(new Intl.NumberFormat(latin, {
          style: 'currency', currency, currencyDisplay: 'narrowSymbol',
          notation: o?.compact ? 'compact' : 'standard',
          maximumFractionDigits: o?.decimals ?? (o?.compact ? 1 : Math.abs(n) >= 1000 ? 0 : 2),
          minimumFractionDigits: o?.decimals ?? 0,
        }).format(n)),
      percent: (n, decimals = 2) => iso(`${new Intl.NumberFormat(latin, { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(n)}%`),
      ratio: (n) => iso(`${new Intl.NumberFormat(latin, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n)}x`),
      date: (d) => (d ? dfShort.format(asDate(d)) : '—'),
      dateTime: (d) => (d ? dfLong.format(asDate(d)) : '—'),
      relative: (d) => {
        const diff = (asDate(d).getTime() - Date.now()) / 1000;
        const abs = Math.abs(diff);
        if (abs < 60) return rtf.format(0, 'second');
        if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
        if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
        return dfShort.format(asDate(d));
      },
      bytes: (n) => {
        if (n < 1024) return `${n} B`;
        if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / 1024 ** 2).toFixed(1)} MB`;
      },
    };
    return {
      locale, dir, isRtl: dir === 'rtl', t, fmt, setLocale, setCurrency,
      has: (k) => k in dict || k in en,
      label: (group, v) => (v ? (dict[`${group}.${v}`] ?? en[`${group}.${v}` as TKey] ?? v) : '—'),
    };
  }, [locale, dir, currency, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}
