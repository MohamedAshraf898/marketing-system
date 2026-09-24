import { useState } from 'react';
import { ArrowLeft, LayoutTemplate, Pencil, Plus, SlidersHorizontal, Tag, Trash2, Workflow } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { Automation, CustomField, TagRow, TaskTemplate } from '@/api/types.tasks';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { Checkbox } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { AutomationEditor, CustomFieldEditor, TemplateEditor } from '@/components/tasks/TemplatesAndRules';

type Tab = 'templates' | 'automations' | 'fields' | 'tags';

/** Templates (tasks.templates), automation rules (tasks.automations), custom fields and tags (tasks.manage_spaces). */
export function TaskSettingsPage() {
  const { t, fmt, label } = useI18n();
  const { can } = useAuth();
  const tabs = ([
    { id: 'templates', label: t('tasks.templates'), show: can('tasks.templates') },
    { id: 'automations', label: t('tasks.automations'), show: can('tasks.automations') },
    { id: 'fields', label: t('tasks.customFields'), show: can('tasks.manage_spaces') },
    { id: 'tags', label: t('tasks.tags'), show: can('tasks.manage_spaces') },
  ] as Array<{ id: Tab; label: string; show: boolean }>).filter((x) => x.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'templates');
  const [editing, setEditing] = useState<{ kind: Tab; item?: unknown } | null>(null);
  const [deleting, setDeleting] = useState<{ path: string; name: string } | null>(null);
  const templates = useApi<{ items: TaskTemplate[] }>(tab === 'templates' ? '/task-templates' : null);
  const rules = useApi<{ items: Automation[] }>(tab === 'automations' ? '/task-automations' : null);
  const fields = useApi<{ items: CustomField[] }>(tab === 'fields' ? '/task-fields' : null);
  const tags = useApi<{ items: TagRow[] }>(tab === 'tags' ? '/task-tags' : null);
  const toggle = useAction((r: Automation) => api.patch(`/task-automations/${r.id}`, { enabled: !r.enabled }));
  const del = useAction((path: string) => api.del(path), { success: t('tasks.deleted'), onSuccess: () => setDeleting(null) });
  const recolor = useAction((v: { id: string; color: string }) => api.patch(`/task-tags/${v.id}`, { color: v.color }));

  const row = 'flex items-center gap-3 px-5 py-3.5';
  return (
    <div>
      <PageHeader back={<LinkButton to="/tasks" variant="ghost" size="sm" icon={<ArrowLeft className="size-4 rtl:rotate-180" />}>{t('nav.tasks')}</LinkButton>} title={t('tasks.settings')} subtitle={t('tasks.settingsSubtitle')}
        actions={tab !== 'tags' && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setEditing({ kind: tab })}>{tab === 'templates' ? t('tasks.newTemplate') : tab === 'automations' ? t('tasks.newRule') : t('tasks.newField')}</Button>} />
      <Tabs<Tab> value={tab} onChange={setTab} className="mb-5" tabs={tabs.map((x) => ({ id: x.id, label: x.label }))} />

      {tab === 'templates' && (templates.isLoading ? <SkeletonRows /> : !templates.data?.items.length ? <EmptyState icon={LayoutTemplate} title={t('tasks.noTemplates')} description={t('tasks.noTemplatesHint')} /> : (
        <Card className="divide-y divide-line">
          {templates.data.items.map((x) => (
            <div key={x.id} className={row}>
              <LayoutTemplate className="size-5 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1"><p className="font-medium text-zinc-900">{x.name}</p><p className="truncate text-xs text-zinc-500">{x.taskTitle} · {x.items.map((i) => i.title).join(', ')}</p></div>
              <Badge dot={false}>{t('tasks.nSubtasks', { n: fmt.number(x.items.length) })}</Badge>
              <IconButton label={t('common.edit')} className="size-8" onClick={() => setEditing({ kind: 'templates', item: x })}><Pencil className="size-4" /></IconButton>
              <IconButton label={t('common.delete')} className="size-8 hover:text-rose-600" onClick={() => setDeleting({ path: `/task-templates/${x.id}`, name: x.name })}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
        </Card>
      ))}

      {tab === 'automations' && (rules.isLoading ? <SkeletonRows /> : !rules.data?.items.length ? <EmptyState icon={Workflow} title={t('tasks.noRules')} description={t('tasks.noRulesHint')} /> : (
        <Card className="divide-y divide-line">
          {rules.data.items.map((r) => (
            <div key={r.id} className={row}>
              <Workflow className="size-5 shrink-0 text-violet-600" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-zinc-900">{r.name}</p>
                <p className="truncate text-xs text-zinc-500">{label('autoTrigger', r.trigger)}{r.triggerStatus ? ` → ${label('taskStatus', r.triggerStatus)}` : ''} · {label('autoAction', r.action)} · {t('tasks.ranTimes', { n: fmt.number(r.runCount) })}</p>
              </div>
              <Checkbox label={t('tasks.ruleEnabled')} checked={r.enabled} onChange={() => toggle.mutate(r)} />
              <IconButton label={t('common.edit')} className="size-8" onClick={() => setEditing({ kind: 'automations', item: r })}><Pencil className="size-4" /></IconButton>
              <IconButton label={t('common.delete')} className="size-8 hover:text-rose-600" onClick={() => setDeleting({ path: `/task-automations/${r.id}`, name: r.name })}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
        </Card>
      ))}

      {tab === 'fields' && (fields.isLoading ? <SkeletonRows /> : !fields.data?.items.length ? <EmptyState icon={SlidersHorizontal} title={t('tasks.noFields')} /> : (
        <Card className="divide-y divide-line">
          {fields.data.items.map((x) => (
            <div key={x.id} className={row}>
              <SlidersHorizontal className="size-5 shrink-0 text-zinc-500" />
              <div className="min-w-0 flex-1"><p className="font-medium text-zinc-900">{x.name}</p><p className="text-xs text-zinc-500">{label('fieldType', x.type)}{x.options.length ? ` · ${x.options.join(', ')}` : ''}{x.spaceId ? '' : ` · ${t('tasks.allSpaces')}`}</p></div>
              <IconButton label={t('common.edit')} className="size-8" onClick={() => setEditing({ kind: 'fields', item: x })}><Pencil className="size-4" /></IconButton>
              <IconButton label={t('common.delete')} className="size-8 hover:text-rose-600" onClick={() => setDeleting({ path: `/task-fields/${x.id}`, name: x.name })}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
        </Card>
      ))}

      {tab === 'tags' && (tags.isLoading ? <SkeletonRows /> : !tags.data?.items.length ? <EmptyState icon={Tag} title={t('tasks.noTags')} /> : (
        <Card className="divide-y divide-line">
          {tags.data.items.map((x) => (
            <div key={x.id} className={row}>
              <input type="color" value={x.color} onChange={(e) => recolor.mutate({ id: x.id, color: e.target.value })} className="h-8 w-9 rounded-lg border border-line" aria-label={t('tasks.color')} />
              <span className="flex-1 font-medium text-zinc-900">{x.name}</span>
              <span className="text-xs text-zinc-500">{t('tasks.usedOn', { n: fmt.number(x.count) })}</span>
              <IconButton label={t('common.delete')} className="size-8 hover:text-rose-600" onClick={() => setDeleting({ path: `/task-tags/${x.id}`, name: x.name })}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
        </Card>
      ))}

      {editing?.kind === 'templates' && <TemplateEditor template={editing.item as TaskTemplate | undefined} onClose={() => setEditing(null)} />}
      {editing?.kind === 'automations' && <AutomationEditor rule={editing.item as Automation | undefined} onClose={() => setEditing(null)} />}
      {editing?.kind === 'fields' && <CustomFieldEditor field={editing.item as CustomField | undefined} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.path)} loading={del.isPending} title={t('tasks.deleteNodeTitle', { name: deleting?.name ?? '' })} message={t('tasks.deleteSettingMessage')} confirmLabel={t('common.delete')} />
    </div>
  );
}
