import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { repCasesSold } from '../lib/reportSemantics';
import { toDateStr, addDays } from '../lib/reportExport';

// Shapes mirror the rep Dashboard's original loadData selections verbatim.
export interface StoreAssignment {
  id: string;
  store_id: string;
  stores: { id: string; name: string; address: string };
}
export interface StoreVisit {
  store_id: string;
  check_out_time: string | null;
}
export interface AttendanceRow {
  id: string;
  check_in_time: string | null;
  check_out_time: string | null;
  latitude: number | null;
  longitude: number | null;
  total_distance_km: number | null;
  total_market_time_minutes: number | null;
  /** Morning odometer, when captured. Drives the punch-out reading's
   *  "must not be below the start" check. Null = not captured today. */
  odo_start: number | null;
  odo_end: number | null;
}
export interface RepDashboardData {
  attendance: AttendanceRow | null;
  assignments: StoreAssignment[];
  visits: StoreVisit[];
  reportSubmitted: boolean;
  casesToday: number;
}

// Wraps the rep Dashboard's original fetches unchanged — only the trailing
// setState calls become a returned object.
async function fetchRepDashboard(
  userId: string,
  today: string
): Promise<RepDashboardData> {
  const { data: att } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', userId)
    .gte('check_in_time', `${today}T00:00:00`)
    .lt('check_in_time', `${today}T23:59:59`)
    .order('check_in_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: assigns } = await supabase
    .from('store_assignments')
    .select('id, store_id, stores(id, name, address)')
    .eq('user_id', userId)
    .eq('assigned_date', today);

  const { data: vis } = await supabase
    .from('store_visits')
    .select('store_id, check_out_time')
    .eq('user_id', userId)
    .gte('check_in_time', `${today}T00:00:00`)
    .lt('check_in_time', `${today}T23:59:59`);

  const { data: report } = await supabase
    .from('daily_reports')
    .select('id')
    .eq('user_id', userId)
    .eq('report_date', today)
    .maybeSingle();

  // "Cases today" routes through the single hybrid (repCasesSold → casesSold).
  // Local calendar day, matching how casesSold buckets — deliberately separate
  // from the UTC `today` the attendance/visit queries above use.
  const localToday = toDateStr(new Date());
  const localTomorrow = toDateStr(addDays(new Date(), 1));
  const casesToday = await repCasesSold(userId, localToday, localTomorrow);

  return {
    attendance: (att as AttendanceRow | null) ?? null,
    assignments: (assigns as any) || [],
    visits: (vis as StoreVisit[]) || [],
    reportSubmitted: !!report,
    casesToday,
  };
}

export function useRepDashboard(userId: string | undefined) {
  const today = new Date().toISOString().split('T')[0];
  return useQuery({
    queryKey: ['rep-dashboard', userId, today],
    enabled: !!userId,
    queryFn: () => fetchRepDashboard(userId!, today),
  });
}
