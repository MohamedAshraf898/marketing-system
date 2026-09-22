import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from './client';
import { useI18n } from '@/i18n';
import { useToast } from '@/components/ui/Toast';
import { errorText } from '@/i18n/errors';

type Params = Record<string, string | number | boolean | null | undefined>;

/** GET helper: the query key is the path + params, so any filter change refetches automatically. */
export function useApi<T>(path: string | null, params?: Params, opts?: { enabled?: boolean; keepPrevious?: boolean }) {
  return useQuery<T>({
    queryKey: ['api', path, params ?? {}] as QueryKey,
    queryFn: () => api.get<T>(path as string, params),
    enabled: path !== null && (opts?.enabled ?? true),
    placeholderData: opts?.keepPrevious === false ? undefined : keepPreviousData,
  });
}

/** Mutation helper: shows a success toast, translates failures, refreshes cached lists. */
export function useAction<TVars, TRes = unknown>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string; onSuccess?: (res: TRes, vars: TVars) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      void qc.invalidateQueries({ queryKey: ['api'] });
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(res, vars);
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorText(t, err));
    },
  });
}
