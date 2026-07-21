import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import Metric from '../../components/Metric';
import { SkelBlock } from '../../components/skeleton/Skeleton';
import { supabase } from '../../lib/supabase';
import { getSignedUrls } from '../../lib/storage';
import {
  toDateStr,
  fmtDDMMYYYY,
  addDays,
  monthStart,
  nextMonthStart,
  monthLabel,
  monthName,
  fmtMinutes,
  exportMonthlyReport,
} from '../../lib/reportExport';
import { repCasesSold } from '../../lib/reportSemantics';
import { exportRepPdf } from '../../lib/reportPdf';

type Period = 'daily' | 'weekly' | 'monthly';

interface RepParam {
  id: string;
  name: string;
}
interface VisitDetail {
  id: string;
  storeName: string;
  cases_sold: number | null;
  check_in_time: string;
  photoUrls: string[];
}
interface DayReport {
  report_date: string;
  notes: string | null;
  challenges: string | null;
}
interface Stats {
  marketTimeMinutes: number | null;
  distanceKm: number | null;
  casesSold: number | null;
  storesVisited: number | null;
}

const EMPTY_STATS: Stats = { marketTimeMinutes: null, distanceKm: null, casesSold: null, storesVisited: null };

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
 * Period semantics + export logic unchanged; presentation only. The generated
 * CSV/PDF documents (lib/reportExport, lib/reportPdf) are intentionally untouched.
 */
