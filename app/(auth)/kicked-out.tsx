import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius } from '../../constants/colors';
import Button from '../../components/Button';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * Calm full-screen shown when the session was revoked server-side (signed in on
 * another device — reps are single-session). Presentation only; the
 * `kickedOut`/`clearKickedOut` flag + server-revocation logic are unchanged.
 */
export default function KickedOutScreen() {
  const clearKickedOut = useAuthStore((s) => s.clearKickedOut);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name="phone-portrait-outline" size={44} color={Colors.textSecondary} />
        </View>
        <Text style={styles.brand}>Tank No. 90</Text>
        <Text style={[Type.title, styles.title]}>Signed out</Text>
        <Text style={[Type.body, styles.msg]}>
          You were signed in on another device. For security, only one device can be
          signed in to an account at a time.
        </Text>
      </View>
      <Button title="Back to sign in" onPress={clearKickedOut} style={styles.action} />
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
