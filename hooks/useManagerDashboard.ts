import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { ORDER_FILTER_STATUSES, OrderFilter } from '../lib/orders';
import { teamFigure, teamDistinct, TeamFigure } from '../lib/reportSemantics';

export interface RepSummary {
  id: string;
  name: string;
  visitCount: number;
  checkedIn: boolean;
  punchedOut: boolean;
}
export interface ManagerDashboardData {
  /** The SM's own reps (assigned to them, or unassigned — the manages_rep rule). */
  repsPresent: number;
  repsTotal: number;
  /** The sales manager's own day — they are part of the team total. */
  meCheckedIn: boolean;
  mePunchedOut: boolean;
  /** Completed visits today, repeats included; of which the SM's own. */
  visits: TeamFigure;
  /** Distinct stores visited today; of which the SM visited. */
  stores: TeamFigure;
  /** Assigned stores visited / assigned stores (reps' assignments only). */
  coveragePct: number;
  /** Reps only — never the manager, so it is never a manager-vs-rep ranking. */
  reps: RepSummary[];
  pipeline: Record<OrderFilter, number>;
}

const FILTER_KEYS = Object.keys(ORDER_FILTER_STATUSES) as OrderFilter[];

// Independent reads, one parallel wave (was 5 sequential hops ≈ 3 s on a
// field connection — see useRepDashboard).
async function fetchManagerDashboard(today: string, me: string): Promise<ManagerDashboardData> {
  const [{ data: allReps }, { data: attendanceRows }, { data: assignments }, { data: visits }, { data: ords }] =
    await Promise.all([
      supabase.from('users').select('id, name, assigned_manager_id').eq('role', 'rep').eq('is_active', true),
      supabase
        .from('attendance')
        .select('user_id, check_out_time')
        .gte('check_in_time', `${today}T00:00:00`)
        .lt('check_in_time', `${today}T23:59:59`),
      supabase.from('store_assignments').select('store_id, user_id').eq('assigned_date', today),
      supabase
        .from('store_visits')
        .select('store_id, user_id, check_out_time')
        .gte('check_in_time', `${today}T00:00:00`)
        .lt('check_in_time', `${today}T23:59:59`),
      supabase.from('orders').select('status'),
    ]);

  // The team = this manager's reps, by the same rule RLS applies
  // (manages_rep): assigned to them, or assigned to nobody. Listing every rep
  // in the company showed other teams' reps as "not checked in" — RLS hides
  // their attendance from this manager, so absence was an artefact.
  const team = (allReps || []).filter((r) => r.assigned_manager_id === me || r.assigned_manager_id == null);
  const teamIds = new Set(team.map((r) => r.id));
  const inScope = (userId: string) => teamIds.has(userId) || userId === me;
  const mine = (r: { user_id: string }) => r.user_id === me;

  const att = (attendanceRows || []).filter((a) => inScope(a.user_id));
  const checkedInIds = new Set(att.map((a) => a.user_id));
  const punchedOutIds = new Set(att.filter((a) => a.check_out_time).map((a) => a.user_id));

  const done = (visits || []).filter((v) => v.check_out_time && inScope(v.user_id));

  const assigned = new Set((assignments || []).filter((a) => teamIds.has(a.user_id)).map((a) => a.store_id));
  const visitedStores = new Set(done.map((v) => v.store_id));
  const assignedVisited = [...assigned].filter((id) => visitedStores.has(id)).length;

  const reps: RepSummary[] = team.map((r) => ({
    id: r.id,
    name: r.name,
    visitCount: done.filter((v) => v.user_id === r.id).length,
    checkedIn: checkedInIds.has(r.id),
    punchedOut: punchedOutIds.has(r.id),
  }));

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
    repsPresent: team.filter((r) => checkedInIds.has(r.id)).length,
    repsTotal: team.length,
    meCheckedIn: checkedInIds.has(me),
    mePunchedOut: punchedOutIds.has(me),
    visits: teamFigure(done, () => 1, mine),
    stores: teamDistinct(done, (v) => v.store_id, mine),
    coveragePct: assigned.size > 0 ? Math.round((assignedVisited / assigned.size) * 100) : 0,
    reps,
    pipeline,
  };
}

export function useManagerDashboard(me: string | undefined) {
  const today = new Date().toISOString().split('T')[0];
  return useQuery({
    queryKey: ['manager-dashboard', today, me],
    enabled: !!me,
    queryFn: () => fetchManagerDashboard(today, me!),
  });
}
