import { Colors } from '../constants/colors';

/** Display label + badge colour per order status. */
export const ORDER_STATUS_META: Record<string, { label: string; color: string }> = {
  placed: { label: 'Order Registered', color: Colors.accent },
  in_process: { label: 'Acknowledged', color: Colors.accent },
  dispatched: { label: 'Dispatched', color: Colors.text },
  in_transit: { label: 'In Transit', color: Colors.text },
  delivered: { label: 'Delivered', color: Colors.success },
  cancelled: { label: 'Cancelled', color: Colors.alert },
};

export const orderStatusLabel = (status: string): string =>
  ORDER_STATUS_META[status]?.label || status;
export const orderStatusColor = (status: string): string =>
  ORDER_STATUS_META[status]?.color || Colors.muted;

export interface OrderItemQty {
  cases: number;
  bottles: number;
  free_cases: number;
  free_bottles: number;
  price_per_case: number | null;
  price_per_bottle: number | null;
}

/** Priced value of an order (freebies are never valued). 0 if nothing priced. */
export function orderValue(items: OrderItemQty[]): number {
  let total = 0;
  for (const it of items) {
    if (it.price_per_case != null) total += it.cases * it.price_per_case;
    if (it.price_per_bottle != null) total += it.bottles * it.price_per_bottle;
  }
  return total;
}

export const fmtOrderPrice = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Filter buckets used by the Orders tab summary/segments. */
export type OrderFilter =
  | 'to_process'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export const ORDER_FILTER_STATUSES: Record<OrderFilter, string[]> = {
  to_process: ['placed', 'in_process'],
  dispatched: ['dispatched'],
  in_transit: ['in_transit'],
  delivered: ['delivered'],
  cancelled: ['cancelled'],
};
