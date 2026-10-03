import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, ActivityIndicator, Linking } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import Button from './Button';
import Header from './Header';
import { supabase } from '../lib/supabase';
import { errorCode, userMessage } from '../lib/userError';

/** A duty fix newer than this reads as "live"; the phone reports every 3 min. */
const LIVE_MAX_AGE_MS = 10 * 60_000;

interface Fix {
  lat: number;
  lng: number;
  at: string | null; // ISO timestamp of the reading
  live: boolean;
  sourceLabel: string;
}

interface View_ {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  title: string;
  msg: string;
  fix: Fix | null;
}

async function fetchLastKnown(repId: string): Promise<Fix | null> {
  // Most recent check-in GPS across attendance + visits. Managers can read
  // both via existing RLS. Pick the newer of the two.
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
  if (att?.latitude != null) cands.push({ lat: att.latitude, lng: att.longitude, at: att.check_in_time, live: false, sourceLabel: 'punch-in' });
  if (vis?.latitude != null) cands.push({ lat: vis.latitude, lng: vis.longitude, at: vis.check_in_time, live: false, sourceLabel: 'store check-in' });
  cands.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return cands[0] ?? null;
}

const fmtWhen = (iso: string | null) => {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? 'just now' : `${min} min ago`;
};

/**
 * Manager-side "Get location" (management + sales_manager). While a rep is on
 * duty their phone reports its position every few minutes (lib/dutyLocation),
 * so this answers instantly — no request for the rep to accept. Logging the
 * view (location_requests INSERT) is what tells the rep: its trigger snapshots
 * what was shown and, only while they are on duty, sends them a silent
 * "Your live location was viewed" notification. RLS gates who may look.
 */
export default function GetLocationButton({ repId, repName }: { repId: string; repName: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View_ | null>(null);

  const start = async () => {
    setView(null);
    setOpen(true);
    const me = (await supabase.auth.getSession()).data.session?.user.id;

    // One wave: on-duty state, the duty fix, check-in fallbacks, and the view log.
    const [{ data: day }, { data: pos }, last, { error: logError }] = await Promise.all([
      supabase.from('attendance').select('check_in_time').eq('user_id', repId)
        .is('check_out_time', null).limit(1).maybeSingle(),
      supabase.from('rep_positions').select('lat, lng, recorded_at, is_mock').eq('rep_id', repId).maybeSingle(),
      fetchLastKnown(repId),
      supabase.from('location_requests').insert({ rep_id: repId, requested_by: me }),
    ]);

    // An unlogged view would be one the rep is never told about — don't show it.
    if (logError) {
      setView({
        icon: 'close-circle-outline', tone: Colors.alert, title: 'Couldn’t get location', fix: null,
        // Any manager may look up any active rep, so 42501 means the target is not one.
        msg: errorCode(logError) === '42501' ? 'Live location is only available for active reps.' : userMessage(logError),
      });
      return;
    }

    const duty: Fix | null = pos
      ? { lat: pos.lat, lng: pos.lng, at: pos.recorded_at, live: true, sourceLabel: 'phone GPS' }
      : null;
    const newest = [duty, last].filter((f): f is Fix => !!f)
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0] ?? null;
    const mock = pos?.is_mock ? ' The phone reported a mock (fake) location.' : '';

    if (!day) {
      setView({
        icon: 'alert-circle-outline', tone: Colors.warning, title: 'Rep isn’t on duty',
        msg: newest ? `Showing their last known position (${newest.sourceLabel}, ${fmtWhen(newest.at)}).` : 'No location on record.',
        fix: newest && { ...newest, live: false },
      });
    } else if (duty && Date.parse(duty.at!) >= Date.parse(day.check_in_time) && Date.now() - Date.parse(duty.at!) <= LIVE_MAX_AGE_MS) {
      setView({ icon: 'location', tone: Colors.success, title: 'Live location', msg: `Updated ${ago(duty.at!)}.${mock}`, fix: duty });
    } else {
      // On duty but the phone has gone quiet: switched off, no signal, battery
      // saver, or background location not allowed. Say so rather than guess.
      setView({
        icon: 'time-outline', tone: Colors.warning, title: 'Location not updating',
        msg: (newest ? `Showing their last known position (${newest.sourceLabel}, ${fmtWhen(newest.at)}). ` : 'No location on record. ')
          + 'The rep’s phone may be off or offline, or location may not be set to “Allow all the time”.' + mock,
        fix: newest && { ...newest, live: false },
      });
    }
  };

  const navigate = () => {
    if (!view?.fix) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${view.fix.lat},${view.fix.lng}`);
  };

  return (
    <>
      <Button title="Get location" onPress={start} variant="secondary" />

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={styles.container}>
          <Header title={repName} onBack={() => setOpen(false)} />
          <View style={styles.body}>
            {!view ? (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={Colors.accent} />
                <Text style={[Type.body, { color: Colors.textSecondary, marginTop: Space.md }]}>Locating…</Text>
              </View>
            ) : (
              <>
                <Banner icon={view.icon} tone={view.tone} title={view.title} msg={view.msg} />
                {view.fix ? <FixMap fix={view.fix} onNavigate={navigate} /> : null}
              </>
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
