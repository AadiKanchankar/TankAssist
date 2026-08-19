import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';
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
  planCutoffDate,
} from '../lib/journeyPlan';
import { mismatchFlag } from '../lib/odometer';

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
  /**
   * A rep with no assigned_manager_id is invisible to every sales_manager
   * (manages_rep only matches an SM to their own reports), so ONLY management
   * can action their plan. Surfaced on the card so it doesn't sit unreviewed
   * forever with nobody realising why.
   */
  rep_has_manager: boolean;
}

export interface PendingPlans {
  plans: PendingPlan[];
  /**
   * Submitted plans too old to be worth approving, which this list deliberately
   * omits. Surfaced as a COUNT so the empty state can say "4 older plans are no
   * longer actionable" — a bare "nothing waiting" over a silently dropped pile
   * would tell the manager they were done when they were not.
   */
  staleCount: number;
}

/**
 * Plans awaiting this manager's approval. RLS scopes to reps they own.
 *
 * Scoped to PLAN_ACTIONABLE_DAYS: the query was previously unbounded and
 * returned every submitted plan ever, which is both the slowness and the
 * clutter — live data held 4 submitted plans, all 10-12 days old, none of them
 * still meaningful to approve.
 */
export function usePendingPlans(viewerId?: string) {
  return useQuery({
    queryKey: ['pending-plans', viewerId],
    refetchOnMount: false,
    queryFn: async (): Promise<PendingPlans> => {
      const cutoff = planCutoffDate();
      // Exclude plans the VIEWER submitted. The read policy lets you see your
      // own plans (rep_id = auth.uid()), but nobody manages themselves, so
      // yours can never be approved by you. Listing them as "awaiting your
      // approval" is what made three live plans look permanently broken —
      // visible in the queue, refused on every tap.
      const listBase = supabase
        .from('journey_plans')
        .select(SELECT)
        .eq('status', 'submitted')
        .gte('plan_date', cutoff);
      // head:true — we want the number, not the rows.
      const staleBase = supabase
        .from('journey_plans')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted')
        .lt('plan_date', cutoff);

      const [{ data, error }, { count, error: countError }] = await Promise.all([
        (viewerId ? listBase.neq('rep_id', viewerId) : listBase).order('submitted_at', {
          ascending: true,
        }),
        viewerId ? staleBase.neq('rep_id', viewerId) : staleBase,
      ]);
      if (error) throw error;
      if (countError) throw countError;

      const rows = (data ?? []).map(shape);
      const info = await repInfo(rows.map((r) => r.rep_id));
      return {
        plans: rows.map((r) => ({
          ...r,
          rep_name: info[r.rep_id]?.name ?? 'Unknown rep',
          rep_has_manager: info[r.rep_id]?.hasManager ?? false,
        })),
        staleCount: count ?? 0,
      };
    },
  });
}

interface RepInfo {
  name: string;
  hasManager: boolean;
}

/**
 * Names + manager linkage for a set of rep ids.
 *
 * Nulls are filtered out before the query: store_visits.user_id is nullable,
 * and passing a null into .in() errors the whole request rather than just
 * skipping that row. A missing id simply resolves to "Unknown rep" — an
 * unattributable row must never take the screen down.
 */
async function repInfo(ids: (string | null)[]): Promise<Record<string, RepInfo>> {
  const unique = [...new Set(ids)].filter((id): id is string => !!id);
  if (!unique.length) return {};
  const { data } = await supabase
    .from('users')
    .select('id, name, assigned_manager_id')
    .in('id', unique);
  const out: Record<string, RepInfo> = {};
  for (const u of data ?? []) {
    out[u.id] = { name: u.name ?? 'Unknown rep', hasManager: !!u.assigned_manager_id };
  }
  return out;
}

/**
 * Why a review update matched no rows.
 *
 * Called only on the failure path, so the extra round-trip costs nothing in
 * the normal case. Distinguishes the causes that actually occur: already
 * reviewed (by whom), your own plan, or genuinely not yours.
 */
