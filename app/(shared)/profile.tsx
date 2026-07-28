import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import FacilitiesScreen from '../(admin)/facilities';

const TESTER_ROLES: { value: 'rep' | 'sales_manager' | 'management'; label: string }[] = [
  { value: 'rep', label: 'Rep' },
  { value: 'sales_manager', label: 'Sales manager' },
  { value: 'management', label: 'Management' },
];

const APP_VERSION = 'v1.0.0';

export default function ProfileScreen() {
  const { profile, logout, refreshProfile } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [managerName, setManagerName] = useState<string | null>(null);
  const [loadingManager, setLoadingManager] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [showFacilities, setShowFacilities] = useState(false);

  useEffect(() => {
    if (profile?.role === 'rep' && profile.assigned_manager_id) {
      loadManagerName(profile.assigned_manager_id);
    }
  }, [profile]);

  const loadManagerName = async (managerId: string) => {
    setLoadingManager(true);
    try {
      // Reps can't read manager rows directly (RLS); use the id+name-only RPC.
      const { data, error } = await supabase.rpc('get_sales_managers');
      if (!error && data) {
        const manager = (data as { id: string; name: string }[]).find((m) => m.id === managerId);
        if (manager) setManagerName(manager.name);
      }
    } catch {
      // Non-critical.
    }
    setLoadingManager(false);
  };

  const getRoleLabel = (role: string): string => {
    switch (role) {
      case 'rep':
        return 'Sales representative';
      case 'sales_manager':
        return 'Sales manager';
      case 'management':
        return 'Management';
      default:
        return role;
    }
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          try {
            await logout();
          } catch {
            Alert.alert('Couldn’t log out', 'Try again.');
            setLoggingOut(false);
          }
        },
      },
    ]);
  };

  // Tester-only: self-switch role via the whitelisted RPC, then refresh the
  // profile — App.tsx keys the nav tree on role, so it remounts at the new
  // role's Dashboard (like a fresh login). This screen unmounts as part of that.
  const handleSwitchRole = async (newRole: string) => {
    if (!profile || newRole === profile.role || switching) return;
    setSwitching(newRole);
    const { error } = await supabase.rpc('switch_tester_role', { new_role: newRole });
    if (error) {
      setSwitching(null);
      Alert.alert('Couldn’t switch role', error.message || 'Try again.');
      return;
    }
    await refreshProfile();
  };

  if (!profile) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  const initials = profile.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.md, paddingBottom: Layout.tabBar + insets.bottom + Space.md },
      ]}
    >
      <Text style={[Type.title, { color: Colors.text, marginBottom: Space.lg }]}>Profile</Text>

      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
      </View>

      <BentoTile>
        <InfoRow label="Name" value={profile.name} />
        <View style={styles.divider} />
        <InfoRow label="Phone" value={profile.phone || '—'} />
        <View style={styles.divider} />
        <InfoRow label="Role" value={getRoleLabel(profile.role)} />
        {profile.role === 'rep' && (
          <>
            <View style={styles.divider} />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Sales manager</Text>
              {loadingManager ? (
                <ActivityIndicator size="small" color={Colors.accent} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
              ) : (
                <Text style={[Type.bodyMed, { color: Colors.text }]}>{managerName || 'Not assigned'}</Text>
              )}
            </View>
          </>
        )}
      </BentoTile>

      {/* Management-only admin config */}
      {profile.role === 'management' && (
        <Pressable onPress={() => setShowFacilities(true)} accessibilityRole="button" accessibilityLabel="Excise facilities">
          <BentoTile style={{ marginTop: Space.md }}>
            <View style={styles.adminRow}>
              <Ionicons name="business-outline" size={20} color={Colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[Type.bodyMed, { color: Colors.text }]}>Excise facilities</Text>
                <Text style={[Type.caption, { color: Colors.textMuted }]}>
                  Your factory / warehouse licence numbers
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </View>
          </BentoTile>
        </Pressable>
      )}

      {profile.is_tester && (
        <BentoTile style={{ marginTop: Space.md }}>
          <View style={styles.testerHeader}>
            <Ionicons name="flask" size={16} color={Colors.accent} />
            <Text style={[Type.label, { color: Colors.text }]}>Testing tools</Text>
          </View>
          <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2, marginBottom: Space.md }]}>
            Switch your role to test each workflow end-to-end. Full access — actions write real data.
          </Text>
          <View style={styles.roleRow}>
            {TESTER_ROLES.map((r) => {
              const active = profile.role === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => handleSwitchRole(r.value)}
                  disabled={active || switching !== null}
                  style={[styles.roleBtn, active && styles.roleBtnActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${r.label}`}
                  accessibilityState={{ selected: active }}
                >
                  {switching === r.value ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Text style={[styles.roleText, active && styles.roleTextActive]}>{r.label}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </BentoTile>
      )}

      <BentoTile style={styles.appCard}>
        <Text style={[Type.label, { color: Colors.accent }]}>Tank No. 90</Text>
        <Text style={[Type.section, { color: Colors.text, marginTop: 2 }]}>TankAssist</Text>
        <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>{APP_VERSION}</Text>
      </BentoTile>

      <Button title="Log out" onPress={handleLogout} variant="danger" loading={loggingOut} style={{ marginTop: Space.md }} />

      <FacilitiesScreen visible={showFacilities} onClose={() => setShowFacilities(false)} />
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[Type.bodyMed, { color: Colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Layout.screenPad },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  avatarWrap: { alignItems: 'center', marginBottom: Space.lg },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...Type.display, color: Colors.textOnDark },
  field: { paddingVertical: Space.md },
  fieldLabel: { ...Type.label, color: Colors.textMuted, marginBottom: 2 },
  divider: { height: 1, backgroundColor: Colors.border },
  appCard: { alignItems: 'center', marginTop: Space.md },
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  // Testing tools
  testerHeader: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  roleRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  roleBtn: { flex: 1, minHeight: Layout.tap, alignItems: 'center', justifyContent: 'center', paddingVertical: Space.sm },
  roleBtnActive: { backgroundColor: Colors.accent },
  roleText: { ...Type.label, color: Colors.text },
  roleTextActive: { color: Colors.white },
});

