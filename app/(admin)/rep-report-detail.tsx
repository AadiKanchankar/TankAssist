import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import Metric from '../../components/Metric';
import ErrorState from '../../components/ErrorState';
import { PhotoStrip } from '../../components/PhotoViewer';
import { SkelBlock } from '../../components/skeleton/Skeleton';
import {
  toDateStr,
  fmtDDMMYYYY,
  addDays,
  monthStart,
  nextMonthStart,
  monthName,
  fmtMinutes,
  exportMonthlyReport,
} from '../../lib/reportExport';
import { exportRepPdf } from '../../lib/reportPdf';
import { displayFigure, fmtKmShort } from '../../lib/reportFigures';
import { useRepReport } from '../../hooks/useRepReport';
import type { DrilldownKind, DrilldownParams } from './report-drilldown';

type Period = 'daily' | 'weekly' | 'monthly';

interface RepParam {
  id: string;
  name: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * Rep Report section — Daily / Weekly / Monthly views over one rep's activity.
 *
 * Every figure comes from useRepReport, the same cached query the drill-downs
 * read, so a tile and the page it opens always agree. Market time and both
 * distances are written only at punch-out: a day that never punched out shows
 * "Not recorded", not 0 (see lib/reportFigures).
 */
export default function RepReportSection({ rep }: { rep: RepParam }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [period, setPeriod] = useState<Period>('daily');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday);
  const [monthCursor, setMonthCursor] = useState<Date>(() => monthStart(new Date()));
  const [exportKind, setExportKind] = useState<'csv' | 'pdf' | null>(null);

  const downloadMonthAnchor = period === 'monthly' ? monthCursor : selectedDate;

  const rangeStart =
    period === 'daily' ? selectedDate : period === 'weekly' ? addDays(selectedDate, -6) : monthStart(monthCursor);
  const rangeEnd = period === 'monthly' ? addDays(nextMonthStart(monthCursor), -1) : selectedDate;
  const start = toDateStr(rangeStart);
  const endExclusive = toDateStr(addDays(rangeEnd, 1));

  const rangeLabel =
    period === 'daily'
      ? fmtDDMMYYYY(selectedDate)
      : period === 'weekly'
      ? `${fmtDDMMYYYY(rangeStart)} – ${fmtDDMMYYYY(selectedDate)}`
      : monthName(monthCursor);

  const canGoForward =
    period === 'monthly'
      ? toDateStr(monthCursor) < toDateStr(monthStart(new Date()))
      : toDateStr(selectedDate) < toDateStr(startOfToday());

  const step = (dir: -1 | 1) => {
    if (period === 'monthly') setMonthCursor((d) => addMonths(d, dir));
    else if (period === 'weekly') setSelectedDate((d) => addDays(d, dir * 7));
    else setSelectedDate((d) => addDays(d, dir));
  };

  const { data, isPending, isError, refetch } = useRepReport(rep.id, start, endExclusive);
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const open = (kind: DrilldownKind) => {
    const params: DrilldownParams = { kind, rep, start, endExclusive, rangeLabel };
    navigation.navigate('ReportDrilldown', params);
  };

  const handleExportCsv = async () => {
    setExportKind('csv');
    try {
      await exportMonthlyReport(rep.id, rep.name, downloadMonthAnchor);
    } catch (err: any) {
      Alert.alert('Export failed', err.message || 'Could not generate the report.');
    }
    setExportKind(null);
  };

  const handleExportPdf = async () => {
    setExportKind('pdf');
    try {
      await exportRepPdf(rep.id, rep.name, [downloadMonthAnchor]);
    } catch (err: any) {
      Alert.alert('Export failed', err.message || 'Could not generate the report.');
    }
    setExportKind(null);
  };

