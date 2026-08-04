import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius } from '../../constants/colors';
import Header from '../../components/Header';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import { useMyPlan, useSubmitPlan } from '../../hooks/useJourneyPlans';
import { planDateFor, PLAN_STATUS_LABEL } from '../../lib/journeyPlan';

interface StoreLite {
  id: string;
  name: string;
  address: string | null;
}

/**
 * The rep submits a planned route for the day; their manager approves it.
 *
 * Approval is OPTIMISTIC-WITH-FLAGGING, not blocking (owner decision): the rep
 * can start the day against a still-submitted plan rather than waiting on a
 * manager who may be asleep at 8am. Visits made before approval are flagged for
 * review, and an approval clears the flag.
 */
export default function JourneyPlanScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const date = planDateFor();
  const { data: plan, refetch, isPending } = useMyPlan(profile?.id, date);
  const submit = useSubmitPlan(profile?.id);

  const [stores, setStores] = useState<StoreLite[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name, address')
      .order('name')
      .then(({ data }) => setStores((data as StoreLite[]) ?? []));
  }, []);

  // Seed the picker from the existing plan so "edit and resubmit" starts from
  // what was actually submitted rather than an empty list.
  useEffect(() => {
    if (plan) setSelected(plan.store_ids);
  }, [plan?.id, plan?.status]);

  const locked = plan?.status === 'approved';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) => s.name.toLowerCase().includes(q));
  }, [stores, search]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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

  return (
    <View style={styles.screen}>
      <Header title="Plan my day" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {plan ? (
          <BentoTile
            style={[
              styles.statusTile,
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
                You can start visiting now. Visits made before approval are shown to your manager
                for review.
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
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={Colors.textMuted} />
            <TextInput
              style={styles.search}
              placeholder="Search stores"
              placeholderTextColor={Colors.textMuted}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        )}

        {isPending ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: Space.lg }} />
        ) : locked ? (
          <BentoTile>
            {plan!.store_ids.length === 0 ? (
              <Text style={styles.hint}>No stores on this plan.</Text>
            ) : (
              plan!.store_ids.map((id, i) => {
                const s = stores.find((x) => x.id === id);
                return (
                  <View key={id} style={[styles.row, i > 0 && styles.divider]}>
                    <Text style={styles.seq}>{i + 1}</Text>
                    <Text style={[Type.bodyMed, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                      {s?.name ?? 'Store'}
                    </Text>
                  </View>
                );
              })
            )}
          </BentoTile>
        ) : filtered.length === 0 ? (
          <BentoTile>
            <EmptyState icon="storefront-outline" title="No stores found" message="Try a different search." />
          </BentoTile>
        ) : (
          <BentoTile>
            {filtered.map((s, i) => {
              const on = selected.includes(s.id);
              const order = selected.indexOf(s.id) + 1;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggle(s.id)}
                  style={[styles.row, i > 0 && styles.divider]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={s.name}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={on ? Colors.accent : Colors.borderStrong}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    {s.address ? (
                      <Text style={[Type.caption, { color: Colors.textMuted }]} numberOfLines={1}>
                        {s.address}
                      </Text>
                    ) : null}
                  </View>
                  {on ? <Text style={styles.seq}>{order}</Text> : null}
                </Pressable>
              );
            })}
          </BentoTile>
        )}
      </ScrollView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Space.md, paddingBottom: Space.xl },
  statusTile: {},
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
    marginBottom: Space.sm,
  },
  search: { ...Type.body, color: Colors.text, flex: 1, paddingVertical: Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  seq: {
    ...Type.caption,
    color: Colors.accent,
    minWidth: 20,
    textAlign: 'center',
  },
  footer: {
    padding: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
});
