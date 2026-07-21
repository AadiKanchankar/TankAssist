import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getSignedUrls } from '../lib/storage';
import { orderValue } from '../lib/orders';

export interface OrderRow {
  id: string;
  status: string;
  created_at: string;
  placed_by: string;
  placed_by_name: string;
  store_name: string;
  item_count: number;
  value: number;
}

export interface ItemRow {
  product_name: string;
  cases: number;
  bottles: number;
  free_cases: number;
  free_bottles: number;
  price_per_case: number | null;
  price_per_bottle: number | null;
}
export interface HistoryRow {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  changed_by_name: string;
  reason: string | null;
  changed_at: string;
}
export interface OrderDetail {
  id: string;
  status: string;
  created_at: string;
  order_notes: string | null;
  cancellation_reason: string | null;
  delivered_verified_by: string | null;
  delivered_verified_name: string | null;
  placed_by: string;
  placed_by_name: string;
  placed_by_phone: string | null;
  store_name: string;
  store_address: string | null;
  store_state: string | null;
  store_contact: string | null;
  items: ItemRow[];
}
export interface OrderDetailData {
  order: OrderDetail;
  history: HistoryRow[];
  photoUrls: string[];
}

export const orderDetailKey = (orderId: string) => ['order-detail', orderId];

// ── Orders list (wraps the tab's original loadOrders verbatim) ──
export async function fetchOrdersList(): Promise<OrderRow[]> {
  const { data } = await supabase
    .from('orders')
    .select(
      `id, status, created_at, placed_by,
       stores(name),
       order_items(cases, bottles, free_cases, free_bottles, price_per_case, price_per_bottle)`
    )
    .order('created_at', { ascending: false });
  const rows = (data as any[]) || [];

  const ids = [...new Set(rows.map((o) => o.placed_by).filter(Boolean))];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: users } = await supabase.from('users').select('id, name').in('id', ids);
    for (const u of users || []) names[u.id] = u.name;
  }

  return rows.map((o) => ({
    id: o.id,
    status: o.status,
    created_at: o.created_at,
    placed_by: o.placed_by,
    placed_by_name: names[o.placed_by] || '—',
    store_name: o.stores?.name || 'Unknown store',
    item_count: (o.order_items || []).length,
    value: orderValue(o.order_items || []),
  }));
}
export function useOrdersList() {
  return useQuery({ queryKey: ['orders'], queryFn: fetchOrdersList });
}

// ── Order detail (wraps the shared screen's original loadDetail verbatim) ──
export async function fetchOrderDetail(orderId: string): Promise<OrderDetailData | null> {
  const { data: o } = await supabase
    .from('orders')
    .select(
      `id, status, created_at, order_notes, cancellation_reason,
       delivered_photo_paths, delivered_verified_by, placed_by,
       stores(name, address, state, contact_number),
       order_items(cases, bottles, free_cases, free_bottles, price_per_case, price_per_bottle, products(name))`
    )
    .eq('id', orderId)
    .single();
  if (!o) return null;

  const { data: hist } = await supabase
    .from('order_status_history')
    .select('id, from_status, to_status, changed_by, reason, changed_at')
    .eq('order_id', orderId)
    .order('changed_at', { ascending: true });

  const ids = [
    ...new Set(
      [(o as any).placed_by, (o as any).delivered_verified_by, ...(hist || []).map((h) => h.changed_by)].filter(
        Boolean
      )
    ),
  ];
  const names: Record<string, string> = {};
  const phones: Record<string, string | null> = {};
  if (ids.length) {
    const { data: users } = await supabase.from('users').select('id, name, phone').in('id', ids);
    for (const u of users || []) {
      names[u.id] = u.name;
      phones[u.id] = u.phone;
    }
  }

  const paths: string[] = (o as any).delivered_photo_paths || [];
  let photoUrls: string[] = [];
  if (paths.length) {
    const map = await getSignedUrls(paths, 3600);
    photoUrls = paths.map((p) => map[p]).filter(Boolean);
  }

  const oo = o as any;
  const order: OrderDetail = {
    id: oo.id,
    status: oo.status,
    created_at: oo.created_at,
    order_notes: oo.order_notes,
    cancellation_reason: oo.cancellation_reason,
    delivered_verified_by: oo.delivered_verified_by,
    delivered_verified_name: oo.delivered_verified_by ? names[oo.delivered_verified_by] || '—' : null,
    placed_by: oo.placed_by,
    placed_by_name: names[oo.placed_by] || '—',
    placed_by_phone: phones[oo.placed_by] ?? null,
    store_name: oo.stores?.name || 'Unknown store',
    store_address: oo.stores?.address ?? null,
    store_state: oo.stores?.state ?? null,
    store_contact: oo.stores?.contact_number ?? null,
    items: (oo.order_items || []).map((it: any) => ({
      product_name: it.products?.name || 'Unknown',
      cases: it.cases,
      bottles: it.bottles,
      free_cases: it.free_cases,
      free_bottles: it.free_bottles,
      price_per_case: it.price_per_case,
      price_per_bottle: it.price_per_bottle,
    })),
  };
  const history: HistoryRow[] = (hist || []).map((h) => ({
    ...h,
    changed_by_name: names[h.changed_by] || '—',
  }));

  return { order, history, photoUrls };
}
export function useOrderDetail(orderId: string) {
  return useQuery({ queryKey: orderDetailKey(orderId), queryFn: () => fetchOrderDetail(orderId) });
}
