import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import { Colors, Type, tabularNums } from '../constants/colors';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  data: DonutSegment[];
  /** big number shown in the ring centre */
  centerValue: string | number;
  centerLabel?: string;
  radius?: number;
  onSegmentPress?: (label: string) => void;
}

/** Pipeline / share ring — wraps gifted-charts PieChart in donut mode. */
export default function Donut({
  data,
  centerValue,
  centerLabel,
  radius = 64,
  onSegmentPress,
}: DonutProps) {
  const pieData = data
    .filter((d) => d.value > 0)
    .map((d) => ({
      value: d.value,
      color: d.color,
      onPress: onSegmentPress ? () => onSegmentPress(d.label) : undefined,
    }));

  // gifted-charts renders nothing for an all-zero dataset; show a neutral ring.
  const safeData = pieData.length > 0 ? pieData : [{ value: 1, color: Colors.border }];

  return (
    <PieChart
      data={safeData}
      donut
      radius={radius}
      innerRadius={radius * 0.62}
      innerCircleColor={Colors.surface}
      centerLabelComponent={() => (
        <View style={styles.center}>
          <Text style={[Type.metric, tabularNums, { color: Colors.text }]}>
            {centerValue}
          </Text>
          {centerLabel ? (
            <Text style={[Type.caption, { color: Colors.textMuted }]}>{centerLabel}</Text>
          ) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
