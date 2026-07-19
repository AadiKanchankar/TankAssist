import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Button from '../../components/Button';
import Card from '../../components/Card';
import VoiceInput from '../../components/VoiceInput';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { repCasesSold } from '../../lib/reportSemantics';

export default function ReportScreen() {
  const { profile } = useAuthStore();
  const [totalMarketTime, setTotalMarketTime] = useState<number | null>(null);
  const [totalDistance, setTotalDistance] = useState<number | null>(null);
  const [totalCases, setTotalCases] = useState(0);
  const [storesVisited, setStoresVisited] = useState(0);
  const [notes, setNotes] = useState('');
  const [challenges, setChallenges] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    if (!profile) return;

    // Attendance data
    const { data: att } = await supabase
      .from('attendance')
      .select('total_market_time_minutes, total_distance_km')
      .eq('user_id', profile.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`)
      .maybeSingle();

    setTotalMarketTime(att?.total_market_time_minutes ?? null);
    setTotalDistance(att?.total_distance_km ?? null);

    // Stores visited today (visit count is unchanged by the semantics switch).
    const { data: visits } = await supabase
      .from('store_visits')
      .select('check_out_time')
      .eq('user_id', profile.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);
    setStoresVisited((visits || []).filter((v) => v.check_out_time).length);

    // Cases Sold — cutover semantics (today is on/after cutover → orders).
    // Parse/step in UTC to match this screen's `today` (an ISO UTC date string)
    // and avoid a local-offset shift landing back on today.
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    setTotalCases(await repCasesSold(profile.id, today, tomorrowStr));

    // Check if report already submitted
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
      Alert.alert('Success', 'Daily report submitted.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to submit report.');
    }
    setSubmitting(false);
  };

  const formatTime = (minutes: number | null) => {
    if (minutes === null) return '—';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.title}>Daily Report</Text>
      <Text style={styles.date}>
        {new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </Text>

      {/* Auto-populated Stats */}
      <View style={styles.statsGrid}>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{formatTime(totalMarketTime)}</Text>
          <Text style={styles.statLabel}>MARKET TIME</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>
            {totalDistance !== null ? `${totalDistance.toFixed(1)} km` : '—'}
          </Text>
          <Text style={styles.statLabel}>DISTANCE</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{totalCases}</Text>
          <Text style={styles.statLabel}>CASES SOLD</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{storesVisited}</Text>
          <Text style={styles.statLabel}>STORES VISITED</Text>
        </Card>
      </View>

      {/* Editable Fields */}
      <Card>
        <Text style={styles.fieldLabel}>NOTES</Text>
        <VoiceInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Any notes for today..."
          editable={!submitted}
          inputStyle={styles.textInput}
        />
      </Card>

      <Card>
        <Text style={styles.fieldLabel}>CHALLENGES</Text>
        <VoiceInput
          value={challenges}
          onChangeText={setChallenges}
          placeholder="Any challenges faced today..."
          editable={!submitted}
          inputStyle={styles.textInput}
        />
      </Card>

      {submitted ? (
        <View style={styles.submittedBanner}>
          <Text style={styles.submittedText}>✓ Report submitted</Text>
        </View>
      ) : (
        <Button
          title="Submit Report"
          onPress={handleSubmit}
          loading={submitting}
          style={styles.submitBtn}
        />
      )}

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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  statCard: {
    width: '47%',
    alignItems: 'center',
    paddingVertical: 20,
  },
  statValue: {
    fontFamily: Typography.fontFamily,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginTop: 6,
  },
  fieldLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
  },
  textInput: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    padding: 12,
    minHeight: 100,
  },
  submitBtn: { marginTop: 8 },
  submittedBanner: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  submittedText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.success,
    fontWeight: '600',
    fontSize: 18,
  },
});
