import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
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
import {
  useFlagResolutions,
  useResolveFlag,
  resolutionKey,
  type FlagAction,
} from '../../hooks/useFlagResolutions';

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

/** Which way the queue is chunked. Two options only — Hick's law. */
type GroupBy = 'type' | 'rep';

/**
 * One row. The three families stay separate shapes rather than being forced
 * into a shared type that would need narrowing back out anyway; `sortKey` and
 * the rep fields are the only things every row must carry, because both
 * grouping views need to sort and bucket without knowing the kind.
 */
type Row =
  | { kind: 'odometer'; key: string; sortKey: string; repId: string; repName: string; day: FlaggedDay }
  | { kind: 'visit'; key: string; sortKey: string; repId: string; repName: string; visit: FlaggedVisit }
  | { kind: 'plan'; key: string; sortKey: string; repId: string; repName: string; plan: PendingPlan }
  | { kind: 'empty'; key: string; icon: any; title: string; message: string };

interface QueueSection {
  key: string;
  title: string;
  /** Shown in the header pill. Counts real rows, never the empty placeholder. */
  count: number;
  collapsible: boolean;
  data: Row[];
}

/**
 * Dismiss / Warn, per reason.
 *
 * ponytail: BUTTONS, not swipe. The brief asked for swipe with buttons as the
 * accessible fallback, but react-native-gesture-handler is not installed and
 * adding it means another native module plus a root-view wrapper. Buttons are
 * the half that is mandatory (swipe alone is neither discoverable nor
 * accessible) and they deliver the whole capability. Upgrade path: wrap this
 * row in a Swipeable once gesture-handler lands.
 */
function TriageActions({ onDismiss, onWarn }: { onDismiss: () => void; onWarn: () => void }) {
  return (
    <View style={styles.triageRow}>
      <Pressable
        onPress={onDismiss}
        style={styles.triageBtn}
        accessibilityRole="button"
        accessibilityLabel="Dismiss this flag"
      >
        <Ionicons name="checkmark-circle-outline" size={16} color={Colors.textSecondary} />
        <Text style={styles.triageText}>Dismiss</Text>
      </Pressable>
      <Pressable
        onPress={onWarn}
        style={[styles.triageBtn, styles.triageWarn]}
        accessibilityRole="button"
        accessibilityLabel="Warn the rep about this flag"
      >
        <Ionicons name="alert-circle-outline" size={16} color={Colors.alert} />
        <Text style={[styles.triageText, { color: Colors.alert }]}>Warn rep</Text>
      </Pressable>
    </View>
  );
}

const TYPE_ORDER = ['odometer', 'visit', 'plan'] as const;
const TYPE_TITLE: Record<(typeof TYPE_ORDER)[number], string> = {
  odometer: 'Odometer flags',
  visit: 'Location & visit flags',
  plan: 'Day plans',
};

/**
 * The manager's exception queue.
 *
 * Floats the FLAGGED items, not all activity — "review these 3", never "audit
 * all 300". Every flag carries its own reason, and nothing here was ever
 * blocked from happening; this is where a manager decides whether it mattered.
 *
 * UX shape, and why:
 *  • NEWEST FIRST everywhere. The old queue put the oldest plan on top, which
 *    buried the item most worth acting on under everything already stale.
 *  • TWO grouping views, no more (Hick's). "By type" is triage by kind of
 *    judgement; "by rep" is the view a manager with 20 reps actually needs,
 *    because a rep with four flags is a conversation, not four tasks.
 *  • COLLAPSIBLE sections (chunking + Common Region) so 20 reps is a short
 *    scannable list of names, expanded one at a time.
 *  • A SUMMARY HEADER so the eye lands on the total before the detail; the
 *    number goes alert-coloured only when something actually needs action
 *    (Von Restorff works only if it is rare).
 */
