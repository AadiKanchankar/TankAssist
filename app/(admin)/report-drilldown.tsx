import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList, Pressable, Image, StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
import Header from '../../components/Header';
import Breadcrumbs from '../../components/Breadcrumbs';
import BentoTile from '../../components/BentoTile';
import Metric from '../../components/Metric';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import PhotoViewer, { PhotoStrip, ViewerPhoto } from '../../components/PhotoViewer';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { supabase } from '../../lib/supabase';
import { getSignedUrls, ODOMETER_BUCKET } from '../../lib/storage';
import { toDateStr, fmtDDMMYYYY, fmtMinutes } from '../../lib/reportExport';
import { periodFigure, coverageNote, dayFigure, odometerKm, routeFor, toNum, fmtKmShort } from '../../lib/reportFigures';
import { mismatchFlag } from '../../lib/odometer';
import { FAR_FROM_STORE_METERS } from '../../lib/journeyPlan';
import { useRepReport, RepReport, ReportDay, ReportVisit } from '../../hooks/useRepReport';

export type DrilldownKind = 'odometer' | 'cases' | 'route' | 'visits';

export interface DrilldownParams {
  kind: DrilldownKind;
  rep: { id: string; name: string };
  start: string; // yyyy-mm-dd
  endExclusive: string;
  rangeLabel: string;
}

