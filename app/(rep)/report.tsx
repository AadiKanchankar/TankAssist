import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import Metric from '../../components/Metric';
import VoiceInput from '../../components/VoiceInput';
import { SkelBlock } from '../../components/skeleton/Skeleton';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { repCasesSold } from '../../lib/reportSemantics';
import { displayFigure, fmtKmShort, AttendanceFigures } from '../../lib/reportFigures';

export default function ReportScreen() {
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();
  // Today's attendance row, or null before punch-in.
  const [day, setDay] = useState<AttendanceFigures | null>(null);
  const [totalCases, setTotalCases] = useState(0);
  const [storesVisited, setStoresVisited] = useState(0);
  const [notes, setNotes] = useState('');
  const [challenges, setChallenges] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    if (!profile) return;
    // Attendance data
    const { data: att } = await supabase
      .from('attendance')
      .select('check_out_time, auto_closed, total_market_time_minutes, total_distance_km, odo_start, odo_end')
      .eq('user_id', profile.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`)
      .maybeSingle();
    setDay(att ?? null);

    // Stores visited today.
    const { data: visits } = await supabase
      .from('store_visits')
      .select('check_out_time')
      .eq('user_id', profile.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);
    setStoresVisited((visits || []).filter((v) => v.check_out_time).length);

    // Cases Sold — cutover semantics (today on/after cutover → orders).
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    setTotalCases(await repCasesSold(profile.id, today, tomorrowStr));

    // Already submitted?
    const { data: report } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('user_id', profile.id)
      .eq('report_date', today)
      .maybeSingle();
    if (report) {
      setSubmitted(true);
      setNotes(report.notes || '');
      setChallenges(report.challenges || '');
    }
    setLoading(false);
  }, [profile, today]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const { refreshing, onRefresh } = usePullToRefresh(loadData);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.from('daily_reports').insert({
        user_id: profile!.id,
        report_date: today,
        notes: notes || null,
        challenges: challenges || null,
      });
      if (error) throw error;
      setSubmitted(true);
    } catch (err: any) {
      Alert.alert('Couldn’t submit the report', err.message || 'Try again.');
    }
    setSubmitting(false);
  };

  // Route, odometer and market time are all written at punch-out, so until
  // then they read "Calculated at punch-out" rather than a misleading 0.
  const days = day ? [day] : [];
  const route = displayFigure(days, 'route', (km) => `${km.toFixed(1)} km`);
  const odo = displayFigure(days, 'odometer', fmtKmShort);
  const market = displayFigure(days, 'market', (m) => `${Math.floor(m / 60)}h ${m % 60}m`);

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
        <SkelBlock w={200} h={26} />
        <SkelBlock w={160} h={16} style={{ marginTop: Space.sm }} />
        <View style={[styles.statsGrid, { marginTop: Space.lg }]}>
          {[0, 1, 2, 3].map((i) => (
            <SkelBlock key={i} w="48%" h={84} r={Radius.card} />
          ))}
          <SkelBlock w="100%" h={84} r={Radius.card} />
        </View>
        <SkelBlock h={120} r={Radius.card} style={{ marginTop: Space.md }} />
        <SkelBlock h={120} r={Radius.card} style={{ marginTop: Space.md }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.md, paddingBottom: Layout.tabBar + insets.bottom + Space.md },
      ]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={[Type.title, { color: Colors.text }]}>Daily report</Text>
      <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 2, marginBottom: Space.lg }]}>
        {dateLabel}
      </Text>

      {/* Both distances side by side, never merged: the odometer is what your
          travel allowance is checked against. */}
      <View style={styles.statsGrid}>
        <View style={styles.cell}>
          <BentoTile style={styles.tile}><Metric label="Route (GPS)" {...route} /></BentoTile>
        </View>
        <View style={styles.cell}>
          <BentoTile style={styles.tile}><Metric label="Odometer" {...odo} /></BentoTile>
        </View>
        <View style={styles.cell}>
          <BentoTile style={styles.tile}><Metric label="Cases sold" value={totalCases} /></BentoTile>
        </View>
        <View style={styles.cell}>
          <BentoTile style={styles.tile}><Metric label="Stores visited" value={storesVisited} /></BentoTile>
        </View>
        <View style={styles.cellWide}>
          <BentoTile style={styles.tile}><Metric label="Market time" {...market} /></BentoTile>
        </View>
      </View>

      <BentoTile style={styles.field}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <VoiceInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Any notes for today…"
          editable={!submitted}
          inputStyle={styles.textInput}
        />
      </BentoTile>

      <BentoTile style={styles.field}>
        <Text style={styles.fieldLabel}>Challenges</Text>
        <VoiceInput
          value={challenges}
          onChangeText={setChallenges}
          placeholder="Any challenges faced today…"
          editable={!submitted}
          inputStyle={styles.textInput}
        />
      </BentoTile>

      {submitted ? (
        <View style={styles.submittedBanner}>
          <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
          <Text style={[Type.bodyMed, { color: Colors.success }]}>Report submitted</Text>
        </View>
      ) : (
        <Button title="Submit report" spotlight onPress={handleSubmit} loading={submitting} style={{ marginTop: Space.sm }} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Layout.screenPad },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Layout.gridGap, marginBottom: Space.md },
  // Cells stretch to the tallest tile in the row; tiles grow to fill, so a
  // tile with a note doesn't leave its neighbour short.
  cell: { width: '48%' },
  cellWide: { width: '100%' },
  tile: { flexGrow: 1 },
  field: { marginTop: Space.md },
  fieldLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  textInput: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Space.md,
    minHeight: 100,
  },
  submittedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    justifyContent: 'center',
    paddingVertical: Space.lg,
  },
});
