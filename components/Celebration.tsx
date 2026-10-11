import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, Text, View, StyleSheet, AccessibilityInfo } from 'react-native';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Glass, Type, Space, Radius, tabularNums } from '../constants/colors';

/**
 * The ONLY celebration in the app, and only three things may trigger it
 * (CLAUDE.md "Gamification"): today's plan completed, a new personal best, a
 * round milestone. Nothing else animates like this — if everything sparkles,
 * nothing means anything.
 *
 * - Under a second end to end (enter ≤ 300 ms, auto-dismiss at ~950 ms), and a
 *   tap anywhere dismisses it at once: a rep who has seen it forty times must
 *   be able to move straight past.
 * - Opaque surface, so the lime check mark is the single spotlight on screen
 *   (lime: at most once per visible screen).
 * - Reduce Motion: plain fade, no scale.
 * - No countdowns, no "don't lose it", no random rewards — ever.
 */
export type CelebrationKind = 'plan' | 'best' | 'milestone';

export interface CelebrationSpec {
  kind: CelebrationKind;
  title: string;
  /** The day's figure, e.g. "6 stores · 6 stock counted". */
  figure: string;
}

const VISIBLE_MS = 950;

export default function Celebration({ spec, onDone }: { spec: CelebrationSpec | null; onDone: () => void }) {
  const reduce = useReducedMotion();
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!spec) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // With TalkBack on, 950 ms ends before the announcement does: stay until
    // the person taps or presses Back instead.
    let t: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .catch(() => false)
      .then((sr) => {
        if (live && !sr) t = setTimeout(() => done.current(), VISIBLE_MS);
      });
    return () => {
      live = false;
      if (t) clearTimeout(t);
    };
  }, [spec]);

  if (!spec) return null;
  const big = spec.kind !== 'plan'; // rarer moments may be slightly bigger
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onDone}>
      <Pressable
        style={styles.backdrop}
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel={`${spec.title}. ${spec.figure}. Tap to continue.`}
        accessibilityViewIsModal
      >
        <MotiView
          from={{ opacity: 0, scale: reduce ? 1 : big ? 0.88 : 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'timing', duration: reduce ? 120 : big ? 300 : 240 }}
          style={styles.center}
        >
          <View style={[styles.mark, big && styles.markBig]}>
            <Ionicons
              name={spec.kind === 'milestone' ? 'flag' : spec.kind === 'best' ? 'trending-up' : 'checkmark'}
              size={big ? 40 : 34}
              color={Colors.onSpotlight}
            />
          </View>
          <Text style={[big ? Type.title : Type.section, styles.title]}>{spec.title}</Text>
          {spec.kind === 'plan' ? (
            // The bar completing — the visual the rep has been filling all day.
            <View style={styles.track}>
              <MotiView
                from={{ width: reduce ? '100%' : '82%' }}
                animate={{ width: '100%' }}
                transition={{ type: 'timing', duration: reduce ? 0 : 260 }}
                style={styles.fill}
              />
            </View>
          ) : null}
          <Text style={[Type.body, tabularNums, styles.figure]}>{spec.figure}</Text>
        </MotiView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.surfaceDark,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  center: { alignItems: 'center', maxWidth: 360, width: '100%' },
  mark: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spotlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markBig: { width: 80, height: 80 },
  title: { color: Colors.textOnDark, marginTop: Space.lg, textAlign: 'center' },
  track: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Glass.hairline, // cream at 18% — the track on surfaceDark
    marginTop: Space.lg,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: Radius.pill, backgroundColor: Colors.textOnDark },
  figure: { color: Colors.textOnDark, opacity: 0.85, marginTop: Space.md, textAlign: 'center' },
});
