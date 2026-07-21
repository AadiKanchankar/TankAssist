import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import {
  Colors,
  Type,
  Space,
  Radius,
  Layout,
  tabularNums,
} from '../../constants/colors';
import { entrance } from '../../constants/motion';
import BentoTile from '../../components/BentoTile';
import Donut, { DonutSegment } from '../../components/Donut';
import TrendBars from '../../components/TrendBars';
import { ManagementDashboardSkeleton } from '../../components/skeleton/ManagementDashboardSkeleton';
import ErrorState from '../../components/ErrorState';
import { useAuthStore } from '../../store/useAuthStore';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { OrderFilter } from '../../lib/orders';
import { monthName } from '../../lib/reportExport';
import { useManagementDashboard } from '../../hooks/useManagementDashboard';

// Pipeline buckets with DISTINCT on-brand colours (order metadata collides
// dispatched/in_transit on ink, so the donut/legend use this explicit set).
const BUCKET_META: { key: OrderFilter; label: string; color: string }[] = [
  { key: 'to_process', label: 'To process', color: Colors.accent },
  { key: 'dispatched', label: 'Dispatched', color: Colors.warning },
  { key: 'in_transit', label: 'In transit', color: Colors.textSecondary },
  { key: 'delivered', label: 'Delivered', color: Colors.success },
  { key: 'cancelled', label: 'Cancelled', color: Colors.alert },
];

