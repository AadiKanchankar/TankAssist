import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import {
  orderStatusColor,
  orderStatusLabel,
  orderValue,
  fmtOrderPrice,
} from '../../lib/orders';

interface StoreParam {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  contact_person: string | null; // Store Manager Name
  contact_number: string | null;
  license_number: string | null;
  owner_name: string | null;
  state: string | null;
}

interface VisitRow {
  id: string;
  check_in_time: string;
  check_out_time: string | null;
  cases_sold: number | null;
  notes: string | null;
  users: { name: string } | null;
}

interface StockRow {
  product_id: string;
  product_name: string;
  unit: string;
  cases: number;
  bottles: number;
  recorded_at: string;
  recorded_by: string;
  recorder_name: string | null;
}

interface RecentOrder {
  id: string;
  status: string;
  created_at: string;
  value: number;
}

type RepStatus = 'visited' | 'in-progress' | 'pending';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

/**
 * Shared Store Detail screen (rep + admin). Shows the store's **Current Stock**
 * (latest snapshot per product), a secondary Total Cases Ordered stat, the
 * non-null info fields, and Visits & Notes — all RLS-scoped. Managers also get
 * a recent-orders list (→ Order Detail) plus Edit/Delete; reps get
 * Check-In/Navigate. Stock is read-only for everyone here.
 */
