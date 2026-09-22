import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriesPoint } from '@/api/types';
import { useI18n } from '@/i18n';

// Categorical slots from the validated palette (fixed order, never cycled).
export const SERIES = { blue: '#2a78d6', aqua: '#1baf7a', orange: '#eb6834', violet: '#4a3aa7' } as const;

type Kind = 'area' | 'bar' | 'line';
type Key = 'spend' | 'clicks' | 'conversions' | 'roas' | 'impressions' | 'reach';

interface TipProps { active?: boolean; payload?: Array<{ value: number; payload: SeriesPoint }>; label?: string; format: (n: number) => string; name: string }

function Tip({ active, payload, format, name }: TipProps) {
  const { fmt } = useI18n();
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
      <p className="font-medium text-zinc-500">{fmt.date(p.payload.date)}</p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-900 tabular">{format(p.value)} <span className="text-xs font-normal text-zinc-500">{name}</span></p>
    </div>
  );
}

/** One measure, one axis (no dual axes). Charts stay LTR in Arabic; only the text around them flips. */
export function SeriesChart({ data, dataKey, kind, color, name, format, height = 220 }: { data: SeriesPoint[]; dataKey: Key; kind: Kind; color: string; name: string; format: (n: number) => string; height?: number }) {
  const { fmt } = useI18n();
  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid stroke="#ececE6" strokeDasharray="0" vertical={false} />
      <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#71717a' }} tickFormatter={(d: string) => fmt.date(d).replace(/,?\s?\d{4}/, '')} minTickGap={28} />
      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#71717a' }} width={46} tickFormatter={(v: number) => (dataKey === 'roas' ? v.toFixed(1) : fmt.compact(v))} />
      <Tooltip cursor={{ stroke: '#d4d4cf' }} content={<Tip format={format} name={name} />} />
    </>
  );
  return (
    <div dir="ltr" style={{ height }} role="img" aria-label={name}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'bar' ? (
          <BarChart {...common}>{axes}<Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} /></BarChart>
        ) : kind === 'line' ? (
          <LineChart {...common}>{axes}<Line dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} /></LineChart>
        ) : (
          <AreaChart {...common}>
            <defs><linearGradient id={`g-${dataKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
            {axes}
            <Area dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#g-${dataKey})`} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
