import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius } from '../../constants/colors';
import Header from '../../components/Header';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useAuthStore } from '../../store/useAuthStore';
import {
  usePendingPlans,
  useReviewPlan,
  useFlaggedVisits,
  useOdometerFlags,
  usePlanSubmissions,
  type FlaggedDay,
  type FlaggedVisit,
  type PendingPlan,
} from '../../hooks/useJourneyPlans';
import { PLAN_ACTIONABLE_DAYS } from '../../lib/journeyPlan';

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

/**
 * One row of the queue. The three flag families have nothing in common beyond
 * "a manager should look at this", so they stay separate shapes rather than
 * being forced into a shared type that would need narrowing anyway.
 */
type Row =
  | { kind: 'odometer'; key: string; day: FlaggedDay }
  | { kind: 'visit'; key: string; visit: FlaggedVisit }
  | { kind: 'plan'; key: string; plan: PendingPlan }
  | { kind: 'empty'; key: string; icon: any; title: string; message: string };

interface QueueSection {
  title: string;
  count: number;
  data: Row[];
}

/**
 * The manager's exception queue.
 *
 * This is the payoff of the whole anti-cheat design: it floats the FLAGGED
 * items, not all activity — "review these 3", never "audit all 300". Every
 * flag carries its own reason, and nothing here was ever blocked from
 * happening; this is where a manager decides whether it mattered.
 *
 * Three labelled sections with sticky headers (Common Region + chunking): the
 * families need different judgements — a distance claim, a visit's honesty, a
 * plan approval — so mixing them into one stream made the manager re-orient at
 * every card. SectionList rather than a ScrollView of .map() so a busy week
 * renders the visible window instead of mounting every card at once.
 */
