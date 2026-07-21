import React from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors, Radius, Layout, Shadow, Glass } from '../constants/colors';

type Variant = 'flat' | 'dark' | 'glass';

interface BentoTileProps {
  children: React.ReactNode;
  variant?: Variant;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * Dashboard grid tile (DESIGN.md §5/§8). `flat` = hairline card (default),
 * `dark` = olive hero surface, `glass` = the ONE blurred hero per screen.
 * Tactile effects live on hero surfaces only — everything else stays flat.
 */
export default function BentoTile({
  children,
  variant = 'flat',
  onPress,
  style,
  accessibilityLabel,
}: BentoTileProps) {
  if (variant === 'glass') {
    const content = (
      <BlurView
        intensity={Glass.intensity}
        tint={Glass.tint}
        style={[styles.base, styles.glass, style]}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Glass.overlay }]} />
        {children}
      </BlurView>
    );
    return wrap(content, onPress, accessibilityLabel);
  }

  const content = (
    <View
      style={[
        styles.base,
        variant === 'dark' ? styles.dark : styles.flat,
        style,
      ]}
    >
      {children}
    </View>
  );
  return wrap(content, onPress, accessibilityLabel);
}

function wrap(
  content: React.ReactNode,
  onPress?: () => void,
  accessibilityLabel?: string
) {
  if (!onPress) return <>{content}</>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.card,
    padding: Layout.cardPad,
    overflow: 'hidden',
  },
  flat: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dark: {
    backgroundColor: Colors.surfaceDark,
    ...Shadow.card,
  },
  glass: {
    borderWidth: 1,
    borderColor: Glass.hairline,
  },
});
