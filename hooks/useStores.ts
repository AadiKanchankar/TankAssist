import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { orderValue } from '../lib/orders';
import { bucketBreakdown } from '../lib/stockBuckets';

export interface Store {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  contact_person: string | null; // Store Manager Name
  contact_number: string | null;
  license_number: string | null;
  owner_name: string | null;
  state: string | null;
}

export interface StoreAssignment {
  id: string;
  store_id: string;
  stores: Store;
}

export interface VisitRow {
  id: string;
  check_in_time: string;
  check_out_time: string | null;
  cases_sold: number | null;
  notes: string | null;
  users: { name: string } | null;
}

export interface StockRow {
  product_id: string;
  product_name: string;
  unit: string;
  cases: number; // -1 = never recorded (sentinel, unchanged). Otherwise the TOTAL.
  bottles: number;
  recorded_at: string;
  recorded_by: string;
  recorder_name: string | null;
  /** Per-bucket split. Empty for rows recorded before the floor/display/godown
   *  split — those carry a total only, and the UI says so instead of guessing. */
  breakdown: { label: string; cases: number; bottles: number }[];
}

export interface RecentOrder {
  id: string;
  status: string;
  created_at: string;
  value: number;
}

export type RepStatus = 'visited' | 'in-progress' | 'pending';

const localToday = () => new Date().toISOString().split('T')[0];

// ── Admin stores list ──
async function fetchAdminStores(): Promise<Store[]> {
  const { data } = await supabase.from('stores').select('*').order('name');
  return (data as Store[]) || [];
}
export function useAdminStores() {
  return useQuery({ queryKey: ['stores'], queryFn: fetchAdminStores });
}

// ── Rep stores list (assignments + all + today's visit status) ──
export interface RepStoresData {
  assignments: StoreAssignment[];
  allStores: Store[];
  visited: Set<string>;
  inProgress: Set<string>;
}
async function fetchRepStores(userId: string, today: string): Promise<RepStoresData> {
  const { data: assigns } = await supabase
    .from('store_assignments')
    .select('id, store_id, stores(*)')
    .eq('user_id', userId)
    .eq('assigned_date', today);

  const { data: storesData } = await supabase.from('stores').select('*').order('name');

  const { data: visits } = await supabase
    .from('store_visits')
    .select('store_id, check_out_time')
    .eq('user_id', userId)
    .gte('check_in_time', `${today}T00:00:00`)
    .lt('check_in_time', `${today}T23:59:59`);

  const visited = new Set<string>();
  const inProgress = new Set<string>();
  (visits || []).forEach((v) => {
    if (v.check_out_time) visited.add(v.store_id);
    else inProgress.add(v.store_id);
  });

  return {
    assignments: (assigns as any) || [],
    allStores: (storesData as Store[]) || [],
    visited,
    inProgress,
  };
}
export function useRepStores(userId: string | undefined) {
  const today = localToday();
  return useQuery({
    queryKey: ['rep-stores', userId, today],
    enabled: !!userId,
    queryFn: () => fetchRepStores(userId!, today),
  });
}

// ── Store detail (shared) ──
export interface StoreDetailData {
  store: Store;
  visits: VisitRow[];
  stock: StockRow[];
  totalCasesOrdered: number;
  recentOrders: RecentOrder[];
  repStatus: RepStatus;
  dayEnded: boolean;
}
async function fetchStoreDetail(
  routeStore: Store,
  isManager: boolean,
  userId: string | undefined,
  today: string
): Promise<StoreDetailData> {
  const { data: fresh } = await supabase
    .from('stores')
    .select('*')
    .eq('id', routeStore.id)
    .maybeSingle();

  const { data: visitRows } = await supabase
    .from('store_visits')
    .select('id, check_in_time, check_out_time, cases_sold, notes, users(name)')
    .eq('store_id', routeStore.id)
    .order('check_in_time', { ascending: false });

  const [{ data: prods }, { data: snaps }] = await Promise.all([
    supabase.from('products').select('id, name, unit').eq('is_active', true).order('name'),
    supabase
      .from('store_stock_snapshots')
      .select(
        'product_id, cases, bottles, floor_cases, floor_bottles, display_cases, display_bottles, godown_cases, godown_bottles, recorded_at, recorded_by'
      )
      .eq('store_id', routeStore.id)
      .order('recorded_at', { ascending: false }),
  ]);
  const latest: Record<string, any> = {};
  for (const s of (snaps as any[]) || []) {
    if (!latest[s.product_id]) latest[s.product_id] = s;
  }
  const recorderIds = [...new Set(Object.values(latest).map((s: any) => s.recorded_by))];
  const names: Record<string, string> = {};
  if (recorderIds.length) {
    const { data: users } = await supabase.from('users').select('id, name').in('id', recorderIds);
    for (const u of users || []) names[u.id] = u.name;
  }
  const stockRows: StockRow[] = ((prods as any[]) || [])
    .filter((p) => latest[p.id])
    .map((p) => {
      const s = latest[p.id];
      return {
        product_id: p.id,
        product_name: p.name,
        unit: p.unit,
        cases: s.cases,
        bottles: s.bottles,
        recorded_at: s.recorded_at,
        recorded_by: s.recorded_by,
        recorder_name: names[s.recorded_by] || null,
        breakdown: bucketBreakdown(s),
      };
    });
  const neverRecorded: StockRow[] = ((prods as any[]) || [])
    .filter((p) => !latest[p.id])
    .map((p) => ({
      product_id: p.id,
      product_name: p.name,
      unit: p.unit,
      cases: -1,
      bottles: -1,
      recorded_at: '',
      recorded_by: '',
      recorder_name: null,
      breakdown: [],
    }));
  const stock = [...stockRows, ...neverRecorded];

  const { data: orderRows } = await supabase
    .from('orders')
    .select(
      'id, status, created_at, order_items(cases, bottles, free_cases, free_bottles, price_per_case, price_per_bottle)'
    )
    .eq('store_id', routeStore.id)
    .order('created_at', { ascending: false });
  const orders = (orderRows as any[]) || [];
  let ordered = 0;
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    ordered += (o.order_items || []).reduce((s: number, it: any) => s + (it.cases || 0), 0);
  }
  const recentOrders: RecentOrder[] = orders.slice(0, 5).map((o) => ({
    id: o.id,
    status: o.status,
    created_at: o.created_at,
    value: orderValue(o.order_items || []),
  }));

  let repStatus: RepStatus = 'pending';
  let dayEnded = false;
  if (!isManager && userId) {
    const { data: todayVisit } = await supabase
      .from('store_visits')
      .select('check_out_time')
      .eq('user_id', userId)
      .eq('store_id', routeStore.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`)
      .order('check_in_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    repStatus = todayVisit ? (todayVisit.check_out_time ? 'visited' : 'in-progress') : 'pending';

    const { data: att } = await supabase
      .from('attendance')
      .select('check_out_time')
      .eq('user_id', userId)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`)
      .maybeSingle();
    dayEnded = !!att?.check_out_time;
  }

  return {
    store: (fresh as Store) || routeStore,
    visits: (visitRows as any as VisitRow[]) || [],
    stock,
    totalCasesOrdered: ordered,
    recentOrders,
    repStatus,
    dayEnded,
  };
}
export function useStoreDetail(routeStore: Store, isManager: boolean, userId: string | undefined) {
  const today = localToday();
  return useQuery({
    queryKey: ['store-detail', routeStore.id],
    queryFn: () => fetchStoreDetail(routeStore, isManager, userId, today),
  });
}
