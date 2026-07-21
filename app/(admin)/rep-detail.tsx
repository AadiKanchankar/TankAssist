import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ScrollView, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import Breadcrumbs from '../../components/Breadcrumbs';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import RepReportSection from './rep-report-detail';

type Tab = 'assign' | 'report';
type Role = 'rep' | 'sales_manager' | 'management';

interface Member {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: Role;
  is_active?: boolean;
  assigned_manager_id?: string | null;
}

interface StoreRow {
  id: string;
  name: string;
}

const ROLE_LABEL: Record<Role, string> = {
  rep: 'Sales rep',
  sales_manager: 'Sales manager',
  management: 'Management',
};

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

export default function RepDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const { rep } = route.params as { rep: Member };
  const { profile } = useAuthStore();
  const isManagement = profile?.role === 'management';
  const isSelf = profile?.id === rep.id;
  const isRep = rep.role === 'rep';

  const [tab, setTab] = useState<Tab>('assign');
  const [isActive, setIsActive] = useState(rep.is_active ?? true);
  const [depCount, setDepCount] = useState<number | null>(null);

  // Dependent-rep count for a sales manager (header stat).
  useEffect(() => {
    if (rep.role !== 'sales_manager') return;
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_manager_id', rep.id)
      .then(({ count }) => setDepCount(count ?? 0));
  }, [rep.id, rep.role]);

  // Deactivate / reactivate (unchanged logic).
  const handleToggleActive = async () => {
    const deactivating = isActive;
    let warning = '';
    if (deactivating && rep.role === 'sales_manager') {
      const { count } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_manager_id', rep.id);
      if (count && count > 0) {
        warning = `\n\n${count} rep${count === 1 ? '' : 's'} ${
          count === 1 ? 'is' : 'are'
        } assigned to this manager. Their assignment is unaffected.`;
      }
    }
    Alert.alert(
      deactivating ? 'Deactivate user' : 'Reactivate user',
      (deactivating
        ? `${rep.name} will be signed out at their next app refresh and blocked from signing in.`
        : `${rep.name} will regain access to the app.`) + warning,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: deactivating ? 'Deactivate' : 'Reactivate',
          style: deactivating ? 'destructive' : 'default',
          onPress: async () => {
            const { error } = await supabase
              .from('users')
              .update({ is_active: !deactivating })
              .eq('id', rep.id);
            if (error) {
              Alert.alert('Couldn’t update', error.message || 'Try again.');
              return;
            }
            setIsActive(!deactivating);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Header title={rep.name} onBack={() => navigation.goBack()} />
      <View style={styles.crumbs}>
        <Breadcrumbs items={[{ label: 'Team', onPress: () => navigation.goBack() }, { label: rep.name }]} />
      </View>

      <View style={styles.top}>
        {/* Bento header */}
        <BentoTile>
          <View style={styles.headerRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(rep.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[Type.section, { color: Colors.text }]}>{rep.name}</Text>
              <Text style={[Type.caption, { color: Colors.textMuted }]}>{ROLE_LABEL[rep.role]}</Text>
              {rep.role === 'sales_manager' && depCount != null ? (
                <Text style={[Type.caption, { color: Colors.textSecondary, marginTop: 2 }]}>
                  {depCount} rep{depCount === 1 ? '' : 's'} report to them
                </Text>
              ) : null}
              {rep.phone ? (
                <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>{rep.phone}</Text>
              ) : null}
            </View>
          </View>
        </BentoTile>

        {/* Management deactivate / reactivate */}
        {isManagement && !isSelf && (
          <BentoTile style={{ marginTop: Space.md }}>
            <View style={styles.rowBetween}>
              <Text style={[Type.label, { color: isActive ? Colors.success : Colors.alert }]}>
                {isActive ? 'Active' : 'Deactivated'}
              </Text>
              <Pressable
                onPress={handleToggleActive}
                style={[styles.adminBtn, isActive ? styles.adminBtnDanger : styles.adminBtnPrimary]}
                accessibilityRole="button"
                accessibilityLabel={isActive ? 'Deactivate user' : 'Reactivate user'}
              >
                <Text style={[Type.label, { color: isActive ? Colors.alert : Colors.white }]}>
                  {isActive ? 'Deactivate' : 'Reactivate'}
                </Text>
              </Pressable>
            </View>
          </BentoTile>
        )}

        {/* Rep: Assign / Report segmented control */}
        {isRep && (
          <View style={styles.segRow}>
            {(['assign', 'report'] as Tab[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.segBtn, tab === t && styles.segBtnActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.segText, tab === t && styles.segTextActive]}>
                  {t === 'assign' ? 'Assign stores' : 'Report'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {isRep ? (
        tab === 'assign' ? (
          <AssignStoresSection rep={rep} />
        ) : (
          <RepReportSection rep={rep} />
        )
      ) : null}
    </View>
  );
}

/** Assign Stores — per-day; saving replaces today's set. Logic unchanged. */
function AssignStoresSection({ rep }: { rep: Member }) {
  const insets = useSafeAreaInsets();
  const today = new Date().toISOString().split('T')[0];
  const [allStores, setAllStores] = useState<StoreRow[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: stores } = await supabase.from('stores').select('id, name').order('name');
    setAllStores(stores || []);
    const { data: current } = await supabase
      .from('store_assignments')
      .select('store_id')
      .eq('user_id', rep.id)
      .eq('assigned_date', today);
    setSelectedStoreIds(new Set((current || []).map((c) => c.store_id)));
    setLoading(false);
  }, [rep.id, today]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStore = (storeId: string) =>
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });

  const handleAssign = async () => {
    setAssigning(true);
    try {
      await supabase.from('store_assignments').delete().eq('user_id', rep.id).eq('assigned_date', today);
      if (selectedStoreIds.size > 0) {
        const rows = Array.from(selectedStoreIds).map((storeId) => ({
          user_id: rep.id,
          store_id: storeId,
          assigned_date: today,
        }));
        const { error } = await supabase.from('store_assignments').insert(rows);
        if (error) throw error;
      }
      Alert.alert('Stores assigned', `Assigned ${selectedStoreIds.size} store${selectedStoreIds.size === 1 ? '' : 's'}.`);
    } catch (err: any) {
      Alert.alert('Couldn’t assign stores', err.message || 'Try again.');
    }
    setAssigning(false);
  };

  return (
    <View style={styles.assignWrap}>
      <Text style={styles.assignSubtitle}>Today · {today}</Text>
      <FlatList
        data={allStores}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.assignList}
        renderItem={({ item }) => {
          const selected = selectedStoreIds.has(item.id);
          return (
            <Pressable onPress={() => toggleStore(item.id)} style={styles.rowWrap}>
              <BentoTile style={selected ? styles.selectedCard : undefined}>
                <View style={styles.checkRow}>
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={selected ? Colors.accent : Colors.textMuted}
                  />
                  <Text style={[Type.body, { color: Colors.text }]}>{item.name}</Text>
                </View>
              </BentoTile>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <BentoTile>
            <Text style={[Type.body, { color: Colors.textMuted }]}>
              {loading ? 'Loading…' : 'No stores exist yet. Add stores first.'}
            </Text>
          </BentoTile>
        }
      />
      <View style={[styles.assignFooter, { paddingBottom: Layout.tabBar + insets.bottom + Space.md }]}>
        <Button
          title={`Assign ${selectedStoreIds.size} store${selectedStoreIds.size === 1 ? '' : 's'}`}
          spotlight
          onPress={handleAssign}
          loading={assigning}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  crumbs: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.xs },
  top: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...Type.section, color: Colors.textOnDark },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adminBtn: {
    paddingVertical: Space.sm,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    minHeight: Layout.tap,
    justifyContent: 'center',
  },
  adminBtnDanger: { borderColor: Colors.alert, backgroundColor: Colors.surface },
  adminBtnPrimary: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  segRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    marginTop: Space.md,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, paddingVertical: Space.sm, alignItems: 'center', minHeight: Layout.tap, justifyContent: 'center' },
  segBtnActive: { backgroundColor: Colors.accent },
  segText: { ...Type.label, color: Colors.text },
  segTextActive: { color: Colors.white },
  assignWrap: { flex: 1 },
  assignSubtitle: { ...Type.caption, color: Colors.textMuted, paddingHorizontal: Layout.screenPad, paddingTop: Space.md, paddingBottom: Space.xs },
  assignList: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm },
  rowWrap: { marginBottom: Space.sm },
  selectedCard: { borderColor: Colors.accent, borderWidth: 1.5 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  assignFooter: { paddingHorizontal: Layout.screenPad, paddingTop: Space.md },
});
