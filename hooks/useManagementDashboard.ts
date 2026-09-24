import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { casesSold } from '../lib/reportSemantics';
import { ORDER_FILTER_STATUSES, OrderFilter } from '../lib/orders';
import {
  toDateStr,
  addDays,
  monthStart,
  nextMonthStart,
  monthName,
} from '../lib/reportExport';

// Stores with no visit within this many days are flagged as needing attention.
export const STALE_VISIT_DAYS = 7;

export interface AttentionStore {
  id: string;
  name: string;
  reasons: string[];
}
export interface TopStore {
  name: string;
  cases: number;
}
export interface ManagementDashboardData {
  pipeline: Record<OrderFilter, number>;
  casesThisMonth: number;
  casesLastMonth: number;
  trend: number[];
  repsCheckedIn: number;
  visitsToday: number;
  attention: AttentionStore[];
  topStores: TopStore[];
  monthTitle: string;
  /** A product scope dropped pre-cutover figures — see CasesResult.legacyExcluded. */
  legacyExcluded: boolean;
}

const FILTER_KEYS = Object.keys(ORDER_FILTER_STATUSES) as OrderFilter[];

// Wraps the management KPI dashboard's original load() verbatim — same fetches,
// same hybrid casesSold calls; only the setState calls become a returned object.
async function fetchManagementDashboard(productId?: string): Promise<ManagementDashboardData> {
  const now = new Date();
  const mStartStr = toDateStr(monthStart(now));
  const nextMStr = toDateStr(nextMonthStart(now));
  const lastMStartStr = toDateStr(
    new Date(now.getFullYear(), now.getMonth() - 1, 1)
  );
  const today = toDateStr(now);
  const staleCutoff = toDateStr(addDays(now, -STALE_VISIT_DAYS));

  const scope = productId ? { productId } : {};
  // Everything below is independent, so it goes out as ONE parallel wave. It
  // used to be five sequential hops (≈650 ms each on a field connection).
  // The pipeline is five row-free COUNTs rather than every order's status —
  // that list grows forever, the counts don't.
  const countFor = (key: OrderFilter) =>
    supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ORDER_FILTER_STATUSES[key]);
  const [
    thisM,
    lastM,
    counts,
    { data: attToday },
    { data: visToday },
    { data: stores },
    { data: recentVisits },
    { data: snaps },
  ] = await Promise.all([
    casesSold(mStartStr, nextMStr, scope),
    casesSold(lastMStartStr, mStartStr, scope),
    Promise.all(FILTER_KEYS.map(countFor)),
    supabase
      .from('attendance')
      .select('user_id')
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`),
    supabase
      .from('store_visits')
      .select('id')
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`),
    supabase.from('stores').select('id, name'),
    supabase.from('store_visits').select('store_id').gte('check_in_time', `${staleCutoff}T00:00:00`),
    // ponytail: every snapshot ever, newest first, to find the latest per
    // (store, product). Tens of rows today; when it reaches thousands, move
    // "latest per pair" into a DISTINCT ON view/RPC (schema STOP-POINT).
    supabase
      .from('store_stock_snapshots')
      .select('store_id, product_id, cases, bottles, recorded_at')
      .order('recorded_at', { ascending: false }),
  ]);

  const daysInMonth = addDays(nextMonthStart(now), -1).getDate();
  const trend: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toDateStr(new Date(now.getFullYear(), now.getMonth(), d));
    trend.push(thisM.byDay[key] || 0);
  }

  const pipeline = Object.fromEntries(
    FILTER_KEYS.map((key, i) => [key, counts[i].count ?? 0]),
  ) as Record<OrderFilter, number>;
  const repsCheckedIn = new Set((attToday || []).map((a) => a.user_id)).size;
  const visitsToday = (visToday || []).length;

  const visitedRecently = new Set((recentVisits || []).map((v) => v.store_id));
  const seen = new Set<string>();
  const storeHasSnap = new Set<string>();
  const storeNonZero = new Set<string>();
  for (const s of (snaps as any[]) || []) {
    // Stock DOES carry product_id, so "stock at zero" scopes exactly. Note the
    // other attention reason — "no visit in Nd" — has no product dimension at
    // all and stays whole-company; the screen labels it accordingly.
    if (productId && s.product_id !== productId) continue;
    const key = `${s.store_id}|${s.product_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    storeHasSnap.add(s.store_id);
    if ((s.cases || 0) > 0 || (s.bottles || 0) > 0) storeNonZero.add(s.store_id);
  }

  const attention: AttentionStore[] = [];
  for (const s of (stores as any[]) || []) {
    const reasons: string[] = [];
    if (!visitedRecently.has(s.id)) reasons.push(`No visit in ${STALE_VISIT_DAYS}d`);
    if (storeHasSnap.has(s.id) && !storeNonZero.has(s.id))
      reasons.push('Stock at zero');
    if (reasons.length) attention.push({ id: s.id, name: s.name, reasons });
  }

  const nameById: Record<string, string> = {};
  for (const s of (stores as any[]) || []) nameById[s.id] = s.name;
  const topStores: TopStore[] = Object.entries(thisM.byStore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, cases]) => ({ name: nameById[id] || 'Store', cases }));

  return {
    pipeline,
    casesThisMonth: thisM.total,
    casesLastMonth: lastM.total,
    trend,
    repsCheckedIn,
    visitsToday,
    attention,
    topStores,
    monthTitle: monthName(now),
    legacyExcluded: thisM.legacyExcluded || lastM.legacyExcluded,
  };
}

export function useManagementDashboard(productId?: string) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
  return useQuery({
    queryKey: ['management-dashboard', monthKey, productId ?? 'all'],
    queryFn: () => fetchManagementDashboard(productId),
  });
}
