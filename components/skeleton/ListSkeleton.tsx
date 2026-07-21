import { View } from 'react-native';
import { SkelBlock } from './Skeleton';
import { Layout, Space, Radius } from '../../constants/colors';

/** Generic list-of-cards skeleton for list screens (stores, orders, team, …). */
export function ListSkeleton({ rows = 6, height = 64 }: { rows?: number; height?: number }) {
  return (
    <View style={{ padding: Layout.screenPad, gap: Space.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkelBlock key={i} h={height} r={Radius.card} />
      ))}
    </View>
  );
}
