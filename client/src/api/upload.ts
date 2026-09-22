import { ALLOWED_UPLOADS } from '@shared/uploads';
import { api } from './client';
import type { FileRow } from './types';

export type UploadTarget = { clientId?: string; campaignId?: string; deliverableId?: string; requestId?: string; visibleToClient?: boolean };

export async function uploadFile(file: File, target: UploadTarget): Promise<FileRow> {
  const form = new FormData();
  for (const [k, v] of Object.entries(target)) {
    if (v !== undefined && v !== '') form.append(k, String(v));
  }
  form.append('file', file); // the file goes last so the fields above are parsed first
  const res = await api.upload<{ item: FileRow }>('/files', form);
  return res.item;
}

/** Early feedback only - the API re-validates everything. Returns a translation key or null. */
export function precheckFile(file: File, maxMb: number): 'file.tooLarge' | 'file.typeNotAllowed' | 'file.emptyFile' | null {
  if (file.size === 0) return 'file.emptyFile';
  if (file.size > maxMb * 1024 * 1024) return 'file.tooLarge';
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  return ALLOWED_UPLOADS[ext] ? null : 'file.typeNotAllowed';
}
