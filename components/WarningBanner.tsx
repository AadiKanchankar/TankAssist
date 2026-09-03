import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import { useMyWarnings, useAcknowledgeWarning } from '../hooks/useFlagResolutions';

/**
 * Manager warnings, shown to the rep in-app.
 *
 * Deliberately NOT a push notification this round. A push for a warning is a
 * heavier thing than the queue action that produced it — a manager tapping
 * "warn" is closing a flag, not sounding an alarm on someone's phone at
 * dinner. In-app keeps the weight proportionate.
 *
 * Acknowledging is the rep's only action, and it is theirs alone: the RLS
 * update policy is `rep_id = auth.uid()`, so nobody can clear a warning on
 * their behalf.
 */
export default function WarningBanner({ repId }: { repId: string | undefined }) {
  const { data: warnings } = useMyWarnings(repId);
  const ack = useAcknowledgeWarning(repId);

  if (!warnings?.length) return null;

  return (
    <View style={styles.wrap}>
      {warnings.map((w) => (
        <View key={w.id} style={styles.card}>
          <Ionicons name="alert-circle" size={20} color={Colors.alert} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>From your manager</Text>
            <Text style={styles.body}>{w.message}</Text>
          </View>
          <Pressable
            onPress={() => ack.mutate(w.id)}
            hitSlop={8}
            style={styles.ackBtn}
            accessibilityRole="button"
            accessibilityLabel="Mark this warning as seen"
          >
            <Text style={styles.ackText}>Got it</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Layout.cardPad,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.alert,
    backgroundColor: Colors.bgAlert,
  },
  title: { ...Type.label, color: Colors.alert },
  body: { ...Type.body, color: Colors.text, marginTop: 2, lineHeight: 21 },
  ackBtn: { minHeight: Layout.tap, justifyContent: 'center', paddingHorizontal: Space.sm },
  ackText: { ...Type.label, color: Colors.alert },
});
