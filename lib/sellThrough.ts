/**
 * Sell-through — what a store actually sold between two stock counts.
 *
 *   sold = stock at the earlier count + delivered since − stock at the later count
 *
 * per store per product, in WHOLE BOTTLES (the inventoryMath discipline, so
 * cases never drift). Inputs come from store_stock_snapshots (totals) and
 * delivered orders (cases + bottles + scheme cases/bottles — scheme stock is
 * physically delivered too). Challans are deliberately NOT counted (owner
 * decision 2026-10-11): nothing links a challan to an order, and counting both
 * would double-count the same delivery.
 *
 * In excise-controlled alcobev a store can only source this brand through our
 * channel, so the arithmetic is closed — which is what lets it corroborate spot
 * sales: claimed spot sales in an interval should not exceed what was sold.
 *
 * ponytail: a count is timestamped when the visit's data is committed (at
 * checkout), not when the rep physically counted, so a spot sale logged in the
 * same visit after the count lands in the interval that count closes. The
 * DEPLETION_SLACK_BOTTLES tolerance absorbs that and ordinary miscounts.
 * Upgrade path: commit the snapshot at the stock step.
 */

export interface CountRow {
  store_id: string;
  product_id: string;
  at: string;
  bottles: number;
}
export interface DeliveryRow {
  store_id: string;
  product_id: string;
  at: string;
  bottles: number;
}
export interface SpotRow {
  store_id: string;
  product_id: string;
  at: string;
  bottles: number;
  visit_id: string;
  user_id: string;
  /** spot_sales.id — needed to say WHICH events an interval corroborates. */
  id?: string;
}

export interface Interval {
  store_id: string;
  product_id: string;
  from: string;
  to: string;
  startBottles: number;
  deliveredBottles: number;
  endBottles: number;
  /** May be negative: stock rose with no recorded delivery (miscount, or stock from outside the app). */
  soldBottles: number;
  spotBottles: number;
  /** Visits whose spot sales fall in this interval. */
  spotVisitIds: string[];
  /** The spot-sale events in this interval (those that carried an id). */
  spotIds: string[];
}

/** Spot sales may exceed sell-through by this much before a flag is raised. */
export const DEPLETION_SLACK_BOTTLES = 6;

const key = (r: { store_id: string; product_id: string }) => `${r.store_id}|${r.product_id}`;
const t = (iso: string) => Date.parse(iso);

/** Every interval between consecutive counts, per store-product, oldest first. */
export function sellThroughIntervals(
  counts: CountRow[],
  deliveries: DeliveryRow[],
  spots: SpotRow[] = [],
): Interval[] {
  const byKey = new Map<string, CountRow[]>();
  for (const c of counts) {
    const k = key(c);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(c);
  }
  const out: Interval[] = [];
  for (const [k, rows] of byKey) {
    rows.sort((a, b) => t(a.at) - t(b.at));
    const dels = deliveries.filter((d) => key(d) === k);
    const sp = spots.filter((s) => key(s) === k);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const from = t(a.at);
      const to = t(b.at);
      if (to <= from) continue;
      const inWin = (x: { at: string }) => t(x.at) > from && t(x.at) <= to;
      const delivered = dels.filter(inWin).reduce((n, d) => n + d.bottles, 0);
      const spotIn = sp.filter(inWin);
      out.push({
        store_id: a.store_id,
        product_id: a.product_id,
        from: a.at,
        to: b.at,
        startBottles: a.bottles,
        deliveredBottles: delivered,
        endBottles: b.bottles,
        soldBottles: a.bottles + delivered - b.bottles,
        spotBottles: spotIn.reduce((n, s) => n + s.bottles, 0),
        spotVisitIds: [...new Set(spotIn.map((s) => s.visit_id))],
        spotIds: spotIn.flatMap((s) => (s.id ? [s.id] : [])),
      });
    }
  }
  return out.sort((x, y) => t(x.to) - t(y.to));
}

/** Bottles of claimed spot sales NOT explained by the stock that left the store. */
export function unexplainedSpotBottles(i: Interval): number {
  return Math.max(0, i.spotBottles - Math.max(0, i.soldBottles));
}

/**
 * Spot sales the store's stock fully accounts for — the only ones that may be
 * CELEBRATED (gamification). Strict: an interval whose claims exceed what was
 * sold by even one bottle corroborates none of them (we can't say which), and
 * sales after the latest count are pending, not corroborated. The slack used
 * for FLAGGING is deliberately not used here: tolerance protects reps from
 * accusation, never inflates achievement.
 */
export function corroboratedSpotIds(intervals: Interval[]): Set<string> {
  const out = new Set<string>();
  for (const i of intervals) if (unexplainedSpotBottles(i) === 0) for (const id of i.spotIds) out.add(id);
  return out;
}

export function depletionFlagged(i: Interval): boolean {
  return unexplainedSpotBottles(i) > DEPLETION_SLACK_BOTTLES;
}

/** Whole bottles → "3 cs 4 btl" with the product's carton size. */
export function fmtBottles(bottles: number, perCase: number): string {
  const neg = bottles < 0;
  const b = Math.abs(bottles);
  if (!(perCase > 0)) return `${neg ? '−' : ''}${b} btl`;
  const cs = Math.floor(b / perCase);
  const rem = b % perCase;
  const s = cs && rem ? `${cs} cs ${rem} btl` : cs ? `${cs} cs` : `${rem} btl`;
  return (neg ? '−' : '') + s;
}
