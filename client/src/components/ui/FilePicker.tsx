import { useRef, useState } from 'react';
import { Paperclip, UploadCloud, X } from 'lucide-react';
import { ACCEPT_ATTR } from '@shared/uploads';
import { useAuth } from '@/auth/AuthContext';
import { precheckFile } from '@/api/upload';
import { useI18n } from '@/i18n';
import { cx } from './cx';

export function FilePicker({ file, onChange, error }: { file: File | null; onChange: (f: File | null) => void; error?: string }) {
  const { t, fmt } = useI18n();
  const { config } = useAuth();
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    const problem = precheckFile(f, config?.maxUploadMb ?? 25);
    if (problem) { setLocalError(t(problem, { mb: config?.maxUploadMb ?? 25 })); onChange(null); return; }
    setLocalError(null);
    onChange(f);
  };
  const shownError = localError ?? error;

  return (
    <div>
      <input ref={ref} type="file" accept={ACCEPT_ATTR} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-line-strong bg-zinc-50 px-3.5 py-3">
          <Paperclip className="size-4 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-800">{file.name}</p>
            <p className="text-xs text-zinc-500">{fmt.bytes(file.size)}</p>
          </div>
          <button type="button" onClick={() => onChange(null)} aria-label={t('common.remove')} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700"><X className="size-4" /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          className={cx('flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition', drag ? 'border-brand-500 bg-brand-50' : 'border-line-strong hover:border-zinc-400 hover:bg-zinc-50')}
        >
          <UploadCloud className="size-6 text-zinc-400" strokeWidth={1.6} />
          <span className="text-sm font-medium text-zinc-700">{t('file.choose')}</span>
          <span className="text-xs text-zinc-500">{t('file.hint', { mb: config?.maxUploadMb ?? 25 })}</span>
        </button>
      )}
      {shownError && <p className="mt-1.5 text-xs font-medium text-rose-600" role="alert">{shownError}</p>}
    </div>
  );
}
