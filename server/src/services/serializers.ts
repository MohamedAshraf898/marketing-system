import type { Prisma } from '@prisma/client';

/** Files are returned WITHOUT filePath (the storage key never leaves the server). */
export const fileSelect = {
  id: true,
  fileName: true,
  fileType: true,
  size: true,
  clientId: true,
  campaignId: true,
  deliverableId: true,
  requestId: true,
  version: true,
  visibleToClient: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true, role: true } },
  campaign: { select: { id: true, name: true } },
  deliverable: { select: { id: true, name: true } },
  request: { select: { id: true, title: true } },
} satisfies Prisma.FileSelect;

export const userMini = { id: true, name: true, role: true, avatar: true } satisfies Prisma.UserSelect;

export const isImage = (mime: string) => mime.startsWith('image/');

export function parseJson<T = Record<string, unknown>>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export const and = <T>(...parts: Array<T | undefined>): { AND: T[] } => ({ AND: parts.filter((p): p is T => p !== undefined) });
