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
}

/** Cases-per-day trend — wraps gifted-charts BarChart, spotlights the latest bar. */
export default function TrendBars({
  data,
  spotlightLast = true,
  height = 100,
  barWidth = 12,
  spacing = 8,
}: TrendBarsProps) {
  const barData = data.map((d, i) => ({
    value: d.value,
    label: d.label,
    frontColor:
      spotlightLast && i === data.length - 1 ? Colors.spotlight : Colors.accent,
    labelTextStyle: { color: Colors.textMuted, fontSize: 9 },
  }));

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
      disableScroll
    />
  );
}
