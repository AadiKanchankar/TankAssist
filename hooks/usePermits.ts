import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type PermitStatus = 'pending_review' | 'approved' | 'rejected';
export type MovementDirection =
  | 'factory_to_warehouse'
  | 'warehouse_to_l1'
  | 'internal_transfer'
  | 'unclassified';

export const DIRECTION_LABEL: Record<MovementDirection, string> = {
  factory_to_warehouse: 'Factory → warehouse',
  warehouse_to_l1: 'Warehouse → L1',
  internal_transfer: 'Internal transfer',
  unclassified: 'Unclassified',
};

export interface Permit {
  id: string;
  state: string;
  permit_number: string;
  license_no_source: string | null;
  license_no_dest: string | null;
  licensee_name_source: string | null;
  licensee_name_dest: string | null;
  liquor_class: string | null;
  quantity_value: number;
  quantity_type: 'BL' | 'PL' | 'UNKNOWN';
  permit_date: string | null;
  permit_generated_at: string | null;
  valid_until: string | null;
  original_file_path: string;
  extracted_json: any;
  parser_version: string;
  status: PermitStatus;
  movement_direction: MovementDirection;
  facility_from_id: string | null;
  facility_to_id: string | null;
  uploaded_by: string;
  uploaded_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
}

export interface Allocation {
  id: string;
  permit_id: string;
  product_id: string;
  allocated_bl: number;
  computed_bottles: number | null;
  computed_cases: number | null;
  remainder_bottles: number | null;
  needs_review: boolean;
  conversion_formula_version: string;
}

async function fetchPermits(): Promise<Permit[]> {
  const { data } = await supabase
    .from('excise_permits')
    .select('*')
    .order('uploaded_at', { ascending: false });
  return (data as Permit[]) || [];
}

/** Management-only (RLS). Newest first; the review queue filters client-side. */
export function usePermits() {
  return useQuery({ queryKey: ['excise-permits'], queryFn: fetchPermits });
}

export const permitDetailKey = (id: string) => ['excise-permit', id];

export interface PermitDetail {
  permit: Permit;
  allocations: Allocation[];
}

export async function fetchPermitDetail(id: string): Promise<PermitDetail | null> {
  const { data: permit } = await supabase.from('excise_permits').select('*').eq('id', id).maybeSingle();
  if (!permit) return null;
  const { data: allocations } = await supabase
    .from('permit_product_allocations')
    .select('*')
    .eq('permit_id', id);
  return { permit: permit as Permit, allocations: (allocations as Allocation[]) || [] };
}

export function usePermitDetail(id: string | null) {
  return useQuery({
    queryKey: permitDetailKey(id ?? 'none'),
    enabled: !!id,
    queryFn: () => fetchPermitDetail(id!),
  });
}

/**
 * Bottle/case math — the single client-side implementation of §4, kept
 * identical to the Edge Function's. Returns nulls (never a guess) when the
 * product's unit_size/unit_of_measure aren't set or the quantity isn't in BL.
 */
export const CONVERSION_FORMULA_VERSION = 'bl-v1';
const CONVERSION_TOLERANCE_BOTTLES = 0.05;
const LITRES_PER: Record<string, number> = { ml: 0.001, l: 1, cl: 0.01, litre: 1, liter: 1 };

export function computeAllocation(
  allocatedBl: number,
  quantityType: 'BL' | 'PL' | 'UNKNOWN',
  product: { unit_size: number | null; unit_of_measure: string | null; qty_per_carton: number },
): { computed_bottles: number | null; computed_cases: number | null; remainder_bottles: number | null; needs_review: boolean; reason: string | null } {
  const uom = (product.unit_of_measure ?? '').trim().toLowerCase();
  const litresPerUnit = LITRES_PER[uom];
  const bottleLitres = product.unit_size != null && litresPerUnit ? Number(product.unit_size) * litresPerUnit : null;

  if (quantityType === 'PL') {
    return { computed_bottles: null, computed_cases: null, remainder_bottles: null, needs_review: true,
      reason: 'Proof Litres is strength-adjusted, not physical volume — enter the case count manually.' };
  }
  if (quantityType === 'UNKNOWN') {
    return { computed_bottles: null, computed_cases: null, remainder_bottles: null, needs_review: true,
      reason: 'The permit’s quantity unit could not be read — enter the case count manually.' };
  }
  if (!bottleLitres || bottleLitres <= 0) {
    return { computed_bottles: null, computed_cases: null, remainder_bottles: null, needs_review: true,
      reason: 'This product has no unit size / measure set, so bottles can’t be calculated. Set them in Products, or enter the case count manually.' };
  }

  const raw = allocatedBl / bottleLitres;
  const bottles = Math.round(raw);
  const perCase = Number(product.qty_per_carton) || 0;
  const cases = perCase > 0 ? Math.floor(bottles / perCase) : 0;
  const remainder = perCase > 0 ? bottles - cases * perCase : bottles;
  const off = Math.abs(raw - bottles) > CONVERSION_TOLERANCE_BOTTLES;
  return {
    computed_bottles: bottles,
    computed_cases: cases,
    remainder_bottles: remainder,
    needs_review: off,
    reason: off ? 'The volume doesn’t divide into whole bottles for this product — check the product match.' : null,
  };
}
