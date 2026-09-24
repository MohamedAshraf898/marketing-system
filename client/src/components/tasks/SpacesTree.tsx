import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, Layers, ListPlus, List as ListIcon, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { TASK_STATUSES } from '@shared/enums';
import { api } from '@/api/client';
import { useAction } from '@/api/hooks';
import type { FolderNode, ListNode, SpaceNode, SpaceTree, StatusOption } from '@/api/types.tasks';
import { useI18n } from '@/i18n';
import { fieldErrors, fieldText } from '@/i18n/errors';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useOutsideClose } from '@/components/ui/Popover';
import { cx } from '@/components/ui/cx';
import { useClientOptions, useProjectOptions } from '@/components/shared/options';

export type Location = { kind: 'all' } | { kind: 'space'; id: string } | { kind: 'folder'; id: string } | { kind: 'list'; id: string };

export function locationName(tree: SpaceTree | undefined, loc: Location): { name: string; space?: SpaceNode; list?: ListNode } {
  if (!tree || loc.kind === 'all') return { name: '' };
  for (const s of tree.items) {
    if (loc.kind === 'space' && s.id === loc.id) return { name: s.name, space: s };
    for (const f of s.folders) {
      if (loc.kind === 'folder' && f.id === loc.id) return { name: `${s.name} / ${f.name}`, space: s };
      for (const l of f.lists) if (loc.kind === 'list' && l.id === loc.id) return { name: `${s.name} / ${f.name} / ${l.name}`, space: s, list: l };
    }
    for (const l of s.lists) if (loc.kind === 'list' && l.id === loc.id) return { name: `${s.name} / ${l.name}`, space: s, list: l };
  }
  return { name: '' };
}

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#71717a'];

type Dialog =
  | { kind: 'space'; space?: SpaceNode }
  | { kind: 'folder'; spaceId: string; spaceClientId: string | null; folder?: FolderNode }
  | { kind: 'list'; spaceId: string; spaceClientId: string | null; folderId?: string; list?: ListNode }
  | { kind: 'statuses'; space: SpaceNode }
  | { kind: 'delete'; what: 'space' | 'folder' | 'list'; id: string; name: string };

function Menu({ items }: { items: Array<{ label: string; icon: typeof Plus; onClick: () => void; danger?: boolean }> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-label={t('common.actions')} className="rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 focus:opacity-100"><MoreHorizontal className="size-4" /></button>
      {open && (
        <ul className="og-pop absolute end-0 top-full z-50 mt-1 w-48 rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
          {items.map((i) => <li key={i.label}><button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); i.onClick(); }} className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50', i.danger ? 'text-rose-600' : 'text-zinc-700')}><i.icon className="size-4" />{i.label}</button></li>)}
        </ul>
      )}
    </div>
  );
}

