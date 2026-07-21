import { View } from 'react-native';
import { SkelBlock } from './Skeleton';
import { Layout, Space, Radius } from '../../constants/colors';

/** Mirrors the store-detail bento (stock · cases · info · visits). */
export function StoreDetailSkeleton() {
  return (
    <View style={{ padding: Layout.screenPad, gap: Space.md }}>
      <SkelBlock h={140} r={Radius.card} />
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="49%" h={84} r={Radius.card} />
        <SkelBlock w="49%" h={84} r={Radius.card} />
      </View>
      <SkelBlock h={110} r={Radius.card} />
      <SkelBlock h={90} r={Radius.card} />
      <SkelBlock h={90} r={Radius.card} />
    </View>
  );
}
