import React from 'react';
import { BarChart } from 'react-native-gifted-charts';
import { Colors, Type } from '../constants/colors';

export interface TrendPoint {
  label: string;
  value: number;
}

interface TrendBarsProps {
  data: TrendPoint[];
  /** paint the last (latest/today) bar lime — the one spotlight */
  spotlightLast?: boolean;
  height?: number;
  barWidth?: number;
  spacing?: number;
  /** allow horizontal scroll (long ranges with many buckets) */
  scrollable?: boolean;
  /** tap a bar → index */
  onBarPress?: (index: number) => void;
  /** highlighted bucket (olive) when nothing tapped defaults to the spotlight */
  selectedIndex?: number;
}

/** Cases trend — wraps gifted-charts BarChart, spotlights the latest bar. */
export default function TrendBars({
  data,
  spotlightLast = true,
  height = 100,
  barWidth = 12,
  spacing = 8,
  scrollable = false,
  onBarPress,
  selectedIndex,
}: TrendBarsProps) {
  const barData = data.map((d, i) => {
    const isLast = i === data.length - 1;
    const isSelected = selectedIndex === i;
    const frontColor =
      spotlightLast && isLast
        ? Colors.spotlight
        : isSelected
        ? Colors.text
        : Colors.accent;
    return {
      value: d.value,
      label: d.label,
      frontColor,
      labelTextStyle: { color: Colors.textMuted, fontSize: 9 },
      onPress: onBarPress ? () => onBarPress(i) : undefined,
    };
  });

  return (
    <BarChart
      data={barData}
      height={height}
      barWidth={barWidth}
      barBorderTopLeftRadius={3}
      barBorderTopRightRadius={3}
      spacing={spacing}
      initialSpacing={spacing}
      hideRules
      hideYAxisText
      yAxisThickness={0}
      xAxisThickness={0}
      xAxisLabelTextStyle={{ ...Type.caption, color: Colors.textMuted }}
      rotateLabel={scrollable}
      disableScroll={!scrollable}
      scrollToEnd={scrollable}
    />
  );
}
