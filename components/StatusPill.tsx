import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Type, Radius } from '../constants/colors';
import { orderStatusLabel, orderStatusColor } from '../lib/orders';

/** Order status chip — colour + label from lib/orders metadata. */
export default function StatusPill({ status }: { status: string }) {
  const color = orderStatusColor(status);
  const label = orderStatusLabel(status);
  return (
    <View style={[styles.pill, { backgroundColor: color }]}>
      <Text style={styles.text} numberOfLines={1} accessibilityLabel={`Status: ${label}`}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  text: { ...Type.label, color: Colors.white },
});
