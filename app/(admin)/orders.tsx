import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import {
  ORDER_FILTER_STATUSES,
  OrderFilter,
  orderStatusColor,
  orderStatusLabel,
  orderValue,
  fmtOrderPrice,
} from '../../lib/orders';

interface OrderRow {
  id: string;
  status: string;
  created_at: string;
  placed_by: string;
  placed_by_name: string;
  store_name: string;
  item_count: number;
  value: number;
}

const SEGMENTS: { key: OrderFilter; label: string }[] = [
  { key: 'to_process', label: 'To Process' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function OrdersScreen({
  navigation,
  route,
}: {
  navigation: any;
  route: any;
}) {
  const initialFilter = route.params?.filter as OrderFilter | undefined;
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [filter, setFilter] = useState<OrderFilter>(initialFilter || 'to_process');

  // Deep link from the management dashboard's pipeline strip pre-filters the list.
  useEffect(() => {
    if (route.params?.filter) setFilter(route.params.filter);
  }, [route.params?.filter]);

  const loadOrders = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select(
        `id, status, created_at, placed_by,
         stores(name),
         order_items(cases, bottles, free_cases, free_bottles, price_per_case, price_per_bottle)`
      )
      .order('created_at', { ascending: false });
    const rows = (data as any[]) || [];

    // Resolve placer names (managers can read all users).
    const ids = [...new Set(rows.map((o) => o.placed_by).filter(Boolean))];
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .in('id', ids);
      for (const u of users || []) names[u.id] = u.name;
    }

    setOrders(
      rows.map((o) => ({
        id: o.id,
        status: o.status,
        created_at: o.created_at,
        placed_by: o.placed_by,
        placed_by_name: names[o.placed_by] || '—',
        store_name: o.stores?.name || 'Unknown store',
        item_count: (o.order_items || []).length,
        value: orderValue(o.order_items || []),
      }))
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  const { refreshing, onRefresh } = usePullToRefresh(loadOrders);

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

  return (
    <View style={styles.container}>
      <View style={styles.headerPad}>
        <Text style={styles.title}>Orders</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segScroll}
      >
        {SEGMENTS.map((seg) => {
          const active = filter === seg.key;
          const secondary = seg.key === 'cancelled';
          return (
            <TouchableOpacity
              key={seg.key}
              style={[
                styles.segCard,
                active && styles.segCardActive,
                secondary && !active && styles.segCardSecondary,
              ]}
              onPress={() => setFilter(seg.key)}
            >
              <Text style={[styles.segCount, active && styles.segTextActive]}>
                {counts[seg.key]}
              </Text>
              <Text style={[styles.segLabel, active && styles.segTextActive]}>
                {seg.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
          >
            <Card>
              <View style={styles.cardTop}>
                <Text style={styles.storeName}>{item.store_name}</Text>
                <Text
                  style={[styles.badge, { backgroundColor: orderStatusColor(item.status) }]}
                >
                  {orderStatusLabel(item.status)}
                </Text>
              </View>
              <Text style={styles.meta}>
                {new Date(item.created_at).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}{' '}
                · {item.placed_by_name}
              </Text>
              <Text style={styles.meta}>
                {item.item_count} product{item.item_count === 1 ? '' : 's'}
                {item.value > 0 ? ` · ${fmtOrderPrice(item.value)}` : ''}
              </Text>
              <Text style={styles.tapHint}>Tap to view details →</Text>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyText}>No orders in this bucket.</Text>
          </Card>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 4 },
  title: {
    fontFamily: Typography.fontFamily,
    ...Typography.pageTitle,
    color: Colors.text,
  },
  segScroll: { paddingHorizontal: 24, paddingVertical: 12, gap: 10 },
  segCard: {
    minWidth: 92,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  segCardActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  segCardSecondary: { opacity: 0.6 },
  segCount: {
    fontFamily: Typography.fontFamily,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
  },
  segLabel: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  segTextActive: { color: Colors.white },
  list: { paddingHorizontal: 24, paddingBottom: 24 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  storeName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    fontFamily: Typography.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.white,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  meta: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
  },
  tapHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.accent,
    marginTop: 8,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
});
