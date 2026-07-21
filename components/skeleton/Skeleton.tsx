import { Skeleton as MotiSkeleton } from 'moti/skeleton'; // needs expo-linear-gradient
import { View, StyleProp, ViewStyle } from 'react-native';
import { Radius } from '../../constants/colors';

// Warm cream shimmer, on-brand (not gray) so skeletons don't read as generic.
const COLORS = ['#EAE3CE', '#F1EBD9', '#EAE3CE'];

export function SkelBlock({
  w,
  h,
  r = Radius.sm,
  style,
}: {
  w?: number | string;
  h: number;
  r?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <MotiSkeleton colors={COLORS} width={w as any} height={h} radius={r as any}>
      <View style={[{ width: w as any, height: h }, style]} />
    </MotiSkeleton>
  );
}
