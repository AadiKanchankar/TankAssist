import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Button from './Button';
import { Colors, Type, Space } from '../constants/colors';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Invitation, not apology (DESIGN.md §9). Headline names the space, CTA is a verb. */
export default function EmptyState({
  icon = 'sparkles-outline',
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={40} color={Colors.textMuted} />
      <Text style={[Type.section, styles.title]}>{title}</Text>
      {message ? <Text style={[Type.body, styles.message]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: Space.xxl, paddingHorizontal: Space.xl, gap: Space.sm },
  title: { color: Colors.text, textAlign: 'center', marginTop: Space.sm },
  message: { color: Colors.textSecondary, textAlign: 'center' },
  action: { marginTop: Space.md, alignSelf: 'stretch' },
});