  const days = data?.days ?? [];
  const visits = data?.visits ?? [];
  const dayReports = data?.dayReports ?? [];
  const route = displayFigure(days, 'route', (km) => `${km.toFixed(1)} km`);
  const odo = displayFigure(days, 'odometer', fmtKmShort);
  const market = displayFigure(days, 'market', fmtMinutes);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Layout.tabBar + insets.bottom + Space.md }]}
      >
        {/* Period selector */}
        <View style={styles.segRow}>
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <Pressable
              key={p}
              style={[styles.segBtn, period === p && styles.segBtnActive]}
              onPress={() => setPeriod(p)}
              accessibilityRole="button"
              accessibilityState={{ selected: period === p }}
            >
              <Text style={[styles.segText, period === p && styles.segTextActive]}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Date navigator */}
        <View style={styles.dateNav}>
          <Pressable style={styles.dateArrow} onPress={() => step(-1)} accessibilityLabel="Previous">
            <Ionicons name="chevron-back" size={20} color={Colors.accent} />
          </Pressable>
          <Text style={[Type.bodyMed, { color: Colors.text }]}>{rangeLabel}</Text>
          <Pressable
            style={[styles.dateArrow, !canGoForward && styles.dateArrowDisabled]}
            disabled={!canGoForward}
            onPress={() => step(1)}
            accessibilityLabel="Next"
          >
            <Ionicons name="chevron-forward" size={20} color={canGoForward ? Colors.accent : Colors.textMuted} />
          </Pressable>
        </View>

        {isPending ? (
          <View style={styles.statsGrid}>
            {[0, 1, 2, 3].map((i) => (
              <SkelBlock key={i} w="48%" h={84} r={Radius.card} />
            ))}
            <SkelBlock w="100%" h={84} r={Radius.card} />
          </View>
        ) : isError || !data ? (
          <BentoTile>
            <ErrorState onRetry={refetch} />
          </BentoTile>
        ) : (
          <>
            {/* Two distance methods side by side and never merged: odometer is
                what makes TA auditable, the route is the tracked cross-check. */}
            <View style={styles.statsGrid}>
              <StatTile label="Route (GPS)" {...route} onPress={() => open('route')} />
              <StatTile label="Odometer" {...odo} onPress={() => open('odometer')} />
              <StatTile label="Cases sold" value={String(data.cases.total)} onPress={() => open('cases')} />
              <StatTile
                label="Stores visited"
                value={String(visits.filter((v) => v.check_out_time).length)}
                onPress={() => open('visits')}
              />
              <StatTile label="Market time" {...market} wide />
            </View>

            {visits.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Store visits</Text>
                {visits.map((v) => (
                  <BentoTile key={v.id} style={styles.card}>
                    <Text style={[Type.bodyMed, { color: Colors.text }]}>{v.storeName}</Text>
                    <Text style={[Type.caption, { color: Colors.textSecondary, marginTop: 2 }]}>
                      {fmtDDMMYYYY(new Date(v.check_in_time))} ·{' '}
                      {new Date(v.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {v.cases} {v.cases === 1 ? 'case' : 'cases'} · {v.photoUrls.length}{' '}
                      {v.photoUrls.length === 1 ? 'photo' : 'photos'}
                    </Text>
                    {v.photoUrls.length > 0 ? (
                      <PhotoStrip
                        photos={v.photoUrls.map((uri) => ({ uri, caption: v.storeName }))}
                      />
                    ) : (
                      <View style={[styles.galleryPhoto, styles.photoEmpty]}>
                        <Text style={[Type.caption, { color: Colors.textMuted }]}>No photo</Text>
                      </View>
                    )}
                  </BentoTile>
                ))}
              </View>
            )}

            {dayReports.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Notes & challenges</Text>
                {dayReports.map((r) => (
                  <BentoTile key={r.report_date} style={styles.card}>
                    <Text style={[Type.label, { color: Colors.textMuted, marginBottom: Space.xs }]}>{r.report_date}</Text>
                    {r.notes ? <Text style={[Type.body, { color: Colors.text }]}>{r.notes}</Text> : null}
                    {r.challenges ? (
                      <Text style={[Type.body, { color: Colors.alert, marginTop: Space.xs }]}>Challenges: {r.challenges}</Text>
                    ) : null}
                    {!r.notes && !r.challenges ? <Text style={[Type.body, { color: Colors.text }]}>—</Text> : null}
                  </BentoTile>
                ))}
              </View>
            )}

            {visits.length === 0 && dayReports.length === 0 && (
              <BentoTile>
                <Text style={[Type.body, { color: Colors.textMuted }]}>No activity in this period.</Text>
              </BentoTile>
            )}
          </>
        )}

        {/* CSV / PDF choice — always exports the full calendar month in view */}
        <Text style={[Type.label, { color: Colors.textMuted, marginTop: Space.lg, marginBottom: Space.sm }]}>
          Download {monthName(downloadMonthAnchor)}
        </Text>
        <View style={styles.downloadRow}>
          <Button title="CSV (raw)" onPress={handleExportCsv} loading={exportKind === 'csv'} variant="secondary" style={styles.downloadHalf} />
          <Button title="PDF (formatted)" onPress={handleExportPdf} loading={exportKind === 'pdf'} style={styles.downloadHalf} />
        </View>
      </ScrollView>
    </View>
  );
}

/** Report tile; a chevron marks the ones that open a drill-down. */
function StatTile({
  label,
  value,
  note,
  onPress,
  wide,
}: {
  label: string;
  value: string;
  note?: string | null;
  onPress?: () => void;
  wide?: boolean;
}) {
  const tile = (
    <BentoTile style={styles.tile}>
      <Metric label={label} value={value} note={note} />
      {onPress ? <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} style={styles.tileChevron} /> : null}
    </BentoTile>
  );
  const cell = wide ? styles.cellWide : styles.cell;
  if (!onPress) return <View style={cell}>{tile}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${note ? `, ${note}` : ''}. Show details`}
    >
      {tile}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Layout.screenPad },
  segRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    marginBottom: Space.md,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, paddingVertical: Space.sm, alignItems: 'center', minHeight: Layout.tap, justifyContent: 'center' },
  segBtnActive: { backgroundColor: Colors.accent },
  segText: { ...Type.label, color: Colors.text },
  segTextActive: { color: Colors.white },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    marginBottom: Space.lg,
    paddingHorizontal: Space.sm,
  },
  dateArrow: { padding: Space.md, minWidth: Layout.tap, alignItems: 'center' },
  dateArrowDisabled: { opacity: 0.4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Layout.gridGap, marginBottom: Space.lg },
  // The CELL is the pressable, not the tile: row cells stretch to the tallest
  // tile, and the tile grows to fill, so a tile with a note doesn't leave its
  // neighbour short. (BentoTile's own onPress wraps it in a Pressable that
  // can't be stretched from outside.)
  cell: { width: '48%' },
  cellWide: { width: '100%' },
  tile: { flexGrow: 1 },
  pressed: { opacity: 0.85 },
  tileChevron: { position: 'absolute', top: Layout.cardPad, right: Layout.cardPad },
  section: { marginBottom: Space.lg },
  sectionLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  card: { marginBottom: Space.md },
  galleryPhoto: { width: 96, height: 96, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, marginTop: Space.sm },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  downloadRow: { flexDirection: 'row', gap: Space.md },
  downloadHalf: { flex: 1 },
});
