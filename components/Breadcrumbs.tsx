import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space } from '../constants/colors';

export interface Crumb {
  label: string;
  onPress?: () => void;
}

/** Nested-stack location, e.g. Stores › StoreDetail › OrderDetail. Last = current. */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <View style={styles.row} accessibilityRole="header">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 && (
              <Ionicons name="chevron-forward" size={13} color={Colors.textMuted} />
            )}
            <Pressable
              onPress={last ? undefined : c.onPress}
              disabled={last || !c.onPress}
              hitSlop={8}
            >
              <Text
                style={[
                  Type.label,
                  { color: last ? Colors.text : Colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {c.label}
              </Text>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexWrap: 'wrap' },
});
