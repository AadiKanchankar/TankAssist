import { View } from 'react-native';
import { SkelBlock } from './Skeleton';
import { Layout, Space, Radius } from '../../constants/colors';

/** Mirrors the management bento so content doesn't jump when it arrives. */
export function DashboardSkeleton() {
  return (
    <View style={{ padding: Layout.screenPad, gap: Space.md }}>
      <SkelBlock w={180} h={20} />
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="55%" h={120} r={Radius.card} />
        <SkelBlock w="42%" h={120} r={Radius.card} />
      </View>
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="49%" h={72} r={Radius.card} />
        <SkelBlock w="49%" h={72} r={Radius.card} />
      </View>
      <SkelBlock h={92} r={Radius.card} />
      <SkelBlock h={140} r={Radius.card} />
    </View>
  );
}
