import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout, Shadow } from '../constants/colors';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../lib/supabase';
import { POLICY_VERSION } from '../constants/privacyPolicy';
import PrivacyNotice from './PrivacyNotice';

/**
 * One-time "privacy notice published / updated" card, shown the first time a
 * user opens the app after POLICY_VERSION changes. NOT a wall: it floats above
 * the tab bar, the app stays usable underneath, and one tap dismisses it.
 *
 * Either button records the acknowledgement (acknowledge_policy RPC → users.
 * policy_version / policy_acknowledged_at). If that write fails (offline) the
 * card hides for this session and returns on the next launch — it never nags
 * within a session and never blocks work.
 */
export default function PolicyUpdateCard() {
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const insets = useSafeAreaInsets();
  const [hidden, setHidden] = useState(false);
  const [reading, setReading] = useState(false);

  if (!profile || (profile.policy_version === POLICY_VERSION && !reading)) return null;

  const acknowledge = async () => {
    setHidden(true);
    const { error } = await supabase.rpc('acknowledge_policy', { p_version: POLICY_VERSION });
    if (!error) refreshProfile().catch(() => {});
  };

  return (
    <>
      {!hidden ? (
        <View
          pointerEvents="box-none"
          style={[styles.wrap, { bottom: insets.bottom + Layout.tabBar + Space.sm }]}
        >
          <View style={styles.card} accessibilityRole="alert">
            <Ionicons name="shield-checkmark-outline" size={22} color={Colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[Type.bodyMed, { color: Colors.text }]}>
                {profile.policy_version ? 'Privacy notice updated' : 'How TankAssist uses your data'}
              </Text>
              <Text style={[Type.caption, { color: Colors.textSecondary, marginTop: 2 }]}>
                What’s recorded during your working day, who can see it, and how long it’s kept.
              </Text>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => {
                    setReading(true);
                    acknowledge();
                  }}
                  style={styles.btn}
                  accessibilityRole="button"
                >
                  <Text style={[Type.label, { color: Colors.accent }]}>Read it</Text>
                </Pressable>
                <Pressable onPress={acknowledge} style={styles.btn} accessibilityRole="button">
                  <Text style={[Type.label, { color: Colors.textSecondary }]}>Got it</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      ) : null}
      <PrivacyNotice visible={reading} onClose={() => setReading(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Layout.screenPad, right: Layout.screenPad },
  card: {
    flexDirection: 'row',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.card,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  actions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  btn: { minHeight: Layout.tap, justifyContent: 'center', paddingRight: Space.md },
});
