import { useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useApi } from '@/api/hooks';
import type { ReportsResponse } from '@/api/types';
import type { ComparePeriodsResponse, CompareScope } from '@/api/types.insights';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { MetricTiles } from '@/components/shared/Metrics';
import { ComparisonCard } from '@/components/insights/ComparisonCard';

/**
 * Print-optimised report: no sidebar, no filters, just the numbers for the range the user was looking at
 * (passed as query params by ReportsPanel's "Print" button). `window.print()` opens the browser's print /
 * save-as-PDF dialog; a `<style>` tag hides the surrounding app shell (frozen - we cannot edit AppShell.tsx itself).
 */
export function ReportPrintPage() {
  const { t, fmt, locale } = useI18n();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const campaignId = params.get('campaignId') || undefined;
  const clientId = params.get('clientId') || undefined;
  const from = params.get('from') || '';
  const to = params.get('to') || '';

  const q = useApi<ReportsResponse>('/reports', { campaignId, clientId, from, to, page: 1, pageSize: 100 });
  const canCompare = !!from && !!to;
  const compareScope: CompareScope = campaignId ? 'campaign' : clientId ? 'client' : 'all';
  const cmp = useApi<ComparePeriodsResponse>(
    '/analytics/compare',
    { scope: compareScope, id: campaignId ?? clientId, from, to, mode: 'previous_period' },
    { enabled: canCompare },
  );

  const d = q.data;
  const firstRow = d?.items[0];
  const clientName = firstRow?.client?.companyName;
  const campaignName = firstRow?.campaign?.name;
  const truncated = !!d && d.meta.total > d.items.length;
  const generatedAt = new Date().toISOString();

  return (
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-4xl pb-16">
      {/* This page renders inside the normal app shell (sidebar/header/bottom nav); those elements are owned by
          other files we may not edit, so we hide them for print with a global rule scoped to this page instead. */}
      <style>{`
        @media print {
          aside, header, nav[aria-label="Quick"] { display: none !important; }
          .lg\\:ps-64 { padding-inline-start: 0 !important; }
          main { padding: 0 !important; max-width: none !important; }
          .og-print-hide { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="og-print-hide mb-6 flex items-center justify-between rounded-2xl border border-line bg-white p-4 shadow-card">
        <p className="text-sm text-zinc-600">{t('insights.print.previewHint')}</p>
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()} disabled={!d}>{t('insights.print.button')}</Button>
      </div>

      {q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.isLoading || !d ? (
        <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-56 w-full" /></div>
      ) : (
        <div>
          <div className="mb-6 border-b border-zinc-300 pb-4">
            <h1 className="text-xl font-semibold text-zinc-900">{t('insights.print.title')}</h1>
            <p className="mt-1 text-sm text-zinc-600">{[clientName ?? t('common.allClients'), campaignName ?? t('report.allCampaigns')].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-xs text-zinc-500">{from && to ? `${fmt.date(from)} – ${fmt.date(to)}` : t('report.allTime')}</p>
            <p className="mt-2 text-xs text-zinc-400">{t('insights.print.generated', { at: fmt.dateTime(generatedAt), by: user?.name ?? '' })}</p>
          </div>

          <MetricTiles m={d.summary} compact />

          {canCompare && (cmp.data ? <div className="mt-6"><ComparisonCard data={cmp.data} /></div> : cmp.isLoading ? <Skeleton className="mt-6 h-48 w-full" /> : null)}

          <div className="mt-8">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">{t('report.daily')}</h2>
            {d.items.length === 0 ? (
              <p className="text-sm text-zinc-500">{t('report.empty')}</p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-300 text-start text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <th className="py-1.5 pe-2 text-start">{t('report.date')}</th>
                    <th className="py-1.5 pe-2 text-start">{t('common.client')}</th>
                    <th className="py-1.5 pe-2 text-start">{t('common.campaign')}</th>
                    <th className="py-1.5 ps-2 text-end">{t('metric.spend')}</th>
                    <th className="py-1.5 ps-2 text-end">{t('metric.impressions')}</th>
                    <th className="py-1.5 ps-2 text-end">{t('metric.clicks')}</th>
                    <th className="py-1.5 ps-2 text-end">{t('metric.ctr')}</th>
                    <th className="py-1.5 ps-2 text-end">{t('metric.conversions')}</th>
                    <th className="py-1.5 ps-2 text-end">{t('metric.roas')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100">
                      <td className="py-1.5 pe-2">{fmt.date(r.date)}</td>
                      <td className="py-1.5 pe-2">{r.client?.companyName ?? '—'}</td>
                      <td className="py-1.5 pe-2">{r.campaign?.name ?? '—'}</td>
                      <td className="py-1.5 ps-2 text-end tabular">{fmt.money(r.spend, { decimals: 2 })}</td>
                      <td className="py-1.5 ps-2 text-end tabular">{fmt.number(r.impressions)}</td>
                      <td className="py-1.5 ps-2 text-end tabular">{fmt.number(r.clicks)}</td>
                      <td className="py-1.5 ps-2 text-end tabular">{fmt.percent(r.ctr)}</td>
                      <td className="py-1.5 ps-2 text-end tabular">{fmt.number(r.conversions)}</td>
                      <td className="py-1.5 ps-2 text-end tabular">{fmt.ratio(r.roas)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-zinc-400 font-semibold text-zinc-900">
                    <td className="py-1.5 pe-2" colSpan={3}>{t('common.total')}</td>
                    <td className="py-1.5 ps-2 text-end tabular">{fmt.money(d.summary.spend, { decimals: 2 })}</td>
                    <td className="py-1.5 ps-2 text-end tabular">{fmt.number(d.summary.impressions)}</td>
                    <td className="py-1.5 ps-2 text-end tabular">{fmt.number(d.summary.clicks)}</td>
                    <td className="py-1.5 ps-2 text-end tabular">{fmt.percent(d.summary.ctr)}</td>
                    <td className="py-1.5 ps-2 text-end tabular">{fmt.number(d.summary.conversions)}</td>
                    <td className="py-1.5 ps-2 text-end tabular">{fmt.ratio(d.summary.roas)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {truncated && <p className="mt-2 text-xs text-zinc-400">{t('insights.print.truncated', { n: String(d.meta.total) })}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
