import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Product {
  id: string;
  name: string;
  unit: string;
  qty_per_carton: number; // = units per case (the wizard's "units per case" field)
  product_code: string | null;
  price_per_case: number | null;
  price_per_bottle: number | null;
  is_active: boolean;
  // ── ops-updates columns (all optional) ──
  is_out_of_stock: boolean;
  brand: string | null;
  category: string | null;
  unit_type: string | null;
  unit_size: number | null;
  unit_of_measure: string | null;
  gst_percent: number | null;
  shelf_life_months: number | null;
  sku: string | null;
  barcode: string | null;
  hsn_code: string | null;
  image_path: string | null;
}

/** Display case-config, derived (never stored) so it can't drift: "24 × 180 ml". */
export function caseConfig(p: Pick<Product, 'qty_per_carton' | 'unit_size' | 'unit_of_measure' | 'unit'>): string {
  const size =
    p.unit_size != null && p.unit_of_measure
      ? `${p.unit_size} ${p.unit_of_measure}`
      : p.unit || '';
  if (p.qty_per_carton && size) return `${p.qty_per_carton} × ${size}`;
  if (size) return size;
  return p.qty_per_carton ? `${p.qty_per_carton}/case` : '';
}

async function fetchProducts(): Promise<Product[]> {
  const { data } = await supabase.from('products').select('*').order('name');
  return (data as Product[]) || [];
}

/** Full catalog (active + archived) for the management Products tab. */
export function useProducts() {
  return useQuery({ queryKey: ['products-catalog'], queryFn: fetchProducts });
}
