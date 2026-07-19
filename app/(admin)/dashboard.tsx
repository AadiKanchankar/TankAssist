import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Header from '../../components/Header';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

interface RepSummary {
  id: string;
  name: string;
  visitCount: number;
  checkedIn: boolean;
  punchedOut: boolean;
}

interface RepVisit {
  id: string;
  store_name: string;
  check_in_time: string;
  check_out_time: string | null;
  cases_sold: number;
  duration_minutes: number | null;
}

export default function AdminDashboard() {
  const [presentCount, setPresentCount] = useState(0);
  const [absentCount, setAbsentCount] = useState(0);
  const [totalAssigned, setTotalAssigned] = useState(0);
  const [totalVisited, setTotalVisited] = useState(0);
  const [reps, setReps] = useState<RepSummary[]>([]);
  const [selectedRep, setSelectedRep] = useState<RepSummary | null>(null);
  const [repVisits, setRepVisits] = useState<RepVisit[]>([]);

  const today = new Date().toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    // Get all reps
    const { data: allReps } = await supabase
      .from('users')
      .select('id, name')
      .eq('role', 'rep');

    const totalReps = allReps?.length || 0;

    // Get today's attendance
    const { data: attendanceRows } = await supabase
      .from('attendance')
      .select('user_id, check_out_time')
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);

    const checkedInIds = new Set((attendanceRows || []).map((a) => a.user_id));
    const punchedOutIds = new Set(
      (attendanceRows || []).filter((a) => a.check_out_time).map((a) => a.user_id)
    );

    setPresentCount(checkedInIds.size);
    setAbsentCount(totalReps - checkedInIds.size);

    // Store coverage
    const { data: assignments } = await supabase
      .from('store_assignments')
      .select('store_id')
      .eq('assigned_date', today);
    const assignedStoreIds = new Set((assignments || []).map((a) => a.store_id));
    setTotalAssigned(assignedStoreIds.size);

    const { data: visits } = await supabase
      .from('store_visits')
      .select('store_id, user_id, check_out_time')
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);

    const visitedStoreIds = new Set(
      (visits || []).filter((v) => v.check_out_time).map((v) => v.store_id)
    );
    setTotalVisited(visitedStoreIds.size);

    // Rep summaries
    const repSummaries: RepSummary[] = (allReps || []).map((r) => {
      const repVisits = (visits || []).filter(
        (v) => v.user_id === r.id && v.check_out_time
      );
      return {
        id: r.id,
        name: r.name,
        visitCount: repVisits.length,
        checkedIn: checkedInIds.has(r.id),
        punchedOut: punchedOutIds.has(r.id),
      };
    });
    setReps(repSummaries);
  }, [today]);

  // Refetch data every time the screen gains focus (tab switch, modal close)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const { refreshing, onRefresh } = usePullToRefresh(loadData);

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

  const formattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.date}>{formattedDate}</Text>

      {/* Attendance */}
      <Card>
        <Text style={styles.cardLabel}>ATTENDANCE</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {presentCount}
            </Text>
            <Text style={styles.statLabel}>PRESENT</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: Colors.alert }]}>
              {absentCount}
            </Text>
            <Text style={styles.statLabel}>ABSENT</Text>
          </View>
        </View>
      </Card>

      {/* Store Coverage */}
      <Card>
        <Text style={styles.cardLabel}>STORE COVERAGE</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{totalAssigned}</Text>
            <Text style={styles.statLabel}>ASSIGNED</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {totalVisited}
            </Text>
            <Text style={styles.statLabel}>VISITED</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: Colors.alert }]}>
              {totalAssigned - totalVisited}
            </Text>
            <Text style={styles.statLabel}>MISSED</Text>
          </View>
        </View>
      </Card>

      {/* Reps List */}
      <Text style={styles.sectionTitle}>Reps Today</Text>
      {reps.map((rep) => (
        <TouchableOpacity
          key={rep.id}
          onPress={async () => {
            setSelectedRep(rep);
            await loadRepVisits(rep.id);
          }}
        >
          <Card>
            <View style={styles.repRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: rep.checkedIn
                      ? Colors.success
                      : Colors.muted,
                  },
                ]}
              />
              <View style={styles.repInfo}>
                <Text style={styles.repName}>{rep.name}</Text>
                <Text style={styles.repMeta}>
                  {rep.checkedIn
                    ? rep.punchedOut
                      ? 'Punched Out'
                      : 'Active'
                    : 'Not checked in'}
                </Text>
              </View>
              <Text style={styles.visitCount}>{rep.visitCount} visits</Text>
            </View>
          </Card>
        </TouchableOpacity>
      ))}

      {/* Rep Visits Modal */}
      <Modal
        visible={!!selectedRep}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedRep(null)}
      >
        {selectedRep && (
          <View style={styles.modalContainer}>
            <Header
              title={`${selectedRep.name}'s Visits`}
              onBack={() => setSelectedRep(null)}
            />
            <FlatList
              data={repVisits}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.modalList}
              renderItem={({ item }) => (
                <Card>
                  <Text style={styles.visitStoreName}>{item.store_name}</Text>
                  <Text style={styles.visitTime}>
                    {new Date(item.check_in_time).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {item.check_out_time
                      ? ` → ${new Date(
                          item.check_out_time
                        ).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ' → In progress'}
                  </Text>
                  <Text style={styles.visitCases}>
                    {item.cases_sold} cases • {item.duration_minutes || '—'} min
                  </Text>
                </Card>
              )}
              ListEmptyComponent={
                <Card>
                  <Text style={styles.emptyText}>No visits today.</Text>
                </Card>
              }
            />
          </View>
        )}
      </Modal>

      <View style={{ height: 40 }} />
    </ScrollView>
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
  date: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    marginTop: 4,
    marginBottom: 24,
  },
  cardLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 12,
  },
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
  sectionTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
    marginTop: 8,
    marginBottom: 16,
  },
  repRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  repInfo: { flex: 1 },
  repName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  repMeta: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 2,
  },
  visitCount: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.accent,
    fontWeight: '600',
  },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalList: { padding: 24 },
  visitStoreName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
    marginBottom: 4,
  },
  visitTime: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
  },
  visitCases: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.accent,
    fontWeight: '600',
    marginTop: 4,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
});
