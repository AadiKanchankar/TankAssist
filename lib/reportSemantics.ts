import { supabase } from './supabase';

/** Local YYYY-MM-DD (device-local, matching reportExport's bucketing). */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * ── ORDERS CUTOVER (decision #3) ────────────────────────────────────────────
 * The single source of truth for the "Cases Sold" semantics switch.
 *
 * "Cases Sold" for any calendar day is computed as:
 *   • day  >= cutover → cases in ORDERS placed that day (excluding cancelled)
 *   • day  <  cutover → legacy `store_visits.cases_sold` for that day
 * Never both for the same day, so figures never double-count across the switch.
 *
 * ⚠️ SET THIS to the date the orders-enabled build goes LIVE in production
 * (the coordinated same-day install — see HANDOFF.md go-live checklist).
 * Placeholder below = today's date.
 */
export const ORDERS_CUTOVER_DATE = '2026-07-18';

export interface CasesResult {
  byDay: Record<string, number>;
  byStore: Record<string, number>;
  total: number;
}
export interface CasesFilter {
  userId?: string; // scope to one rep (placed_by / visit user)
  storeId?: string; // scope to one store
}

/**
 * THE hybrid — every "Cases Sold" figure in the app (rep reports, CSV, the
 * management dashboard) routes through here so the orders/legacy split is
 * implemented exactly once. Range is [startYmd, endExclusiveYmd). Omit the
 * filter for org-wide totals (management dashboard).
 */
export async function casesSold(
  startYmd: string,
  endExclusiveYmd: string,
  filter: CasesFilter = {}
): Promise<CasesResult> {
  const byDay: Record<string, number> = {};
  const byStore: Record<string, number> = {};
  const add = (day: string, storeId: string | null, n: number) => {
    byDay[day] = (byDay[day] || 0) + n;
    if (storeId) byStore[storeId] = (byStore[storeId] || 0) + n;
  };

  // Legacy visit cases for days strictly before the cutover.
  if (startYmd < ORDERS_CUTOVER_DATE) {
    let q = supabase
      .from('store_visits')
      .select('check_in_time, cases_sold, store_id')
      .gte('check_in_time', `${startYmd}T00:00:00`)
      .lt('check_in_time', `${endExclusiveYmd}T00:00:00`);
    if (filter.userId) q = q.eq('user_id', filter.userId);
    if (filter.storeId) q = q.eq('store_id', filter.storeId);
    const { data } = await q;
    for (const v of (data as any[]) || []) {
      const d = toDateStr(new Date(v.check_in_time));
      if (d < ORDERS_CUTOVER_DATE) add(d, v.store_id, v.cases_sold || 0);
    }
  }

  // Order cases (excl. cancelled) for days on/after the cutover.
  if (endExclusiveYmd > ORDERS_CUTOVER_DATE) {
    let q = supabase
      .from('orders')
      .select('created_at, store_id, order_items(cases)')
      .neq('status', 'cancelled')
      .gte('created_at', `${startYmd}T00:00:00`)
      .lt('created_at', `${endExclusiveYmd}T00:00:00`);
    if (filter.userId) q = q.eq('placed_by', filter.userId);
    if (filter.storeId) q = q.eq('store_id', filter.storeId);
    const { data } = await q;
    for (const o of (data as any[]) || []) {
      const d = toDateStr(new Date(o.created_at));
      if (d >= ORDERS_CUTOVER_DATE) {
        const cases = (o.order_items || []).reduce(
          (s: number, it: any) => s + (it.cases || 0),
          0
        );
        add(d, o.store_id, cases);
      }
    }
  }

  const total = Object.values(byDay).reduce((s, n) => s + n, 0);
  return { byDay, byStore, total };
}

/** Per-day cases for one rep over [startYmd, endExclusiveYmd). */
export async function repCasesSoldByDay(
  userId: string,
  startYmd: string,
  endExclusiveYmd: string
): Promise<Record<string, number>> {
  return (await casesSold(startYmd, endExclusiveYmd, { userId })).byDay;
}

/** Total cases for one rep over [startYmd, endExclusiveYmd). */
export async function repCasesSold(
  userId: string,
  startYmd: string,
  endExclusiveYmd: string
): Promise<number> {
  return (await casesSold(startYmd, endExclusiveYmd, { userId })).total;
}
