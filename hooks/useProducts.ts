import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Product {
  id: string;
  name: string;
  unit: string;
  qty_per_carton: number;
  product_code: string | null;
  price_per_case: number | null;
  price_per_bottle: number | null;
  is_active: boolean;
}

async function fetchProducts(): Promise<Product[]> {
  const { data } = await supabase.from('products').select('*').order('name');
  return (data as Product[]) || [];
}

/** Full catalog (active + archived) for the management Products tab. */
export function useProducts() {
  return useQuery({ queryKey: ['products-catalog'], queryFn: fetchProducts });
}
