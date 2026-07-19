import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';

export default function ProfileScreen() {
  const { profile, logout } = useAuthStore();
  const [managerName, setManagerName] = useState<string | null>(null);
  const [loadingManager, setLoadingManager] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (profile?.role === 'rep' && profile.assigned_manager_id) {
      loadManagerName(profile.assigned_manager_id);
    }
  }, [profile]);

  const loadManagerName = async (managerId: string) => {
    setLoadingManager(true);
    try {
      // Reps can no longer read manager rows directly (RLS); use the
      // id+name-only RPC and match by id client-side.
      const { data, error } = await supabase.rpc('get_sales_managers');
      if (!error && data) {
        const manager = (data as { id: string; name: string }[]).find(
          (m) => m.id === managerId
        );
        if (manager) {
          setManagerName(manager.name);
        }
      }
    } catch {
      // Silently fail — manager name is non-critical
    }
    setLoadingManager(false);
  };

  const getRoleLabel = (role: string): string => {
    switch (role) {
      case 'rep':
        return 'Sales Representative';
      case 'sales_manager':
        return 'Sales Manager';
      case 'management':
        return 'Management';
      default:
        return role;
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              await logout();
            } catch {
              Alert.alert('Error', 'Failed to log out. Please try again.');
              setLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  if (!profile) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <Text style={styles.title}>Profile</Text>

      {/* Avatar placeholder — initials circle */}
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)}
          </Text>
        </View>
      </View>

      {/* User Info Card */}
      <Card>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>NAME</Text>
          <Text style={styles.fieldValue}>{profile.name}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>PHONE</Text>
          <Text style={styles.fieldValue}>{profile.phone || '—'}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>ROLE</Text>
          <Text style={styles.fieldValue}>{getRoleLabel(profile.role)}</Text>
        </View>

        {profile.role === 'rep' && (
          <>
            <View style={styles.divider} />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>SALES MANAGER</Text>
              {loadingManager ? (
                <ActivityIndicator
                  size="small"
                  color={Colors.accent}
                  style={styles.managerLoader}
                />
              ) : (
                <Text style={styles.fieldValue}>
                  {managerName || 'Not assigned'}
                </Text>
              )}
            </View>
          </>
        )}
      </Card>

      {/* App Info */}
      <Card style={styles.appInfoCard}>
        <Text style={styles.appBrand}>TANK NO.90</Text>
        <Text style={styles.appName}>TankAssist</Text>
        <Text style={styles.appVersion}>v1.0.0</Text>
      </Card>

      {/* Logout */}
      <Button
        title="Logout"
        onPress={handleLogout}
        variant="danger"
        loading={loggingOut}
        style={styles.logoutBtn}
      />

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 24, paddingTop: 60 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  title: {
    fontFamily: Typography.fontFamily,
    ...Typography.pageTitle,
    color: Colors.text,
    marginBottom: 24,
  },
  // Avatar
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Typography.fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: Colors.white,
  },
  // Fields
  field: {
    paddingVertical: 14,
  },
  fieldLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 4,
  },
  fieldValue: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  managerLoader: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  // App info
  appInfoCard: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  appBrand: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 4,
  },
  appName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  appVersion: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 4,
  },
  // Logout
  logoutBtn: {
    marginTop: 8,
  },
});
