import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';

const base =
  'w-full rounded-xl border bg-white px-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 shadow-sm transition ' +
  'focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-zinc-50 disabled:text-zinc-500';

export function Field({ label, error, hint, required, children, className }: { label?: ReactNode; error?: string; hint?: ReactNode; required?: boolean; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-[13px] font-medium text-zinc-700">
          {label}
          {required && <span className="ms-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children(id)}
      {error ? <p className="text-xs font-medium text-rose-600" role="alert">{error}</p> : hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx(base, 'h-10', invalid ? 'border-rose-400' : 'border-line-strong', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} rows={4} className={cx(base, 'resize-y py-2.5 leading-relaxed', invalid ? 'border-rose-400' : 'border-line-strong', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cx(base, 'h-10 appearance-none pe-9', invalid ? 'border-rose-400' : 'border-line-strong', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
    </div>
  );
});

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2.5 text-sm text-zinc-700', className)}>
      <input type="checkbox" className="size-4 rounded border-line-strong accent-[var(--color-brand-600)]" {...rest} />
      {label}
    </label>
  );
}
