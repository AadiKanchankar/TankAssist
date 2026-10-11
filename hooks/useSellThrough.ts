import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  sellThroughIntervals,
  depletionFlagged,
  type CountRow,
  type DeliveryRow,
  type SpotRow,
  type Interval,
} from '../lib/sellThrough';

/** How far back counts, deliveries and spot sales are read. Two counts this far apart still pair. */
export const SELL_THROUGH_DAYS = 90;

export interface SellThrough {
  intervals: Interval[];
  perCase: Record<string, number>;
  productName: Record<string, string>;
}

/**
 * Counts, deliveries and spot sales for these stores in one parallel wave,
 * shaped into sell-through intervals (lib/sellThrough.ts).
 *
 * What a viewer can't read stays out: an SM sees spot sales of their own reps
 * only (RLS), so the depletion comparison is CONSERVATIVE for them — fewer
 * claims, never more. Snapshots are read through the table (rep rows are
 * shared); delivered orders are readable by every authenticated user.
 */
export async function loadSellThrough(storeIds: string[] | 'all', days = SELL_THROUGH_DAYS): Promise<SellThrough> {
  const empty: SellThrough = { intervals: [], perCase: {}, productName: {} };
  if (storeIds !== 'all' && !storeIds.length) return empty;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // 'all' = no store filter (the dashboard); a list of ids would overflow the URL.
  // `any`: supabase-js builder generics blow tsc's instantiation depth here;
  // every result below is cast at the point of use anyway.
  const scoped = (q: any): any => (storeIds === 'all' ? q : q.in('store_id', storeIds));
  const [snaps, orders, spots, prods] = await Promise.all([
    scoped(
      supabase
        .from('store_stock_snapshots')
        .select('store_id, product_id, recorded_at, cases, bottles')
        .gte('recorded_at', since),
    ),
    scoped(
      supabase
        .from('orders')
        .select('store_id, order_items(product_id, cases, bottles, free_cases, free_bottles), order_status_history(to_status, changed_at)')
        .eq('status', 'delivered')
        // Created before the window can still be DELIVERED inside it.
        .gte('created_at', new Date(Date.now() - (days + 60) * 86_400_000).toISOString()),
    ),
    scoped(
      supabase
        .from('spot_sales')
        .select('id, store_id, product_id, created_at, quantity, visit_id, user_id')
        .is('undone_at', null)
        .gte('created_at', since),
    ),
    supabase.from('products').select('id, name, qty_per_carton'),
  ]);
  for (const r of [snaps, orders, spots, prods]) if (r.error) throw r.error;

  const perCase: Record<string, number> = {};
  const productName: Record<string, string> = {};
  for (const p of (prods.data as any[]) ?? []) {
    perCase[p.id] = p.qty_per_carton;
    productName[p.id] = p.name;
  }
  const per = (pid: string) => perCase[pid] ?? 0;

  const counts: CountRow[] = ((snaps.data as any[]) ?? []).map((s) => ({
    store_id: s.store_id,
    product_id: s.product_id,
    at: s.recorded_at,
    // Totals are authoritative (lib/stockBuckets.ts); buckets are the breakdown.
    bottles: (s.cases ?? 0) * per(s.product_id) + (s.bottles ?? 0),
  }));
  const deliveries: DeliveryRow[] = [];
  for (const o of (orders.data as any[]) ?? []) {
    const at = (o.order_status_history ?? []).find((h: any) => h.to_status === 'delivered')?.changed_at;
    if (!at) continue;
    for (const it of o.order_items ?? []) {
      deliveries.push({
        store_id: o.store_id,
        product_id: it.product_id,
        at,
        bottles: ((it.cases ?? 0) + (it.free_cases ?? 0)) * per(it.product_id) + (it.bottles ?? 0) + (it.free_bottles ?? 0),
      });
    }
  }
  const spotRows: SpotRow[] = ((spots.data as any[]) ?? []).map((s) => ({
    store_id: s.store_id,
    product_id: s.product_id,
    at: s.created_at,
    bottles: s.quantity,
    visit_id: s.visit_id,
    user_id: s.user_id,
    id: s.id,
  }));
  return { intervals: sellThroughIntervals(counts, deliveries, spotRows), perCase, productName };
}

/** Sell-through for one store (Store Detail). */
export function useStoreSellThrough(storeId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['sell-through', storeId],
    enabled,
    refetchOnMount: false,
    queryFn: () => loadSellThrough([storeId]),
  });
}

export interface CompanySellThrough {
  /** Per product: bottles sold across intervals that ENDED in the window. */
  soldByProduct: { productId: string; name: string; perCase: number; bottles: number }[];
  /** Stores with at least two counts in the window — the only ones measurable. */
  storesMeasured: number;
  /** Stores where logged spot sales outrun the stock that left. */
  storesUnexplained: number;
}

/**
 * Management dashboard: sell-through over the last `days`. Only intervals that
 * end inside the window count, so a store counted once shows nothing rather
 * than a made-up figure. Negative intervals (stock rose with no delivery) are
 * excluded from the total — they are miscounts, not negative sales.
 */
export function useCompanySellThrough(days = 30) {
  return useQuery({
    queryKey: ['sell-through-company', days],
    refetchOnMount: false,
    queryFn: async (): Promise<CompanySellThrough> => {
      const st = await loadSellThrough('all', days + 60);
      const cutoff = Date.now() - days * 86_400_000;
      const recent = st.intervals.filter((i) => Date.parse(i.to) >= cutoff);
      const sold: Record<string, number> = {};
      for (const i of recent) if (i.soldBottles > 0) sold[i.product_id] = (sold[i.product_id] ?? 0) + i.soldBottles;
      return {
        soldByProduct: Object.entries(sold).map(([productId, bottles]) => ({
          productId,
          name: st.productName[productId] ?? 'Product',
          perCase: st.perCase[productId] ?? 0,
          bottles,
        })),
        storesMeasured: new Set(recent.map((i) => i.store_id)).size,
        storesUnexplained: new Set(recent.filter(depletionFlagged).map((i) => i.store_id)).size,
      };
    },
  });
}
