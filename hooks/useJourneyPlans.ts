import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { haversineKm } from '../lib/haversine';
import {
  JourneyPlan,
  PlanStatus,
  VisitFlag,
  VisitForFlags,
  flagsForVisit,
  sortFlags,
  planDateFor,
} from '../lib/journeyPlan';

const SELECT =
  'id, rep_id, plan_date, status, submitted_at, reviewed_by, reviewed_at, reject_reason, journey_plan_stores(store_id, position)';

const shape = (row: any): JourneyPlan => ({
  id: row.id,
  rep_id: row.rep_id,
  plan_date: row.plan_date,
  status: row.status,
  submitted_at: row.submitted_at,
  reviewed_by: row.reviewed_by,
  reviewed_at: row.reviewed_at,
  reject_reason: row.reject_reason,
  store_ids: (row.journey_plan_stores ?? [])
    .slice()
    .sort((a: any, b: any) => a.position - b.position)
    .map((s: any) => s.store_id),
});

// ── Rep side ──────────────────────────────────────────────────────────────

/** The signed-in rep's plan for a given local date (null when none submitted). */
export function useMyPlan(repId: string | undefined, date: string = planDateFor()) {
  return useQuery({
    queryKey: ['journey-plan', repId, date],
    enabled: !!repId,
    refetchOnMount: false,
    queryFn: async (): Promise<JourneyPlan | null> => {
      const { data, error } = await supabase
        .from('journey_plans')
        .select(SELECT)
        .eq('rep_id', repId!)
        .eq('plan_date', date)
        .maybeSingle();
      if (error) throw error;
      return data ? shape(data) : null;
    },
  });
}

/**
 * Submit a new plan, or edit + resubmit a rejected one. RLS guarantees the rep
 * can only ever land the row in 'submitted' — self-approval is impossible.
 */
export function useSubmitPlan(repId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      date,
      storeIds,
      existingPlanId,
    }: {
      date: string;
      storeIds: string[];
      existingPlanId?: string;
    }) => {
      let planId = existingPlanId;
      if (planId) {
        const { error } = await supabase
          .from('journey_plans')
          .update({ status: 'submitted', reviewed_by: null, reviewed_at: null, reject_reason: null })
          .eq('id', planId);
        if (error) throw error;
        // Route is replaced wholesale — simpler and safer than diffing, and the
        // rows are cheap. Only permitted while the plan is not approved.
        const { error: delErr } = await supabase
          .from('journey_plan_stores')
          .delete()
          .eq('plan_id', planId);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await supabase
          .from('journey_plans')
          .insert({ rep_id: repId!, plan_date: date })
          .select('id')
          .single();
        if (error) throw error;
        planId = data.id;
      }
      if (storeIds.length) {
        const { error } = await supabase
          .from('journey_plan_stores')
          .insert(storeIds.map((store_id, position) => ({ plan_id: planId, store_id, position })));
        if (error) throw error;
      }
      return planId!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journey-plan'] });
      qc.invalidateQueries({ queryKey: ['pending-plans'] });
    },
  });
}

// ── Manager side ──────────────────────────────────────────────────────────

export interface PendingPlan extends JourneyPlan {
  rep_name: string;
}

/** Plans awaiting this manager's approval. RLS scopes to reps they own. */
export function usePendingPlans() {
  return useQuery({
    queryKey: ['pending-plans'],
    refetchOnMount: false,
    queryFn: async (): Promise<PendingPlan[]> => {
      const { data, error } = await supabase
        .from('journey_plans')
        .select(SELECT)
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []).map(shape);
      const names = await repNames(rows.map((r) => r.rep_id));
      return rows.map((r) => ({ ...r, rep_name: names[r.rep_id] ?? 'Unknown rep' }));
    },
  });
}

async function repNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const { data } = await supabase.from('users').select('id, name').in('id', unique);
  const out: Record<string, string> = {};
  for (const u of data ?? []) out[u.id] = u.name;
  return out;
}

/**
 * Approve or reject. No RPC: the transition is submitted -> approved|rejected
 * and RLS enforces it completely, including "only the owning manager" and
 * "a rejection must carry a reason". Compare update_order_status, which earns
 * its RPC with five sequential stages and a role matrix.
 */
