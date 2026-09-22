import { useState } from 'react';
import { BarChart3, Clock, Download, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '@/api/hooks';
import type { ClientTimeReport as Report } from '@/api/types.time';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { ProgressBar } from '@/components/ui/Progress';
import { StatCard } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { SERIES } from '@/components/shared/Charts';
import { useClientOptions } from '@/components/shared/options';
import { formatHM, localDateStr, tzOffsetMin, useTimeFormat } from '@/components/shared/timer';

interface Row { key: string; label: string; seconds: number; hours: number; entries: number }

function Breakdown({ title, rows }: { title: string; rows: Row[] }) {
  const { fmt, t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {rows.length === 0 ? <p className="text-sm text-zinc-500">{t('time.report.noData')}</p> : (
          <ul className="space-y-3.5">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-zinc-800" title={r.label}>{r.label}</span>
                  <span className="shrink-0 tabular text-zinc-600">{formatHM(r.seconds)} <span className="text-xs text-zinc-400">({fmt.number(r.hours)} {t('time.hoursShort')})</span></span>
                </div>
                <ProgressBar value={r.seconds} max={max} size="sm" tone="brand" />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Client time report (time.view_all / ADMIN): totals, breakdowns, simple charts and a CSV export. */
export function ClientTimeReport() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const tf = useTimeFormat();
  const tz = tzOffsetMin();
  const { clients, loading: loadingClients } = useClientOptions(true);
  const today = new Date();
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState(localDateStr(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(localDateStr(today));
  const [exporting, setExporting] = useState(false);

  const q = useApi<Report>(clientId ? `/time/report/client/${clientId}` : null, { from, to, tz });
  const r = q.data;

  async function exportCsv() {
    setExporting(true);
    try {
      const qsStr = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), tz: String(tz) }).toString();
      const res = await fetch(`/api/time/report/client/${clientId}.csv?${qsStr}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'time-report.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(t('time.report.exported'));
    } catch {
      toast.error(t('time.report.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const people = r?.byUser.length ?? 0;
  const chartData = (r?.byDay ?? []).map((d) => ({ date: d.date, label: tf.day(d.date, { month: 'short', day: 'numeric' }), hours: d.hours }));

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto] lg:items-end">
          <Field label={t('common.client')}>
            {(id) => (
              <Select id={id} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">{loadingClients ? t('common.select') : t('time.report.pickClient')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('common.from')}>{(id) => <Input id={id} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={t('common.to')}>{(id) => <Input id={id} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Button variant="secondary" icon={<Download className="size-4" />} disabled={!clientId || !r} loading={exporting} onClick={() => void exportCsv()} className="max-sm:h-11 sm:col-span-2 lg:col-span-1">{t('time.report.exportCsv')}</Button>
        </CardBody>
      </Card>

      {!clientId ? (
        <Card><EmptyState icon={BarChart3} title={t('time.report.title')} description={t('time.report.hint')} /></Card>
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.isLoading || !r ? (
        <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : r.totals.entries === 0 ? (
        <Card><EmptyState icon={Clock} title={t('time.report.empty')} description={t('time.report.emptyHint')} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <StatCard label={t('time.report.totalHours')} value={`${fmt.number(r.totals.hours)} ${t('time.hoursShort')}`} icon={Clock} tone="brand" hint={formatHM(r.totals.seconds)} />
            <StatCard label={t('time.report.entries')} value={fmt.number(r.totals.entries)} icon={BarChart3} tone="sky" />
            <div className="col-span-2 lg:col-span-1"><StatCard label={t('time.report.people')} value={fmt.number(people)} icon={Users} tone="emerald" /></div>
          </div>
          {r.truncated && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('time.report.truncated')}</p>}

          <Card>
            <CardHeader title={t('time.report.byDay')} subtitle={t('time.report.hoursPerDay')} />
            <CardBody>
              <div dir="ltr" style={{ height: 220 }} role="img" aria-label={t('time.report.byDay')}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#ececE6" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#71717a' }} minTickGap={16} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#71717a' }} width={36} />
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} formatter={(v) => [`${fmt.number(Number(v))} ${t('time.hoursShort')}`, t('time.report.hours')]} />
                    <Bar dataKey="hours" fill={SERIES.blue} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title={t('time.report.byProject')} rows={r.byProject.map((p) => ({ key: p.projectId ?? 'none', label: p.name ?? t('time.report.noProject'), seconds: p.seconds, hours: p.hours, entries: p.entries }))} />
            <Breakdown title={t('time.report.byUser')} rows={r.byUser.map((u) => ({ key: u.userId ?? 'none', label: u.name ?? '—', seconds: u.seconds, hours: u.hours, entries: u.entries }))} />
          </div>
          <Breakdown title={t('time.report.byTask')} rows={r.byTask.map((k) => ({ key: k.taskId ?? 'none', label: k.title ?? t('time.report.noTask'), seconds: k.seconds, hours: k.hours, entries: k.entries }))} />
        </>
      )}
    </div>
  );
}
