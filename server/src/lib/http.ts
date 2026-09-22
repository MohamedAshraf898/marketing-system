import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { Errors, zodToFields } from './errors';

/** Wraps async route handlers so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Parses `data` with a zod schema; failures become a 400 VALIDATION_ERROR with per-field codes. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) throw Errors.validation(zodToFields(e));
    throw e;
  }
}

export const idParam = (req: Request, name = 'id'): string => {
  const v = req.params[name];
  // ids are cuid()s; reject anything odd early (also keeps weird input away from queries)
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{5,64}$/.test(v)) throw Errors.notFound();
  return v;
};

export interface Paging {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function paging(query: Request['query'], defaultSize = 20, maxSize = 100): Paging {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(String(query.pageSize ?? defaultSize), 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export const pageMeta = (p: Paging, total: number) => ({
  page: p.page,
  pageSize: p.pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
});

/** Reads a query param as a trimmed string or undefined. */
export const qs = (query: Request['query'], key: string): string | undefined => {
  const v = query[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

/** Optional enum filter: returns the value only when valid, otherwise undefined. */
export function qsEnum<T extends string>(query: Request['query'], key: string, allowed: readonly T[]): T | undefined {
  const v = qs(query, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export const clientIp = (req: Request): string | null => req.ip ?? req.socket.remoteAddress ?? null;
