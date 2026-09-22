import { useState, type ReactNode } from 'react';
import { BarChart3, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAction, useApi } from '@/api/hooks';
import type { ReportRow, ReportsResponse } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect } from '@/components/ui/Filters';
import { Input } from '@/components/ui/Form';
import { IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { MetricTiles } from '@/components/shared/Metrics';
import { SERIES, SeriesChart } from '@/components/shared/Charts';
import { useCampaignOptions, useClientOptions } from '@/components/shared/options';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Real report rows only: filters, KPI tiles, four charts and the daily table. */
export function ReportsPanel({ campaignId: fixedCampaign, toolbar }: { campaignId?: string; toolbar?: ReactNode }) {
  const { t, fmt } = useI18n();
  const { user } = useAuth();
  const staff = user?.role !== 'CLIENT';
  const [clientId, setClientId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<ReportRow | null>(null);
  const { clients } = useClientOptions(staff && !fixedCampaign);
  const { campaigns } = useCampaignOptions(clientId || undefined, !fixedCampaign);
  const effectiveCampaign = fixedCampaign ?? (campaignId || undefined);
  const q = useApi<ReportsResponse>('/reports', { campaignId: effectiveCampaign, clientId: clientId || undefined, from, to, page, pageSize: 15 });
  const del = useAction((id: string) => api.del(`/reports/${id}`), { success: t('report.deleted'), onSuccess: () => setToDelete(null) });
  const reset = () => setPage(1);

  const preset = (days: number | null) => {
    if (days === null) { setFrom(''); setTo(''); } else {
      const end = new Date(); const start = new Date(); start.setDate(end.getDate() - (days - 1));
      setFrom(isoDay(start)); setTo(isoDay(end));
    }
    reset();
  };

  const d = q.data;
  const hasData = !!d && d.meta.total > 0;

  return (
    <div>
      <FilterBar>
        {staff && !fixedCampaign && <FilterSelect value={clientId} onChange={(v) => { setClientId(v); setCampaignId(''); reset(); }} allLabel={t('common.allClients')} options={clients.map((c) => ({ value: c.id, label: c.companyName }))} />}
        {!fixedCampaign && <FilterSelect value={campaignId} onChange={(v) => { setCampaignId(v); reset(); }} allLabel={t('report.allCampaigns')} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />}
        <div className="col-span-2 flex items-center gap-2">
          <Input type="date" aria-label={t('report.from')} value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); reset(); }} className="sm:w-40" />
          <span className="text-zinc-400">–</span>
          <Input type="date" aria-label={t('report.to')} value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); reset(); }} className="sm:w-40" />
        </div>
        <div className="col-span-2 flex gap-1.5 text-[13px]">
          {([[7, t('report.last7')], [30, t('report.last30')], [null, t('report.allTime')]] as const).map(([n, label]) => (
            <button key={label} onClick={() => preset(n)} className="rounded-lg px-2.5 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">{label}</button>
          ))}
        </div>
        {toolbar && <div className="col-span-2 sm:ms-auto">{toolbar}</div>}
      </FilterBar>

      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? (
        <div className="space-y-4"><Skeleton className="h-28 w-full" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></div>
      ) : !hasData ? (
        <EmptyState icon={BarChart3} title={t('report.empty')} description={from || to || effectiveCampaign || clientId ? t('common.noResultsHint') : t('report.emptyHint')} />
      ) : (
        <div className="space-y-5">
          <MetricTiles m={d.summary} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader title={t('report.chartSpend')} /><CardBody><SeriesChart data={d.series} dataKey="spend" kind="area" color={SERIES.blue} name={t('metric.spend')} format={(n) => fmt.money(n)} /></CardBody></Card>
            <Card><CardHeader title={t('report.chartClicks')} /><CardBody><SeriesChart data={d.series} dataKey="clicks" kind="bar" color={SERIES.aqua} name={t('metric.clicks')} format={(n) => fmt.number(n)} /></CardBody></Card>
            <Card><CardHeader title={t('report.chartConversions')} /><CardBody><SeriesChart data={d.series} dataKey="conversions" kind="bar" color={SERIES.orange} name={t('metric.conversions')} format={(n) => fmt.number(n)} /></CardBody></Card>
            <Card><CardHeader title={t('report.chartRoas')} /><CardBody><SeriesChart data={d.series} dataKey="roas" kind="line" color={SERIES.violet} name={t('metric.roas')} format={(n) => fmt.ratio(n)} /></CardBody></Card>
          </div>

          <div>
            <h3 className="mb-3 text-[15px] font-semibold text-zinc-900">{t('report.daily')}</h3>
            <DataList
              rows={d.items}
              rowKey={(r) => r.id}
              columns={[
                { key: 'date', header: t('report.date'), primary: true, cell: (r) => <div><p className="font-medium text-zinc-900">{fmt.date(r.date)}</p>{(!fixedCampaign) && <p className="text-xs font-normal text-zinc-500">{[staff ? r.client?.companyName : null, r.campaign?.name].filter(Boolean).join(' · ')}</p>}</div> },
                { key: 'spend', header: t('metric.spend'), align: 'end', cell: (r) => <span className="tabular">{fmt.money(r.spend, { decimals: 2 })}</span> },
                { key: 'impr', header: t('metric.impressions'), align: 'end', hideOnTablet: true, cell: (r) => <span className="tabular">{fmt.number(r.impressions)}</span> },
                { key: 'clicks', header: t('metric.clicks'), align: 'end', cell: (r) => <span className="tabular">{fmt.number(r.clicks)}</span> },
                { key: 'ctr', header: t('metric.ctr'), align: 'end', hideOnTablet: true, hideOnMobile: true, cell: (r) => <span className="tabular">{fmt.percent(r.ctr)}</span> },
                { key: 'conv', header: t('metric.conversions'), align: 'end', cell: (r) => <span className="tabular">{fmt.number(r.conversions)}</span> },
                { key: 'roas', header: t('metric.roas'), align: 'end', cell: (r) => <span className="tabular">{fmt.ratio(r.roas)}</span> },
                ...(staff ? [{ key: 'del', header: <span className="sr-only">{t('common.actions')}</span>, align: 'end' as const, hideOnMobile: true, cell: (r: ReportRow) => <IconButton label={t('common.delete')} className="size-9 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(r)}><Trash2 className="size-[18px]" /></IconButton> }] : []),
              ]}
            />
            <Pagination meta={d.meta} onPage={setPage} />
          </div>
        </div>
      )}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && del.mutate(toDelete.id)} loading={del.isPending} title={t('report.deleteTitle')} message={t('report.deleteMessage', { date: toDelete ? fmt.date(toDelete.date) : '' })} confirmLabel={t('common.delete')} />
    </div>
  );
}
