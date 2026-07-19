import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Header from '../../components/Header';
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
  rep: 'Sales Rep',
  sales_manager: 'Sales Manager',
  management: 'Management',
};

/**
 * Member detail — reached by tapping any member on the Team tab. For a rep it
 * hosts the "Assign Stores" + "Report" segmented control (unchanged). For a
 * non-rep member it shows a read-only info panel. Management additionally gets
 * a Deactivate/Reactivate control at the top (never for their own account).
 */
export default function RepDetailScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const { rep } = route.params as { rep: Member };
  const { profile } = useAuthStore();
  const isManagement = profile?.role === 'management';
  const isSelf = profile?.id === rep.id;
  const isRep = rep.role === 'rep';

  const [tab, setTab] = useState<Tab>('assign');
  const [isActive, setIsActive] = useState(rep.is_active ?? true);

  const handleToggleActive = async () => {
    const deactivating = isActive;
    let warning = '';
    // Deactivating a sales manager: surface (don't block) how many reps point
    // at them via assigned_manager_id.
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
              Alert.alert('Error', error.message || 'Update failed.');
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

      {isManagement && !isSelf && (
        <View style={styles.adminBar}>
          <Text
            style={[
              styles.adminBarStatus,
              { color: isActive ? Colors.success : Colors.alert },
            ]}
          >
            {isActive ? 'Active' : 'Deactivated'}
          </Text>
          <TouchableOpacity
            style={[
              styles.adminBtn,
              isActive ? styles.adminBtnDanger : styles.adminBtnPrimary,
            ]}
            onPress={handleToggleActive}
          >
            <Text
              style={[
                styles.adminBtnText,
                { color: isActive ? Colors.alert : Colors.white },
              ]}
            >
              {isActive ? 'Deactivate' : 'Reactivate'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isRep ? (
        <>
          <View style={styles.segRow}>
            {(['assign', 'report'] as Tab[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.segBtn, tab === t && styles.segBtnActive]}
                onPress={() => setTab(t)}
              >
                <Text
                  style={[styles.segText, tab === t && styles.segTextActive]}
                >
                  {t === 'assign' ? 'Assign Stores' : 'Report'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'assign' ? (
            <AssignStoresSection rep={rep} />
          ) : (
            <RepReportSection rep={rep} />
          )}
        </>
      ) : (
        <MemberInfo member={rep} />
      )}
    </View>
  );
}

/** Read-only info panel for non-rep members (managers / management). */
function MemberInfo({ member }: { member: Member }) {
  return (
    <ScrollView contentContainerStyle={styles.infoWrap}>
      <Card>
        <Text style={styles.infoLabel}>ROLE</Text>
        <Text style={styles.infoValue}>{ROLE_LABEL[member.role]}</Text>
        {member.email ? (
          <>
            <Text style={[styles.infoLabel, styles.infoLabelSpaced]}>EMAIL</Text>
            <Text style={styles.infoValue}>{member.email}</Text>
          </>
        ) : null}
        {member.phone ? (
          <>
            <Text style={[styles.infoLabel, styles.infoLabelSpaced]}>PHONE</Text>
            <Text style={styles.infoValue}>{member.phone}</Text>
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
}

/**
 * Assign Stores — relocated verbatim (behavior unchanged) from the old Reps
 * tab modal. Assignments are per-day; saving replaces today's set for the rep.
 */
function AssignStoresSection({ rep }: { rep: Member }) {
  const today = new Date().toISOString().split('T')[0];
  const [allStores, setAllStores] = useState<StoreRow[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(
    new Set()
  );
  const [assigning, setAssigning] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: stores } = await supabase
      .from('stores')
      .select('id, name')
      .order('name');
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

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
  };

  const handleAssign = async () => {
    setAssigning(true);
    try {
      // Replace today's assignments for this rep.
      await supabase
        .from('store_assignments')
        .delete()
        .eq('user_id', rep.id)
        .eq('assigned_date', today);

      if (selectedStoreIds.size > 0) {
        const rows = Array.from(selectedStoreIds).map((storeId) => ({
          user_id: rep.id,
          store_id: storeId,
          assigned_date: today,
        }));
        const { error } = await supabase
          .from('store_assignments')
          .insert(rows);
        if (error) throw error;
      }

      Alert.alert('Success', `Assigned ${selectedStoreIds.size} stores.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to assign stores.');
    }
    setAssigning(false);
  };

  return (
    <View style={styles.assignWrap}>
      <Text style={styles.assignSubtitle}>
        {rep.name} • {today}
      </Text>
      <FlatList
        data={allStores}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => toggleStore(item.id)}>
            <Card
              style={
                selectedStoreIds.has(item.id) ? styles.selectedCard : undefined
              }
            >
              <View style={styles.checkRow}>
                <Text style={styles.checkbox}>
                  {selectedStoreIds.has(item.id) ? '☑' : '☐'}
                </Text>
                <Text style={styles.storeItemName}>{item.name}</Text>
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyText}>
              {loading ? 'Loading…' : 'No stores exist yet. Add stores first.'}
            </Text>
          </Card>
        }
      />
      <View style={styles.assignFooter}>
        <Button
          title={`Assign ${selectedStoreIds.size} Stores`}
          onPress={handleAssign}
          loading={assigning}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  // Management deactivate/reactivate bar
  adminBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 24,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
  },
  adminBarStatus: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
  },
  adminBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  adminBtnDanger: { borderColor: Colors.alert, backgroundColor: Colors.white },
  adminBtnPrimary: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  adminBtnText: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    fontWeight: '700',
  },
  // Non-rep member info panel
  infoWrap: { padding: 24 },
  infoLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 4,
  },
  infoLabelSpaced: { marginTop: 16 },
  infoValue: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
  },
  // Segmented control (matches the report period selector)
  segRow: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 4,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.accent },
  segText: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  segTextActive: { color: Colors.white },
  // Assign section
  assignWrap: { flex: 1 },
  assignSubtitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  list: { paddingHorizontal: 24, paddingBottom: 24 },
  selectedCard: { borderColor: Colors.accent, borderWidth: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { fontSize: 22, color: Colors.accent },
  storeItemName: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  assignFooter: { padding: 24, paddingBottom: 40 },
});
