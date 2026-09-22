import { ApiClientError } from '@/api/client';
import type { TKey } from './en';

type T = (key: TKey, params?: Record<string, string | number>) => string;

/** Turns any thrown error into a friendly sentence in the current language. Never shows raw technical text. */
export function errorText(t: T, err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 0) return t('error.NETWORK_ERROR');
    const key = `error.${err.code}` as TKey;
    const translated = t(key);
    if (translated !== key) return translated;
    return t('error.INTERNAL_ERROR');
  }
  return t('error.INTERNAL_ERROR');
}

/** Field-level validation code (from the API) -> sentence. */
export function fieldText(t: T, code: string | undefined): string | undefined {
  if (!code) return undefined;
  const key = `validation.${code}` as TKey;
  const s = t(key);
  return s === key ? t('validation.invalid') : s;
}

export const fieldErrors = (err: unknown): Record<string, string> => (err instanceof ApiClientError && err.fields ? err.fields : {});
