import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type FacilityType = 'factory' | 'warehouse';

export interface Facility {
  id: string;
  name: string;
  license_no: string;
  license_type: string | null;
  state: string;
  facility_type: FacilityType;
  is_active: boolean;
  created_at: string;
  /** Licence validity. An expired licence stays listed but is skipped when
   *  auto-matching a permit's licence numbers to a facility. */
  valid_from: string | null;
  valid_until: string | null;
}

/** True once valid_until is in the past (date-only compare). */
export const isLicenceExpired = (validUntil: string | null): boolean =>
  !!validUntil && validUntil < new Date().toISOString().slice(0, 10);

async function fetchFacilities(): Promise<Facility[]> {
  const { data } = await supabase
    .from('company_facilities')
    .select('*')
    .order('facility_type')
    .order('name');
  return (data as Facility[]) || [];
}

/**
 * Our own factory/warehouse registry. Anything NOT in here is treated as an
 * external party (distributor / L1) when classifying a permit's movement.
 * Read is all-authenticated; writes are management-only (RLS).
 */
export function useFacilities() {
  return useQuery({ queryKey: ['company-facilities'], queryFn: fetchFacilities });
}
