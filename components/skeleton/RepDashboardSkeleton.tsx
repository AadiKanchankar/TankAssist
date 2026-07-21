import { View } from 'react-native';
import { SkelBlock } from './Skeleton';
import { Layout, Space, Radius } from '../../constants/colors';

/** Mirrors the rep dashboard's final bento so nothing jumps when data lands. */
export function RepDashboardSkeleton() {
  return (
    <View style={{ padding: Layout.screenPad, gap: Space.md }}>
      <SkelBlock w={200} h={26} />
      <SkelBlock w={150} h={16} />
      <SkelBlock h={148} r={Radius.card} style={{ marginTop: Space.sm }} />
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="49%" h={92} r={Radius.card} />
        <SkelBlock w="49%" h={92} r={Radius.card} />
      </View>
      <SkelBlock h={44} r={Radius.md} style={{ marginTop: Space.sm }} />
      {[0, 1, 2].map((i) => (
        <SkelBlock key={i} h={60} r={Radius.card} />
      ))}
    </View>
  );
}
