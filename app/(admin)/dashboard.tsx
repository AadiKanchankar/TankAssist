import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
import { entrance } from '../../constants/motion';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import Metric from '../../components/Metric';
import { ManagerDashboardSkeleton } from '../../components/skeleton/ManagerDashboardSkeleton';
import ErrorState from '../../components/ErrorState';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useManagerDashboard, RepSummary } from '../../hooks/useManagerDashboard';
import { OrderFilter } from '../../lib/orders';

interface RepVisit {
  id: string;
  store_name: string;
  check_in_time: string;
  check_out_time: string | null;
  cases_sold: number;
  duration_minutes: number | null;
}

// Open-orders glance → each taps through to the pre-filtered Orders tab.
// Colours match the management pipeline donut so both admin dashboards read alike.
const OPEN_BUCKETS: { key: OrderFilter; label: string; color: string }[] = [
  { key: 'to_process', label: 'To process', color: Colors.accent },
  { key: 'dispatched', label: 'Dispatched', color: Colors.warning },
  { key: 'in_transit', label: 'In transit', color: Colors.textSecondary },
];

export default function AdminDashboard({ navigation }: { navigation: any }) {
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const { data, refetch, isPending, isError } = useManagerDashboard();
  const presentCount = data?.presentCount ?? 0;
  const absentCount = data?.absentCount ?? 0;
  const totalAssigned = data?.totalAssigned ?? 0;
  const totalVisited = data?.totalVisited ?? 0;
  const reps = data?.reps ?? [];
  const pipeline = data?.pipeline;

  const [selectedRep, setSelectedRep] = useState<RepSummary | null>(null);
  const [repVisits, setRepVisits] = useState<RepVisit[]>([]);

  const today = new Date().toISOString().split('T')[0];

  // Cache-backed focus refresh (Phase B); fetching lives in useManagerDashboard.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  // Drill-down: a rep's visits today (unchanged logic).
  const loadRepVisits = async (repId: string) => {
    const { data } = await supabase
      .from('store_visits')
      .select('id, check_in_time, check_out_time, cases_sold, duration_minutes, stores(name)')
      .eq('user_id', repId)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`)
      .order('check_in_time', { ascending: true });

    setRepVisits(
      (data || []).map((v: any) => ({
        id: v.id,
        store_name: v.stores?.name || 'Unknown',
        check_in_time: v.check_in_time,
        check_out_time: v.check_out_time,
        cases_sold: v.cases_sold,
        duration_minutes: v.duration_minutes,
      }))
    );
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const formattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const totalReps = presentCount + absentCount;
  const lowCoverage = totalReps > 0 && presentCount / totalReps < 0.5;
  const coveragePct = totalAssigned > 0 ? Math.round((totalVisited / totalAssigned) * 100) : 0;
  const goToOrders = (filter: OrderFilter) =>
    navigation.navigate('Orders', { screen: 'OrdersList', params: { filter } });

  if (isPending && !data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ManagerDashboardSkeleton />
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
              {getGreeting()}, {profile?.name || 'Manager'}
            </Text>
            <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 2 }]}>
              {formattedDate}
            </Text>
          </View>
          <Text style={styles.brandMark}>Tank No. 90</Text>
        </View>

        {/* Hero — reps checked in (spotlight when under half) */}
        <MotiView {...entrance(section++, reduce)}>
          <BentoTile variant="dark" style={{ marginTop: Space.md }}>
            <Text style={[Type.label, styles.onDarkMuted]}>Reps checked in today</Text>
            <View style={styles.heroRatioRow}>
              <Text
                style={[
                  Type.display,
                  tabularNums,
                  { color: lowCoverage ? Colors.spotlight : Colors.textOnDark },
                ]}
              >
                {presentCount}
              </Text>
              <Text style={[Type.section, styles.onDarkMuted, { marginBottom: 2 }]}>
                {' '}
                / {totalReps}
              </Text>
            </View>
            <Text style={[Type.body, styles.onDarkMuted]}>
              {absentCount} not checked in
            </Text>
          </BentoTile>
        </MotiView>

        {/* Bento row: visits today · coverage */}
        <MotiView {...entrance(section++, reduce)} style={styles.bentoRow}>
          <BentoTile style={styles.flex}>
            <Metric label="Visits today" value={totalVisited} />
          </BentoTile>
          <BentoTile style={styles.flex}>
            <Metric label="Store coverage" value={`${coveragePct}%`} />
          </BentoTile>
        </MotiView>

        {/* Open orders glance */}
        <MotiView {...entrance(section++, reduce)} style={{ marginTop: Space.md }}>
          <View style={styles.sectionHeader}>
            <Text style={[Type.section, { color: Colors.text }]}>Open orders</Text>
            <Pressable
              onPress={() => goToOrders('to_process')}
              hitSlop={8}
              style={styles.seeAll}
              accessibilityRole="button"
              accessibilityLabel="Open the orders tab"
            >
              <Text style={[Type.label, { color: Colors.accent }]}>View all</Text>
              <Ionicons name="chevron-forward" size={14} color={Colors.accent} />
            </Pressable>
          </View>
          <View style={styles.bucketRow}>
            {OPEN_BUCKETS.map((b) => (
              <Pressable
                key={b.key}
                onPress={() => goToOrders(b.key)}
                style={styles.bucket}
                accessibilityRole="button"
                accessibilityLabel={`${pipeline?.[b.key] ?? 0} orders ${b.label}`}
              >
                <View style={[styles.dot, { backgroundColor: b.color }]} />
                <Text style={[Type.metric, tabularNums, { color: Colors.text }]}>
                  {pipeline?.[b.key] ?? 0}
                </Text>
                <Text style={[Type.caption, { color: Colors.textMuted }]}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        </MotiView>

        {/* Team today */}
        <MotiView {...entrance(section++, reduce)} style={{ marginTop: Space.md }}>
          <Text style={[Type.section, styles.sectionTitle]}>Your team today</Text>
          <BentoTile>
            {reps.length === 0 ? (
              <Text style={[Type.body, { color: Colors.textMuted }]}>No reps yet.</Text>
            ) : (
              reps.map((rep, i) => (
                <Pressable
                  key={rep.id}
                  onPress={async () => {
                    setSelectedRep(rep);
                    await loadRepVisits(rep.id);
                  }}
                  style={[styles.repRow, i > 0 && styles.repRowDivider]}
                  accessibilityRole="button"
                  accessibilityLabel={`${rep.name}, ${rep.visitCount} visits`}
                >
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: rep.checkedIn ? Colors.success : Colors.borderStrong },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                      {rep.name}
                    </Text>
                    <Text style={[Type.caption, { color: Colors.textMuted }]}>
                      {rep.checkedIn ? (rep.punchedOut ? 'Punched out' : 'Active') : 'Not checked in'}
                    </Text>
                  </View>
                  <Text style={[Type.label, { color: Colors.accent }]}>
                    {rep.visitCount} visits
                  </Text>
                </Pressable>
              ))
            )}
          </BentoTile>
        </MotiView>
      </ScrollView>

      {/* Rep visits drill-down (unchanged logic) */}
      <Modal
        visible={!!selectedRep}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedRep(null)}
      >
        {selectedRep && (
          <View style={styles.modalContainer}>
            <Header title={`${selectedRep.name}’s visits`} onBack={() => setSelectedRep(null)} />
            <FlatList
              data={repVisits}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.modalList}
              renderItem={({ item }) => (
                <BentoTile style={{ marginBottom: Space.md }}>
                  <Text style={[Type.bodyMed, { color: Colors.text }]}>{item.store_name}</Text>
                  <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>
                    {new Date(item.check_in_time).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {item.check_out_time
                      ? ` → ${new Date(item.check_out_time).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ' → In progress'}
                  </Text>
                  <Text style={[Type.label, { color: Colors.accent, marginTop: Space.xs }]}>
                    {item.cases_sold} cases · {item.duration_minutes || '—'} min
                  </Text>
                </BentoTile>
              )}
              ListEmptyComponent={
                <BentoTile>
                  <Text style={[Type.body, { color: Colors.textMuted }]}>No visits today.</Text>
                </BentoTile>
              }
            />
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Layout.screenPad },
  greetRow: { flexDirection: 'row', alignItems: 'flex-start' },
  brandMark: { ...Type.label, color: Colors.accent },
  onDarkMuted: { color: Colors.textOnDark, opacity: 0.7 },
  heroRatioRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: Space.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bentoRow: { flexDirection: 'row', gap: Layout.gridGap, marginTop: Space.md },
  flex: { flex: 1 },
  sectionTitle: { color: Colors.text, marginBottom: Space.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.sm,
  },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: Layout.tap, paddingLeft: Space.sm },
  bucketRow: { flexDirection: 'row', gap: Layout.gridGap },
  bucket: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    gap: 2,
  },
  repRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm, minHeight: Layout.tap },
  repRowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalList: { padding: Layout.screenPad },
});