/** Space -> Folder -> List navigator. Managers get create / rename / delete / statuses menus (the API re-checks every action). */
export function SpacesTree({ tree, value, onChange }: { tree?: SpaceTree; value: Location; onChange: (l: Location) => void }) {
  const { t, fmt } = useI18n();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const active = (k: Location['kind'], id?: string) => value.kind === k && (k === 'all' || (value as { id: string }).id === id);
  const row = 'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-start text-[13px] transition';
  const listRow = (l: ListNode, s: SpaceNode, indent: string) => (
    <div key={l.id} role="button" tabIndex={0} onClick={() => onChange({ kind: 'list', id: l.id })} onKeyDown={(e) => e.key === 'Enter' && onChange({ kind: 'list', id: l.id })} className={cx(row, indent, active('list', l.id) ? 'bg-brand-50 font-medium text-brand-800' : 'text-zinc-600 hover:bg-zinc-100')}>
      <ListIcon className="size-3.5 shrink-0" style={{ color: l.color ?? undefined }} />
      <span className="min-w-0 flex-1 truncate">{l.name}</span>
      {l.openTasks > 0 && <span className="text-[11px] text-zinc-400 tabular">{fmt.number(l.openTasks)}</span>}
      {s.canManage && <Menu items={[{ label: t('common.edit'), icon: Pencil, onClick: () => setDialog({ kind: 'list', spaceId: s.id, spaceClientId: s.clientId, list: l }) }, { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDialog({ kind: 'delete', what: 'list', id: l.id, name: l.name }) }]} />}
    </div>
  );

  return (
    <nav aria-label={t('tasks.spaces')} className="space-y-0.5">
      <button type="button" onClick={() => onChange({ kind: 'all' })} className={cx(row, active('all') ? 'bg-brand-50 font-medium text-brand-800' : 'text-zinc-700 hover:bg-zinc-100')}><Layers className="size-4" />{t('tasks.allTasks')}</button>
      <div className="flex items-center justify-between px-2 pb-1 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t('tasks.spaces')}</p>
        {tree?.canCreate && <IconButton label={t('tasks.newSpace')} className="size-6" onClick={() => setDialog({ kind: 'space' })}><Plus className="size-3.5" /></IconButton>}
      </div>
      {(tree?.items ?? []).map((s) => (
        <div key={s.id}>
          <div role="button" tabIndex={0} onClick={() => onChange({ kind: 'space', id: s.id })} onKeyDown={(e) => e.key === 'Enter' && onChange({ kind: 'space', id: s.id })} className={cx(row, active('space', s.id) ? 'bg-brand-50 font-medium text-brand-800' : 'text-zinc-800 hover:bg-zinc-100')}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] })); }} className="rounded p-0.5 text-zinc-400 hover:text-zinc-700" aria-label={t('tasks.toggle')}>{collapsed[s.id] ? <ChevronRight className="size-3.5 rtl:rotate-180" /> : <ChevronDown className="size-3.5" />}</button>
            <span className="size-2.5 shrink-0 rounded" style={{ backgroundColor: s.color }} />
            <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
            {s.canManage && <Menu items={[
              { label: t('tasks.newFolder'), icon: FolderPlus, onClick: () => setDialog({ kind: 'folder', spaceId: s.id, spaceClientId: s.clientId }) },
              { label: t('tasks.newList'), icon: ListPlus, onClick: () => setDialog({ kind: 'list', spaceId: s.id, spaceClientId: s.clientId }) },
              { label: t('tasks.statuses'), icon: Settings2, onClick: () => setDialog({ kind: 'statuses', space: s }) },
              { label: t('common.edit'), icon: Pencil, onClick: () => setDialog({ kind: 'space', space: s }) },
              { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDialog({ kind: 'delete', what: 'space', id: s.id, name: s.name }) },
            ]} />}
          </div>
          {!collapsed[s.id] && (
            <div className="space-y-0.5">
              {s.folders.map((f) => (
                <div key={f.id}>
                  <div role="button" tabIndex={0} onClick={() => onChange({ kind: 'folder', id: f.id })} onKeyDown={(e) => e.key === 'Enter' && onChange({ kind: 'folder', id: f.id })} className={cx(row, 'ps-7', active('folder', f.id) ? 'bg-brand-50 font-medium text-brand-800' : 'text-zinc-700 hover:bg-zinc-100')}>
                    <Folder className="size-3.5 shrink-0 text-zinc-400" /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {s.canManage && <Menu items={[
                      { label: t('tasks.newList'), icon: ListPlus, onClick: () => setDialog({ kind: 'list', spaceId: s.id, spaceClientId: s.clientId, folderId: f.id }) },
                      { label: t('common.edit'), icon: Pencil, onClick: () => setDialog({ kind: 'folder', spaceId: s.id, spaceClientId: s.clientId, folder: f }) },
                      { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDialog({ kind: 'delete', what: 'folder', id: f.id, name: f.name }) },
                    ]} />}
                  </div>
                  {f.lists.map((l) => listRow(l, s, 'ps-12'))}
                </div>
              ))}
              {s.lists.map((l) => listRow(l, s, 'ps-7'))}
              {s.folders.length === 0 && s.lists.length === 0 && <p className="ps-8 text-xs text-zinc-400">{t('tasks.emptySpace')}</p>}
            </div>
          )}
        </div>
      ))}
      {tree && tree.items.length === 0 && <p className="px-2 text-xs text-zinc-400">{tree.canCreate ? t('tasks.noSpacesManager') : t('tasks.noSpaces')}</p>}

      {dialog?.kind === 'space' && <SpaceModal space={dialog.space} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'folder' && <FolderModal d={dialog} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'list' && <ListModal d={dialog} tree={tree} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'statuses' && <StatusesModal space={dialog.space} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteNode d={dialog} onClose={() => setDialog(null)} onDeleted={() => onChange({ kind: 'all' })} />}
    </nav>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return <div className="flex flex-wrap gap-1.5">{COLORS.map((c) => <button key={c} type="button" onClick={() => onChange(c)} className={cx('size-7 rounded-lg ring-offset-2', value === c && 'ring-2 ring-zinc-900')} style={{ backgroundColor: c }} aria-label={c} />)}</div>;
}

