import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { loadSellThrough } from './useSellThrough';
import { corroboratedSpotIds } from '../lib/sellThrough';
import {
  dayKey,
  dayOf,
  dayProgress,
  streak,
  personalBests,
  monthPattern,
  STREAK_LOOKBACK_DAYS,
  type ProgressInput,
  type DayProgress,
  type PersonalBests,
  type MonthPattern,
} from '../lib/reportSemantics';

/**
 * Data for the personal progress layer. Everything is DERIVED from existing
 * rows (lib/progress.ts) — this hook only fetches them. No score table exists
 * and none may be added (CLAUDE.md "Gamification").
 */

const PAGE = 1000; // PostgREST's default max rows per request

/** Every page of a query. Usually one page; a year of a busy rep is ~2–3. */
async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const shapePlans = (rows: any[]) =>
  rows.map((p) => ({
    plan_date: p.plan_date,
    status: p.status,
    store_ids: (p.journey_plan_stores ?? []).map((s: any) => s.store_id),
    rep_id: p.rep_id as string,
  }));

export interface MyProgress {
  today: DayProgress;
  streak: number;
  bests: PersonalBests;
}

/** The signed-in person's own progress — reps, and sales managers' own field work. */
export function useMyProgress(userId: string | undefined) {
  const today = dayKey(new Date());
  return useQuery({
    queryKey: ['my-progress', userId, today],
    enabled: !!userId,
    refetchOnMount: false,
    queryFn: async (): Promise<MyProgress> => {
      const sinceDay = dayKey(new Date(Date.now() - STREAK_LOOKBACK_DAYS * 86_400_000));
      const since = new Date(`${sinceDay}T00:00:00`).toISOString();
      const [att, visits, snaps, plans, spots, allTime] = await Promise.all([
        fetchAll((a, b) =>
          supabase.from('attendance').select('check_in_time').eq('user_id', userId!).gte('check_in_time', since).range(a, b),
        ),
        fetchAll((a, b) =>
          supabase
            .from('store_visits')
            .select('id, store_id, check_in_time, check_out_time, stock_skip_reason')
            .eq('user_id', userId!)
            .gte('check_in_time', since)
            .order('check_in_time')
            .range(a, b),
        ),
        fetchAll((a, b) =>
          supabase
            .from('store_stock_snapshots')
            .select('visit_id')
            .eq('recorded_by', userId!)
            .gte('recorded_at', since)
            .not('visit_id', 'is', null)
            .range(a, b),
        ),
        fetchAll((a, b) =>
          supabase
            .from('journey_plans')
            .select('plan_date, status, rep_id, journey_plan_stores(store_id)')
            .eq('rep_id', userId!)
            .gte('plan_date', sinceDay)
            .range(a, b),
        ),
        fetchAll((a, b) =>
          supabase
            .from('spot_sales')
            .select('id, store_id, created_at')
            .eq('user_id', userId!)
            .is('undone_at', null)
            .gte('created_at', since)
            .range(a, b),
        ),
        // All-time visit count for milestones — the window above is a year.
        supabase.from('store_visits').select('id', { count: 'exact', head: true }).eq('user_id', userId!),
      ]);
      if (allTime.error) throw allTime.error;

      // Corroboration needs the stores' counts and deliveries — second wave,
      // only for someone who has logged spot sales at all.
      const spotStores = [...new Set(spots.map((s) => s.store_id))];
      const corroborated = spotStores.length
        ? corroboratedSpotIds((await loadSellThrough(spotStores, STREAK_LOOKBACK_DAYS + 30)).intervals)
        : new Set<string>();

      const input: ProgressInput = {
        workedDays: new Set(att.filter((r) => r.check_in_time).map((r) => dayOf(r.check_in_time))),
        visits,
        countedVisitIds: new Set(snaps.map((s) => s.visit_id)),
        plans: shapePlans(plans),
        spots,
        corroboratedSpotIds: corroborated,
      };
      const bests = personalBests(today, input);
      bests.lifetimeVisits = Math.max(bests.lifetimeVisits, allTime.count ?? 0);
      return { today: dayProgress(today, input), streak: streak(today, input), bests };
    },
  });
}

export interface PersonPattern {
  userId: string;
  name: string;
  role: string;
  pattern: MonthPattern;
}

/**
 * Management only: each field user's month — plans completed, stock counted.
 * Listed by NAME, never sorted by score: this is a coaching signal, not a
 * ranking (CLAUDE.md "Gamification").
 */
export function useTeamPatterns(enabled: boolean) {
  const now = new Date();
  const today = dayKey(now);
  const month = today.slice(0, 7);
  return useQuery({
    queryKey: ['team-patterns', month, today],
    enabled,
    refetchOnMount: false,
    queryFn: async (): Promise<PersonPattern[]> => {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const [users, att, visits, snaps, plans] = await Promise.all([
        fetchAll((a, b) =>
          supabase
            .from('users')
            .select('id, name, role')
            .in('role', ['rep', 'sales_manager'])
            .eq('is_active', true)
            .order('name')
            .range(a, b),
        ),
        fetchAll((a, b) => supabase.from('attendance').select('user_id, check_in_time').gte('check_in_time', start).range(a, b)),
        fetchAll((a, b) =>
          supabase
            .from('store_visits')
            .select('id, user_id, store_id, check_in_time, check_out_time, stock_skip_reason')
            .gte('check_in_time', start)
            .range(a, b),
        ),
        fetchAll((a, b) =>
          supabase
            .from('store_stock_snapshots')
            .select('visit_id')
            .gte('recorded_at', start)
            .not('visit_id', 'is', null)
            .range(a, b),
        ),
        fetchAll((a, b) =>
          supabase
            .from('journey_plans')
            .select('plan_date, status, rep_id, journey_plan_stores(store_id)')
            .gte('plan_date', `${month}-01`)
            .range(a, b),
        ),
      ]);
      const counted = new Set(snaps.map((s) => s.visit_id));
      const allPlans = shapePlans(plans);
      return users.map((u) => {
        const input: ProgressInput = {
          workedDays: new Set(att.filter((r) => r.user_id === u.id && r.check_in_time).map((r) => dayOf(r.check_in_time))),
          visits: visits.filter((v) => v.user_id === u.id),
          countedVisitIds: counted,
          plans: allPlans.filter((p) => p.rep_id === u.id),
          spots: [],
          corroboratedSpotIds: new Set(),
        };
        return { userId: u.id, name: u.name, role: u.role, pattern: monthPattern(month, today, input) };
      });
    },
  });
}
