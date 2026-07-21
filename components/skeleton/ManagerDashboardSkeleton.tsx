import { View } from 'react-native';
import { SkelBlock } from './Skeleton';
import { Layout, Space, Radius } from '../../constants/colors';

/** Mirrors the sales-manager dashboard's final bento. */
export function ManagerDashboardSkeleton() {
  return (
    <View style={{ padding: Layout.screenPad, gap: Space.md }}>
      <SkelBlock w={200} h={26} />
      <SkelBlock w={150} h={16} />
      <SkelBlock h={128} r={Radius.card} style={{ marginTop: Space.sm }} />
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="49%" h={84} r={Radius.card} />
        <SkelBlock w="49%" h={84} r={Radius.card} />
      </View>
      <SkelBlock h={80} r={Radius.card} />
      {[0, 1, 2, 3].map((i) => (
        <SkelBlock key={i} h={56} r={Radius.card} />
      ))}
    </View>
  );
}
