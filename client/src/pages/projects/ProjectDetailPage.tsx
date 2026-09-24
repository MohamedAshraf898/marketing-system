import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Download, ListChecks, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { PROJECT_STATUSES } from '@shared/enums';
import { api, fileUrl } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { FileRow, Paged } from '@/api/types';
import type { Milestone, Project } from '@/api/types.work';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/Progress';
import { StatCard } from '@/components/ui/StatCard';
import { Tabs } from '@/components/ui/Tabs';
import { StatusBadge } from '@/components/ui/Badge';
import { FileTypeIcon } from '@/components/shared/Media';
import { DeliverablesPanel } from '@/components/panels/DeliverablesPanel';
import { ProjectFormModal } from '@/components/forms/ProjectFormModal';
import { UploadFileModal } from '@/components/forms/UploadFileModal';
import { TasksPanel } from '@/components/panels/TasksPanel';
import { ActivityFeed } from '@/components/panels/ActivityFeed';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { TaskTimeline } from '@/components/tasks/TaskViews';
import { Avatar } from '@/components/ui/Avatar';
import type { SharedTasksResponse } from '@/api/types.tasks';
import type { Task } from '@/api/types.work';

type Tab = 'overview' | 'tasks' | 'timeline' | 'team' | 'milestones' | 'campaigns' | 'deliverables' | 'files' | 'activity';
const TABS: Tab[] = ['overview', 'tasks', 'timeline', 'team', 'milestones', 'campaigns', 'deliverables', 'files', 'activity'];
type ModalKind = 'edit' | 'delete' | null;

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900">{children || '—'}</dd>
    </div>
  );
}