function SpaceModal({ space, onClose }: { space?: SpaceNode; onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: space?.name ?? '', color: space?.color ?? COLORS[0], clientId: space?.clientId ?? '' });
  const { clients } = useClientOptions();
  const save = useAction(() => (space ? api.patch(`/spaces/${space.id}`, { name: f.name, color: f.color, clientId: f.clientId || null }) : api.post('/spaces', { name: f.name, color: f.color, clientId: f.clientId || null })), { success: t('tasks.saved'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  return (
    <Modal open onClose={onClose} size="sm" title={space ? t('tasks.editSpace') : t('tasks.newSpace')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('common.name')} required error={fieldText(t, errs.name)}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} maxLength={80} />}</Field>
        <Field label={t('common.client')} hint={t('tasks.spaceClientHint')} error={fieldText(t, errs.clientId)}>{(id) => <Select id={id} value={f.clientId} onChange={(e) => setF((s) => ({ ...s, clientId: e.target.value }))}><option value="">{t('tasks.internalSpace')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select>}</Field>
        <Field label={t('tasks.color')}>{() => <ColorPicker value={f.color} onChange={(c) => setF((s) => ({ ...s, color: c }))} />}</Field>
      </div>
    </Modal>
  );
}

function FolderModal({ d, onClose }: { d: Extract<Dialog, { kind: 'folder' }>; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(d.folder?.name ?? '');
  const [projectId, setProjectId] = useState(d.folder?.projectId ?? '');
  const { projects } = useProjectOptions(d.spaceClientId ?? undefined);
  const save = useAction(() => (d.folder ? api.patch(`/spaces/folders/${d.folder.id}`, { name, projectId: projectId || null }) : api.post(`/spaces/${d.spaceId}/folders`, { name, projectId: projectId || null })), { success: t('tasks.saved'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  return (
    <Modal open onClose={onClose} size="sm" title={d.folder ? t('tasks.editFolder') : t('tasks.newFolder')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('common.name')} required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
        <Field label={t('common.project')} hint={t('tasks.folderProjectHint')} error={fieldText(t, errs.projectId)}>{(id) => <Select id={id} value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
      </div>
    </Modal>
  );
}

function ListModal({ d, tree, onClose }: { d: Extract<Dialog, { kind: 'list' }>; tree?: SpaceTree; onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: d.list?.name ?? '', color: d.list?.color ?? COLORS[1], folderId: d.list?.folderId ?? d.folderId ?? '', projectId: d.list?.projectId ?? '' });
  const { projects } = useProjectOptions(d.spaceClientId ?? undefined);
  const folders = tree?.items.find((s) => s.id === d.spaceId)?.folders ?? [];
  const body = { name: f.name, color: f.color, folderId: f.folderId || null, projectId: f.projectId || null };
  const save = useAction(() => (d.list ? api.patch(`/spaces/lists/${d.list.id}`, body) : api.post(`/spaces/${d.spaceId}/lists`, body)), { success: t('tasks.saved'), onSuccess: onClose });
  const errs = fieldErrors(save.error);
  return (
    <Modal open onClose={onClose} size="sm" title={d.list ? t('tasks.editList') : t('tasks.newList')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('common.name')} required>{(id) => <Input id={id} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} maxLength={80} />}</Field>
        <Field label={t('tasks.folder')}>{(id) => <Select id={id} value={f.folderId} onChange={(e) => setF((s) => ({ ...s, folderId: e.target.value }))}><option value="">{t('tasks.noFolder')}</option>{folders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label={t('common.project')} hint={t('tasks.listProjectHint')} error={fieldText(t, errs.projectId)}>{(id) => <Select id={id} value={f.projectId} onChange={(e) => setF((s) => ({ ...s, projectId: e.target.value }))}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
        <Field label={t('tasks.color')}>{() => <ColorPicker value={f.color} onChange={(c) => setF((s) => ({ ...s, color: c }))} />}</Field>
      </div>
    </Modal>
  );
}

function StatusesModal({ space, onClose }: { space: SpaceNode; onClose: () => void }) {
  const { t, label } = useI18n();
  const [rows, setRows] = useState<Array<Partial<StatusOption> & { name: string; color: string; category: StatusOption['category'] }>>(space.statuses.length ? space.statuses : []);
  const save = useAction(() => api.put(`/spaces/${space.id}/statuses`, { statuses: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, color: r.color, category: r.category })) }), { success: t('tasks.saved'), onSuccess: onClose });
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => setRows((rs) => { const n = [...rs]; const j = i + d; if (j < 0 || j >= n.length) return rs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <Modal open onClose={onClose} size="lg" title={t('tasks.statusesOf', { name: space.name })} description={t('tasks.statusesHint')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={rows.some((r) => !r.name.trim())} onClick={() => save.mutate(undefined)}>{t('common.save')}</Button></>}>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id ?? `new${i}`} className="flex flex-wrap items-center gap-2">
            <input type="color" value={r.color} onChange={(e) => set(i, { color: e.target.value })} className="h-9 w-10 rounded-lg border border-line" aria-label={t('tasks.color')} />
            <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={40} className="min-w-40 flex-1" />
            <Select value={r.category} onChange={(e) => set(i, { category: e.target.value as StatusOption['category'] })} className="w-40" aria-label={t('tasks.behavesAs')}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{label('taskStatus', s)}</option>)}</Select>
            <IconButton label={t('tasks.moveUp')} className="size-9" onClick={() => move(i, -1)}><ChevronDown className="size-4 rotate-180" /></IconButton>
            <IconButton label={t('tasks.moveDown')} className="size-9" onClick={() => move(i, 1)}><ChevronDown className="size-4" /></IconButton>
            <IconButton label={t('common.delete')} className="size-9 hover:text-rose-600" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-zinc-500">{t('tasks.usingDefaultStatuses')}</p>}
      <Button variant="secondary" size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, { name: '', color: '#71717a', category: 'TODO' }])}>{t('tasks.addStatus')}</Button>
    </Modal>
  );
}

function DeleteNode({ d, onClose, onDeleted }: { d: Extract<Dialog, { kind: 'delete' }>; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const path = d.what === 'space' ? `/spaces/${d.id}` : d.what === 'folder' ? `/spaces/folders/${d.id}` : `/spaces/lists/${d.id}`;
  const del = useAction(() => api.del(path), { success: t('tasks.deleted'), onSuccess: () => { onClose(); onDeleted(); } });
  return <ConfirmDialog open onClose={onClose} onConfirm={() => del.mutate(undefined)} loading={del.isPending} title={t('tasks.deleteNodeTitle', { name: d.name })} message={t('tasks.deleteNodeMessage')} confirmLabel={t('common.delete')} />;
}
