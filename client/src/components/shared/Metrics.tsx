import type { Metrics } from '@/api/types';
import { useI18n } from '@/i18n';

/** The ten report metrics as a tile grid. All numbers come from real report rows. */
export function MetricTiles({ m, compact }: { m: Metrics; compact?: boolean }) {
  const { t, fmt } = useI18n();
  const items: Array<[string, string]> = [
    [t('metric.spend'), fmt.money(m.spend)],
    [t('metric.reach'), fmt.compact(m.reach)],
    [t('metric.impressions'), fmt.compact(m.impressions)],
    [t('metric.clicks'), fmt.number(m.clicks)],
    [t('metric.ctr'), fmt.percent(m.ctr)],
    [t('metric.cpc'), fmt.money(m.cpc, { decimals: 2 })],
    [t('metric.cpm'), fmt.money(m.cpm, { decimals: 2 })],
    [t('metric.conversions'), fmt.number(m.conversions)],
    [t('metric.conversionValue'), fmt.money(m.conversionValue)],
    [t('metric.roas'), fmt.ratio(m.roas)],
  ];
  return (
    <dl className={compact ? 'grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'}>
      {items.map(([label, value]) => (
        <div key={label} className={compact ? '' : 'rounded-2xl border border-line bg-white p-4 shadow-card'}>
          <dt className="text-[12px] font-medium text-zinc-500">{label}</dt>
          <dd className="mt-1 text-lg font-semibold tracking-tight text-zinc-900 tabular sm:text-xl">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
