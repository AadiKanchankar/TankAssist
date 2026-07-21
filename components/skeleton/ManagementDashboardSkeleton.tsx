import { View } from 'react-native';
import { SkelBlock } from './Skeleton';
import { Layout, Space, Radius } from '../../constants/colors';

/** Mirrors the management KPI dashboard's final bento (§3.3). */
export function ManagementDashboardSkeleton() {
  return (
    <View style={{ padding: Layout.screenPad, gap: Space.md }}>
      <SkelBlock w={200} h={26} />
      <SkelBlock w={120} h={16} />
      <SkelBlock h={112} r={Radius.card} style={{ marginTop: Space.sm }} />
      <SkelBlock h={150} r={Radius.card} />
      <SkelBlock h={190} r={Radius.card} />
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="49%" h={84} r={Radius.card} />
        <SkelBlock w="49%" h={84} r={Radius.card} />
      </View>
      <SkelBlock h={120} r={Radius.card} />
      <SkelBlock h={140} r={Radius.card} />
    </View>
  );
}
