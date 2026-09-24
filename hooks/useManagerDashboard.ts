import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { ORDER_FILTER_STATUSES, OrderFilter } from '../lib/orders';

export interface RepSummary {
  id: string;
  name: string;
  visitCount: number;
  checkedIn: boolean;
  punchedOut: boolean;
}
export interface ManagerDashboardData {
  presentCount: number;
  absentCount: number;
  totalAssigned: number;
  totalVisited: number;
  reps: RepSummary[];
  pipeline: Record<OrderFilter, number>;
}

const FILTER_KEYS = Object.keys(ORDER_FILTER_STATUSES) as OrderFilter[];

// Independent reads, one parallel wave (was 5 sequential hops ≈ 3 s on a
// field connection — see useRepDashboard).
async function fetchManagerDashboard(today: string): Promise<ManagerDashboardData> {
  const [{ data: allReps }, { data: attendanceRows }, { data: assignments }, { data: visits }, { data: ords }] =
    await Promise.all([
      supabase.from('users').select('id, name').eq('role', 'rep'),
      supabase
        .from('attendance')
        .select('user_id, check_out_time')
        .gte('check_in_time', `${today}T00:00:00`)
        .lt('check_in_time', `${today}T23:59:59`),
      supabase.from('store_assignments').select('store_id').eq('assigned_date', today),
      supabase
        .from('store_visits')
        .select('store_id, user_id, check_out_time')
        .gte('check_in_time', `${today}T00:00:00`)
        .lt('check_in_time', `${today}T23:59:59`),
      supabase.from('orders').select('status'),
    ]);
  const totalReps = allReps?.length || 0;

  const checkedInIds = new Set((attendanceRows || []).map((a) => a.user_id));
  const punchedOutIds = new Set(
    (attendanceRows || []).filter((a) => a.check_out_time).map((a) => a.user_id)
  );

  const assignedStoreIds = new Set((assignments || []).map((a) => a.store_id));

  const visitedStoreIds = new Set(
    (visits || []).filter((v) => v.check_out_time).map((v) => v.store_id)
  );

  const reps: RepSummary[] = (allReps || []).map((r) => {
    const repVisits = (visits || []).filter(
      (v) => v.user_id === r.id && v.check_out_time
    );
    return {
      id: r.id,
      name: r.name,
      visitCount: repVisits.length,
      checkedIn: checkedInIds.has(r.id),
      punchedOut: punchedOutIds.has(r.id),
    };
  });

  // Open-orders glance (same bucket logic as the management dashboard).
  const pipeline: Record<OrderFilter, number> = {
    to_process: 0,
    dispatched: 0,
    in_transit: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const o of (ords as any[]) || []) {
    for (const key of FILTER_KEYS) {
      if (ORDER_FILTER_STATUSES[key].includes(o.status)) pipeline[key]++;
    }
  }

  return {
    presentCount: checkedInIds.size,
    absentCount: totalReps - checkedInIds.size,
    totalAssigned: assignedStoreIds.size,
    totalVisited: visitedStoreIds.size,
    reps,
    pipeline,
  };
}

export function useManagerDashboard() {
  const today = new Date().toISOString().split('T')[0];
  return useQuery({
    queryKey: ['manager-dashboard', today],
    queryFn: () => fetchManagerDashboard(today),
  });
}
