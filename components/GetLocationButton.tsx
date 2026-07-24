import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator, Linking } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import Button from './Button';
import Header from './Header';
import { supabase } from '../lib/supabase';

const TIMEOUT_MS = 18000;

type Phase = 'checking' | 'waiting' | 'live' | 'fallback' | 'notCheckedIn' | 'error';

interface Fix {
  lat: number;
  lng: number;
  at: string | null; // ISO timestamp of the reading (null = just now / live)
  live: boolean;
  sourceLabel?: string; // for the fallback ("last check-in", "last visit")
}

async function fetchLastKnown(repId: string): Promise<Fix | null> {
  // Most recent GPS event for the rep across attendance + visits. Managers can
  // read both via existing RLS. Pick the newest of the two.
  const [{ data: att }, { data: vis }] = await Promise.all([
    supabase
      .from('attendance')
      .select('latitude, longitude, check_in_time')
      .eq('user_id', repId)
      .not('latitude', 'is', null)
      .order('check_in_time', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('store_visits')
      .select('latitude, longitude, check_in_time')
      .eq('user_id', repId)
      .not('latitude', 'is', null)
      .order('check_in_time', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const cands: Fix[] = [];
  if (att?.latitude != null) cands.push({ lat: att.latitude, lng: att.longitude, at: att.check_in_time, live: false, sourceLabel: 'last check-in' });
  if (vis?.latitude != null) cands.push({ lat: vis.latitude, lng: vis.longitude, at: vis.check_in_time, live: false, sourceLabel: 'last store visit' });
  if (cands.length === 0) return null;
  cands.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return cands[0];
}

const fmtWhen = (iso: string | null) => {
  if (!iso) return 'just now';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * Requester-side "Get location" (management + sales_manager). Fast-fails if the
 * rep isn't checked in; otherwise sends a request over Supabase Realtime and
 * waits ~18s, then falls back to the rep's last-known GPS. Reuses react-native-maps.
 * RLS gates who may actually request whom — this only offers the control.
 */
export default function GetLocationButton({ repId, repName }: { repId: string; repName: string }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('checking');
  const [fix, setFix] = useState<Fix | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  const cleanup = () => {
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const close = () => { cleanup(); setOpen(false); };

  const toFallback = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    cleanup();
    const last = await fetchLastKnown(repId);
    if (last) { setFix(last); setPhase('fallback'); }
    else { setErrMsg('No recent location on record for this rep.'); setPhase('error'); }
  };

  const start = async () => {
    doneRef.current = false;
    setFix(null);
    setErrMsg('');
    setPhase('checking');
    setOpen(true);

    // 1) Fast-fail if the rep isn't checked in today.
    const today = new Date().toISOString().split('T')[0];
    const { data: att } = await supabase
      .from('attendance')
      .select('check_out_time')
      .eq('user_id', repId)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`)
      .order('check_in_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    const checkedIn = !!att && !att.check_out_time;
    if (!checkedIn) {
      setPhase('notCheckedIn');
      const last = await fetchLastKnown(repId);
      setFix(last);
      return;
    }

    // 2) Insert the request; subscribe to its completion.
    const { data: req, error } = await supabase
      .from('location_requests')
      .insert({ rep_id: repId, requested_by: (await supabase.auth.getUser()).data.user?.id })
      .select()
      .single();
    if (error || !req) { setErrMsg(error?.message || 'Couldn’t send the request.'); setPhase('error'); return; }

    setPhase('waiting');
    const onComplete = (row: any) => {
      if (doneRef.current || !row || row.status !== 'completed' || row.lat == null) return;
      doneRef.current = true;
      cleanup();
      setFix({ lat: row.lat, lng: row.lng, at: row.responded_at, live: true });
      setPhase('live');
    };

    channelRef.current = supabase
      .channel(`locreq-req-${req.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'location_requests', filter: `id=eq.${req.id}` },
        (payload) => onComplete(payload.new))
      .subscribe();

    // Race guard: the rep may have already responded before we subscribed.
    const { data: fresh } = await supabase.from('location_requests').select('*').eq('id', req.id).maybeSingle();
    if (fresh?.status === 'completed') onComplete(fresh);

    timerRef.current = setTimeout(toFallback, TIMEOUT_MS);
  };

  const navigate = () => {
    if (!fix) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${fix.lat},${fix.lng}`);
  };

  return (
    <>
      <Button title="Get location" onPress={start} variant="secondary" />

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        <View style={styles.container}>
          <Header title={repName} onBack={close} />
          <View style={styles.body}>
            {(phase === 'checking' || phase === 'waiting') && (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={Colors.accent} />
                <Text style={[Type.body, { color: Colors.textSecondary, marginTop: Space.md }]}>
                  {phase === 'checking' ? 'Checking…' : `Asking ${repName} for their location…`}
                </Text>
              </View>
            )}

            {phase === 'notCheckedIn' && (
              <>
                <Banner icon="alert-circle-outline" tone={Colors.warning} title="Rep isn’t checked in"
                  msg={fix ? 'Showing their last known location instead.' : 'No recent location on record.'} />
                {fix ? <FixMap fix={fix} onNavigate={navigate} /> : null}
              </>
            )}
            {phase === 'live' && fix && (
              <>
                <Banner icon="location" tone={Colors.success} title="Live location" msg="As of just now." />
                <FixMap fix={fix} onNavigate={navigate} />
              </>
            )}
            {phase === 'fallback' && fix && (
              <>
                <Banner icon="time-outline" tone={Colors.warning} title="Couldn’t reach the rep"
                  msg={`Showing their ${fix.sourceLabel} — not live (${fmtWhen(fix.at)}).`} />
                <FixMap fix={fix} onNavigate={navigate} />
              </>
            )}
            {phase === 'error' && (
              <Banner icon="close-circle-outline" tone={Colors.alert} title="Couldn’t get location" msg={errMsg} />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function Banner({ icon, tone, title, msg }: { icon: keyof typeof Ionicons.glyphMap; tone: string; title: string; msg: string }) {
  return (
    <View style={styles.banner}>
      <Ionicons name={icon} size={20} color={tone} />
      <View style={{ flex: 1 }}>
        <Text style={[Type.bodyMed, { color: Colors.text }]}>{title}</Text>
        <Text style={[Type.caption, { color: Colors.textMuted }]}>{msg}</Text>
      </View>
    </View>
  );
}

function FixMap({ fix, onNavigate }: { fix: Fix; onNavigate: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.mapWrap}>
        <MapView
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={{ latitude: fix.lat, longitude: fix.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        >
          <Marker coordinate={{ latitude: fix.lat, longitude: fix.lng }} pinColor={fix.live ? Colors.success : Colors.warning} />
        </MapView>
      </View>
      <Text style={[Type.caption, { color: Colors.textMuted, marginTop: Space.sm }]}>
        {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
      </Text>
      <Button title="Navigate" spotlight onPress={onNavigate} style={{ marginTop: Space.md }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, padding: Layout.screenPad },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Space.md, marginBottom: Space.md },
  mapWrap: { flex: 1, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
});
