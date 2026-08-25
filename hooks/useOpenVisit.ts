import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface OpenVisit {
  id: string;
  store_id: string;
  check_in_time: string;
  store: { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null };
}

/**
 * The rep's own still-open store visit for TODAY, if any.
 *
 * This is the resume BACKBONE: an open `store_visits` row (checked in, never
 * checked out) already lives in Postgres under RLS, so it survives an app kill
 * and even a device swap with no local storage involved. The encrypted draft
 * (lib/visitDraft) only restores what was typed on top of it.
 *
 * NO LONGER scoped to today. It was, on the reasoning that resuming a week-old
 * visit is nonsense — but store_visits_one_open_per_user now makes an open
 * visit BLOCKING: while it exists the rep cannot check in anywhere else. A
 * day-scoped query would hide the exact row standing in their way, leaving the
 * dashboard silent while every check-in failed. If it is open, it is the
 * rep's current session whether it started an hour ago or on Tuesday, and the
 * dashboard must offer the way to close it.
 *
 * In practice the 22:30 IST sweep closes stragglers overnight, so a
 * multi-day-old row means the sweep did not run — which is precisely when the
 * rep most needs to see it.
 */
export function useOpenVisit(repId: string | undefined) {
  return useQuery({
    queryKey: ['open-visit', repId],
    enabled: !!repId,
    refetchOnMount: false,
    queryFn: async (): Promise<OpenVisit | null> => {
      const { data, error } = await supabase
        .from('store_visits')
        .select('id, store_id, check_in_time, stores(id, name, address, latitude, longitude)')
        .eq('user_id', repId!)
        .is('check_out_time', null)
        .order('check_in_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const store = (data as any).stores;
      // A visit whose store row is gone cannot be resumed into the stepper,
      // which needs the store's coordinates to re-run its distance check.
      if (!store) return null;
      return {
        id: (data as any).id,
        store_id: (data as any).store_id,
        check_in_time: (data as any).check_in_time,
        store,
      };
    },
  });
}