export default function ManagementDashboard({ navigation }: { navigation: any }) {
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const { data, refetch, isPending, isError } = useManagementDashboard();

  const pipeline = data?.pipeline ?? {
    to_process: 0,
    dispatched: 0,
    in_transit: 0,
    delivered: 0,
    cancelled: 0,
  };
  const casesThisMonth = data?.casesThisMonth ?? 0;
  const casesLastMonth = data?.casesLastMonth ?? 0;
  const trend = data?.trend ?? [];
  const repsCheckedIn = data?.repsCheckedIn ?? 0;
  const visitsToday = data?.visitsToday ?? 0;
  const attention = data?.attention ?? [];
  const topStores = data?.topStores ?? [];
  const monthTitle = data?.monthTitle ?? monthName(new Date());

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const delta = casesThisMonth - casesLastMonth;
  const goToOrders = (filter: OrderFilter) =>
    navigation.navigate('Orders', { screen: 'OrdersList', params: { filter } });

  const openCount = pipeline.to_process + pipeline.dispatched + pipeline.in_transit;
  const donutData: DonutSegment[] = BUCKET_META.map((b) => ({
    label: b.label,
    value: pipeline[b.key],
    color: b.color,
  }));

  // Fit a full month of per-day bars to the card width (no horizontal scroll).
  const innerW = Dimensions.get('window').width - 2 * Layout.screenPad - 2 * Layout.cardPad;
  const n = Math.max(1, trend.length);
  const trendSpacing = 2;
  const barWidth = Math.max(3, Math.floor((innerW - (n + 1) * trendSpacing) / n));
  const trendData = trend.map((v) => ({ label: '', value: v }));

  if (isPending && !data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ManagementDashboardSkeleton />
      </View>
    );
  }
  if (isError && !data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ErrorState onRetry={refetch} />
      </View>
    );
  }

  let section = 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Space.md,
            paddingBottom: Layout.tabBar + insets.bottom + Space.md,
          },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Greeting + brand mark */}
        <View style={styles.greetRow}>
          <View style={{ flex: 1 }}>
            <Text style={[Type.title, { color: Colors.text }]}>
              {getGreeting()}, {profile?.name || 'Team'}
            </Text>
            <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 2 }]}>
              {monthTitle}
            </Text>
          </View>
          <Text style={styles.brandMark}>Tank No. 90</Text>
        </View>

        {/* Hero — cases this month (cream on dark for legibility; no lime here) */}
        <MotiView {...entrance(section++, reduce)}>
          <BentoTile variant="dark" style={{ marginTop: Space.md }}>
            <Text style={[Type.label, styles.onDarkMuted]}>Cases this month · {monthTitle}</Text>
            <Text style={[Type.display, tabularNums, { color: Colors.textOnDark, marginTop: 2 }]}>
              {casesThisMonth}
            </Text>
            <View style={styles.deltaRow}>
              <Ionicons
                name={delta >= 0 ? 'arrow-up' : 'arrow-down'}
                size={14}
                color={Colors.textOnDark}
              />
              <Text style={[Type.label, styles.onDarkMuted]}>
                {Math.abs(delta)} vs {casesLastMonth} last month
              </Text>
            </View>
          </BentoTile>
        </MotiView>

        {/* Cases per day — the one lime spotlight (latest bar) */}
        <MotiView {...entrance(section++, reduce)}>
          <BentoTile style={{ marginTop: Space.md }}>
            <Text style={[Type.label, { color: Colors.textMuted }]}>Cases per day</Text>
            <View style={{ marginTop: Space.md }}>
              {trendData.length > 0 ? (
                <TrendBars data={trendData} barWidth={barWidth} spacing={trendSpacing} height={110} />
              ) : (
                <Text style={[Type.body, { color: Colors.textMuted }]}>No cases yet this month.</Text>
              )}
            </View>
          </BentoTile>
        </MotiView>

        {/* Order pipeline — donut + tappable legend → pre-filtered Orders tab */}
        <MotiView {...entrance(section++, reduce)}>
          <BentoTile style={{ marginTop: Space.md }}>
            <Text style={[Type.section, { color: Colors.text, marginBottom: Space.md }]}>
              Order pipeline
            </Text>
            <View style={styles.pipelineRow}>
              <Donut
                data={donutData}
                centerValue={openCount}
                centerLabel="open"
                radius={54}
                onSegmentPress={(label) => {
                  const b = BUCKET_META.find((x) => x.label === label);
                  if (b) goToOrders(b.key);
                }}
              />
              <View style={styles.legend}>
                {BUCKET_META.map((b) => (
                  <Pressable
                    key={b.key}
                    onPress={() => goToOrders(b.key)}
                    style={styles.legendRow}
                    accessibilityRole="button"
                    accessibilityLabel={`${pipeline[b.key]} orders ${b.label}`}
                  >
                    <View style={[styles.dot, { backgroundColor: b.color }]} />
                    <Text style={[Type.body, { color: Colors.text, flex: 1 }]}>{b.label}</Text>
                    <Text style={[Type.bodyMed, tabularNums, { color: Colors.text }]}>
                      {pipeline[b.key]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </BentoTile>
        </MotiView>

        {/* Today's field activity */}
        <MotiView {...entrance(section++, reduce)} style={styles.bentoRow}>
          <BentoTile style={styles.flex}>
            <Text style={[Type.label, { color: Colors.textMuted }]}>Reps checked in</Text>
            <Text style={[Type.metric, tabularNums, { color: Colors.success, marginTop: 2 }]}>
              {repsCheckedIn}
            </Text>
          </BentoTile>
          <BentoTile style={styles.flex}>
            <Text style={[Type.label, { color: Colors.textMuted }]}>Visits today</Text>
            <Text style={[Type.metric, tabularNums, { color: Colors.text, marginTop: 2 }]}>
              {visitsToday}
            </Text>
          </BentoTile>
        </MotiView>

        {/* Stores needing attention */}
        <MotiView {...entrance(section++, reduce)} style={{ marginTop: Space.md }}>
          <Text style={[Type.section, styles.sectionTitle]}>Stores needing attention</Text>
          {attention.length === 0 ? (
            <BentoTile>
              <Text style={[Type.body, { color: Colors.textMuted }]}>All stores are covered.</Text>
            </BentoTile>
          ) : (
            <Pressable
              onPress={() => navigation.navigate('Stores')}
              accessibilityRole="button"
              accessibilityLabel={`${attention.length} stores need attention`}
            >
              <BentoTile>
                <View style={styles.attnHead}>
                  <Text style={[Type.metric, tabularNums, { color: Colors.warning }]}>
                    {attention.length}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </View>
                {attention.slice(0, 3).map((s, i) => (
                  <View key={s.id} style={[styles.attnRow, i > 0 && styles.attnDivider]}>
                    <Text style={[Type.bodyMed, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <View style={styles.tagRow}>
                      {s.reasons.map((r) => (
                        <Text key={r} style={styles.tag}>
                          {r}
                        </Text>
                      ))}
                    </View>
                  </View>
                ))}
              </BentoTile>
            </Pressable>
          )}
        </MotiView>

        {/* Top stores this month */}
        <MotiView {...entrance(section++, reduce)} style={{ marginTop: Space.md }}>
          <Text style={[Type.section, styles.sectionTitle]}>Top stores · {monthTitle}</Text>
          <BentoTile>
            {topStores.length === 0 ? (
              <Text style={[Type.body, { color: Colors.textMuted }]}>No cases ordered yet this month.</Text>
            ) : (
              topStores.map((s, i) => (
                <View key={`${s.name}-${i}`} style={[styles.topRow, i > 0 && styles.attnDivider]}>
                  <Text style={[Type.body, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                    {i + 1}. {s.name}
                  </Text>
                  <Text style={[Type.bodyMed, tabularNums, { color: Colors.accent }]}>
                    {s.cases} cases
                  </Text>
                </View>
              ))
            )}
          </BentoTile>
        </MotiView>
      </ScrollView>
    </View>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Layout.screenPad },
  greetRow: { flexDirection: 'row', alignItems: 'flex-start' },
  brandMark: { ...Type.label, color: Colors.accent },
  onDarkMuted: { color: Colors.textOnDark, opacity: 0.7 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pipelineRow: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  legend: { flex: 1, gap: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: Layout.tap },
  bentoRow: { flexDirection: 'row', gap: Layout.gridGap, marginTop: Space.md },
  flex: { flex: 1 },
  sectionTitle: { color: Colors.text, marginBottom: Space.sm },
  attnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attnRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm },
  attnDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, justifyContent: 'flex-end' },
  tag: {
    ...Type.caption,
    fontWeight: '700',
    color: Colors.warning,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Space.sm },
});
