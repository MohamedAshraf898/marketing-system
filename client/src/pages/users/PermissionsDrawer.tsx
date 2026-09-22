import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { AdminUserRow, PermissionCatalog } from '@/api/types.admin';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Modal';

/** Permissions that expose money, people-cost data or destructive actions: the editor flags them. */
export const isSensitivePermission = (p: string) => /^(invoices|contracts)\./.test(p) || p === 'time.view_all' || p.endsWith('.delete');

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function GroupCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: (v: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-500">
      <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-line-strong accent-[var(--color-brand-600)]" />
      {label}
    </label>
  );
}

/** ADMIN only. Edits the permission list of one TEAM member (the API re-validates everything). */
export function PermissionsDrawer({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const { t, label } = useI18n();
  const cat = useApi<PermissionCatalog>('/permissions/catalog');
  const initial = useMemo(() => new Set(user.permissions ?? []), [user.permissions]);
  const [sel, setSel] = useState<Set<string>>(initial);
  const [discard, setDiscard] = useState(false);
  const adminOnly = useMemo(() => new Set(cat.data?.adminOnly ?? []), [cat.data]);
  const defaults = useMemo(() => new Set(cat.data?.defaults ?? []), [cat.data]);
  const dirty = !sameSet(sel, initial);
  const total = cat.data ? cat.data.groups.reduce((n, g) => n + g.permissions.filter((p) => !adminOnly.has(p)).length, 0) : 0;

  const save = useAction(
    () => api.put(`/users/${user.id}/permissions`, { permissions: sameSet(sel, defaults) ? null : [...sel] }),
    { success: t('admin.perms.saved'), onSuccess: onClose },
  );

  const toggle = (p: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(p); else n.delete(p); return n; });
  const setGroup = (perms: string[], on: boolean) => setSel((s) => { const n = new Set(s); for (const p of perms) { if (on) n.add(p); else n.delete(p); } return n; });
  const requestClose = () => (dirty ? setDiscard(true) : onClose());
  const sensitiveOn = [...sel].filter(isSensitivePermission);

  return (
    <Drawer
      open
      onClose={requestClose}
      width="lg"
      title={t('admin.perms.title')}
      subtitle={`${user.name} · ${user.email}`}
      footer={
        <>
          <span className="me-auto flex items-center gap-2 self-center text-xs text-zinc-500" aria-live="polite">
            {dirty ? <Badge tone="amber">{t('admin.perms.unsaved')}</Badge> : <span>{t('admin.perms.count', { n: sel.size, total })}</span>}
          </span>
          <Button variant="secondary" onClick={requestClose} className="max-sm:h-11">{t('common.cancel')}</Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!dirty || !cat.data} className="max-sm:h-11">{t('common.saveChanges')}</Button>
        </>
      }
    >
      {cat.isError ? <ErrorState onRetry={() => void cat.refetch()} /> : !cat.data ? (
        <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-4 py-3">
            <div className="text-[13px] text-zinc-600">
              <p>{t('admin.perms.intro')}</p>
              <p className="mt-1 text-xs text-zinc-500">{user.permissionsCustom ? t('admin.perms.custom') : t('admin.perms.usingDefaults')}</p>
            </div>
            <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => setSel(new Set(defaults))} disabled={sameSet(sel, defaults)}>{t('admin.perms.useDefaults')}</Button>
          </div>

          {sensitiveOn.length > 0 && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />{t('admin.perms.sensitiveNote')}
            </div>
          )}

          {cat.data.groups.map((g) => {
            const grantable = g.permissions.filter((p) => !adminOnly.has(p));
            const on = grantable.filter((p) => sel.has(p)).length;
            return (
              <fieldset key={g.id} className="rounded-2xl border border-line">
                <legend className="sr-only">{label('admin.permGroup', g.id)}</legend>
                <div className="flex items-center justify-between gap-3 border-b border-line bg-zinc-50/60 px-4 py-2.5">
                  <h3 className="text-[13px] font-semibold text-zinc-800">{label('admin.permGroup', g.id)} <span className="ms-1 font-normal text-zinc-400 tabular">{on}/{grantable.length}</span></h3>
                  {grantable.length > 0 && (
                    <GroupCheckbox label={t('admin.perms.selectAll')} checked={on === grantable.length} indeterminate={on > 0 && on < grantable.length} onChange={(v) => setGroup(grantable, v)} />
                  )}
                </div>
                <ul className="divide-y divide-line">
                  {g.permissions.map((p) => {
                    const locked = adminOnly.has(p);
                    return (
                      <li key={p}>
                        <label className={`flex items-center gap-3 px-4 py-2.5 text-sm ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-zinc-50'}`}>
                          <input type="checkbox" disabled={locked} checked={!locked && sel.has(p)} onChange={(e) => toggle(p, e.target.checked)} className="size-4 shrink-0 rounded border-line-strong accent-[var(--color-brand-600)]" />
                          <span className="min-w-0 flex-1 text-zinc-800">{label('admin.perm', p)}</span>
                          {locked && <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Lock className="size-3" />{t('admin.perms.adminOnly')}</span>}
                          {!locked && isSensitivePermission(p) && <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-amber-700"><ShieldAlert className="size-3.5" />{t('admin.perms.sensitive')}</span>}
                          {!locked && defaults.has(p) && <span className="hidden text-[11px] text-zinc-400 sm:inline">{t('admin.perms.default')}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={discard} onClose={() => setDiscard(false)} onConfirm={onClose} tone="primary" title={t('admin.perms.discardTitle')} message={t('admin.perms.discardMessage')} confirmLabel={t('admin.perms.discard')} />
    </Drawer>
  );
}
