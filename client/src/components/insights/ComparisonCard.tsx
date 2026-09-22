import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { AnalyticsMetricKey, AnalyticsMetricSet, ComparePeriodsResponse } from '@/api/types.insights';
import { useI18n, type Formatters, type TKey } from '@/i18n';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';

const ROWS: Array<{ key: AnalyticsMetricKey; labelKey: TKey; format: (fmt: Formatters, n: number) => string }> = [
  { key: 'spend', labelKey: 'metric.spend', format: (fmt, n) => fmt.money(n) },
  { key: 'clicks', labelKey: 'metric.clicks', format: (fmt, n) => fmt.number(n) },
  { key: 'conversions', labelKey: 'metric.conversions', format: (fmt, n) => fmt.number(n) },
  { key: 'conversionValue', labelKey: 'metric.conversionValue', format: (fmt, n) => fmt.money(n) },
  { key: 'ctr', labelKey: 'metric.ctr', format: (fmt, n) => fmt.percent(n) },
  { key: 'roas', labelKey: 'metric.roas', format: (fmt, n) => fmt.ratio(n) },
];

const cell = (m: AnalyticsMetricSet, key: AnalyticsMetricKey, format: (fmt: Formatters, n: number) => string, fmt: Formatters): string => {
  const v = m[key];
  return v === null ? '—' : format(fmt, v);
};

/** Current vs. previous period, six headline metrics, with a coloured delta arrow. Never invents a percentage when the previous value was 0/null. */
export function ComparisonCard({ data, title }: { data: ComparePeriodsResponse; title?: string }) {
  const { t, fmt } = useI18n();
  return (
    <Card>
      <CardHeader title={title ?? t('insights.compare.title')} subtitle={t('insights.compare.subtitle', { from: fmt.date(data.previous.from), to: fmt.date(data.previous.to) })} />
      <CardBody className="!p-0">
        <div className="grid grid-cols-3 gap-2 px-5 pb-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400 sm:px-6">
          <span />
          <span className="text-end">{t('insights.compare.previous')}</span>
          <span className="text-end">{t('insights.compare.current')}</span>
        </div>
        <div className="divide-y divide-line">
          {ROWS.map(({ key, labelKey, format }) => {
            const delta = data.deltas[key];
            const pct = delta.pct;
            const up = pct !== null && pct > 0.0001;
            const down = pct !== null && pct < -0.0001;
            return (
              <div key={key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
                <span className="min-w-0 shrink-0 text-zinc-500">{t(labelKey)}</span>
                <div className="flex flex-1 items-center justify-end gap-4 tabular">
                  <span className="text-xs text-zinc-400">{cell(data.previous.metrics, key, format, fmt)}</span>
                  <span className="font-semibold text-zinc-900">{cell(data.current.metrics, key, format, fmt)}</span>
                  <span className={cx('inline-flex w-20 shrink-0 items-center justify-end gap-1 text-xs font-semibold', up ? 'text-emerald-600' : down ? 'text-rose-600' : 'text-zinc-400')}>
                    {up ? <ArrowUp className="size-3.5" /> : down ? <ArrowDown className="size-3.5" /> : <Minus className="size-3.5" />}
                    {pct === null ? '—' : fmt.percent(Math.abs(pct), 1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
