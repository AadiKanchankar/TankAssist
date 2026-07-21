import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
import BentoTile from '../../components/BentoTile';
import StatusPill from '../../components/StatusPill';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { ORDER_FILTER_STATUSES, OrderFilter, fmtOrderPrice } from '../../lib/orders';
import { useOrdersList, fetchOrderDetail, orderDetailKey } from '../../hooks/useOrders';

const SEGMENTS: { key: OrderFilter; label: string }[] = [
  { key: 'to_process', label: 'To process' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default function OrdersScreen({ navigation, route }: { navigation: any; route: any }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const initialFilter = route.params?.filter as OrderFilter | undefined;
  const { data, refetch, isPending, isError } = useOrdersList();
  const orders = data ?? [];
  const [filter, setFilter] = useState<OrderFilter>(initialFilter || 'to_process');

  // Deep link from the management dashboard's pipeline pre-filters the list.
  useEffect(() => {
    if (route.params?.filter) setFilter(route.params.filter);
  }, [route.params?.filter]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const counts = useMemo(() => {
    const c: Record<OrderFilter, number> = {
      to_process: 0,
      dispatched: 0,
      in_transit: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const o of orders) {
      for (const seg of SEGMENTS) {
        if (ORDER_FILTER_STATUSES[seg.key].includes(o.status)) c[seg.key]++;
      }
    }
    return c;
  }, [orders]);

  const filtered = useMemo(
    () => orders.filter((o) => ORDER_FILTER_STATUSES[filter].includes(o.status)),
    [orders, filter]
  );

  const prefetchDetail = (id: string) =>
    queryClient.prefetchQuery({ queryKey: orderDetailKey(id), queryFn: () => fetchOrderDetail(id) });

  return (
    <View style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + Space.md }]}>
        <Text style={[Type.title, { color: Colors.text }]}>Orders</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segScroll}>
        {SEGMENTS.map((seg) => {
          const active = filter === seg.key;
          const secondary = seg.key === 'cancelled';
          return (
            <Pressable
              key={seg.key}
              style={[styles.segCard, active && styles.segCardActive, secondary && !active && styles.segCardSecondary]}
              onPress={() => setFilter(seg.key)}
              accessibilityRole="button"
              accessibilityLabel={`${counts[seg.key]} ${seg.label}`}
            >
              <Text style={[styles.segCount, tabularNums, active && styles.segTextActive]}>
                {counts[seg.key]}
              </Text>
              <Text style={[styles.segLabel, active && styles.segTextActive]}>{seg.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {isPending && !data ? (
        <ListSkeleton height={92} />
      ) : isError && !data ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Layout.tabBar + insets.bottom + Space.md },
          ]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
              onPressIn={() => prefetchDetail(item.id)}
              style={styles.rowWrap}
            >
              <BentoTile>
                <View style={styles.cardTop}>
                  <Text style={[Type.bodyMed, { color: Colors.text, flex: 1, marginRight: Space.sm }]} numberOfLines={1}>
                    {item.store_name}
                  </Text>
                  <StatusPill status={item.status} />
                </View>
                <Text style={[Type.caption, { color: Colors.textMuted, marginTop: Space.sm }]}>
                  {fmtDate(item.created_at)} · {item.placed_by_name}
                </Text>
                <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>
                  {item.item_count} product{item.item_count === 1 ? '' : 's'}
                  {item.value > 0 ? ` · ${fmtOrderPrice(item.value)}` : ''}
                </Text>
              </BentoTile>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="No orders here"
              message="New orders show up here as reps place them."
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.xs },
  segScroll: { paddingHorizontal: Layout.screenPad, paddingVertical: Space.md, gap: Space.sm },
  segCard: {
    minWidth: 92,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    alignItems: 'center',
  },
  segCardActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  segCardSecondary: { opacity: 0.6 },
  segCount: { ...Type.metric, color: Colors.text },
  segLabel: { ...Type.caption, color: Colors.textMuted, marginTop: 2 },
  segTextActive: { color: Colors.white },
  list: { paddingHorizontal: Layout.screenPad, paddingTop: Space.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  rowWrap: { marginBottom: Space.md },
});