export default function StoreDetailScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const { store: routeStore } = route.params as { store: StoreParam };
  const { profile } = useAuthStore();
  const isManager = profile?.role !== 'rep';

  const [store, setStore] = useState<StoreParam>(routeStore);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [totalCasesOrdered, setTotalCasesOrdered] = useState(0);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const [repStatus, setRepStatus] = useState<RepStatus>('pending');
  const [dayEnded, setDayEnded] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const load = useCallback(async () => {
    setLoading(true);

    const { data: fresh } = await supabase
      .from('stores')
      .select('*')
      .eq('id', routeStore.id)
      .maybeSingle();
    if (fresh) setStore(fresh as StoreParam);

    // Visits + notes (RLS-scoped).
    const { data: visitRows } = await supabase
      .from('store_visits')
      .select('id, check_in_time, check_out_time, cases_sold, notes, users(name)')
      .eq('store_id', routeStore.id)
      .order('check_in_time', { ascending: false });
    setVisits((visitRows as any as VisitRow[]) || []);

    // Current stock = latest snapshot per active product for this store.
    const [{ data: prods }, { data: snaps }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, unit')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('store_stock_snapshots')
        .select('product_id, cases, bottles, recorded_at, recorded_by')
        .eq('store_id', routeStore.id)
        .order('recorded_at', { ascending: false }),
    ]);
    const latest: Record<string, any> = {};
    for (const s of (snaps as any[]) || []) {
      if (!latest[s.product_id]) latest[s.product_id] = s;
    }
    // Resolve recorder names (managers see all; a rep sees only their own).
    const recorderIds = [
      ...new Set(Object.values(latest).map((s: any) => s.recorded_by)),
    ];
    const names: Record<string, string> = {};
    if (recorderIds.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .in('id', recorderIds);
      for (const u of users || []) names[u.id] = u.name;
    }
    const stockRows: StockRow[] = ((prods as any[]) || [])
      .filter((p) => latest[p.id])
      .map((p) => {
        const s = latest[p.id];
        return {
          product_id: p.id,
          product_name: p.name,
          unit: p.unit,
          cases: s.cases,
          bottles: s.bottles,
          recorded_at: s.recorded_at,
          recorded_by: s.recorded_by,
          recorder_name: names[s.recorded_by] || null,
        };
      });
    // Active products never recorded show as "never recorded" rows too.
    const neverRecorded: StockRow[] = ((prods as any[]) || [])
      .filter((p) => !latest[p.id])
      .map((p) => ({
        product_id: p.id,
        product_name: p.name,
        unit: p.unit,
        cases: -1,
        bottles: -1,
        recorded_at: '',
        recorded_by: '',
        recorder_name: null,
      }));
    setStock([...stockRows, ...neverRecorded]);

    // Orders at this store → total cases ordered (excl. cancelled) + recent list.
    const { data: orderRows } = await supabase
      .from('orders')
      .select(
        'id, status, created_at, order_items(cases, bottles, free_cases, free_bottles, price_per_case, price_per_bottle)'
      )
      .eq('store_id', routeStore.id)
      .order('created_at', { ascending: false });
    const orders = (orderRows as any[]) || [];
    let ordered = 0;
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      ordered += (o.order_items || []).reduce(
        (s: number, it: any) => s + (it.cases || 0),
        0
      );
    }
    setTotalCasesOrdered(ordered);
    setRecentOrders(
      orders.slice(0, 5).map((o) => ({
        id: o.id,
        status: o.status,
        created_at: o.created_at,
        value: orderValue(o.order_items || []),
      }))
    );

    if (!isManager && profile) {
      const { data: todayVisit } = await supabase
        .from('store_visits')
        .select('check_out_time')
        .eq('user_id', profile.id)
        .eq('store_id', routeStore.id)
        .gte('check_in_time', `${today}T00:00:00`)
        .lt('check_in_time', `${today}T23:59:59`)
        .order('check_in_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      setRepStatus(
        todayVisit
          ? todayVisit.check_out_time
            ? 'visited'
            : 'in-progress'
          : 'pending'
      );

      const { data: att } = await supabase
        .from('attendance')
        .select('check_out_time')
        .eq('user_id', profile.id)
        .gte('check_in_time', `${today}T00:00:00`)
        .lt('check_in_time', `${today}T23:59:59`)
        .maybeSingle();
      setDayEnded(!!att?.check_out_time);
    }

    setLoading(false);
  }, [routeStore.id, isManager, profile, today]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const callNumber = () => {
    if (store.contact_number) Linking.openURL(`tel:${store.contact_number}`);
  };

  const navigateToStore = () => {
    if (store.latitude == null || store.longitude == null) {
      Alert.alert('Error', 'Store coordinates not available.');
      return;
    }
    const url = Platform.select({
      ios: `maps:0,0?q=${store.latitude},${store.longitude}`,
      android: `geo:${store.latitude},${store.longitude}?q=${store.latitude},${store.longitude}`,
    });
    if (url) Linking.openURL(url);
  };

  const handleDelete = () => {
    Alert.alert('Delete Store', `Delete "${store.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const { error } = await supabase
            .from('stores')
            .delete()
            .eq('id', store.id);
          setDeleting(false);
          if (error) {
            Alert.alert('Error', error.message);
          } else {
            navigation.goBack();
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Header title={store.name} onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Current Stock */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CURRENT STOCK</Text>
          {loading ? (
            <ActivityIndicator
              size="small"
              color={Colors.accent}
              style={{ marginTop: 12 }}
            />
          ) : stock.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No products in the catalog.</Text>
            </Card>
          ) : (
            <Card>
              {stock.map((s, i) => (
                <View
                  key={s.product_id}
                  style={[styles.stockRow, i > 0 && styles.stockRowDivider]}
                >
                  <Text style={styles.stockName}>{s.product_name}</Text>
                  {s.cases < 0 ? (
                    <Text style={styles.stockNever}>Never recorded</Text>
                  ) : (
                    <>
                      <Text style={styles.stockQty}>
                        {s.cases} cs / {s.bottles} btl
                      </Text>
                      <Text style={styles.stockMeta}>
                        {fmtDate(s.recorded_at)}
                        {s.recorder_name ? ` · ${s.recorder_name}` : ''}
                      </Text>
                    </>
                  )}
                </View>
              ))}
            </Card>
          )}
        </View>

        {/* Total cases ordered (secondary stat) */}
        <Card style={styles.orderedCard}>
          <Text style={styles.orderedValue}>{totalCasesOrdered}</Text>
          <Text style={styles.orderedLabel}>TOTAL CASES ORDERED (ALL-TIME)</Text>
        </Card>

        {/* Store info — only non-null fields */}
        <View style={styles.infoBlock}>
          {store.address ? (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={18} color={Colors.muted} style={styles.infoIcon} />
              <Text style={styles.infoText}>{store.address}</Text>
            </View>
          ) : null}
          {store.state ? (
            <View style={styles.infoRow}>
              <Ionicons name="map-outline" size={18} color={Colors.muted} style={styles.infoIcon} />
              <Text style={styles.infoText}>{store.state}</Text>
            </View>
          ) : null}
          {store.license_number ? (
            <View style={styles.infoRow}>
              <Ionicons name="document-text-outline" size={18} color={Colors.muted} style={styles.infoIcon} />
              <Text style={styles.infoText}>License: {store.license_number}</Text>
            </View>
          ) : null}
          {store.contact_number ? (
            <TouchableOpacity style={styles.infoRow} onPress={callNumber}>
              <Ionicons name="call" size={18} color={Colors.accent} style={styles.infoIcon} />
              <Text style={[styles.infoText, styles.infoLink]}>{store.contact_number}</Text>
            </TouchableOpacity>
          ) : null}
          {store.contact_person ? (
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={18} color={Colors.muted} style={styles.infoIcon} />
              <Text style={styles.infoText}>Store Manager: {store.contact_person}</Text>
            </View>
          ) : null}
          {store.owner_name ? (
            <View style={styles.infoRow}>
              <Ionicons name="business-outline" size={18} color={Colors.muted} style={styles.infoIcon} />
              <Text style={styles.infoText}>Owner: {store.owner_name}</Text>
            </View>
          ) : null}
        </View>

        {/* Rep actions */}
        {!isManager && (
          <View style={styles.actions}>
            {store.latitude != null && store.longitude != null && (
              <Button
                title="Navigate to Store"
                onPress={navigateToStore}
                variant="secondary"
                style={styles.actionBtn}
              />
            )}
            {dayEnded ? (
              <View style={styles.repStatusBadge}>
                <Text style={styles.repStatusText}>Day ended</Text>
              </View>
            ) : repStatus === 'visited' ? (
              <View style={styles.repStatusBadge}>
                <Text style={styles.repStatusText}>✓ Visit completed</Text>
              </View>
            ) : (
              <Button
                title={repStatus === 'in-progress' ? 'Continue Visit' : 'Check In'}
                onPress={() => navigation.navigate('StoreVisit', { store })}
                style={styles.actionBtn}
              />
            )}
          </View>
        )}

        {/* Recent orders (managers) */}
        {isManager && recentOrders.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RECENT ORDERS</Text>
            {recentOrders.map((o) => (
              <TouchableOpacity
                key={o.id}
                onPress={() => navigation.navigate('OrderDetail', { orderId: o.id })}
              >
                <Card style={styles.orderCard}>
                  <Text
                    style={[styles.orderBadge, { backgroundColor: orderStatusColor(o.status) }]}
                  >
                    {orderStatusLabel(o.status)}
                  </Text>
                  <Text style={styles.orderMeta}>
                    {fmtDate(o.created_at)}
                    {o.value > 0 ? ` · ${fmtOrderPrice(o.value)}` : ''}
                  </Text>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Visits & Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VISITS & NOTES</Text>
          {loading ? (
            <ActivityIndicator size="large" color={Colors.accent} style={{ marginTop: 24 }} />
          ) : visits.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No visits recorded yet.</Text>
            </Card>
          ) : (
            visits.map((v) => (
              <Card key={v.id} style={styles.visitCard}>
                <View style={styles.visitHeaderRow}>
                  <Text style={styles.visitRepName}>{v.users?.name || 'Unknown rep'}</Text>
                  <Text style={styles.visitDate}>{fmtDate(v.check_in_time)}</Text>
                </View>
                {v.cases_sold ? (
                  <Text style={styles.visitCases}>{v.cases_sold} cases sold (legacy)</Text>
                ) : null}
                {v.notes ? (
                  <Text style={styles.visitNotes}>{v.notes}</Text>
                ) : (
                  <Text style={styles.visitNoNotes}>No notes</Text>
                )}
              </Card>
            ))
          )}
        </View>

        {/* Manager actions */}
        {isManager && (
          <View style={styles.managerActions}>
            <Button
              title="Edit Store"
              onPress={() => navigation.navigate('StoreForm', { store })}
              variant="secondary"
              style={styles.managerBtn}
            />
            <Button
              title="Delete Store"
              onPress={handleDelete}
              variant="danger"
              loading={deleting}
              style={styles.managerBtn}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  section: { marginBottom: 20 },
  sectionLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
  },
  // Current stock
  stockRow: { paddingVertical: 8 },
  stockRowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  stockName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  stockQty: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    marginTop: 2,
  },
  stockMeta: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  stockNever: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  // Ordered stat
  orderedCard: { alignItems: 'center', paddingVertical: 16, marginBottom: 20 },
  orderedValue: {
    fontFamily: Typography.fontFamily,
    fontSize: 32,
    fontWeight: '700',
    color: Colors.accent,
  },
  orderedLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginTop: 4,
  },
  // Info block
  infoBlock: { marginBottom: 20 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  infoIcon: { marginRight: 10, marginTop: 1 },
  infoText: {
    flex: 1,
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
  },
  infoLink: { color: Colors.accent, fontWeight: '600' },
  // Rep actions
  actions: { marginBottom: 20 },
  actionBtn: { marginBottom: 12 },
  repStatusBadge: { paddingVertical: 16, alignItems: 'center' },
  repStatusText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.success,
    fontWeight: '600',
  },
  // Recent orders
  orderCard: { marginBottom: 10 },
  orderBadge: {
    alignSelf: 'flex-start',
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
  orderMeta: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 6,
  },
  // Visits
  visitCard: { marginBottom: 12 },
  visitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  visitRepName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  visitDate: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
  },
  visitCases: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
  },
  visitNotes: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    marginTop: 8,
    lineHeight: 22,
  },
  visitNoNotes: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    fontStyle: 'italic',
    marginTop: 8,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  // Manager actions
  managerActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  managerBtn: { flex: 1 },
});
