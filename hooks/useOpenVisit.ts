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
 * Scoped to today deliberately. Live data already holds visits left open for
 * days; offering to "resume" a week-old visit would be nonsense, and it would
 * also fight the stepper, whose own check-in lookup is same-day. Anything
 * older is an abandoned record for a manager to reconcile, not a session.
 */
export function useOpenVisit(repId: string | undefined) {
  return useQuery({
    queryKey: ['open-visit', repId],
    enabled: !!repId,
    refetchOnMount: false,
    queryFn: async (): Promise<OpenVisit | null> => {
      const today = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const ymd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
      const { data, error } = await supabase
        .from('store_visits')
        .select('id, store_id, check_in_time, stores(id, name, address, latitude, longitude)')
        .eq('user_id', repId!)
        .is('check_out_time', null)
        .gte('check_in_time', `${ymd}T00:00:00`)
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
