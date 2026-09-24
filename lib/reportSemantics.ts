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
  /**
   * True when a PRODUCT filter forced pre-cutover figures out of this result.
   *
   * `store_visits.cases_sold` is a bare integer with no product dimension —
   * verified against the live schema — so legacy days cannot be attributed to
   * a product at all. Rather than quietly mixing a whole-company legacy number
   * into a single product's total (which would overstate it, invisibly), those
   * days are dropped and this flag is raised so the UI can say so.
   *
   * Only ever true when the requested window actually reaches back before
   * ORDERS_CUTOVER_DATE; a product-filtered query entirely after the cutover
   * is exact and leaves this false.
   */
  legacyExcluded: boolean;
  /**
   * Cases per VISIT, by the same hybrid: orders linked by `visit_id` on/after
   * the cutover, the legacy per-visit counter before. Reading
   * `store_visits.cases_sold` directly is the bug this exists for — the
   * stepper stopped writing it at the cutover, so every visit since read 0
   * while the header (orders) read 300.
   */
  byVisit: Record<string, number>;
  /**
   * Post-cutover only: store → product → cases. Legacy days have no product
   * dimension, so they appear in `byStore` but never here — a caller showing
   * a product split must label the difference, not invent a split.
   */
  byStoreProduct: Record<string, Record<string, number>>;
}
export interface CasesFilter {
  userId?: string; // scope to one rep (placed_by / visit user)
  storeId?: string; // scope to one store
  productId?: string; // scope to one product — see legacyExcluded above
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
  const byVisit: Record<string, number> = {};
  const byStoreProduct: Record<string, Record<string, number>> = {};
  const add = (day: string, storeId: string | null, visitId: string | null, n: number) => {
    byDay[day] = (byDay[day] || 0) + n;
    if (storeId) byStore[storeId] = (byStore[storeId] || 0) + n;
    if (visitId) byVisit[visitId] = (byVisit[visitId] || 0) + n;
  };

  // A product filter cannot reach the legacy figures at all: cases_sold is one
  // integer per VISIT with no product on it. Skipping those days is the only
  // honest option — attributing a whole-company legacy number to one product
  // would silently overstate it.
  const legacyExcluded = !!filter.productId && startYmd < ORDERS_CUTOVER_DATE;

  // The two sides are independent, so both requests go out together (a range
  // spanning the cutover used to pay two sequential round trips).
  const wantLegacy = startYmd < ORDERS_CUTOVER_DATE && !filter.productId;
  const wantOrders = endExclusiveYmd > ORDERS_CUTOVER_DATE;
  let legacyQ: any = null;
  if (wantLegacy) {
    let q = supabase
      .from('store_visits')
      .select('id, check_in_time, cases_sold, store_id')
      .gte('check_in_time', `${startYmd}T00:00:00`)
      .lt('check_in_time', `${endExclusiveYmd}T00:00:00`);
    if (filter.userId) q = q.eq('user_id', filter.userId);
    if (filter.storeId) q = q.eq('store_id', filter.storeId);
    legacyQ = q;
  }
  let ordersQ: any = null;
  if (wantOrders) {
    let q = supabase
      .from('orders')
      // product_id comes along so a product filter can be applied per LINE.
      // Filtering the join server-side would drop whole orders that merely
      // contain other products too, which is a different question.
      .select('created_at, store_id, visit_id, order_items(cases, product_id)')
      .neq('status', 'cancelled')
      .gte('created_at', `${startYmd}T00:00:00`)
      .lt('created_at', `${endExclusiveYmd}T00:00:00`);
    if (filter.userId) q = q.eq('placed_by', filter.userId);
    if (filter.storeId) q = q.eq('store_id', filter.storeId);
    ordersQ = q;
  }
  const [legacyRes, ordersRes] = await Promise.all([legacyQ, ordersQ]);

  // Legacy visit cases for days strictly before the cutover.
  if (legacyRes) {
    for (const v of (legacyRes.data as any[]) || []) {
      const d = toDateStr(new Date(v.check_in_time));
      if (d < ORDERS_CUTOVER_DATE) add(d, v.store_id, v.id, v.cases_sold || 0);
    }
  }

  // Order cases (excl. cancelled) for days on/after the cutover.
  if (ordersRes) {
    for (const o of (ordersRes.data as any[]) || []) {
      const d = toDateStr(new Date(o.created_at));
      if (d >= ORDERS_CUTOVER_DATE) {
        const lines = (o.order_items || []).filter(
          (it: any) => !filter.productId || it.product_id === filter.productId
        );
        add(d, o.store_id, o.visit_id, lines.reduce((s: number, it: any) => s + (it.cases || 0), 0));
        if (o.store_id) {
          const perProduct = byStoreProduct[o.store_id] || (byStoreProduct[o.store_id] = {});
          for (const it of lines) {
            perProduct[it.product_id] = (perProduct[it.product_id] || 0) + (it.cases || 0);
          }
        }
      }
    }
  }

  const total = Object.values(byDay).reduce((s, n) => s + n, 0);
  return { byDay, byStore, total, legacyExcluded, byVisit, byStoreProduct };
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
