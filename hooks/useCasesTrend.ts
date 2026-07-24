import { useQuery } from '@tanstack/react-query';
import { casesSold } from '../lib/reportSemantics';
import { toDateStr, addDays } from '../lib/reportExport';

export type TrendRange = '1W' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y';
type Gran = 'daily' | 'weekly' | 'monthly';

export const TREND_RANGES: TrendRange[] = ['1W', '1M', '3M', '6M', '1Y', '3Y', '5Y'];

export interface TrendBucket {
  label: string; // x-axis label (real date)
  value: number; // cases in the bucket
  rangeText: string; // full date / range for the tap readout
}
export interface CasesTrend {
  buckets: TrendBucket[];
  total: number;
  rangeLabel: string;
  granularity: Gran;
}

// Tiered granularity (brief §4): daily 1W–1M, weekly 3M–1Y, monthly 3Y–5Y.
const RANGE_CFG: Record<TrendRange, { gran: Gran; days?: number; months?: number }> = {
  '1W': { gran: 'daily', days: 7 },
  '1M': { gran: 'daily', days: 30 },
  '3M': { gran: 'weekly', months: 3 },
  '6M': { gran: 'weekly', months: 6 },
  '1Y': { gran: 'weekly', months: 12 },
  '3Y': { gran: 'monthly', months: 36 },
  '5Y': { gran: 'monthly', months: 60 },
};

const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const fmtMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const fmtFull = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

async function fetchTrend(range: TrendRange): Promise<CasesTrend> {
  const cfg = RANGE_CFG[range];
  const today = startOfDay(new Date());
  const rawStart =
    cfg.days != null ? addDays(today, -(cfg.days - 1)) : startOfDay(addMonths(today, -(cfg.months! - 1)));
  // Monthly buckets snap the start to the 1st of that month.
  const rangeStart =
    cfg.gran === 'monthly' ? new Date(rawStart.getFullYear(), rawStart.getMonth(), 1) : rawStart;
  const endExclusive = addDays(today, 1);

  // ── ONE hybrid call for the whole range. casesSold applies the ORDERS_CUTOVER
  // split per day internally and returns byDay; we only re-bucket that map here,
  // never reimplementing the cutover for any bucket size. ──
  const { byDay } = await casesSold(toDateStr(rangeStart), toDateStr(endExclusive));

  const sumDays = (from: Date, to: Date): number => {
    let s = 0;
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) s += byDay[toDateStr(d)] || 0;
    return s;
  };

  const buckets: TrendBucket[] = [];
  if (cfg.gran === 'daily') {
    for (let d = new Date(rangeStart); d <= today; d = addDays(d, 1)) {
      buckets.push({ label: fmtDay(d), value: byDay[toDateStr(d)] || 0, rangeText: fmtFull(d) });
    }
  } else if (cfg.gran === 'weekly') {
    for (let s = new Date(rangeStart); s <= today; s = addDays(s, 7)) {
      const e = addDays(s, 6);
      const eClamped = e > today ? today : e;
      buckets.push({ label: fmtDay(s), value: sumDays(s, eClamped), rangeText: `${fmtFull(s)} – ${fmtFull(eClamped)}` });
    }
  } else {
    let m = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const lastMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    while (m <= lastMonth) {
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      const monthEnd = addDays(next, -1);
      const eClamped = monthEnd > today ? today : monthEnd;
      buckets.push({
        label: fmtMonth(m),
        value: sumDays(m, eClamped),
        rangeText: m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      });
      m = next;
    }
  }

  const total = buckets.reduce((s, b) => s + b.value, 0);
  return { buckets, total, rangeLabel: `${fmtFull(rangeStart)} – ${fmtFull(today)}`, granularity: cfg.gran };
}

export function useCasesTrend(range: TrendRange) {
  return useQuery({ queryKey: ['cases-trend', range], queryFn: () => fetchTrend(range) });
}
