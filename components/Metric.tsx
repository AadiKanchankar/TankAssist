import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, tabularNums } from '../constants/colors';

interface MetricProps {
  label: string;
  value: string | number;
  /** signed delta vs previous period; positive → success, negative → alert */
  delta?: number;
  deltaSuffix?: string;
  /** render the value in lime — only valid on a dark tile (§ spotlight rule) */
  spotlight?: boolean;
  onDark?: boolean;
}

/** KPI number + label (+ optional delta). Numbers use tabular-nums. */
export default function Metric({
  label,
  value,
  delta,
  deltaSuffix = '',
  spotlight = false,
  onDark = false,
}: MetricProps) {
  const valueColor = spotlight
    ? Colors.spotlight
    : onDark
    ? Colors.textOnDark
    : Colors.text;
  const labelColor = onDark ? Colors.textOnDark : Colors.textMuted;
  const up = (delta ?? 0) >= 0;

  return (
    <View>
      <Text style={[Type.label, { color: labelColor }]}>{label}</Text>
      <Text style={[Type.metric, tabularNums, { color: valueColor, marginTop: 2 }]}>
        {value}
      </Text>
      {delta != null && (
        <View style={styles.deltaRow}>
          <Ionicons
            name={up ? 'arrow-up' : 'arrow-down'}
            size={13}
            color={up ? Colors.success : Colors.alert}
          />
          <Text
            style={[
              Type.caption,
              tabularNums,
              { color: up ? Colors.success : Colors.alert },
            ]}
          >
            {Math.abs(delta)}
            {deltaSuffix}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
});
