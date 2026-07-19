import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { casesSold } from '../../lib/reportSemantics';
import {
  ORDER_FILTER_STATUSES,
  OrderFilter,
  orderStatusColor,
} from '../../lib/orders';
import {
  toDateStr,
  addDays,
  monthStart,
  nextMonthStart,
  monthName,
} from '../../lib/reportExport';

// Stores with no visit within this many days are flagged as needing attention.
const STALE_VISIT_DAYS = 7;

const PIPELINE: { key: OrderFilter; label: string }[] = [
  { key: 'to_process', label: 'To Process' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

interface AttentionStore {
  id: string;
  name: string;
  reasons: string[];
}
interface TopStore {
  name: string;
  cases: number;
}

export default function ManagementDashboard({ navigation }: { navigation: any }) {
  const [pipeline, setPipeline] = useState<Record<OrderFilter, number>>({
    to_process: 0,
    dispatched: 0,
    in_transit: 0,
    delivered: 0,
    cancelled: 0,
  });
  const [casesThisMonth, setCasesThisMonth] = useState(0);
  const [casesLastMonth, setCasesLastMonth] = useState(0);
  const [trend, setTrend] = useState<number[]>([]);
  const [repsCheckedIn, setRepsCheckedIn] = useState(0);
  const [visitsToday, setVisitsToday] = useState(0);
  const [attention, setAttention] = useState<AttentionStore[]>([]);
  const [topStores, setTopStores] = useState<TopStore[]>([]);
  const [monthTitle, setMonthTitle] = useState(monthName(new Date()));

  const load = useCallback(async () => {
    const now = new Date();
    const mStartStr = toDateStr(monthStart(now));
    const nextMStr = toDateStr(nextMonthStart(now));
    const lastMStartStr = toDateStr(
      new Date(now.getFullYear(), now.getMonth() - 1, 1)
    );
    const today = toDateStr(now);
    const staleCutoff = toDateStr(addDays(now, -STALE_VISIT_DAYS));
    setMonthTitle(monthName(now));

    // Cases (hybrid, org-wide) — this month byDay/byStore/total + last month total.
    const [thisM, lastM] = await Promise.all([
      casesSold(mStartStr, nextMStr),
      casesSold(lastMStartStr, mStartStr),
    ]);
    setCasesThisMonth(thisM.total);
    setCasesLastMonth(lastM.total);

    // Trend: cases per calendar day of the current month.
    const daysInMonth = addDays(nextMonthStart(now), -1).getDate();
    const arr: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = toDateStr(new Date(now.getFullYear(), now.getMonth(), d));
      arr.push(thisM.byDay[key] || 0);
    }
    setTrend(arr);

    // Order pipeline counts.
    const { data: ords } = await supabase.from('orders').select('status');
    const counts: Record<OrderFilter, number> = {
      to_process: 0,
      dispatched: 0,
      in_transit: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const o of (ords as any[]) || []) {
      for (const p of PIPELINE) {
        if (ORDER_FILTER_STATUSES[p.key].includes(o.status)) counts[p.key]++;
      }
    }
    setPipeline(counts);

    // Today's field activity.
    const { data: attToday } = await supabase
      .from('attendance')
      .select('user_id')
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);
    setRepsCheckedIn(new Set((attToday || []).map((a) => a.user_id)).size);
    const { data: visToday } = await supabase
      .from('store_visits')
      .select('id')
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);
    setVisitsToday((visToday || []).length);

    // Stores needing attention: no visit in N days, and/or latest stock all-zero.
    const [{ data: stores }, { data: recentVisits }, { data: snaps }] =
      await Promise.all([
        supabase.from('stores').select('id, name'),
        supabase
          .from('store_visits')
          .select('store_id')
          .gte('check_in_time', `${staleCutoff}T00:00:00`),
        supabase
          .from('store_stock_snapshots')
          .select('store_id, product_id, cases, bottles, recorded_at')
          .order('recorded_at', { ascending: false }),
      ]);

    const visitedRecently = new Set(
      (recentVisits || []).map((v) => v.store_id)
    );
    // Latest snapshot per store+product → decide which stores are all-zero.
    const seen = new Set<string>();
    const storeHasSnap = new Set<string>();
    const storeNonZero = new Set<string>();
    for (const s of (snaps as any[]) || []) {
      const key = `${s.store_id}|${s.product_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      storeHasSnap.add(s.store_id);
      if ((s.cases || 0) > 0 || (s.bottles || 0) > 0) storeNonZero.add(s.store_id);
    }

    const attn: AttentionStore[] = [];
    for (const s of (stores as any[]) || []) {
      const reasons: string[] = [];
      if (!visitedRecently.has(s.id))
        reasons.push(`No visit in ${STALE_VISIT_DAYS}d`);
      if (storeHasSnap.has(s.id) && !storeNonZero.has(s.id))
        reasons.push('Stock at zero');
      if (reasons.length) attn.push({ id: s.id, name: s.name, reasons });
    }
    setAttention(attn);

    // Top stores this month by cases (hybrid).
    const nameById: Record<string, string> = {};
    for (const s of (stores as any[]) || []) nameById[s.id] = s.name;
    setTopStores(
      Object.entries(thisM.byStore)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, cases]) => ({ name: nameById[id] || 'Store', cases }))
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const { refreshing, onRefresh } = usePullToRefresh(load);

  const delta = casesThisMonth - casesLastMonth;
  const goToOrders = (filter: OrderFilter) =>
    navigation.navigate('Orders', { screen: 'OrdersList', params: { filter } });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>{monthTitle}</Text>

      {/* Order pipeline strip */}
      <Text style={styles.sectionTitle}>Order Pipeline</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pipelineRow}
      >
        {PIPELINE.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={styles.pipelineCard}
            onPress={() => goToOrders(p.key)}
          >
            <View
              style={[styles.pipelineDot, { backgroundColor: orderStatusColor(p.key === 'to_process' ? 'placed' : p.key) }]}
            />
            <Text style={styles.pipelineCount}>{pipeline[p.key]}</Text>
            <Text style={styles.pipelineLabel}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Cases ordered — this vs last month + trend */}
      <Card>
        <Text style={styles.cardLabel}>CASES ORDERED · {monthTitle}</Text>
        <View style={styles.casesRow}>
          <Text style={styles.casesValue}>{casesThisMonth}</Text>
          <View style={styles.deltaWrap}>
            <Text
              style={[
                styles.deltaText,
                { color: delta >= 0 ? Colors.success : Colors.alert },
              ]}
            >
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
            </Text>
            <Text style={styles.deltaSub}>vs {casesLastMonth} last month</Text>
          </View>
        </View>
        <BarTrend data={trend} />
        <Text style={styles.trendCaption}>Cases per day</Text>
      </Card>

      {/* Today's field activity */}
      <Card>
        <Text style={styles.cardLabel}>TODAY'S FIELD ACTIVITY</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {repsCheckedIn}
            </Text>
            <Text style={styles.statLabel}>REPS CHECKED IN</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{visitsToday}</Text>
            <Text style={styles.statLabel}>VISITS TODAY</Text>
          </View>
        </View>
      </Card>

      {/* Stores needing attention */}
      <Text style={styles.sectionTitle}>Stores Needing Attention</Text>
      {attention.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>All stores are covered. 🎉</Text>
        </Card>
      ) : (
        attention.map((s) => (
          <Card key={s.id} style={styles.attnCard}>
            <Text style={styles.attnName}>{s.name}</Text>
            <View style={styles.tagRow}>
              {s.reasons.map((r) => (
                <Text key={r} style={styles.tag}>
                  {r}
                </Text>
              ))}
            </View>
          </Card>
        ))
      )}

      {/* Top stores this month */}
      <Text style={styles.sectionTitle}>Top Stores · {monthTitle}</Text>
      {topStores.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>No cases ordered yet this month.</Text>
        </Card>
      ) : (
        <Card>
          {topStores.map((s, i) => (
            <View
              key={`${s.name}-${i}`}
              style={[styles.topRow, i > 0 && styles.topRowDivider]}
            >
              <Text style={styles.topName}>
                {i + 1}. {s.name}
              </Text>
              <Text style={styles.topCases}>{s.cases} cases</Text>
            </View>
          ))}
        </Card>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

/** Basic RN bar chart (no charting library / SVG). One bar per day. */
function BarTrend({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const H = 72;
  return (
    <View style={[styles.trendRow, { height: H }]}>
      {data.map((v, i) => (
        <View
          key={i}
          style={[
            styles.trendBar,
            { height: v > 0 ? Math.max(3, (v / max) * H) : 1 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 24, paddingTop: 60 },
  title: {
    fontFamily: Typography.fontFamily,
    ...Typography.pageTitle,
    color: Colors.text,
  },
  subtitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    marginTop: 4,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
    marginTop: 20,
    marginBottom: 12,
  },
  // Pipeline
  pipelineRow: { gap: 10, paddingBottom: 4 },
  pipelineCard: {
    minWidth: 88,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pipelineDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 6 },
  pipelineCount: {
    fontFamily: Typography.fontFamily,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
  },
  pipelineLabel: {
    fontFamily: Typography.fontFamily,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
  },
  // Cases card
  cardLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 12,
  },
  casesRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  casesValue: {
    fontFamily: Typography.fontFamily,
    fontSize: 40,
    fontWeight: '700',
    color: Colors.accent,
  },
  deltaWrap: { marginLeft: 16, marginBottom: 6 },
  deltaText: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    fontWeight: '700',
  },
  deltaSub: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
  },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end' },
  trendBar: {
    flex: 1,
    marginHorizontal: 1,
    backgroundColor: Colors.accent,
    borderRadius: 1,
  },
  trendCaption: {
    fontFamily: Typography.fontFamily,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 6,
    textAlign: 'center',
  },
  // Today
  statsRow: { flexDirection: 'row', gap: 32 },
  stat: {},
  statValue: {
    fontFamily: Typography.fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginTop: 2,
  },
  // Attention
  attnCard: { marginBottom: 10 },
  attnName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tag: {
    fontFamily: Typography.fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: Colors.alert,
    borderWidth: 1,
    borderColor: Colors.alert,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  // Top stores
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  topRowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  topName: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    flex: 1,
  },
  topCases: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.accent,
    fontWeight: '600',
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
});
