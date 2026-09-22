import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/api/client';
import type { AppConfig, Me, MeResponse } from '@/api/types';
import { useI18n } from '@/i18n';

interface AuthValue {
  user: Me | null;
  config: AppConfig | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  updateLocale: (l: 'en' | 'ar') => void;
  refresh: () => Promise<void>;
  /** true when the signed-in user holds the permission (ADMIN always; CLIENT never). UI hint only - the API enforces it. */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);
const ME_KEY = ['me'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setLocale, setCurrency, locale } = useI18n();

  const me = useQuery<MeResponse | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/me');
      } catch (e) {
        if (e instanceof ApiClientError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const data = me.data ?? null;

  // adopt the account's saved language + currency once per login
  useEffect(() => {
    if (!data) return;
    setCurrency(data.config.currency);
    setLocale(data.user.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.user.id]);

  useEffect(() => {
    const onUnauth = () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ queryKey: ['api'] });
    };
    window.addEventListener('og:unauthenticated', onUnauth);
    return () => window.removeEventListener('og:unauthenticated', onUnauth);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<MeResponse>('/auth/login', { email, password });
    qc.removeQueries({ queryKey: ['api'] });
    qc.setQueryData(ME_KEY, res);
    return res.user;
  }, [qc]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* already signed out */ }
    qc.setQueryData(ME_KEY, null);
    qc.removeQueries({ queryKey: ['api'] });
  }, [qc]);

  const updateLocale = useCallback((l: 'en' | 'ar') => {
    setLocale(l);
    if (data) void api.patch<MeResponse>('/me', { locale: l }).then((res) => qc.setQueryData(ME_KEY, res)).catch(() => undefined);
  }, [data, qc, setLocale]);

  const refresh = useCallback(async () => { await qc.invalidateQueries({ queryKey: ME_KEY }); }, [qc]);

  const can = useCallback((permission: string) => !!data && data.user.role !== 'CLIENT' && (data.user.role === 'ADMIN' || data.user.permissions.includes(permission)), [data]);

  const value = useMemo<AuthValue>(
    () => ({ user: data?.user ?? null, config: data?.config ?? null, loading: me.isLoading, login, logout, updateLocale, refresh, can }),
    [data, me.isLoading, login, logout, updateLocale, refresh, can],
  );
  void locale;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
