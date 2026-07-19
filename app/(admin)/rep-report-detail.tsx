import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Button from '../../components/Button';
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
  photoUrls: string[]; // 1-hour signed URLs for in-app display
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

const EMPTY_STATS: Stats = {
  marketTimeMinutes: null,
  distanceKm: null,
  casesSold: null,
  storesVisited: null,
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** First of the month `n` months from `d` (n may be negative). */
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * Rep Report section — Daily / Weekly / Monthly views over one rep's activity.
 * Rendered as the "Report" tab inside RepDetailScreen (no Header of its own;
 * the parent screen owns the rep-name header).
 *
 * Period semantics + navigator arrow step (per period):
 * - Daily   = the single selected date; arrows step ±1 day.
 * - Weekly  = rolling 7 days ENDING on the anchor date (not Mon–Sun); arrows
 *             step ±7 days on the anchor.
 * - Monthly = a separate month cursor, independent of the daily/weekly anchor;
 *             arrows step ±1 calendar month. Rollup numbers come from the
 *             monthly_ta_summary view (security_invoker).
 * "Download Detail Report" always exports the FULL CALENDAR MONTH currently in
 * view (the month cursor in Monthly, else the anchor date's month).
 */
export default function RepReportSection({ rep }: { rep: RepParam }) {
  const [period, setPeriod] = useState<Period>('daily');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday);
  // Monthly is navigated independently of the daily/weekly anchor.
  const [monthCursor, setMonthCursor] = useState<Date>(() =>
    monthStart(new Date())
  );
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [visits, setVisits] = useState<VisitDetail[]>([]);
  const [dayReports, setDayReports] = useState<DayReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportKind, setExportKind] = useState<'csv' | 'pdf' | null>(null);

  // The month a download resolves to: the cursor in Monthly, else the anchor.
  const downloadMonthAnchor = period === 'monthly' ? monthCursor : selectedDate;

  // Resolved inclusive range for the current period.
  const rangeStart =
    period === 'daily'
      ? selectedDate
      : period === 'weekly'
      ? addDays(selectedDate, -6)
      : monthStart(monthCursor);
  const rangeEnd =
    period === 'monthly' ? addDays(nextMonthStart(monthCursor), -1) : selectedDate;

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

  // One tap of the navigator arrows, stepped by the active period.
  const step = (dir: -1 | 1) => {
    if (period === 'monthly') {
      setMonthCursor((d) => addMonths(d, dir));
    } else if (period === 'weekly') {
      setSelectedDate((d) => addDays(d, dir * 7));
    } else {
      setSelectedDate((d) => addDays(d, dir));
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const startStr = toDateStr(rangeStart);
      const endExclusiveStr = toDateStr(addDays(rangeEnd, 1));

      // Visits (+ stores) in range — used for the list in all periods,
      // and for cases/visited stats in daily/weekly.
      const { data: visitRows } = await supabase
        .from('store_visits')
        .select(
          'id, cases_sold, check_in_time, check_out_time, photo_url, stores(name)'
        )
        .eq('user_id', rep.id)
        .gte('check_in_time', `${startStr}T00:00:00`)
        .lt('check_in_time', `${endExclusiveStr}T00:00:00`)
        .order('check_in_time', { ascending: true });
      const vRows = (visitRows as any[]) || [];

      // Photos for those visits (batch), signed for 1 hour (in-app only).
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
        if (!pathsByVisit[v.id] && v.photo_url) {
          pathsByVisit[v.id] = [v.photo_url]; // legacy single-photo fallback
        }
      }
      const allPaths = Object.values(pathsByVisit).flat();
      const signed = await getSignedUrls(allPaths); // default 1h expiry
      setVisits(
        vRows.map((v) => ({
          id: v.id,
          storeName: v.stores?.name || 'Store',
          cases_sold: v.cases_sold,
          check_in_time: v.check_in_time,
          photoUrls: (pathsByVisit[v.id] || [])
            .map((p) => signed[p])
            .filter((u): u is string => !!u),
        }))
      );

      // Notes / challenges in range.
      const { data: reportRows } = await supabase
        .from('daily_reports')
        .select('report_date, notes, challenges')
        .eq('user_id', rep.id)
        .gte('report_date', startStr)
        .lt('report_date', endExclusiveStr)
        .order('report_date', { ascending: false });
      setDayReports((reportRows as DayReport[]) || []);

      // Cases Sold — cutover semantics (orders on/after cutover, legacy visits
      // before), uniform across all periods.
      const casesSold = await repCasesSold(rep.id, startStr, endExclusiveStr);

      // Stats.
      if (period === 'monthly') {
        // Reuse monthly_ta_summary for market time / distance / stores; cases
        // now come from the cutover-aware helper above (not the view).
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
          marketTimeMinutes: aRows.reduce(
            (s, a) => s + (a.total_market_time_minutes || 0),
            0
          ),
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
      Alert.alert('Export Failed', err.message || 'Could not generate report.');
    }
    setExportKind(null);
  };

  const handleExportPdf = async () => {
    setExportKind('pdf');
    try {
      await exportRepPdf(rep.id, rep.name, [downloadMonthAnchor]);
    } catch (err: any) {
      Alert.alert('Export Failed', err.message || 'Could not generate report.');
    }
    setExportKind(null);
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Period selector */}
        <View style={styles.periodRow}>
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text
                style={[
                  styles.periodBtnText,
                  period === p && styles.periodBtnTextActive,
                ]}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date navigator — step size follows the active period (see step()) */}
        <View style={styles.dateNav}>
          <TouchableOpacity style={styles.dateArrow} onPress={() => step(-1)}>
            <Text style={styles.dateArrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.dateLabel}>{rangeLabel}</Text>
          <TouchableOpacity
            style={[styles.dateArrow, !canGoForward && styles.dateArrowDisabled]}
            disabled={!canGoForward}
            onPress={() => step(1)}
          >
            <Text
              style={[
                styles.dateArrowText,
                !canGoForward && styles.dateArrowTextDisabled,
              ]}
            >
              ›
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.accent} />
          </View>
        ) : (
          <>
            {/* Stat cards */}
            <View style={styles.statsGrid}>
              <Card style={styles.statCard}>
                <Text style={styles.statValue}>
                  {stats.marketTimeMinutes !== null
                    ? fmtMinutes(stats.marketTimeMinutes) || '0h 0m'
                    : '—'}
                </Text>
                <Text style={styles.statLabel}>MARKET TIME</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={styles.statValue}>
                  {stats.distanceKm !== null
                    ? `${Number(stats.distanceKm).toFixed(1)} km`
                    : '—'}
                </Text>
                <Text style={styles.statLabel}>DISTANCE</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={styles.statValue}>{stats.casesSold ?? '—'}</Text>
                <Text style={styles.statLabel}>CASES SOLD</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={styles.statValue}>{stats.storesVisited ?? '—'}</Text>
                <Text style={styles.statLabel}>STORES VISITED</Text>
              </Card>
            </View>

            {/* Store visits with photo gallery */}
            {visits.length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>STORE VISITS</Text>
                {visits.map((v) => (
                  <Card key={v.id} style={styles.visitCard}>
                    <Text style={styles.visitStoreName}>{v.storeName}</Text>
                    <Text style={styles.visitMeta}>
                      {fmtDDMMYYYY(new Date(v.check_in_time))}
                      {' • '}
                      {new Date(v.check_in_time).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' • '}
                      {v.cases_sold ?? 0} cases
                      {' • '}
                      {v.photoUrls.length}{' '}
                      {v.photoUrls.length === 1 ? 'photo' : 'photos'}
                    </Text>
                    {v.photoUrls.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.galleryRow}
                      >
                        {v.photoUrls.map((url, i) => (
                          <Image
                            key={`${v.id}-${i}`}
                            source={{ uri: url }}
                            style={styles.galleryPhoto}
                          />
                        ))}
                      </ScrollView>
                    ) : (
                      <View style={[styles.galleryPhoto, styles.photoEmpty]}>
                        <Text style={styles.photoEmptyText}>No photo</Text>
                      </View>
                    )}
                  </Card>
                ))}
              </View>
            )}

            {/* Notes / challenges from submitted daily reports */}
            {dayReports.length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>NOTES & CHALLENGES</Text>
                {dayReports.map((r) => (
                  <Card key={r.report_date} style={styles.visitCard}>
                    <Text style={styles.reportDate}>{r.report_date}</Text>
                    {r.notes ? (
                      <Text style={styles.reportText}>{r.notes}</Text>
                    ) : null}
                    {r.challenges ? (
                      <Text style={styles.reportChallenges}>
                        Challenges: {r.challenges}
                      </Text>
                    ) : null}
                    {!r.notes && !r.challenges ? (
                      <Text style={styles.reportText}>—</Text>
                    ) : null}
                  </Card>
                ))}
              </View>
            )}

            {visits.length === 0 && dayReports.length === 0 && (
              <Card>
                <Text style={styles.emptyText}>
                  No activity in this period.
                </Text>
              </Card>
            )}
          </>
        )}

        {/* Always exports the full calendar month currently in view */}
        <Text style={styles.downloadHint}>
          Download {monthName(downloadMonthAnchor)}
        </Text>
        <View style={styles.downloadRow}>
          <Button
            title="CSV (raw)"
            onPress={handleExportCsv}
            loading={exportKind === 'csv'}
            variant="secondary"
            style={styles.downloadHalf}
          />
          <Button
            title="PDF (formatted)"
            onPress={handleExportPdf}
            loading={exportKind === 'pdf'}
            style={styles.downloadHalf}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  loadingWrap: { paddingVertical: 48, alignItems: 'center' },
  // Period selector
  periodRow: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    marginBottom: 12,
    overflow: 'hidden',
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  periodBtnActive: { backgroundColor: Colors.accent },
  periodBtnText: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  periodBtnTextActive: { color: Colors.white },
  // Date navigator
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  dateArrow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dateArrowDisabled: { opacity: 0.3 },
  dateArrowText: {
    fontSize: 24,
    color: Colors.accent,
    fontWeight: '700',
  },
  dateArrowTextDisabled: { color: Colors.muted },
  dateLabel: {
    fontFamily: Typography.fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  // Stats
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    width: '47%',
    alignItems: 'center',
    paddingVertical: 16,
  },
  statValue: {
    fontFamily: Typography.fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginTop: 4,
  },
  // Sections
  detailSection: { marginBottom: 20 },
  detailLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 6,
  },
  visitCard: { marginBottom: 12 },
  visitStoreName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  visitMeta: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 2,
  },
  galleryRow: { marginTop: 10 },
  galleryPhoto: {
    width: 96,
    height: 96,
    borderRadius: 4,
    backgroundColor: Colors.background,
    marginRight: 8,
  },
  photoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 10,
  },
  photoEmptyText: {
    fontFamily: Typography.fontFamily,
    fontSize: 10,
    color: Colors.muted,
  },
  reportDate: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 4,
  },
  reportText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
  },
  reportChallenges: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.alert,
    marginTop: 4,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  downloadHint: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginTop: 8,
    marginBottom: 8,
  },
  downloadRow: { flexDirection: 'row', gap: 12 },
  downloadHalf: { flex: 1 },
});
