import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { haversineKm } from '../lib/haversine';
import { boundingBox, byDistanceFrom, DEFAULT_SCOPE_KM } from '../lib/geoScope';

export interface PlanStore {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  state: string | null;
}

/** How many stores the default (unsearched) list pulls. */
const DEFAULT_LIMIT = 200;
/** Search reaches the whole table, but still bounded. */
const SEARCH_LIMIT = 50;

export type ScopeKind = 'nearby' | 'area' | 'all';

export interface ScopedStores {
  stores: PlanStore[];
  scope: ScopeKind;
  /** Human label for the list header, so the rep knows why these stores. */
  scopeLabel: string;
}

const COLS = 'id, name, address, latitude, longitude, state';

/** A GPS fix taking longer than this falls back to area/all rather than hang the list. */
const FIX_TIMEOUT_MS = 6000;
/** Older than this, a last-known fix may be another city (the rep travelled) — take a fresh one. */
const LAST_KNOWN_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Where the phone is, WITHOUT prompting: only if location is already granted
 * (attendance requires it, so reps have), last-known first because it's
 * instant and a 100 km radius doesn't need precision. Null on any failure.
 */
async function devicePosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    if ((await Location.getForegroundPermissionsAsync()).status !== 'granted') return null;
    const loc =
      (await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS })) ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), FIX_TIMEOUT_MS)),
      ]));
    return loc ? { lat: loc.coords.latitude, lng: loc.coords.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * Stores for the plan picker, scoped so the default list stays small.
 *
 * Owner decision: nearby (~DEFAULT_SCOPE_KM) by default, with an explicit
 * "All stores" toggle. Where "nearby" is measured from, in order:
 *  1. Today's punch-in position, when checked in.
 *  2. The phone's own position. This is the one that matters in practice:
 *     reps plan BEFORE punching in, and live reps have no assigned stores with
 *     a state, so without it rules 1 and 3 had no input for anyone and every
 *     plan fell through to "All stores".
 *  3. The states the rep's assigned stores sit in.
 *  4. Nothing to go on -> everything, still limited and virtualized, and the
 *     label says why.
 *
 * SEARCH IGNORES THE SCOPE ENTIRELY and queries the full table server-side, so
 * a store outside the box (or one with no coordinates/state at all — live data
 * has both) is always reachable by typing its name.
 */
export function usePlanStores(repId: string | undefined, search: string, showAll = false) {
  const q = search.trim();
  return useQuery({
    queryKey: ['plan-stores', repId, q, showAll],
    enabled: !!repId,
    refetchOnMount: false,
    queryFn: async (): Promise<ScopedStores> => {
      // ── Search: full table, no scope. ──
      if (q.length >= 2) {
        const { data, error } = await supabase
          .from('stores')
          .select(COLS)
          .ilike('name', `%${q}%`)
          .order('name')
          .limit(SEARCH_LIMIT);
        if (error) throw error;
        return {
          stores: (data as PlanStore[]) ?? [],
          scope: 'all',
          scopeLabel: `Matching “${q}” — all areas`,
        };
      }

      if (showAll) return allStores('All stores · search by name to narrow');

      // ── Default scope 1/2: near today's punch-in, else near the phone. ──
      const today = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const ymd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
      const { data: att } = await supabase
        .from('attendance')
        .select('latitude, longitude')
        .eq('user_id', repId!)
        .gte('check_in_time', `${ymd}T00:00:00`)
        .order('check_in_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      const punchIn =
        (att as any)?.latitude != null && (att as any)?.longitude != null
          ? { lat: (att as any).latitude as number, lng: (att as any).longitude as number }
          : null;
      const here = punchIn ?? (await devicePosition());

      if (here) {
        const { lat, lng } = here;
        const b = boundingBox(lat, lng, DEFAULT_SCOPE_KM);
        const { data, error } = await supabase
          .from('stores')
          .select(COLS)
          .gte('latitude', b.minLat)
          .lte('latitude', b.maxLat)
          .gte('longitude', b.minLng)
          .lte('longitude', b.maxLng)
          .limit(DEFAULT_LIMIT);
        if (error) throw error;
        const rows = (data as PlanStore[]) ?? [];
        if (rows.length) {
          return {
            stores: byDistanceFrom(rows, lat, lng, haversineKm),
            scope: 'nearby',
            scopeLabel: `Nearby stores · within ${DEFAULT_SCOPE_KM} km · tap All to see everything`,
          };
        }
        // Fall through when the box is empty (rep working a new area) rather
        // than showing them nothing.
      }

      // ── Default scope 2: the states the rep's assigned stores are in. ──
      const { data: assigns } = await supabase
        .from('store_assignments')
        .select('stores(state)')
        .eq('user_id', repId!);
      const states = [
        ...new Set(
          ((assigns as any[]) ?? [])
            .map((a) => a.stores?.state)
            .filter((s: string | null): s is string => !!s),
        ),
      ];

      if (states.length) {
        const { data, error } = await supabase
          .from('stores')
          .select(COLS)
          .in('state', states)
          .order('name')
          .limit(DEFAULT_LIMIT);
        if (error) throw error;
        return {
          stores: (data as PlanStore[]) ?? [],
          scope: 'area',
          scopeLabel: `Your area · ${states.join(', ')} · tap All to see everything`,
        };
      }

      // ── Nothing to go on: say so, rather than let "All" look like the default. ──
      return allStores(
        here
          ? `No stores within ${DEFAULT_SCOPE_KM} km · showing all stores`
          : 'Location unavailable · showing all stores',
      );
    },
  });
}

async function allStores(scopeLabel: string): Promise<ScopedStores> {
  const { data, error } = await supabase.from('stores').select(COLS).order('name').limit(DEFAULT_LIMIT);
  if (error) throw error;
  return { stores: (data as PlanStore[]) ?? [], scope: 'all', scopeLabel };
}