export default function ExceptionsScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const plans = usePendingPlans(profile?.id);
  const flagged = useFlaggedVisits();
  const odoFlags = useOdometerFlags();
  const review = useReviewPlan(profile?.id);
  const { data: resolved } = useFlagResolutions();
  const resolve = useResolveFlag(profile?.id);
  /** The item being dismissed/warned, held while the note sheet is open. */
  const [resolving, setResolving] = useState<{
    subject: 'visit' | 'attendance';
    subjectId: string;
    flagKind: string;
    action: FlagAction;
    repId: string;
    repName: string;
    reason: string;
  } | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  // Live: a rep submitting a plan refreshes this list without a pull.
  usePlanSubmissions(true);

  const [groupBy, setGroupBy] = useState<GroupBy>('type');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  /**
   * Open the note sheet for a triage action.
   *
   * Both actions share one sheet: the note is optional on a dismissal (why it
   * was fine) and becomes the message on a warning, so a manager never has to
   * learn two flows for what is one decision.
   */
  const startResolve = (
    subject: 'visit' | 'attendance',
    subjectId: string,
    flagKind: string,
    action: FlagAction,
    repId: string,
    repName: string,
    reason: string,
  ) => {
    setResolving({ subject, subjectId, flagKind, action, repId, repName, reason });
    setResolveNote('');
  };

  const submitResolve = async () => {
    if (!resolving) return;
    try {
      await resolve.mutateAsync({
        subject: resolving.subject,
        subjectId: resolving.subjectId,
        flagKind: resolving.flagKind,
        action: resolving.action,
        note: resolveNote,
        repId: resolving.repId,
        // The flag's own wording is the default message, so a warning always
        // says what it is about even when the manager adds nothing.
        message: resolveNote.trim() || resolving.reason,
      });
      setResolving(null);
      setResolveNote('');
    } catch (e: any) {
      Alert.alert('Couldn’t save', e?.message ?? 'Try again.');
    }
  };

  /** Every actionable row, newest first, in one flat list. */
  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = [
      // A resolved reason must STAY resolved: these flags are derived and would
      // otherwise reappear on the next load as if nothing had been decided.
      ...days
        .filter((d) => !resolved?.has(resolutionKey('attendance', d.attendance_id, 'odometer_mismatch')))
        .map((d) => ({
        kind: 'odometer' as const,
        key: `odo-${d.attendance_id}`,
        // A day flag has only a date; pin it to end-of-day so it sorts against
        // timestamped rows without appearing to happen at midnight.
        sortKey: `${d.date}T23:59:59`,
        repId: d.rep_id,
        repName: d.rep_name,
        day: d,
      })),
      // Per-REASON, not per-row: dismissing "far from store" leaves any other
      // flag on the same visit still showing, and the row only disappears once
      // every reason on it has been dealt with.
      ...visits
        .map((v) => ({
          ...v,
          flags: v.flags.filter(
            (f) => !resolved?.has(resolutionKey('visit', v.visit_id, f.kind)),
          ),
        }))
        .filter((v) => v.flags.length > 0)
        .map((v) => ({
          kind: 'visit' as const,
          key: `visit-${v.visit_id}`,
          sortKey: v.check_in_time ?? '',
          repId: v.rep_id,
          repName: v.rep_name,
          visit: v,
        })),
      ...pending.map((p) => ({
        kind: 'plan' as const,
        key: `plan-${p.id}`,
        sortKey: p.submitted_at,
        repId: p.rep_id,
        repName: p.rep_name,
        plan: p,
      })),
    ];
    return rows.sort((a, b) => (b as any).sortKey.localeCompare((a as any).sortKey));
  }, [days, visits, pending, resolved]);

  const totalActionable = allRows.length;

  const sections: QueueSection[] = useMemo(() => {
    const hide = (key: string, rows: Row[]) => (collapsed.has(key) ? [] : rows);

    if (groupBy === 'rep') {
      // One section per rep, the rep with the most recent item first — same
      // newest-first rule as the flat list, lifted one level up.
      const byRep = new Map<string, { name: string; rows: Row[] }>();
      for (const r of allRows) {
        if (r.kind === 'empty') continue;
        const entry = byRep.get(r.repId) ?? { name: r.repName, rows: [] };
        entry.rows.push(r);
        byRep.set(r.repId, entry);
      }
      if (byRep.size === 0) {
        return loading
          ? []
          : [
              {
                key: 'empty',
                title: 'Nothing to review',
                count: 0,
                collapsible: false,
                data: [
                  {
                    kind: 'empty',
                    key: 'empty-all',
                    icon: 'shield-checkmark-outline',
                    title: 'All clear',
                    message: 'No rep has anything waiting on you.',
                  },
                ],
              },
            ];
      }
      return [...byRep.entries()].map(([repId, { name, rows }]) => ({
        key: `rep-${repId}`,
        title: name,
        count: rows.length,
        collapsible: true,
        data: hide(`rep-${repId}`, rows),
      }));
    }

    // ── by type ──
    const buckets: Record<string, Row[]> = { odometer: [], visit: [], plan: [] };
    for (const r of allRows) if (r.kind !== 'empty') buckets[r.kind].push(r);

    const emptyFor: Record<string, { icon: string; title: string; message: string }> = {
      odometer: {
        icon: 'speedometer-outline',
        title: 'Distances add up',
        message: 'Odometer claims match the tracked routes.',
      },
      visit: {
        icon: 'shield-checkmark-outline',
        title: 'Nothing to review',
        message: 'No recent visit raised a flag.',
      },
      plan: {
        icon: 'checkmark-done-outline',
        title: 'Nothing waiting',
        message: staleCount
          ? // Never let a silently-filtered pile read as "you're done".
            `${staleCount} older plan${staleCount === 1 ? '' : 's'} ` +
            `${staleCount === 1 ? 'is' : 'are'} past the ${PLAN_ACTIONABLE_DAYS}-day window ` +
            'and no longer actionable. They stay in the rep’s history.'
          : 'Every plan has been reviewed.',
      },
    };

    return TYPE_ORDER.map((kind) => {
      const rows = buckets[kind];
      const key = `type-${kind}`;
      const e = emptyFor[kind];
      return {
        key,
        title: TYPE_TITLE[kind],
        count: rows.length,
        collapsible: rows.length > 0,
        data: rows.length
          ? hide(key, rows)
          : loading
            ? []
            : [
                {
                  kind: 'empty' as const,
                  key: `empty-${kind}`,
                  icon: e.icon,
                  title: e.title,
                  message: e.message,
                },
              ],
      };
    });
  }, [groupBy, allRows, collapsed, loading, staleCount]);

  // ── Row renderers ────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'empty') {
      return (
        <BentoTile style={styles.tile}>
          <EmptyState icon={item.icon} title={item.title} message={item.message} />
        </BentoTile>
      );
    }

    // In the by-rep view the name is the section header, so repeating it on
    // every card is noise; by type, the rep is the thing you need to know.
    const showRep = groupBy === 'type';

    if (item.kind === 'odometer') {
      const d = item.day;
      return (
        <BentoTile style={styles.tile}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={[Type.bodyMed, { color: Colors.text }]}>
                {showRep ? d.rep_name : 'Odometer'}
              </Text>
              <Text style={styles.meta}>{d.date}</Text>
            </View>
            <Text style={[Type.bodyMed, tabularNums, { color: Colors.alert }]}>
              +{Math.round(d.excessKm)} km
            </Text>
          </View>
          <View style={[styles.flagRow, styles.flagHard]}>
            <Ionicons name="speedometer-outline" size={16} color={Colors.alert} />
            <Text style={styles.flagText}>{d.reason}</Text>
          </View>
          <TriageActions
            onDismiss={() =>
              startResolve('attendance', d.attendance_id, 'odometer_mismatch', 'dismissed', d.rep_id, d.rep_name, d.reason)
            }
            onWarn={() =>
              startResolve('attendance', d.attendance_id, 'odometer_mismatch', 'warned', d.rep_id, d.rep_name, d.reason)
            }
          />
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
                {showRep ? `${v.rep_name} · ` : ''}
                {fmtWhen(v.check_in_time)}
              </Text>
            </View>
          </View>
          {v.flags.map((f, i) => (
            <View key={i}>
              <View style={[styles.flagRow, f.soft ? styles.flagSoft : styles.flagHard]}>
                <Ionicons
                  name={f.soft ? 'help-circle-outline' : 'alert-circle-outline'}
                  size={16}
                  color={f.soft ? Colors.textSecondary : Colors.alert}
                />
                <Text style={styles.flagText}>{f.reason}</Text>
              </View>
              {/* Per REASON, because that is the unit a manager judges. */}
              <TriageActions
                onDismiss={() =>
                  startResolve('visit', v.visit_id, f.kind, 'dismissed', v.rep_id, v.rep_name, f.reason)
                }
                onWarn={() =>
                  startResolve('visit', v.visit_id, f.kind, 'warned', v.rep_id, v.rep_name, f.reason)
                }
              />
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
            <Text style={[Type.bodyMed, { color: Colors.text }]}>
              {showRep ? p.rep_name : `Plan for ${p.plan_date}`}
            </Text>
            <Text style={styles.meta}>
              {showRep ? `${p.plan_date} · ` : ''}
              {p.store_ids.length} store{p.store_ids.length === 1 ? '' : 's'} · sent{' '}
              {fmtWhen(p.submitted_at)}
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
        ListHeaderComponent={
          <View>
            {/* Summary first: the total, then how it breaks down. */}
            <View style={styles.summary}>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Needs your attention</Text>
                <Text
                  style={[
                    Type.display,
                    tabularNums,
                    { color: totalActionable ? Colors.alert : Colors.textSecondary },
                  ]}
                >
                  {loading ? '—' : totalActionable}
                </Text>
              </View>
              <View style={styles.breakdown}>
                <Text style={styles.breakdownRow}>{days.length} odometer</Text>
                <Text style={styles.breakdownRow}>{visits.length} visit</Text>
                <Text style={styles.breakdownRow}>{pending.length} plan</Text>
              </View>
            </View>

            {/* Two views, no more. */}
            <View style={styles.toggle} accessibilityRole="tablist">
              {(['type', 'rep'] as GroupBy[]).map((g) => (
                <Pressable
                  key={g}
                  onPress={() => setGroupBy(g)}
                  style={[styles.toggleBtn, groupBy === g && styles.toggleBtnActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: groupBy === g }}
                  accessibilityLabel={g === 'type' ? 'Group by flag type' : 'Group by rep'}
                >
                  <Text style={[styles.toggleText, groupBy === g && styles.toggleTextActive]}>
                    {g === 'type' ? 'By type' : 'By rep'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {loading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginTop: Space.lg }} />
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => {
          const s = section as unknown as QueueSection;
          const isCollapsed = collapsed.has(s.key);
          return (
            <Pressable
              onPress={() => s.collapsible && toggleSection(s.key)}
              style={styles.sectionHeader}
              disabled={!s.collapsible}
              accessibilityRole={s.collapsible ? 'button' : 'header'}
              accessibilityState={s.collapsible ? { expanded: !isCollapsed } : undefined}
              accessibilityLabel={`${s.title}, ${s.count} item${s.count === 1 ? '' : 's'}`}
            >
              {s.collapsible ? (
                <Ionicons
                  name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                  size={18}
                  color={Colors.textSecondary}
                />
              ) : null}
              <Text style={[Type.section, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                {s.title}
              </Text>
              {s.count > 0 ? (
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{s.count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
        ListFooterComponent={
          <Text style={styles.footNote}>
            Nothing here was blocked — reps are never stopped from working. These are the items
            worth a second look.
          </Text>
        }
      />

      {/* One sheet for both actions: the note is optional context on a
          dismissal and becomes the message on a warning. */}
      <Modal
        visible={!!resolving}
        transparent
        animationType="fade"
        onRequestClose={() => setResolving(null)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>
              {resolving?.action === 'warned'
                ? `Warn ${resolving?.repName}`
                : 'Dismiss this flag'}
            </Text>
            <Text style={styles.meta}>{resolving?.reason}</Text>
            <TextInput
              style={styles.input}
              placeholder={
                resolving?.action === 'warned'
                  ? 'What should they do differently? (optional)'
                  : 'Why was this fine? (optional)'
              }
              placeholderTextColor={Colors.textMuted}
              value={resolveNote}
              onChangeText={setResolveNote}
              multiline
              accessibilityLabel="Note"
            />
            <Text style={styles.meta}>
              {resolving?.action === 'warned'
                ? 'The rep sees this in the app. It is not a push notification.'
                : 'Kept as an audit trail — dismissing hides the flag, it does not erase it.'}
            </Text>
            <View style={styles.actions}>
              <Button
                title={resolving?.action === 'warned' ? 'Send warning' : 'Dismiss'}
                variant={resolving?.action === 'warned' ? 'danger' : 'primary'}
                onPress={submitResolve}
                loading={resolve.isPending}
              />
              <Button title="Cancel" variant="secondary" onPress={() => setResolving(null)} />
            </View>
          </View>
        </View>
      </Modal>

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

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Layout.cardPad,
  },
  summaryLabel: { ...Type.label, color: Colors.textSecondary },
  breakdown: { alignItems: 'flex-end', gap: 2 },
  breakdownRow: { ...Type.caption, color: Colors.textSecondary },

  toggle: {
    flexDirection: 'row',
    gap: Space.xs,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.pill,
    padding: Space.xs,
    marginTop: Space.md,
  },
  toggleBtn: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  toggleBtnActive: { backgroundColor: Colors.accent },
  toggleText: { ...Type.label, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.white },

  // Sticky, so the group a card belongs to is never off-screen while scrolling
  // a long one. Opaque background for the same reason.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: Layout.tap,
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

  triageRow: { flexDirection: 'row', gap: Space.sm, marginTop: Space.sm },
  triageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    flex: 1,
    minHeight: Layout.tap,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  triageWarn: { borderColor: Colors.alert },
  triageText: { ...Type.label, color: Colors.textSecondary },
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
