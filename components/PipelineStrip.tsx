import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Type, Space, Radius } from '../constants/colors';
import { ORDER_STAGE_LABELS, orderStageIndex } from '../lib/orders';

interface PipelineStripProps {
  /** an order status ('placed'…'delivered'); takes precedence over currentIndex */
  status?: string;
  /** 0-based current stage (0 = Placed … 4 = Delivered) */
  currentIndex?: number;
  showLabels?: boolean;
  /** current stage in lime (default). Set false when another element on the
   *  screen already owns the single lime spotlight (e.g. a stepper header). */
  spotlightCurrent?: boolean;
}

/**
 * Goal-gradient segmented progress for an order. Completed stages fill olive,
 * the current stage is the one lime (spotlight), remaining stages are hairline.
 */
export default function PipelineStrip({
  status,
  currentIndex,
  showLabels = true,
  spotlightCurrent = true,
}: PipelineStripProps) {
  const idx = status != null ? orderStageIndex(status) : currentIndex ?? 0;

  return (
    <View>
      <View style={styles.track}>
        {ORDER_STAGE_LABELS.map((_, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              {
                backgroundColor:
                  i < idx
                    ? Colors.accent
                    : i === idx
                    ? spotlightCurrent
                      ? Colors.spotlight
                      : Colors.accent
                    : Colors.border,
              },
            ]}
          />
        ))}
      </View>
      {showLabels && (
        <View style={styles.labels}>
          {ORDER_STAGE_LABELS.map((s, i) => (
            <Text
              key={s}
              style={[
                Type.caption,
                { color: i === idx ? Colors.text : Colors.textMuted },
              ]}
            >
              {s}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 5, borderRadius: Radius.pill },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Space.xs,
  },
});
