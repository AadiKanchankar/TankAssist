import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * Calm full-screen shown when the account is found deactivated (is_active=false).
 * The session was already torn down by signOutDeactivated — this just informs and
 * returns to sign-in. No auth logic here; wired to the existing `deactivated` flag.
 */
export default function DeactivatedScreen() {
  const clearDeactivated = useAuthStore((s) => s.clearDeactivated);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name="pause-circle-outline" size={44} color={Colors.textSecondary} />
        </View>
        <Text style={styles.brand}>Tank No. 90</Text>
        <Text style={[Type.title, styles.title]}>Your account is paused</Text>
        <Text style={[Type.body, styles.msg]}>
          Access to TankAssist has been turned off for this account. Contact your
          management team to restore it.
        </Text>
      </View>
      <Button title="Back to sign in" onPress={clearDeactivated} style={styles.action} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background, padding: Space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.md,
  },
  brand: { ...Type.label, color: Colors.accent },
  title: { color: Colors.text, textAlign: 'center' },
  msg: { color: Colors.textSecondary, textAlign: 'center', maxWidth: 320, marginTop: Space.xs },
  action: { marginBottom: Space.md },
});
