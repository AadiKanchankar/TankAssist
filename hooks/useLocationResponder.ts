import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

/**
 * Rep-side live-location responder. While the rep is checked in, subscribes to
 * new pending `location_requests` targeting them, takes one GPS reading, and
 * writes it back. Does NOT subscribe while not checked in (a request for a
 * not-checked-in rep fails fast on the requester side, not here). Re-evaluates
 * checked-in state on app foreground. Rep role only.
 */
export function useLocationResponder() {
  const profile = useAuthStore((s) => s.profile);
  const repId = profile?.role === 'rep' ? profile.id : undefined;
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!repId) return;
    let cancelled = false;

    const isCheckedIn = async (): Promise<boolean> => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('attendance')
        .select('check_out_time')
        .eq('user_id', repId)
        .gte('check_in_time', `${today}T00:00:00`)
        .lt('check_in_time', `${today}T23:59:59`)
        .order('check_in_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      return !!data && !data.check_out_time;
    };

    const respond = async (req: any) => {
      if (!req || req.status !== 'pending') return;
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await supabase
          .from('location_requests')
          .update({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            responded_at: new Date().toISOString(),
            status: 'completed',
          })
          .eq('id', req.id);
      } catch {
        // Swallow — the requester falls back to last-known on timeout.
      }
    };

    const teardown = () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };

    const sync = async () => {
      const checkedIn = await isCheckedIn();
      if (cancelled) return;
      if (checkedIn && !channelRef.current) {
        channelRef.current = supabase
          .channel(`locreq-${repId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'location_requests', filter: `rep_id=eq.${repId}` },
            (payload) => respond(payload.new)
          )
          .subscribe();
      } else if (!checkedIn && channelRef.current) {
        teardown();
      }
    };

    sync();
    // Re-evaluate when the app returns to the foreground (may have just
    // checked in / punched out since we last looked).
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
    });

    return () => {
      cancelled = true;
      appSub.remove();
      teardown();
    };
  }, [repId]);
}