export function useReviewPlan(reviewerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      status,
      reason,
    }: {
      planId: string;
      status: Extract<PlanStatus, 'approved' | 'rejected'>;
      reason?: string;
    }) => {
      if (status === 'rejected' && !reason?.trim()) {
        throw new Error('A reason is required when sending a plan back.');
      }
      const { error } = await supabase
        .from('journey_plans')
        .update({
          status,
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
          reject_reason: status === 'rejected' ? reason!.trim() : null,
        })
        .eq('id', planId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-plans'] });
      qc.invalidateQueries({ queryKey: ['journey-plan'] });
      qc.invalidateQueries({ queryKey: ['flagged-visits'] });
    },
  });
}

/**
 * Live notification when a rep submits a plan. Reuses the live-location
 * Realtime pattern (postgres_changes on a table in the supabase_realtime
 * publication) rather than adding push notifications — no new native module,
 * so this stays OTA-shippable.
 */
export function usePlanSubmissions(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel('journey-plan-submissions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'journey_plans' },
        () => qc.invalidateQueries({ queryKey: ['pending-plans'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [enabled, qc]);
}

// ── The exception queue ───────────────────────────────────────────────────

export interface FlaggedVisit {
  visit_id: string;
  rep_id: string;
  rep_name: string;
  store_id: string | null;
  store_name: string;
  check_in_time: string | null;
  flags: VisitFlag[];
}

const QUEUE_DAYS = 7;

/**
 * Visits with at least one flag, newest first — the manager reviews THESE, not
 * all activity. Every flag but mock-location is derived here rather than
 * stored, so a client that skips a check still gets caught, and an approved
 * plan retroactively clears its visits.
 */
export function useFlaggedVisits() {
  return useQuery({
    queryKey: ['flagged-visits'],
    refetchOnMount: false,
    queryFn: async (): Promise<FlaggedVisit[]> => {
      const since = new Date(Date.now() - QUEUE_DAYS * 86_400_000).toISOString();
      const [{ data: visits, error }, { data: stores }] = await Promise.all([
        supabase
          .from('store_visits')
          .select(
            'id, user_id, store_id, check_in_time, latitude, longitude, distance_from_store_meters, is_mock_location',
          )
          .gte('check_in_time', since)
          .order('check_in_time', { ascending: true }),
        supabase.from('stores').select('id, name'),
      ]);
      if (error) throw error;
      const rows = (visits as any[]) ?? [];
      if (!rows.length) return [];

      const storeName: Record<string, string> = {};
      for (const s of stores ?? []) storeName[s.id] = s.name;

      // Plans covering the same window, keyed rep|local-date.
      const { data: planRows } = await supabase
        .from('journey_plans')
        .select(SELECT)
        .gte('plan_date', planDateFor(new Date(Date.now() - QUEUE_DAYS * 86_400_000)));
      const planBy: Record<string, JourneyPlan> = {};
      for (const p of planRows ?? []) {
        const s = shape(p);
        planBy[`${s.rep_id}|${s.plan_date}`] = s;
      }

      const names = await repNames(rows.map((v) => v.user_id));
      const prevByRep: Record<string, VisitForFlags> = {};
      const out: FlaggedVisit[] = [];

      for (const v of rows) {
        const visit: VisitForFlags = {
          id: v.id,
          store_id: v.store_id,
          check_in_time: v.check_in_time,
          latitude: v.latitude,
          longitude: v.longitude,
          distance_from_store_meters: v.distance_from_store_meters,
          is_mock_location: v.is_mock_location,
        };
        const day = v.check_in_time ? planDateFor(new Date(v.check_in_time)) : null;
        const plan = day ? planBy[`${v.user_id}|${day}`] ?? null : null;
        const flags = sortFlags(
          flagsForVisit(visit, plan, prevByRep[v.user_id] ?? null, haversineKm),
        );
        prevByRep[v.user_id] = visit;
        if (!flags.length) continue;
        out.push({
          visit_id: v.id,
          rep_id: v.user_id,
          rep_name: names[v.user_id] ?? 'Unknown rep',
          store_id: v.store_id,
          store_name: (v.store_id && storeName[v.store_id]) || 'Unknown store',
          check_in_time: v.check_in_time,
          flags,
        });
      }
      return out.reverse(); // newest first
    },
  });
}
