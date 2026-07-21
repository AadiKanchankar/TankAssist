import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Layout } from '../constants/colors';

interface HeaderProps {
  title: string;
  onBack?: () => void;
  rightElement?: React.ReactNode;
}

export default function Header({ title, onBack, rightElement }: HeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + Space.md }]}>
      <View style={styles.leftSection}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backButton} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </Pressable>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {rightElement ? <View>{rightElement}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.screenPad,
    paddingBottom: Space.md,
    backgroundColor: Colors.background,
  },
  leftSection: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: Space.xs },
  backButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  title: { ...Type.title, color: Colors.text, flex: 1 },
});
