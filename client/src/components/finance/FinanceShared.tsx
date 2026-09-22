import { useState, type ReactNode } from 'react';
import { Download, Eye, EyeOff, Paperclip, Trash2 } from 'lucide-react';
import { INLINE_SAFE_MIME } from '@shared/uploads';
import { api, fileUrl } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { FileRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { FilePicker } from '@/components/ui/FilePicker';
import { ConfirmDialog } from '@/components/ui/Modal';
import { FileTypeIcon } from '@/components/shared/Media';

/** YYYY-MM-DD part of an ISO date (date-only fields are stored as UTC midnight). */
export const dayStr = (s: string | null | undefined): string => (s ? s.slice(0, 10) : '');
export const todayStr = (): string => new Date().toISOString().slice(0, 10);
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Whole days from today (UTC) to the given date: positive = in the future, negative = in the past. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = Date.parse(`${dayStr(date)}T00:00:00Z`);
  const today = Date.parse(`${todayStr()}T00:00:00Z`);
  return Number.isNaN(target) ? null : Math.round((target - today) / 86_400_000);
}

/** Small "ends in N days" / "expired N days ago" hint that highlights contracts that need attention. */
export function ExpiryHint({ status, endDate }: { status: string; endDate: string | null }) {
  const { t } = useI18n();
  const d = daysUntil(endDate);
  if (d === null || status === 'DRAFT' || status === 'TERMINATED') return null;
  if (status === 'EXPIRED' || d < 0) return <span className="text-xs font-medium text-rose-600">{t('finance.expiredAgo', { n: Math.abs(d) })}</span>;
  if (d <= 30) return <span className="text-xs font-medium text-amber-700">{d === 0 ? t('finance.endsToday') : t('finance.endsIn', { n: d })}</span>;
  return null;
}

/** "Due in N days" / "N days overdue" hint for open invoices. */
export function DueHint({ status, dueDate }: { status: string; dueDate: string }) {
  const { t } = useI18n();
  const d = daysUntil(dueDate);
  if (d === null || !['SENT', 'PENDING', 'OVERDUE'].includes(status)) return null;
  if (status === 'OVERDUE' || d < 0) return <span className="text-xs font-medium text-rose-600">{t('finance.overdueBy', { n: Math.abs(d) })}</span>;
  if (d <= 7) return <span className="text-xs font-medium text-amber-700">{d === 0 ? t('finance.dueToday') : t('finance.dueIn', { n: d })}</span>;
  return null;
}

export function SharedBadge({ shared }: { shared: boolean | undefined }) {
  const { t } = useI18n();
  return shared ? <Badge tone="green" dot={false}><Eye className="size-3" />{t('finance.sharedWithClient')}</Badge> : <Badge dot={false}><EyeOff className="size-3" />{t('finance.internalOnly')}</Badge>;
}

export function DetailRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-zinc-900">{children}</dd>
    </div>
  );
}

/**
 * Attachments of a contract / invoice. Downloads go through the authorised /files route only. Staff with the manage
 * permission can add / remove files; CLIENT users only see (and download) what was shared with them.
 */
export function Attachments({ field, parentId, files, canManage }: { field: 'contractId' | 'invoiceId'; parentId: string; files: FileRow[]; canManage: boolean }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [toDelete, setToDelete] = useState<FileRow | null>(null);
  const upload = useAction(
    () => {
      const form = new FormData();
      form.append(field, parentId);
      form.append('file', file as File); // the file goes last so the fields above are parsed first
      return api.upload('/files', form);
    },
    { success: t('file.uploaded'), onSuccess: () => setFile(null) },
  );
  const remove = useAction((id: string) => api.del(`/files/${id}`), { success: t('file.deleted'), onSuccess: () => setToDelete(null) });
  const canDelete = (f: FileRow) => canManage && !!user && (user.role === 'ADMIN' || f.uploadedBy.id === user.id);

  return (
    <div>
      {files.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Paperclip className="size-4" />{t('finance.noAttachments')}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3.5 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"><FileTypeIcon mime={f.fileType} /></span>
              <div className="min-w-0 flex-1">
                <a href={fileUrl(f.id)} className="block truncate text-sm font-medium text-zinc-900 hover:text-brand-700">{f.fileName}</a>
                <p className="text-xs text-zinc-500">{fmt.bytes(f.size)} · {fmt.date(f.createdAt)}</p>
              </div>
              {INLINE_SAFE_MIME.includes(f.fileType) && (
                <a href={fileUrl(f.id, true)} target="_blank" rel="noopener noreferrer" aria-label={t('finance.viewFile')} title={t('finance.viewFile')} className="inline-flex size-9 items-center justify-center rounded-xl text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"><Eye className="size-[18px]" /></a>
              )}
              <a href={fileUrl(f.id)} aria-label={t('file.download')} title={t('file.download')} className="inline-flex size-9 items-center justify-center rounded-xl text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"><Download className="size-[18px]" /></a>
              {canDelete(f) && <IconButton label={t('common.delete')} className="size-9 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(f)}><Trash2 className="size-[18px]" /></IconButton>}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="mt-3 space-y-3">
          <FilePicker file={file} onChange={setFile} />
          {file && <Button onClick={() => upload.mutate(undefined)} loading={upload.isPending}>{t('file.upload')}</Button>}
        </div>
      )}
      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)} loading={remove.isPending}
        title={t('file.deleteTitle')} message={t('file.deleteMessage', { name: toDelete?.fileName ?? '' })} confirmLabel={t('common.delete')}
      />
    </div>
  );
}
