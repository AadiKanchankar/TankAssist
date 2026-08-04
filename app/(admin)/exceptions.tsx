import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius } from '../../constants/colors';
import Header from '../../components/Header';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import { useAuthStore } from '../../store/useAuthStore';
import {
  usePendingPlans,
  useReviewPlan,
  useFlaggedVisits,
  usePlanSubmissions,
} from '../../hooks/useJourneyPlans';
import { PLAN_STATUS_LABEL } from '../../lib/journeyPlan';

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      })
    : '—';

/**
 * The manager's exception queue.
 *
 * This is the payoff of the whole anti-cheat design: it floats the FLAGGED
 * items, not all activity — "review these 3", never "audit all 300". Every
 * flag carries its own reason, and nothing here was ever blocked from
 * happening; this is where a manager decides whether it mattered.
 */
export default function ExceptionsScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const plans = usePendingPlans();
  const flagged = useFlaggedVisits();
  const review = useReviewPlan(profile?.id);

  // Live: a rep submitting a plan refreshes this list without a pull.
  usePlanSubmissions(true);

  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useFocusEffect(
    useCallback(() => {
      plans.refetch();
      flagged.refetch();
    }, [plans.refetch, flagged.refetch]),
  );

  const approve = async (planId: string) => {
    try {
      await review.mutateAsync({ planId, status: 'approved' });
    } catch (e: any) {
      Alert.alert('Couldn’t approve', e.message || 'Try again.');
    }
  };

  const doReject = async () => {
    if (!reason.trim()) {
      Alert.alert('Reason needed', 'Tell the rep what to change.');
      return;
    }
    try {
      await review.mutateAsync({ planId: rejecting!, status: 'rejected', reason });
      setRejecting(null);
      setReason('');
    } catch (e: any) {
      Alert.alert('Couldn’t send back', e.message || 'Try again.');
    }
  };

  const pending = plans.data ?? [];
  const visits = flagged.data ?? [];
  const loading = plans.isPending || flagged.isPending;

  return (
    <View style={styles.screen}>
      <Header title="Review queue" onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color={Colors.accent} style={{ marginTop: Space.lg }} /> : null}

        {/* ── Plans awaiting approval ── */}
        <Text style={[Type.section, styles.sectionTitle]}>
          Plans awaiting approval{pending.length ? ` · ${pending.length}` : ''}
        </Text>
        {!loading && pending.length === 0 ? (
          <BentoTile>
            <EmptyState icon="checkmark-done-outline" title="Nothing waiting" message="Every plan has been reviewed." />
          </BentoTile>
        ) : (
          pending.map((p) => (
            <BentoTile key={p.id} style={styles.tile}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[Type.bodyMed, { color: Colors.text }]}>{p.rep_name}</Text>
                  <Text style={styles.meta}>
                    {p.plan_date} · {p.store_ids.length} store{p.store_ids.length === 1 ? '' : 's'} · sent{' '}
                    {fmtWhen(p.submitted_at)}
                  </Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Button title="Approve" onPress={() => approve(p.id)} loading={review.isPending} />
                <Button
                  title="Send back"
                  variant="secondary"
                  onPress={() => { setRejecting(p.id); setReason(''); }}
                />
              </View>
            </BentoTile>
          ))
        )}

        {/* ── Flagged visits ── */}
        <Text style={[Type.section, styles.sectionTitle]}>
          Flagged visits{visits.length ? ` · ${visits.length}` : ''}
        </Text>
        {!loading && visits.length === 0 ? (
          <BentoTile>
            <EmptyState
              icon="shield-checkmark-outline"
              title="Nothing to review"
              message="No visits in the last 7 days raised a flag."
            />
          </BentoTile>
        ) : (
          visits.map((v) => (
            <BentoTile key={v.visit_id} style={styles.tile}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                    {v.store_name}
                  </Text>
                  <Text style={styles.meta}>
                    {v.rep_name} · {fmtWhen(v.check_in_time)}
                  </Text>
                </View>
              </View>
              {v.flags.map((f, i) => (
                <View key={i} style={[styles.flagRow, f.soft ? styles.flagSoft : styles.flagHard]}>
                  <Ionicons
                    name={f.soft ? 'help-circle-outline' : 'alert-circle-outline'}
                    size={16}
                    color={f.soft ? Colors.textSecondary : Colors.alert}
                  />
                  <Text style={styles.flagText}>{f.reason}</Text>
                </View>
              ))}
            </BentoTile>
          ))
        )}

        <Text style={styles.footNote}>
          Nothing here was blocked — reps are never stopped from working. These are the items worth
          a second look.
        </Text>
      </ScrollView>

      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>Send the plan back</Text>
            <Text style={styles.meta}>The rep sees this and can edit and resubmit.</Text>
            <TextInput
              style={styles.input}
              placeholder="What should change?"
              placeholderTextColor={Colors.textMuted}
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <View style={styles.actions}>
              <Button title="Send back" variant="danger" onPress={doReject} loading={review.isPending} />
              <Button title="Cancel" variant="secondary" onPress={() => setRejecting(null)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Space.md, paddingBottom: Space.xl },
  sectionTitle: { color: Colors.text, marginTop: Space.lg, marginBottom: Space.sm },
  tile: { marginBottom: Space.sm },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
  meta: { ...Type.caption, color: Colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.md },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    marginTop: Space.sm,
    padding: Space.sm,
    borderRadius: Radius.sm,
    borderLeftWidth: 3,
  },
  flagHard: { backgroundColor: Colors.surfaceAlt, borderLeftColor: Colors.alert },
  flagSoft: { backgroundColor: Colors.surfaceAlt, borderLeftColor: Colors.borderStrong },
  flagText: { ...Type.caption, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  footNote: {
    ...Type.caption,
    color: Colors.textMuted,
    marginTop: Space.lg,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalWrap: { flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: Space.lg },
  modal: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Space.lg },
  input: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Space.md,
    marginTop: Space.md,
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
