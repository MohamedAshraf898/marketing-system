import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

interface ToastItem { id: number; kind: 'success' | 'error'; text: string }
interface ToastApi { success: (text: string) => void; error: (text: string) => void }

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((i) => i.id !== id)), []);
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = ++idRef.current;
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    window.setTimeout(() => dismiss(id), kind === 'error' ? 6500 : 3800);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({ success: (t) => push('success', t), error: (t) => push('error', t) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {items.map((i) => (
          <div
            key={i.id}
            role={i.kind === 'error' ? 'alert' : 'status'}
            className="og-pop pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm shadow-[var(--shadow-pop)]"
          >
            {i.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
            )}
            <p className="flex-1 leading-snug text-zinc-800">{i.text}</p>
            <button onClick={() => dismiss(i.id)} className="-m-1 rounded-md p-1 text-zinc-400 hover:text-zinc-700" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