export default function ExceptionsScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const plans = usePendingPlans(profile?.id);
  const flagged = useFlaggedVisits();
  const odoFlags = useOdometerFlags();
  const review = useReviewPlan(profile?.id);

  // Live: a rep submitting a plan refreshes this list without a pull.
  usePlanSubmissions(true);

  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  /**
   * Which plan is mid-review. Per-plan rather than the mutation's shared
   * isPending, which spun EVERY approve button at once and left them all
   * tappable — so a queue of five plans offered five concurrent approves.
   */
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    await Promise.all([plans.refetch(), flagged.refetch(), odoFlags.refetch()]);
  }, [plans.refetch, flagged.refetch, odoFlags.refetch]);

  const { refreshing, onRefresh } = usePullToRefresh(reload);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const approve = async (planId: string) => {
    if (reviewingId) return; // never let a second approve start
    setReviewingId(planId);
    try {
      await review.mutateAsync({ planId, status: 'approved' });
    } catch (e: any) {
      Alert.alert('Couldn’t approve', e.message || 'Try again.');
    } finally {
      setReviewingId(null);
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

  const pending = plans.data?.plans ?? [];
  const staleCount = plans.data?.staleCount ?? 0;
  const visits = flagged.data ?? [];
  const days = odoFlags.data ?? [];
  const loading = plans.isPending || flagged.isPending || odoFlags.isPending;

  const sections: QueueSection[] = useMemo(() => {
    const fill = (rows: Row[], empty: Row): Row[] =>
      rows.length ? rows : loading ? [] : [empty];

    return [
      {
        title: 'Odometer flags',
        count: days.length,
        data: fill(
          days.map((d) => ({ kind: 'odometer' as const, key: d.attendance_id, day: d })),
          {
            kind: 'empty',
            key: 'empty-odo',
            icon: 'speedometer-outline',
            title: 'Distances add up',
            message: 'Odometer claims match the tracked routes.',
          },
        ),
      },
      {
        title: 'Location & visit flags',
        count: visits.length,
        data: fill(
          visits.map((v) => ({ kind: 'visit' as const, key: v.visit_id, visit: v })),
          {
            kind: 'empty',
            key: 'empty-visits',
            icon: 'shield-checkmark-outline',
            title: 'Nothing to review',
            message: 'No visit in the last 7 days raised a flag.',
          },
        ),
      },
      {
        title: 'Day plans',
        count: pending.length,
        data: fill(
          pending.map((p) => ({ kind: 'plan' as const, key: p.id, plan: p })),
          {
            kind: 'empty',
            key: 'empty-plans',
            icon: 'checkmark-done-outline',
            title: 'Nothing waiting',
            message: staleCount
              ? // Never let a silently-filtered pile read as "you're done".
                `${staleCount} older plan${staleCount === 1 ? '' : 's'} ` +
                `${staleCount === 1 ? 'is' : 'are'} past the ${PLAN_ACTIONABLE_DAYS}-day window ` +
                'and no longer actionable. They stay in the rep’s history.'
              : 'Every plan has been reviewed.',
          },
        ),
      },
    ];
  }, [days, visits, pending, staleCount, loading]);

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'empty') {
      return (
        <BentoTile style={styles.tile}>
          <EmptyState icon={item.icon} title={item.title} message={item.message} />
        </BentoTile>
      );
    }

    if (item.kind === 'odometer') {
      const d = item.day;
      return (
        <BentoTile style={styles.tile}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={[Type.bodyMed, { color: Colors.text }]}>{d.rep_name}</Text>
              <Text style={styles.meta}>{d.date}</Text>
            </View>
            <Text style={[Type.bodyMed, { color: Colors.alert }]}>
              +{Math.round(d.excessKm)} km
            </Text>
          </View>
          <View style={[styles.flagRow, styles.flagHard]}>
            <Ionicons name="speedometer-outline" size={16} color={Colors.alert} />
            <Text style={styles.flagText}>{d.reason}</Text>
          </View>
        </BentoTile>
      );
    }

    if (item.kind === 'visit') {
      const v = item.visit;
      return (
        <BentoTile style={styles.tile}>
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
      );
    }

    const p = item.plan;
    return (
      <BentoTile style={styles.tile}>
        <View style={styles.rowTop}>
          <View style={{ flex: 1 }}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>{p.rep_name}</Text>
            <Text style={styles.meta}>
              {p.plan_date} · {p.store_ids.length} store{p.store_ids.length === 1 ? '' : 's'} ·
              sent {fmtWhen(p.submitted_at)}
            </Text>
          </View>
        </View>
        {!p.rep_has_manager ? (
          <View style={[styles.flagRow, styles.flagSoft]}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.flagText}>
              This rep has no assigned sales manager, so only management can review their plans.
              Assign one in Team to route future plans automatically.
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            title="Approve"
            onPress={() => approve(p.id)}
            loading={reviewingId === p.id}
            disabled={!!reviewingId}
          />
          <Button
            title="Send back"
            variant="secondary"
            disabled={!!reviewingId}
            onPress={() => {
              setRejecting(p.id);
              setReason('');
            }}
          />
        </View>
      </BentoTile>
    );
  };

  return (
    <View style={styles.screen}>
      <Header
        title="Review queue"
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={[Type.section, { color: Colors.text }]}>{section.title}</Text>
            {section.count > 0 ? (
              <View style={styles.countPill}>
                <Text style={styles.countText}>{section.count}</Text>
              </View>
            ) : null}
          </View>
        )}
        ListHeaderComponent={
          loading ? <ActivityIndicator color={Colors.accent} style={{ marginTop: Space.lg }} /> : null
        }
        ListFooterComponent={
          <Text style={styles.footNote}>
            Nothing here was blocked — reps are never stopped from working. These are the items
            worth a second look.
          </Text>
        }
      />

      <Modal
        visible={!!rejecting}
        transparent
        animationType="fade"
        onRequestClose={() => setRejecting(null)}
      >
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
              accessibilityLabel="Reason for sending the plan back"
            />
            <View style={styles.actions}>
              <Button
                title="Send back"
                variant="danger"
                onPress={doReject}
                loading={review.isPending}
              />
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
  // Sticky, so the section a card belongs to is never off-screen while
  // scrolling a long family. Opaque background for the same reason.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingTop: Space.lg,
    paddingBottom: Space.sm,
    backgroundColor: Colors.background,
  },
  countPill: {
    minWidth: 24,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  countText: { ...Type.caption, color: Colors.textSecondary, textAlign: 'center' },
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
