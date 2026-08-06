import { useQuery } from '@tanstack/react-query';
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

/**
 * Stores for the plan picker, scoped so the default list stays small.
 *
 * Owner decision: GPS if checked in, else assigned area.
 *  1. Checked in today with coordinates -> stores within DEFAULT_SCOPE_KM,
 *     nearest first. A rep works a ~100km radius; other-state stores are noise.
 *  2. Otherwise -> the states the rep's assigned stores sit in.
 *  3. Neither -> everything, still limited and virtualized.
 *
 * SEARCH IGNORES THE SCOPE ENTIRELY and queries the full table server-side, so
 * a store outside the box (or one with no coordinates/state at all — live data
 * has both) is always reachable by typing its name.
 */
export function usePlanStores(repId: string | undefined, search: string) {
  const q = search.trim();
  return useQuery({
    queryKey: ['plan-stores', repId, q],
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

      // ── Default scope 1: near today's punch-in. ──
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

      const lat = (att as any)?.latitude as number | null | undefined;
      const lng = (att as any)?.longitude as number | null | undefined;

      if (lat != null && lng != null) {
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
            scopeLabel: `Near you · within ${DEFAULT_SCOPE_KM} km`,
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
          scopeLabel: `Your area · ${states.join(', ')}`,
        };
      }

      // ── Default scope 3: no signal at all. ──
      const { data, error } = await supabase
        .from('stores')
        .select(COLS)
        .order('name')
        .limit(DEFAULT_LIMIT);
      if (error) throw error;
      return {
        stores: (data as PlanStore[]) ?? [],
        scope: 'all',
        scopeLabel: 'All stores — search to narrow',
      };
    },
  });
}
