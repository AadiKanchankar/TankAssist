import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Header from '../../components/Header';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import AddStoreModal from '../../components/AddStoreModal';
import { useAuthStore } from '../../store/useAuthStore';
import { useMyPlan, useSubmitPlan } from '../../hooks/useJourneyPlans';
import { usePlanStores, PlanStore } from '../../hooks/usePlanStores';
import { planDateFor, PLAN_STATUS_LABEL } from '../../lib/journeyPlan';

/**
 * The rep submits a planned route for the day; their manager approves it.
 *
 * Approval is OPTIMISTIC-WITH-FLAGGING, not blocking (owner decision): the rep
 * can start the day against a still-submitted plan rather than waiting on a
 * manager who may be asleep at 8am. Visits made before approval are flagged for
 * review, and an approval clears the flag.
 *
 * The store list is SCOPED and VIRTUALIZED (see usePlanStores): the default
 * shows what is near the rep, search reaches the whole table server-side, and
 * FlatList windows the rows so the screen never renders thousands at once.
 */
export default function JourneyPlanScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const date = planDateFor();
  const { data: plan, refetch, isPending } = useMyPlan(profile?.id, date);
  const submit = useSubmitPlan(profile?.id);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  // Stores chosen via search or just created, kept so a selected store never
  // vanishes from the list when the scope changes underneath it.
  const [extras, setExtras] = useState<PlanStore[]>([]);
  const [showAddStore, setShowAddStore] = useState(false);

  const { data: scoped, isFetching } = usePlanStores(profile?.id, debounced);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  // Debounce so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (plan) setSelected(plan.store_ids);
  }, [plan?.id, plan?.status]);

  const locked = plan?.status === 'approved';

  // Scoped results plus anything selected that the scope doesn't cover, so a
  // store found by search stays visible and un-tickable after clearing search.
  const rows = useMemo(() => {
    const base = scoped?.stores ?? [];
    const seen = new Set(base.map((s) => s.id));
    const pinned = extras.filter((s) => !seen.has(s.id) && selected.includes(s.id));
    return [...pinned, ...base];
  }, [scoped, extras, selected]);

  const toggle = (s: PlanStore) => {
    setExtras((prev) => (prev.find((x) => x.id === s.id) ? prev : [...prev, s]));
    setSelected((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]));
  };

  const onSubmit = async () => {
    if (!selected.length) {
      Alert.alert('Pick at least one store', 'Add the stores you plan to visit today.');
      return;
    }
    try {
      await submit.mutateAsync({ date, storeIds: selected, existingPlanId: plan?.id });
      Alert.alert(
        'Plan sent',
        'Your manager has been notified. You can start your day now — you don’t have to wait for approval.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Couldn’t send the plan', e.message || 'Try again.');
    }
  };

  const header = (
    <View>
      {plan ? (
        <BentoTile
          style={[
            plan.status === 'approved' && styles.okTile,
            plan.status === 'rejected' && styles.badTile,
          ]}
        >
          <Text style={[Type.label, { color: Colors.textMuted }]}>Today’s plan</Text>
          <Text style={[Type.bodyMed, { color: Colors.text, marginTop: 2 }]}>
            {PLAN_STATUS_LABEL[plan.status]}
          </Text>
          {plan.status === 'submitted' ? (
            <Text style={styles.hint}>
              You can start visiting now. Visits made before approval are shown to your manager for
              review.
            </Text>
          ) : null}
          {plan.status === 'rejected' ? (
            <Text style={styles.hint}>
              {plan.reject_reason
                ? `Your manager wrote: “${plan.reject_reason}”`
                : 'Your manager asked for changes.'}
              {'\n'}Edit the stores below and send it again.
            </Text>
          ) : null}
          {locked ? (
            <Text style={styles.hint}>
              An approved plan is locked. Speak to your manager if the route has to change.
            </Text>
          ) : null}
        </BentoTile>
      ) : (
        <BentoTile>
          <Text style={[Type.bodyMed, { color: Colors.text }]}>No plan for today yet</Text>
          <Text style={styles.hint}>
            Pick the stores you plan to visit and send it to your manager.
          </Text>
        </BentoTile>
      )}

      <Text style={[Type.section, styles.sectionTitle]}>
        Planned stores{selected.length ? ` · ${selected.length}` : ''}
      </Text>

      {!locked && (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={Colors.textMuted} />
            <TextInput
              style={styles.search}
              placeholder="Search any store by name"
              placeholderTextColor={Colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            {isFetching ? <ActivityIndicator size="small" color={Colors.accent} /> : null}
          </View>
          {/* Says WHY these stores, so a short list doesn't look like a bug. */}
          <Text style={styles.scopeNote}>{scoped?.scopeLabel ?? 'Loading stores…'}</Text>
        </>
      )}
    </View>
  );

  const empty = locked ? null : (
    <BentoTile style={{ marginTop: Space.sm }}>
      {debounced.length >= 2 ? (
        <>
          <EmptyState
            icon="storefront-outline"
            title={`No store matches “${debounced}”`}
            message="If this is a shop you're standing at, add it — we'll check it isn't already on the system under another name."
          />
          <Button
            title="Add a new store"
            onPress={() => setShowAddStore(true)}
            style={{ marginTop: Space.sm }}
          />
        </>
      ) : (
        <EmptyState
          icon="search-outline"
          title="No stores in range"
          message="Search by name to reach stores outside your area."
        />
      )}
    </BentoTile>
  );

  return (
    <View style={styles.screen}>
      <Header title="Plan my day" onBack={() => navigation.goBack()} />

      {isPending ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: Space.lg }} />
      ) : locked ? (
        <FlatList
          data={plan!.store_ids}
          keyExtractor={(id) => id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          renderItem={({ item, index }) => {
            const s = rows.find((x) => x.id === item);
            return (
              <View style={[styles.row, index > 0 && styles.divider]}>
                <Text style={styles.seq}>{index + 1}</Text>
                <Text style={[Type.bodyMed, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                  {s?.name ?? 'Store'}
                </Text>
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          keyboardShouldPersistTaps="handled"
          // Windowing: only what's on screen (plus a small buffer) is mounted,
          // so the list stays flat whether it holds 5 stores or 5,000.
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item, index }) => {
            const on = selected.includes(item.id);
            const order = selected.indexOf(item.id) + 1;
            return (
              <Pressable
                onPress={() => toggle(item)}
                style={[styles.row, index > 0 && styles.divider]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={item.name}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={on ? Colors.accent : Colors.borderStrong}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.address ? (
                    <Text style={[Type.caption, { color: Colors.textMuted }]} numberOfLines={1}>
                      {item.address}
                    </Text>
                  ) : null}
                </View>
                {on ? <Text style={styles.seq}>{order}</Text> : null}
              </Pressable>
            );
          }}
        />
      )}

      {!locked && (
        <View style={styles.footer}>
          <Button
            title={plan ? 'Send updated plan' : 'Send plan to manager'}
            onPress={onSubmit}
            loading={submit.isPending}
            disabled={selected.length === 0}
          />
        </View>
      )}

      {/* Same dedup-guarded component the dashboard uses — adding a store from
          a plan must not be a backdoor around the duplicate check. */}
      <AddStoreModal
        visible={showAddStore}
        initialName={debounced}
        createdByUserId={profile!.id}
        onClose={() => setShowAddStore(false)}
        onResolved={(s) => {
          setShowAddStore(false);
          const store: PlanStore = { ...s, state: null };
          setExtras((prev) => (prev.find((x) => x.id === s.id) ? prev : [...prev, store]));
          setSelected((prev) => (prev.includes(s.id) ? prev : [...prev, s.id]));
          setSearch('');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Space.md, paddingBottom: Space.xl },
  okTile: { borderColor: Colors.success },
  badTile: { borderColor: Colors.alert },
  hint: { ...Type.caption, color: Colors.textMuted, marginTop: Space.xs, lineHeight: 18 },
  sectionTitle: { color: Colors.text, marginTop: Space.lg, marginBottom: Space.sm },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    minHeight: Layout.tap,
  },
  search: { ...Type.body, color: Colors.text, flex: 1, paddingVertical: Space.sm },
  scopeNote: { ...Type.caption, color: Colors.textMuted, marginTop: Space.xs, marginBottom: Space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    minHeight: Layout.tap,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  seq: { ...Type.caption, color: Colors.accent, minWidth: 20, textAlign: 'center' },
  footer: {
    padding: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
});
