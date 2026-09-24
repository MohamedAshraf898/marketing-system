import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { DEFAULT_BRANDING, type BrandingInfo } from '@/api/types.admin';

export interface Branding {
  agencyName: string;
  primaryColor: string;
  secondaryColor: string;
  /** true when the agency name differs from the built-in "Famolya" (the original wordmark is kept otherwise) */
  customName: boolean;
  logoUrl?: string;
  faviconUrl?: string;
  loading: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;
const CACHE_KEY = 'og_branding';
const VARS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const S = Math.max(0, Math.min(100, s)) / 100, L = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => Math.round(255 * (L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 50-950 scale from one colour (the primary colour is the "600" step: buttons with white text). Pure + exported for tests / previews. */
export function brandScale(primary: string): Record<(typeof VARS)[number], string> | null {
  if (!HEX.test(primary)) return null;
  const [h, s, l0] = hexToHsl(primary);
  const l = Math.min(l0, 85);
  const toward = (t: number) => l + (88 - l) * t; // lerp towards a light tint
  const L: Record<(typeof VARS)[number], number> = {
    '50': 97, '100': 94, '200': 88, '300': toward(0.8), '400': toward(0.55), '500': toward(0.25), '600': l0,
    '700': l * 0.87, '800': l * 0.74, '900': l * 0.6, '950': l * 0.45,
  };
  return Object.fromEntries(VARS.map((k) => [k, hslToHex(h, k === '50' || k === '100' ? Math.min(s, 100) : s, L[k])])) as Record<(typeof VARS)[number], string>;
}

const readCache = (): BrandingInfo | undefined => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const v = raw ? (JSON.parse(raw) as BrandingInfo) : null;
    return v && typeof v.agencyName === 'string' && HEX.test(v.primaryColor) && HEX.test(v.secondaryColor) ? v : undefined;
  } catch {
    return undefined;
  }
};

const BrandingContext = createContext<Branding>({ ...DEFAULT_BRANDING, customName: false, loading: false });

/** Public branding (agency name, colours, logo, favicon). Fetched once; drives CSS variables so every `brand-*` class follows. */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const q = useQuery<BrandingInfo>({
    queryKey: ['api', '/branding', {}],
    queryFn: async () => {
      const b = await api.get<BrandingInfo>('/branding');
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch { /* storage unavailable */ }
      return b;
    },
    initialData: readCache,
    initialDataUpdatedAt: 0, // cached copy is only a first paint; it is always refreshed
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const b = q.data;

  const value = useMemo<Branding>(() => {
    const v = b ? `?v=${new Date(b.updatedAt).getTime() || 0}` : '';
    const name = b?.agencyName?.trim() || DEFAULT_BRANDING.agencyName;
    return {
      agencyName: name,
      primaryColor: b && HEX.test(b.primaryColor) ? b.primaryColor.toLowerCase() : DEFAULT_BRANDING.primaryColor,
      secondaryColor: b && HEX.test(b.secondaryColor) ? b.secondaryColor.toLowerCase() : DEFAULT_BRANDING.secondaryColor,
      customName: name !== DEFAULT_BRANDING.agencyName,
      logoUrl: b?.hasLogo ? `/api/branding/logo${v}` : undefined,
      faviconUrl: b?.hasFavicon ? `/api/branding/favicon${v}` : undefined,
      loading: q.isLoading,
    };
  }, [b, q.isLoading]);

  // colours -> CSS variables (validated hex only). The built-in colours are left untouched so nothing changes when unset.
  useEffect(() => {
    const root = document.documentElement.style;
    const scale = value.primaryColor !== DEFAULT_BRANDING.primaryColor ? brandScale(value.primaryColor) : null;
    for (const k of VARS) {
      if (scale) root.setProperty(`--color-brand-${k}`, scale[k]);
      else root.removeProperty(`--color-brand-${k}`);
    }
    if (value.secondaryColor !== DEFAULT_BRANDING.secondaryColor && HEX.test(value.secondaryColor)) root.setProperty('--color-sidebar', value.secondaryColor);
    else root.removeProperty('--color-sidebar');
  }, [value.primaryColor, value.secondaryColor]);

  // browser tab title (the i18n provider resets it on a language change, so keep it in sync)
  useEffect(() => {
    if (!value.customName) return;
    const apply = () => { if (document.title !== value.agencyName) document.title = value.agencyName; };
    apply();
    const el = document.querySelector('title');
    if (!el) return;
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => mo.disconnect();
  }, [value.customName, value.agencyName]);

  // favicon
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    if (!link.dataset.ogOriginal) link.dataset.ogOriginal = JSON.stringify({ href: link.getAttribute('href'), type: link.getAttribute('type') });
    if (value.faviconUrl) {
      link.removeAttribute('type');
      link.setAttribute('href', value.faviconUrl);
    } else {
      try {
        const o = JSON.parse(link.dataset.ogOriginal) as { href: string | null; type: string | null };
        if (o.href) link.setAttribute('href', o.href);
        if (o.type) link.setAttribute('type', o.type);
      } catch { /* keep as is */ }
    }
  }, [value.faviconUrl]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);
