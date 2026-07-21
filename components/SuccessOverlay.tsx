import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Radius, Space } from '../constants/colors';
import { Motion } from '../constants/motion';

/**
 * Peak-end moment — mount this over the screen on check-out complete / order
 * delivered. Fires a success haptic once on mount. Caller controls visibility.
 */
export default function SuccessOverlay({ label }: { label: string }) {
  const reduce = useReducedMotion();

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  return (
    // No pointerEvents="none": the full-screen backdrop must ABSORB touches so
    // nothing underneath (e.g. the checkout button) can be re-tapped during the
    // peak-end window before navigation happens.
    <View style={styles.backdrop} accessibilityViewIsModal accessibilityRole="alert">
      <MotiView
        from={{ scale: reduce ? 1 : 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'timing', duration: reduce ? Motion.dur.fast : Motion.dur.slow }}
        style={styles.card}
      >
        <Ionicons name="checkmark-circle" size={56} color={Colors.success} />
        <Text style={[Type.section, { color: Colors.success, marginTop: Space.sm }]}>
          {label}
        </Text>
      </MotiView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    paddingVertical: Space.xl,
    paddingHorizontal: Space.xxl,
    alignItems: 'center',
  },
});