export default function RepReportSection({ rep }: { rep: RepParam }) {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>('daily');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday);
  const [monthCursor, setMonthCursor] = useState<Date>(() => monthStart(new Date()));
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [visits, setVisits] = useState<VisitDetail[]>([]);
  const [dayReports, setDayReports] = useState<DayReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportKind, setExportKind] = useState<'csv' | 'pdf' | null>(null);

  const downloadMonthAnchor = period === 'monthly' ? monthCursor : selectedDate;

  const rangeStart =
    period === 'daily' ? selectedDate : period === 'weekly' ? addDays(selectedDate, -6) : monthStart(monthCursor);
  const rangeEnd = period === 'monthly' ? addDays(nextMonthStart(monthCursor), -1) : selectedDate;

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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const startStr = toDateStr(rangeStart);
      const endExclusiveStr = toDateStr(addDays(rangeEnd, 1));

      const { data: visitRows } = await supabase
        .from('store_visits')
        .select('id, cases_sold, check_in_time, check_out_time, photo_url, stores(name)')
        .eq('user_id', rep.id)
        .gte('check_in_time', `${startStr}T00:00:00`)
        .lt('check_in_time', `${endExclusiveStr}T00:00:00`)
        .order('check_in_time', { ascending: true });
      const vRows = (visitRows as any[]) || [];

      const visitIds = vRows.map((v) => v.id);
      const pathsByVisit: Record<string, string[]> = {};
      if (visitIds.length > 0) {
        const { data: photoRows } = await supabase
          .from('store_visit_photos')
          .select('visit_id, storage_path, position')
          .in('visit_id', visitIds)
          .order('position', { ascending: true });
        for (const row of (photoRows as any[]) || []) {
          if (!pathsByVisit[row.visit_id]) pathsByVisit[row.visit_id] = [];
          pathsByVisit[row.visit_id].push(row.storage_path);
        }
      }
      for (const v of vRows) {
        if (!pathsByVisit[v.id] && v.photo_url) pathsByVisit[v.id] = [v.photo_url];
      }
      const allPaths = Object.values(pathsByVisit).flat();
      const signed = await getSignedUrls(allPaths);
      setVisits(
        vRows.map((v) => ({
          id: v.id,
          storeName: v.stores?.name || 'Store',
          cases_sold: v.cases_sold,
          check_in_time: v.check_in_time,
          photoUrls: (pathsByVisit[v.id] || []).map((p) => signed[p]).filter((u): u is string => !!u),
        }))
      );

      const { data: reportRows } = await supabase
        .from('daily_reports')
        .select('report_date, notes, challenges')
        .eq('user_id', rep.id)
        .gte('report_date', startStr)
        .lt('report_date', endExclusiveStr)
        .order('report_date', { ascending: false });
      setDayReports((reportRows as DayReport[]) || []);

      const casesSold = await repCasesSold(rep.id, startStr, endExclusiveStr);

      if (period === 'monthly') {
        const { data: summary } = await supabase
          .from('monthly_ta_summary')
          .select('*')
          .eq('user_id', rep.id)
          .eq('month_label', monthLabel(monthCursor))
          .maybeSingle();
        setStats({
          marketTimeMinutes: summary?.total_market_time_minutes ?? 0,
          distanceKm: summary?.total_distance_km ?? 0,
          casesSold,
          storesVisited: summary?.stores_visited ?? 0,
        });
      } else {
        const { data: attRows } = await supabase
          .from('attendance')
          .select('total_market_time_minutes, total_distance_km')
          .eq('user_id', rep.id)
          .gte('check_in_time', `${startStr}T00:00:00`)
          .lt('check_in_time', `${endExclusiveStr}T00:00:00`);
        const aRows = (attRows as any[]) || [];
        setStats({
          marketTimeMinutes: aRows.reduce((s, a) => s + (a.total_market_time_minutes || 0), 0),
          distanceKm: aRows.reduce((s, a) => s + (a.total_distance_km || 0), 0),
          casesSold,
          storesVisited: vRows.filter((v) => v.check_out_time).length,
        });
      }
    } catch {
      setStats(EMPTY_STATS);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep.id, period, toDateStr(selectedDate), toDateStr(monthCursor)]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

        {loading ? (
          <View style={styles.statsGrid}>
            {[0, 1, 2, 3].map((i) => (
              <SkelBlock key={i} w="48%" h={84} r={Radius.card} />
            ))}
          </View>
        ) : (
          <>
            <View style={styles.statsGrid}>
              <BentoTile style={styles.statCard}>
                <Metric
                  label="Market time"
                  value={stats.marketTimeMinutes !== null ? fmtMinutes(stats.marketTimeMinutes) || '0h 0m' : '—'}
                />
              </BentoTile>
              <BentoTile style={styles.statCard}>
                <Metric label="Distance" value={stats.distanceKm !== null ? `${Number(stats.distanceKm).toFixed(1)} km` : '—'} />
              </BentoTile>
              <BentoTile style={styles.statCard}>
                <Metric label="Cases sold" value={stats.casesSold ?? '—'} />
              </BentoTile>
              <BentoTile style={styles.statCard}>
                <Metric label="Stores visited" value={stats.storesVisited ?? '—'} />
              </BentoTile>
            </View>

            {visits.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Store visits</Text>
                {visits.map((v) => (
                  <BentoTile key={v.id} style={styles.card}>
                    <Text style={[Type.bodyMed, { color: Colors.text }]}>{v.storeName}</Text>
                    <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>
                      {fmtDDMMYYYY(new Date(v.check_in_time))} ·{' '}
                      {new Date(v.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {v.cases_sold ?? 0} cases · {v.photoUrls.length} {v.photoUrls.length === 1 ? 'photo' : 'photos'}
                    </Text>
                    {v.photoUrls.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.galleryRow}>
                        {v.photoUrls.map((url, i) => (
                          <Image key={`${v.id}-${i}`} source={{ uri: url }} style={styles.galleryPhoto} />
                        ))}
                      </ScrollView>
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
  statCard: { width: '48%' },
  section: { marginBottom: Space.lg },
  sectionLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  card: { marginBottom: Space.md },
  galleryRow: { marginTop: Space.sm },
  galleryPhoto: { width: 96, height: 96, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, marginRight: Space.sm },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  downloadRow: { flexDirection: 'row', gap: Space.md },
  downloadHalf: { flex: 1 },
});