async function explainFailedReview(planId: string, reviewerId?: string): Promise<string> {
  const { data } = await supabase
    .from('journey_plans')
    .select('status, rep_id, reviewed_by')
    .eq('id', planId)
    .maybeSingle();

  if (!data) return 'This plan is no longer visible to you. Pull to refresh.';

  const row = data as { status: PlanStatus; rep_id: string; reviewed_by: string | null };

  if (row.status !== 'submitted') {
    const who = row.reviewed_by ? (await repInfo([row.reviewed_by]))[row.reviewed_by]?.name : null;
    const verb = row.status === 'approved' ? 'approved' : 'sent back';
    return who
      ? `Already ${verb} by ${who}. Pull to refresh.`
      : `This plan was already ${verb}. Pull to refresh.`;
  }

  if (reviewerId && row.rep_id === reviewerId) {
    return 'This is your own plan — it has to be reviewed by someone else.';
  }

  return 'This rep is not assigned to you, so their plan is not yours to review.';
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
      // .select() so we can tell "RLS matched nothing" from "it worked".
      // Without it an update the policy filters out returns no error and the
      // UI cheerfully reports success while the plan stays submitted.
      const { data, error } = await supabase
        .from('journey_plans')
        .update({
          status,
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
          reject_reason: status === 'rejected' ? reason!.trim() : null,
        })
        .eq('id', planId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        // 0 rows has several distinct causes and the old message guessed at
        // them ("reviewed already, or the rep is not assigned to you"), which
        // was wrong for every stuck plan. Read the row back and say what
        // actually happened — including WHO reviewed it, per the idempotency
        // requirement, so a second approve is answered with a fact.
        throw new Error(await explainFailedReview(planId, reviewerId));
      }
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
  // The channel topic MUST be unique per hook instance. Team and the review
  // queue both mount this, and a native stack keeps Team mounted when the
  // queue is pushed on top — so a shared topic means two subscribes on one
  // topic, which Realtime rejects ("can only be called a single time per
  // channel instance") and which surfaced as a crash on opening the queue.
  // Same convention as locreq-${repId} / locreq-req-${id}.
  const instanceId = useId();
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel(`journey-plans-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'journey_plans' },
        () => qc.invalidateQueries({ queryKey: ['pending-plans'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [enabled, qc, instanceId]);
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

/**
 * A day whose odometer distance far exceeds the tracked GPS route.
 *
 * Derived, not stored — same posture as every other flag but mock-location:
 * both numbers already live on the attendance row, so the signal comes from
 * the data rather than from whether a client chose to record it.
 */
export interface FlaggedDay {
  attendance_id: string;
  rep_id: string;
  rep_name: string;
  date: string;
  odoKm: number;
  gpsKm: number;
  excessKm: number;
  reason: string;
}

const QUEUE_DAYS = 7;

/**
 * Hard cap on visits scanned per queue open.
 *
 * A 7-day window is normally far under this; the cap exists so one abnormal
 * week (or a manager with a large team) cannot turn the queue into an
 * unbounded fetch. Flags are derived client-side, so the row count is real
 * work, not just transfer.
 */
const VISIT_SCAN_LIMIT = 500;

/**
 * How many work artifacts each visit produced, keyed by visit id.
 *
 * Three narrow selects of just `visit_id` rather than a counting RPC: the ids
 * are already in hand and the window is bounded to QUEUE_DAYS, so adding a
 * database object for a tally the client can do would be the expensive way
 * round.
 *
 * A failure here THROWS rather than returning partial counts. A missing row
 * reads as "this rep recorded nothing", so silently swallowing a network error
 * would accuse every honest rep in the window — the one direction this flag
 * must never fail in.
 */
async function artifactCounts(visitIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!visitIds.length) return out;

  const results = await Promise.all([
    supabase.from('store_visit_photos').select('visit_id').in('visit_id', visitIds),
    supabase.from('store_stock_snapshots').select('visit_id').in('visit_id', visitIds),
    supabase.from('orders').select('visit_id').in('visit_id', visitIds),
    // A challan logged inside a visit is work done at that shop, so it must
    // count — otherwise a rep whose only task there was recording a delivery
    // gets accused of a phantom visit.
    supabase.from('challans').select('visit_id').in('visit_id', visitIds),
  ]);
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of (data as { visit_id: string | null }[]) ?? []) {
      if (row.visit_id) out[row.visit_id] = (out[row.visit_id] ?? 0) + 1;
    }
  }
  return out;
}

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
      const { data: visits, error } = await supabase
        .from('store_visits')
        .select(
          'id, user_id, store_id, check_in_time, check_out_time, notes, latitude, longitude, distance_from_store_meters, is_mock_location, auto_closed',
        )
        .gte('check_in_time', since)
        // Newest first so the cap keeps the RECENT window when a busy week
        // exceeds it — an ascending limit would keep the oldest and silently
        // hide today's flags, the exact opposite of what a queue is for.
        .order('check_in_time', { ascending: false })
        .limit(VISIT_SCAN_LIMIT);
      if (error) throw error;
      // Back to chronological: the movement check compares each visit with the
      // same rep's PREVIOUS one, which only holds in time order.
      const rows = ((visits as any[]) ?? []).reverse();
      if (!rows.length) return [];

      const storeIds = [...new Set(rows.map((v) => v.store_id).filter(Boolean))];

      // One parallel wave. These were three sequential round-trips, and the
      // store lookup fetched the ENTIRE stores table to build a name map.
      const [artifacts, { data: stores }, { data: planRows }] = await Promise.all([
        artifactCounts(rows.map((v) => v.id)),
        supabase.from('stores').select('id, name').in('id', storeIds),
        supabase
          .from('journey_plans')
          .select(SELECT)
          .gte('plan_date', planDateFor(new Date(Date.now() - QUEUE_DAYS * 86_400_000))),
      ]);

      const storeName: Record<string, string> = {};
      for (const s of stores ?? []) storeName[s.id] = s.name;

      // Plans covering the same window, keyed rep|local-date.
      const planBy: Record<string, JourneyPlan> = {};
      for (const p of planRows ?? []) {
        const s = shape(p);
        planBy[`${s.rep_id}|${s.plan_date}`] = s;
      }

      const info = await repInfo(rows.map((v) => v.user_id));
      const prevByRep: Record<string, VisitForFlags> = {};
      const out: FlaggedVisit[] = [];

      for (const v of rows) {
        // An unattributable visit can't be reviewed against a rep's plan, and
        // it must not crash the queue for every other row.
        if (!v.user_id) continue;
        const visit: VisitForFlags = {
          id: v.id,
          store_id: v.store_id,
          check_in_time: v.check_in_time,
          check_out_time: v.check_out_time,
          latitude: v.latitude,
          longitude: v.longitude,
          distance_from_store_meters: v.distance_from_store_meters,
          is_mock_location: v.is_mock_location,
          auto_closed: v.auto_closed,
          // A written note is work too, so it counts against the phantom-visit
          // flag even though it carries no timestamp of its own.
          artifact_count: (artifacts[v.id] ?? 0) + (v.notes?.trim() ? 1 : 0),
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
          rep_name: info[v.user_id]?.name ?? 'Unknown rep',
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

/**
 * Days where the odometer claim outruns the GPS route by a gross margin.
 *
 * Only over-claims flag, and the tolerance is deliberately generous — a real
 * day includes petrol, lunch and wrong turns, so some overshoot is normal and
 * must never read as dishonesty. See MISMATCH_PERCENT / MISMATCH_FLOOR_KM in
 * lib/odometer.ts, which are the single place to tune this.
 */
export function useOdometerFlags() {
  return useQuery({
    queryKey: ['odometer-flags'],
    refetchOnMount: false,
    queryFn: async (): Promise<FlaggedDay[]> => {
      const since = new Date(Date.now() - QUEUE_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('attendance')
        .select('id, user_id, check_in_time, odo_start, odo_end, total_distance_km')
        .gte('check_in_time', since)
        .not('odo_end', 'is', null)
        .order('check_in_time', { ascending: false });
      if (error) throw error;

      const rows = (data as any[]) ?? [];
      if (!rows.length) return [];
      const info = await repInfo(rows.map((r) => r.user_id));

      const out: FlaggedDay[] = [];
      for (const r of rows) {
        if (!r.user_id) continue;
        const m = mismatchFlag(r.odo_start, r.odo_end, r.total_distance_km);
        if (!m.flagged) continue;
        out.push({
          attendance_id: r.id,
          rep_id: r.user_id,
          rep_name: info[r.user_id]?.name ?? 'Unknown rep',
          date: r.check_in_time ? planDateFor(new Date(r.check_in_time)) : '',
          odoKm: m.odoKm!,
          gpsKm: m.gpsKm!,
          excessKm: m.excessKm!,
          reason: m.reason!,
        });
      }
      return out;
    },
  });
}