const TITLE: Record<DrilldownKind, string> = {
  odometer: 'Odometer',
  cases: 'Cases sold',
  route: 'Route (GPS)',
  visits: 'Stores visited',
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtDay = (iso: string) => fmtDDMMYYYY(new Date(iso));

/**
 * The detail behind one report tile. Reads the SAME cached query as the report
 * (useRepReport, same key), so the page always sums to the tile that opened it.
 * Kept behind a tap rather than in the report so the report — and its export —
 * doesn't balloon.
 */
export default function ReportDrilldownScreen({ route, navigation }: { route: any; navigation: any }) {
  const p = route.params as DrilldownParams;
  const insets = useSafeAreaInsets();
  const { data, isPending, isError, refetch } = useRepReport(p.rep.id, p.start, p.endExclusive);

  return (
    <View style={styles.screen}>
      <Header title={TITLE[p.kind]} onBack={() => navigation.goBack()} />
      <View style={styles.crumbs}>
        <Breadcrumbs
          items={[
            { label: 'Team', onPress: () => navigation.popToTop() },
            { label: p.rep.name, onPress: () => navigation.goBack() },
            { label: TITLE[p.kind] },
          ]}
        />
        <Text style={[Type.bodyMed, { color: Colors.textSecondary, marginTop: Space.xs }]}>{p.rangeLabel}</Text>
      </View>
      {isPending ? (
        <ListSkeleton rows={4} height={140} />
      ) : isError || !data ? (
        <ErrorState onRetry={refetch} />
      ) : p.kind === 'visits' ? (
        // A month of an active rep's visits is 150+ photo cards — virtualize.
        <VisitsView data={data} contentStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
          {p.kind === 'odometer' ? <OdometerView data={data} /> : null}
          {p.kind === 'cases' ? <CasesView data={data} /> : null}
          {p.kind === 'route' ? <RouteView data={data} /> : null}
        </ScrollView>
      )}
    </View>
  );
}

// ── 1. Odometer: each day's readings beside the dial photos ───────────────

/**
 * The travel-allowance verification surface: a manager reads the number the
 * rep attested next to the photo of the dial and sees at once whether they
 * match. Odometer photos live in the manager-only bucket, so this page is the
 * only place they surface.
 */
function OdometerView({ data }: { data: RepReport }) {
  const days = data.days;
  const paths = days.flatMap((d) => [d.odo_start_photo_path, d.odo_end_photo_path]).filter((x): x is string => !!x);
  const { data: signed } = useQuery({
    queryKey: ['odo-photos', paths],
    enabled: paths.length > 0,
    queryFn: () => getSignedUrls(paths, 3600, ODOMETER_BUCKET),
  });
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null);

  if (!days.length) {
    return <EmptyState icon="speedometer-outline" title="No punch-ins" message="Odometer readings are taken at punch-in and punch-out." />;
  }
  const odo = periodFigure(days, 'odometer');
  const gps = periodFigure(days, 'route');

  return (
    <>
      <BentoTile style={styles.summary}>
        <View style={styles.summaryRow}>
          <View style={styles.half}>
            <Metric label="Odometer" value={odo.value == null ? '—' : fmtKmShort(odo.value)} note={coverageNote(odo)} />
          </View>
          <View style={styles.half}>
            <Metric label="Route (GPS)" value={gps.value == null ? '—' : `${gps.value.toFixed(1)} km`} note={coverageNote(gps)} />
          </View>
        </View>
      </BentoTile>

      {days.map((d) => {
        const km = odometerKm(d);
        const state = dayFigure(d, 'odometer').state;
        const flag = mismatchFlag(toNum(d.odo_start), toNum(d.odo_end), toNum(d.total_distance_km));
        const readings = [
          { label: 'Start', value: d.odo_start, at: d.odo_start_at, path: d.odo_start_photo_path },
          { label: 'End', value: d.odo_end, at: d.odo_end_at, path: d.odo_end_photo_path },
        ];
        // Both of the day's photos in one viewer, so start and end can be
        // compared by swiping.
        const photos = readings
          .filter((r) => r.path && signed?.[r.path])
          .map((r) => ({ uri: signed![r.path!], caption: `${r.label} · ${r.value ?? 'no reading'} · ${fmtDay(d.check_in_time)}` }));
        return (
          <BentoTile key={d.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={[Type.bodyMed, { color: Colors.text }]}>{fmtDay(d.check_in_time)}</Text>
              <Text style={[Type.bodyMed, tabularNums, styles.headEnd, { color: km != null ? Colors.text : Colors.textSecondary }]}>
                {km != null
                  ? fmtKmShort(km)
                  : state === 'pending'
                  ? 'End reading at punch-out'
                  : d.auto_closed
                  ? 'Not recorded · auto-closed'
                  : 'Not recorded'}
              </Text>
            </View>
            {readings.map((r) => {
              const uri = r.path ? signed?.[r.path] : undefined;
              const idx = photos.findIndex((ph) => ph.uri === uri);
              return (
                <View key={r.label} style={styles.readingRow}>
                  {uri ? (
                    <Pressable
                      onPress={() => setViewer({ photos, index: Math.max(0, idx) })}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open ${r.label.toLowerCase()} odometer photo`}
                    >
                      <Image source={{ uri }} style={styles.dial} />
                    </Pressable>
                  ) : (
                    <View style={[styles.dial, styles.dialEmpty]}>
                      <Text style={[Type.caption, { color: Colors.textMuted }]}>{r.path ? 'Loading' : 'No photo'}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.label, { color: Colors.textMuted }]}>{r.label}</Text>
                    {r.value != null ? (
                      <Text style={[Type.section, tabularNums, { color: Colors.text }]}>{r.value}</Text>
                    ) : (
                      <Text style={[Type.body, { color: Colors.textSecondary }]}>Not taken</Text>
                    )}
                    {r.at ? <Text style={[Type.caption, { color: Colors.textSecondary }]}>{fmtTime(r.at)}</Text> : null}
                  </View>
                </View>
              );
            })}
            <Text style={[Type.caption, styles.foot]}>
              Route (GPS) that day:{' '}
              {d.total_distance_km != null ? `${Number(d.total_distance_km).toFixed(1)} km` : 'not recorded'}
            </Text>
            {flag.flagged ? (
              <View style={styles.warnRow}>
                <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                <Text style={[Type.caption, { color: Colors.text, flex: 1 }]}>{flag.reason}</Text>
              </View>
            ) : null}
          </BentoTile>
        );
      })}
      <PhotoViewer photos={viewer?.photos ?? []} index={viewer?.index ?? null} onClose={() => setViewer(null)} />
    </>
  );
}

// ── 2. Cases: which stores bought what, highest first ─────────────────────

function CasesView({ data }: { data: RepReport }) {
  const { total, byStore, byStoreProduct } = data.cases;
  const storeIds = Object.keys(byStore).sort((a, b) => byStore[b] - byStore[a]);
  const productIds = [...new Set(Object.values(byStoreProduct).flatMap((m) => Object.keys(m)))];
  const { data: names } = useQuery({
    queryKey: ['report-names', storeIds, productIds],
    enabled: storeIds.length > 0,
    queryFn: async () => {
      const [s, p] = await Promise.all([
        supabase.from('stores').select('id, name').in('id', storeIds),
        productIds.length
          ? supabase.from('products').select('id, name').in('id', productIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      ]);
      const map: Record<string, string> = {};
      for (const r of [...(s.data ?? []), ...(p.data ?? [])]) map[r.id] = r.name;
      return map;
    },
  });

  if (total === 0) {
    return <EmptyState icon="cube-outline" title="No cases in this period" message="Orders placed during store visits show up here." />;
  }
  const attributed = storeIds.reduce((s, id) => s + byStore[id], 0);

  return (
    <>
      <BentoTile style={styles.summary}>
        <Metric
          label="Total"
          value={`${total} ${total === 1 ? 'case' : 'cases'}`}
          note={`${storeIds.length} ${storeIds.length === 1 ? 'store' : 'stores'} · cancelled orders excluded`}
        />
      </BentoTile>
      {storeIds.map((id, rank) => {
        const lines = Object.entries(byStoreProduct[id] ?? {}).sort((a, b) => b[1] - a[1]);
        const legacy = byStore[id] - lines.reduce((s, [, n]) => s + n, 0);
        return (
          <BentoTile key={id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.rank}>{rank + 1}</Text>
              <Text style={[Type.bodyMed, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                {names ? names[id] ?? 'Unknown store' : '…'}
              </Text>
              <Text style={[Type.bodyMed, tabularNums, { color: Colors.text }]}>{byStore[id]}</Text>
            </View>
            {lines.map(([pid, n]) => (
              <View key={pid} style={styles.lineRow}>
                <Text style={[Type.body, { color: Colors.textSecondary, flex: 1 }]} numberOfLines={1}>
                  {names ? names[pid] ?? 'Unknown product' : '…'}
                </Text>
                <Text style={[Type.body, tabularNums, { color: Colors.textSecondary }]}>{n}</Text>
              </View>
            ))}
            {legacy > 0 ? (
              <Text style={[Type.caption, styles.foot]}>
                {legacy} from before orders began — recorded without a product
              </Text>
            ) : null}
          </BentoTile>
        );
      })}
      {total > attributed ? (
        <Text style={[Type.caption, styles.foot]}>{total - attributed} cases have no store on record.</Text>
      ) : null}
    </>
  );
}

// ── 3. Route: punch-in → stores → punch-out, per day ──────────────────────

function RouteView({ data }: { data: RepReport }) {
  const byDate = new Map<string, { day: ReportDay | null; visits: ReportVisit[] }>();
  for (const d of data.days) byDate.set(toDateStr(new Date(d.check_in_time)), { day: d, visits: [] });
  for (const v of data.visits) {
    const k = toDateStr(new Date(v.check_in_time));
    if (!byDate.has(k)) byDate.set(k, { day: null, visits: [] });
    byDate.get(k)!.visits.push(v);
  }
  const dates = [...byDate.keys()].sort();

  if (!dates.length) {
    return <EmptyState icon="navigate-outline" title="No route in this period" message="Routes are built from punch-in, store check-ins and punch-out." />;
  }

  return (
    <>
      <Text style={[Type.caption, styles.intro]}>
        Distance is measured by Google at punch-out. Days punched out from 23 Sep 2026 show each leg
        by road; earlier days show straight-line legs between the recorded positions.
      </Text>
      {dates.map((k) => {
        const { day, visits } = byDate.get(k)!;
        const { stops, legs, source, unplaced } = routeFor(day, visits);
        const state = day ? dayFigure(day, 'route').state : 'missing';
        return (
          <BentoTile key={k} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={[Type.bodyMed, { color: Colors.text }]}>{fmtDDMMYYYY(new Date(`${k}T00:00:00`))}</Text>
              <Text style={[Type.bodyMed, tabularNums, styles.headEnd, { color: state === 'recorded' ? Colors.text : Colors.textSecondary }]}>
                {!day
                  ? 'No punch-in'
                  : state === 'recorded'
                  ? `${Number(day.total_distance_km).toFixed(1)} km by road`
                  : state === 'pending'
                  ? 'Calculated at punch-out'
                  : 'Not recorded'}
              </Text>
            </View>
            {stops.map((s, i) => (
              <View key={`${s.kind}-${i}`}>
                {i > 0 ? (
                  <View style={styles.legRow}>
                    <View style={styles.rail} />
                    <Text style={[Type.caption, tabularNums, { color: Colors.textSecondary }]}>
                      {legs[i - 1] != null
                        ? `${legs[i - 1]!.toFixed(1)} km ${source === 'directions' ? 'by road' : 'straight-line'}`
                        : s.kind === 'punch_out'
                        ? 'Punch-out position not stored'
                        : 'Position not recorded'}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.stopRow}>
                  <Ionicons
                    name={s.kind === 'punch_in' ? 'log-in-outline' : s.kind === 'punch_out' ? 'log-out-outline' : 'storefront-outline'}
                    size={18}
                    color={s.kind === 'store' ? Colors.accent : Colors.textSecondary}
                  />
                  <Text style={[Type.body, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                    {s.label}
                  </Text>
                  <Text style={[Type.caption, tabularNums, { color: Colors.textSecondary }]}>{fmtTime(s.at)}</Text>
                </View>
              </View>
            ))}
            {unplaced > 0 ? (
              <Text style={[Type.caption, styles.foot]}>
                {unplaced} {unplaced === 1 ? 'visit has' : 'visits have'} no recorded position, so {unplaced === 1 ? 'it isn’t' : 'they aren’t'} on the route.
              </Text>
            ) : null}
            {day?.auto_closed ? (
              <Text style={[Type.caption, styles.foot]}>
                No punch-out — the day was closed automatically at 22:30, so no route was calculated.
              </Text>
            ) : null}
          </BentoTile>
        );
      })}
    </>
  );
}

// ── 4. Stores visited: each visit with its detail and photos ──────────────

function VisitsView({ data, contentStyle }: { data: RepReport; contentStyle: StyleProp<ViewStyle> }) {
  return (
    <FlatList
      data={data.visits}
      keyExtractor={(v) => v.id}
      contentContainerStyle={contentStyle}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={7}
      ListEmptyComponent={
        <EmptyState icon="storefront-outline" title="No visits in this period" message="Store check-ins show up here with their photos." />
      }
      renderItem={({ item: v }) => {
        const far = v.distance_from_store_meters != null && v.distance_from_store_meters > FAR_FROM_STORE_METERS;
        const out = v.auto_closed ? 'auto-closed' : v.check_out_time ? fmtTime(v.check_out_time) : 'still open';
        return (
          <BentoTile key={v.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={[Type.bodyMed, { color: Colors.text, flex: 1 }]} numberOfLines={1}>{v.storeName}</Text>
              <Text style={[Type.bodyMed, tabularNums, { color: Colors.text }]}>
                {v.cases} {v.cases === 1 ? 'case' : 'cases'}
              </Text>
            </View>
            <Text style={[Type.caption, tabularNums, { color: Colors.textSecondary }]}>
              {fmtDay(v.check_in_time)} · {fmtTime(v.check_in_time)} → {out}
              {v.duration_minutes != null ? ` · ${fmtMinutes(v.duration_minutes)}` : ''}
            </Text>
            {v.distance_from_store_meters != null ? (
              <View style={styles.inlineRow}>
                {far ? <Ionicons name="alert-circle" size={14} color={Colors.warning} /> : null}
                <Text style={[Type.caption, tabularNums, { color: far ? Colors.text : Colors.textSecondary }]}>
                  Checked in {Math.round(v.distance_from_store_meters).toLocaleString('en-IN')} m from the store
                  {far ? ` — beyond the ${FAR_FROM_STORE_METERS} m range` : ''}
                </Text>
              </View>
            ) : null}
            {v.notes ? <Text style={[Type.body, { color: Colors.text, marginTop: Space.xs }]}>{v.notes}</Text> : null}
            {v.photoUrls.length ? (
              <PhotoStrip photos={v.photoUrls.map((uri) => ({ uri, caption: `${v.storeName} · ${fmtDay(v.check_in_time)}` }))} />
            ) : (
              <Text style={[Type.caption, styles.foot]}>No photos</Text>
            )}
          </BentoTile>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  crumbs: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.xs },
  content: { padding: Layout.screenPad, paddingTop: Space.sm },
  summary: { marginBottom: Space.md },
  summaryRow: { flexDirection: 'row', gap: Space.md },
  half: { flex: 1 },
  card: { marginBottom: Space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm },
  // Status text yields at large system font sizes instead of pushing off-card.
  headEnd: { flex: 1, textAlign: 'right' },
  intro: { color: Colors.textSecondary, marginBottom: Space.md },
  foot: { color: Colors.textSecondary, marginTop: Space.sm },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: Space.sm },
  dial: { width: 88, height: 88, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  dialEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  warnRow: {
    flexDirection: 'row',
    gap: Space.xs,
    alignItems: 'flex-start',
    marginTop: Space.sm,
    padding: Space.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgWarning,
  },
  rank: { ...Type.label, color: Colors.textMuted, minWidth: 18 },
  lineRow: { flexDirection: 'row', gap: Space.sm, paddingLeft: 18 + Space.sm, marginTop: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 28 },
  // Rail sits under the 18pt stop icon's centre (Space.sm + 2/2 = 9).
  legRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingLeft: Space.sm, minHeight: 24 },
  rail: { width: 2, alignSelf: 'stretch', backgroundColor: Colors.border },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 2 },
});