function MilestonesTab({ project }: { project: Project }) {
  const { t, fmt } = useI18n();
  const id = project.id;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', dueDate: '' });
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [toDelete, setToDelete] = useState<Milestone | null>(null);

  const toggle = useAction((m: Milestone) => api.post(`/projects/${id}/milestones/${m.id}/${m.completedAt ? 'uncomplete' : 'complete'}`, {}));
  const save = useAction(() => api.patch(`/projects/${id}/milestones/${editingId}`, { title: draft.title, description: draft.description || null, dueDate: draft.dueDate || null }), { success: t('work.milestone.updated'), onSuccess: () => setEditingId(null) });
  const create = useAction(() => api.post(`/projects/${id}/milestones`, { title: newTitle.trim(), dueDate: newDue || null }), { success: t('work.milestone.created'), onSuccess: () => { setNewTitle(''); setNewDue(''); setAdding(false); } });
  const remove = useAction(() => api.del(`/projects/${id}/milestones/${toDelete?.id}`), { success: t('work.milestone.deleted'), onSuccess: () => setToDelete(null) });

  const startEdit = (m: Milestone) => { setEditingId(m.id); setDraft({ title: m.title, description: m.description ?? '', dueDate: m.dueDate?.slice(0, 10) ?? '' }); };
  const milestones = project.milestones ?? [];

  return (
    <Card>
      <CardHeader title={t('work.milestone.title')} action={project.permissions?.canEdit && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding((v) => !v)}>{t('work.milestone.new')}</Button>} />
      <CardBody>
        {adding && (
          <form onSubmit={(e) => { e.preventDefault(); if (newTitle.trim()) create.mutate(undefined); }} className="mb-4 flex flex-col gap-2 rounded-xl border border-line-strong bg-zinc-50 p-3 sm:flex-row sm:items-end">
            <div className="flex-1"><Field label={t('work.milestone.name')}>{(fid) => <Input id={fid} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={160} />}</Field></div>
            <div className="sm:w-44"><Field label={t('common.dueDate')} hint={t('common.optional')}>{(fid) => <Input id={fid} type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} />}</Field></div>
            <Button type="submit" loading={create.isPending} disabled={!newTitle.trim()}>{t('work.milestone.save')}</Button>
          </form>
        )}
        {milestones.length === 0 ? (
          <EmptyState compact icon={ListChecks} title={t('work.milestone.empty')} description={t('work.milestone.emptyHint')} />
        ) : (
          <ul className="divide-y divide-line">
            {milestones.map((m) => (
              <li key={m.id} className="py-3.5 first:pt-0 last:pb-0">
                {editingId === m.id ? (
                  <div className="space-y-2.5 rounded-xl border border-line-strong bg-zinc-50 p-3">
                    <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={160} />
                    <Textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={2} placeholder={t('common.description')} />
                    <Input type="date" value={draft.dueDate} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} className="sm:w-44" />
                    <div className="flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>{t('common.cancel')}</Button><Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>{t('common.saveChanges')}</Button></div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => project.permissions?.canEdit && toggle.mutate(m)} disabled={!project.permissions?.canEdit} className="mt-0.5 shrink-0 text-zinc-400 hover:text-emerald-600 disabled:cursor-default">
                      {m.completedAt ? <CheckCircle2 className="size-5 text-emerald-600" /> : <Circle className="size-5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={m.completedAt ? 'text-sm font-medium text-zinc-400 line-through' : 'text-sm font-medium text-zinc-900'}>{m.title}</p>
                      {m.description && <p className="mt-0.5 text-xs text-zinc-500">{m.description}</p>}
                      {m.dueDate && <p className="mt-1 text-xs text-zinc-400">{fmt.date(m.dueDate)}</p>}
                    </div>
                    {project.permissions?.canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <IconButton label={t('common.edit')} className="size-8" onClick={() => startEdit(m)}><Pencil className="size-4" /></IconButton>
                        <IconButton label={t('common.delete')} className="size-8 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(m)}><Trash2 className="size-4" /></IconButton>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} title={t('work.milestone.deleteTitle')} message={t('work.milestone.deleteMessage', { title: toDelete?.title ?? '' })} confirmLabel={t('common.delete')} />
    </Card>
  );
}

function FilesTab({ project }: { project: Project }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [uploading, setUploading] = useState(false);
  const list = useApi<Paged<FileRow>>(`/projects/${project.id}/files`, { pageSize: 50 });
  const del = useAction((fid: string) => api.del(`/files/${fid}`), { success: t('file.deleted') });
  const canDelete = (f: FileRow) => !!user && (user.role === 'ADMIN' || (user.role === 'TEAM' && f.uploadedBy.id === user.id));
  return (
    <Card>
      <CardHeader title={t('work.project.tabFiles')} action={staff && <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={() => setUploading(true)}>{t('file.upload')}</Button>} />
      <CardBody>
        {list.isLoading ? <SkeletonRows rows={3} /> : !list.data?.items.length ? (
          <EmptyState compact icon={Upload} title={t('file.empty')} description={t('file.emptyHint')} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.items.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <FileTypeIcon mime={f.fileType} className="shrink-0 text-zinc-500" />
                <a href={fileUrl(f.id)} className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 hover:text-brand-700">{f.fileName}</a>
                <span className="shrink-0 text-xs text-zinc-400 tabular">{fmt.bytes(f.size)}</span>
                <a href={fileUrl(f.id)} aria-label={t('file.download')} className="shrink-0 rounded p-1.5 text-zinc-400 hover:text-zinc-700"><Download className="size-4" /></a>
                {canDelete(f) && <IconButton label={t('common.delete')} className="size-8 shrink-0 hover:bg-rose-50 hover:text-rose-600" onClick={() => del.mutate(f.id)}><Trash2 className="size-4" /></IconButton>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {uploading && <UploadFileModal open onClose={() => setUploading(false)} target={{ projectId: project.id }} title={t('file.upload')} />}
    </Card>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt, label } = useI18n();
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<ModalKind>(null);
  const q = useApi<{ item: Project }>(`/projects/${id}`);
  const staff = user?.role !== 'CLIENT';
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview';
  const close = () => setModal(null);

  const setStatus = useAction((status: string) => api.patch(`/projects/${id}`, { status }), { success: t('work.project.updated') });
  const remove = useAction(() => api.del(`/projects/${id}`), { success: t('work.project.deleted'), onSuccess: () => nav('/projects', { replace: true }) });

  const back = <Link to="/projects" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"><ArrowLeft className="size-4 rtl:rotate-180" />{t('nav.projects')}</Link>;
  if (q.isError) return <div><div className="mb-4">{back}</div><ErrorState onRetry={() => void q.refetch()} message={t('common.notFoundHint')} /></div>;
  const p = q.data?.item;
  if (!p) return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-72 w-full" /></div>;

  const canEdit = can('projects.edit') && !!p.permissions?.canEdit;
  const canDelete = can('projects.delete') && !!p.permissions?.canDelete;

  return (
    <div>
      <div className="mb-3">{back}</div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 sm:text-2xl">{p.name}</h1>
            <StatusBadge group="projectStatus" value={p.status} />
            <StatusBadge group="priority" value={p.priority} />
          </div>
          <p className="mt-1.5 text-sm text-zinc-500">
            {staff && <Link to={`/clients/${p.client.id}`} className="font-medium text-zinc-700 hover:text-brand-700">{p.client.companyName}</Link>}
            {staff && p.projectManager && <> · {p.projectManager.name}</>}
          </p>
        </div>
        {staff && (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <div className="w-full sm:w-52">
                <Select aria-label={t('common.status')} value={p.status} onChange={(e) => setStatus.mutate(e.target.value)} disabled={setStatus.isPending}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{label('projectStatus', s)}</option>)}
                </Select>
              </div>
            )}
            {canEdit && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setModal('edit')}>{t('common.edit')}</Button>}
            {canDelete && <Button variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="size-4" />} onClick={() => setModal('delete')}>{t('common.delete')}</Button>}
          </div>
        )}
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}
        className="mb-6"
        tabs={[
          { id: 'overview', label: t('work.project.tabOverview') },
          { id: 'tasks' as Tab, label: t('work.project.tabTasks'), count: staff ? p.taskCounts?.total : undefined },
          ...(staff ? [{ id: 'timeline' as Tab, label: t('tasks.timeline') }, { id: 'team' as Tab, label: t('work.project.tabTeam') }] : []),
          { id: 'milestones', label: t('work.project.tabMilestones'), count: p.milestoneCounts.total },
          { id: 'campaigns', label: t('work.project.tabCampaigns'), count: p.counts?.campaigns ?? p.campaigns?.length },
          { id: 'deliverables', label: t('work.project.tabDeliverables'), count: p.counts?.deliverables },
          { id: 'files', label: t('work.project.tabFiles'), count: p.counts?.files },
          { id: 'activity', label: t('work.project.tabActivity') },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('work.project.progress')} value={`${fmt.number(p.progress)}%`} icon={ListChecks} tone="brand" />
            {staff && p.taskCounts && <StatCard label={t('work.project.tabTasks')} value={`${fmt.number(p.taskCounts.done)}/${fmt.number(p.taskCounts.total)}`} icon={CheckCircle2} tone="emerald" hint={p.taskCounts.overdue > 0 ? t('common.overdue') : undefined} />}
            <StatCard label={t('work.milestone.title')} value={`${fmt.number(p.milestoneCounts.done)}/${fmt.number(p.milestoneCounts.total)}`} icon={Circle} tone="sky" />
            <StatCard label={t('work.project.nextMilestone')} value={p.nextMilestone ? p.nextMilestone.title : t('work.project.noNextMilestone')} icon={ListChecks} tone="zinc" hint={p.nextMilestone?.dueDate ? fmt.date(p.nextMilestone.dueDate) : undefined} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title={t('work.project.details')} />
              <CardBody>
                <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <Info label={t('common.startDate')}>{p.startDate ? fmt.date(p.startDate) : null}</Info>
                  <Info label={t('common.dueDate')}>{p.dueDate ? fmt.date(p.dueDate) : null}</Info>
                  {staff && <Info label={t('work.project.manager')}>{p.projectManager?.name}</Info>}
                  {staff && p.budget != null && <Info label={t('work.project.budget')}>{fmt.money(p.budget)}</Info>}
                </dl>
                {p.description && <p className="mt-6 whitespace-pre-line border-t border-line pt-5 text-sm leading-relaxed text-zinc-600">{p.description}</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('work.project.progress')} />
              <CardBody>
                <p className="text-2xl font-semibold tracking-tight text-zinc-900 tabular">{fmt.number(p.progress)}%</p>
                <div className="mt-4"><ProgressBar value={p.progress} tone="auto" /></div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === 'tasks' && staff && <TasksPanel projectId={id} />}
      {tab === 'tasks' && !staff && <SharedProjectTasks projectId={id} />}
      {tab === 'timeline' && staff && <ProjectTimeline projectId={id} />}
      {tab === 'team' && staff && <ProjectTeam projectId={id} manager={p.projectManager} />}
      {tab === 'activity' && <ActivityFeed projectId={id} />}
      {tab === 'milestones' && <MilestonesTab project={p} />}
      {tab === 'campaigns' && (
        <Card>
          <CardBody>
            {!p.campaigns?.length ? <EmptyState compact icon={ListChecks} title={t('work.project.campaignsEmpty')} /> : (
              <ul className="divide-y divide-line">
                {p.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <Link to={`/campaigns/${c.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 hover:text-brand-700">{c.name}</Link>
                    <StatusBadge group="campaignStatus" value={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
      {tab === 'deliverables' && <DeliverablesPanel projectId={id} />}
      {tab === 'files' && <FilesTab project={p} />}

      {modal === 'edit' && <ProjectFormModal open onClose={close} project={p} />}
      <ConfirmDialog open={modal === 'delete'} onClose={close} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} title={t('work.project.deleteTitle')} message={t('work.project.deleteMessage', { name: p.name })} confirmLabel={t('common.delete')} />
    </div>
  );
}

function ProjectTimeline({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <TaskTimeline filters={{ projectId }} onOpen={setOpen} />
      <TaskDrawer taskId={open} open={!!open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Who works on the project: the manager + everybody assigned to its tasks, with their open / overdue counts. */
function ProjectTeam({ projectId, manager }: { projectId: string; manager: Project['projectManager'] }) {
  const { t, fmt } = useI18n();
  const q = useApi<Paged<Task>>('/tasks', { projectId, pageSize: 100, archived: undefined });
  const people = new Map<string, { id: string; name: string; open: number; overdue: number; done: number }>();
  for (const task of q.data?.items ?? []) {
    for (const a of task.assignees) {
      const p = people.get(a.id) ?? { id: a.id, name: a.name, open: 0, overdue: 0, done: 0 };
      if (task.status === 'DONE') p.done++; else p.open++;
      if (task.overdue) p.overdue++;
      people.set(a.id, p);
    }
  }
  const rows = [...people.values()].sort((a, b) => b.open - a.open);
  return (
    <Card>
      <CardHeader title={t('work.project.tabTeam')} subtitle={manager ? t('work.project.managedBy', { name: manager.name }) : undefined} />
      <CardBody>
        {q.isLoading ? <SkeletonRows rows={3} /> : rows.length === 0 ? <EmptyState compact icon={ListChecks} title={t('work.project.noTeam')} /> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <Avatar name={r.name} size="sm" /><span className="flex-1 text-sm font-medium text-zinc-900">{r.name}</span>
                <span className="text-xs text-zinc-500">{t('work.project.teamCounts', { open: fmt.number(r.open), done: fmt.number(r.done) })}</span>
                {r.overdue > 0 && <span className="text-xs font-medium text-rose-600">{t('tasks.overdueN', { n: fmt.number(r.overdue) })}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** CLIENT: the project's tasks the agency shared. */
function SharedProjectTasks({ projectId }: { projectId: string }) {
  const { t, fmt } = useI18n();
  const q = useApi<SharedTasksResponse>('/client-tasks', { projectId, pageSize: 50 });
  return (
    <Card>
      <CardBody>
        {q.isLoading ? <SkeletonRows rows={3} /> : !q.data?.items.length ? <EmptyState compact icon={ListChecks} title={t('tasks.clientEmpty')} /> : (
          <ul className="divide-y divide-line">
            {q.data.items.map((x) => (
              <li key={x.id}><Link to={`/tasks?open=${x.id}`} className="flex items-center gap-3 py-3 hover:text-brand-700"><span className="flex-1 text-sm font-medium">{x.title}</span><StatusBadge group="taskStatus" value={x.status} />{x.dueDate && <span className="text-xs text-zinc-500">{fmt.date(x.dueDate)}</span>}</Link></li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
