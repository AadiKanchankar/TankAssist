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
}

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
