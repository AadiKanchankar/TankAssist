import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import { useAuthStore } from '../store/useAuthStore';

const ROLE_LABEL: Record<string, string> = {
  rep: 'Rep',
  sales_manager: 'Sales manager',
  management: 'Management',
};

/**
 * Persistent indicator shown only while the logged-in profile is a tester, so
 * it's never ambiguous which role is currently being driven mid-testing.
 * Floats above the tab bar; pointerEvents="none" so it never intercepts taps.
 */
export default function TesterBadge() {
  const profile = useAuthStore((s) => s.profile);
  const insets = useSafeAreaInsets();
  if (!profile?.is_tester) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { bottom: insets.bottom + Layout.tabBar + Space.sm }]}
    >
      <View style={styles.pill}>
        <Ionicons name="flask" size={13} color={Colors.warning} />
        <Text style={styles.text}>Testing as {ROLE_LABEL[profile.role] ?? profile.role}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    backgroundColor: Colors.surfaceDark,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    opacity: 0.94,
  },
  text: { ...Type.label, color: Colors.textOnDark },
});
