import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { financialYearLabel, financialYearStartYmd } from '../lib/financialYear';
import { computeAnalytics, InventoryAnalytics, MovementRow } from '../lib/inventoryMath';

// Re-exported so screens have one import for both the data and its formatting.
export { fmtQty } from '../lib/inventoryMath';
export type { Qty, ProductBalance, WarehouseBalance, InventoryAnalytics } from '../lib/inventoryMath';

async function fetchInventoryAnalytics(): Promise<InventoryAnalytics> {
  const fyStartYmd = financialYearStartYmd();
  const [{ data: moves }, { data: products }, { data: facilities }] = await Promise.all([
    supabase
      .from('inventory_movements')
      .select('product_id, direction, facility_from_id, facility_to_id, cases, remainder_bottles, movement_date'),
    supabase.from('products').select('id, name, qty_per_carton'),
    supabase.from('company_facilities').select('id, name, facility_type'),
  ]);
  return {
    fyLabel: financialYearLabel(),
    ...computeAnalytics(
      (moves as MovementRow[]) ?? [],
      (products as any[]) ?? [],
      (facilities as any[]) ?? [],
      fyStartYmd,
    ),
  };
}

/** Management-only (inventory_movements is management-read by RLS). */
export function useInventoryAnalytics() {
  return useQuery({ queryKey: ['inventory-analytics'], queryFn: fetchInventoryAnalytics });
}
