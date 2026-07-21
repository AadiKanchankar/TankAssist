import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type Role = 'rep' | 'sales_manager' | 'management';

export interface Member {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  is_active: boolean;
  assigned_manager_id: string | null;
}

// Management sees everyone; sales managers see reps only (UI-level scope).
async function fetchTeam(role: Role | undefined): Promise<Member[]> {
  let query = supabase
    .from('users')
    .select('id, name, email, phone, role, is_active, assigned_manager_id')
    .order('name');
  if (role !== 'management') query = query.eq('role', 'rep');
  const { data } = await query;
  return (data as Member[]) || [];
}

export function useTeam(role: Role | undefined) {
  return useQuery({ queryKey: ['team', role], queryFn: () => fetchTeam(role) });
}
