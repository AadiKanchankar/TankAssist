import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { supabase } from '../../lib/supabase';
import { getSignedUrls } from '../../lib/storage';
import { useAuthStore } from '../../store/useAuthStore';
import {
  orderStatusColor,
  orderStatusLabel,
  orderValue,
  fmtOrderPrice,
} from '../../lib/orders';

interface ItemRow {
  product_name: string;
  cases: number;
  bottles: number;
  free_cases: number;
  free_bottles: number;
  price_per_case: number | null;
  price_per_bottle: number | null;
}
interface HistoryRow {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  changed_by_name: string;
  reason: string | null;
  changed_at: string;
}
interface OrderDetail {
  id: string;
  status: string;
  created_at: string;
  order_notes: string | null;
  cancellation_reason: string | null;
  delivered_verified_by: string | null;
  delivered_verified_name: string | null;
  placed_by: string;
  placed_by_name: string;
  placed_by_phone: string | null;
  store_name: string;
  store_address: string | null;
  store_state: string | null;
  store_contact: string | null;
  items: ItemRow[];
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
const fmtDateTime = (iso: string) =>
  `${fmtDate(iso)} ${new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;

// Manager forward action per current status (strict-sequential; the RPC enforces).
const NEXT_ACTION: Record<string, { label: string; to: string; reason?: boolean }> = {
  placed: { label: 'Acknowledge', to: 'in_process' },
  in_process: { label: 'Mark Dispatched', to: 'dispatched' },
  dispatched: { label: 'Mark In Transit', to: 'in_transit' },
  in_transit: { label: 'Mark Delivered (override)', to: 'delivered', reason: true },
};

export default function OrderDetailScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const { orderId } = route.params as { orderId: string };
  const { profile } = useAuthStore();
  const isManager =
    profile?.role === 'sales_manager' || profile?.role === 'management';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  // Reason modal (cancel / delivered-override)
  const [reasonFor, setReasonFor] = useState<'cancel' | 'deliver' | null>(null);
  const [reasonText, setReasonText] = useState('');

  const loadDetail = useCallback(async () => {
    const { data: o } = await supabase
      .from('orders')
      .select(
        `id, status, created_at, order_notes, cancellation_reason,
         delivered_photo_paths, delivered_verified_by, placed_by,
         stores(name, address, state, contact_number),
         order_items(cases, bottles, free_cases, free_bottles, price_per_case, price_per_bottle, products(name))`
      )
      .eq('id', orderId)
      .single();
    if (!o) {
      setLoading(false);
      return;
    }

    const { data: hist } = await supabase
      .from('order_status_history')
      .select('id, from_status, to_status, changed_by, reason, changed_at')
      .eq('order_id', orderId)
      .order('changed_at', { ascending: true });

    const ids = [
      ...new Set(
        [
          (o as any).placed_by,
          (o as any).delivered_verified_by,
          ...(hist || []).map((h) => h.changed_by),
        ].filter(Boolean)
      ),
    ];
    const names: Record<string, string> = {};
    const phones: Record<string, string | null> = {};
    if (ids.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, name, phone')
        .in('id', ids);
      for (const u of users || []) {
        names[u.id] = u.name;
        phones[u.id] = u.phone;
      }
    }

    const paths: string[] = (o as any).delivered_photo_paths || [];
    if (paths.length) {
      const map = await getSignedUrls(paths, 3600);
      setPhotoUrls(paths.map((p) => map[p]).filter(Boolean));
    } else {
      setPhotoUrls([]);
    }

    const oo = o as any;
    setOrder({
      id: oo.id,
      status: oo.status,
      created_at: oo.created_at,
      order_notes: oo.order_notes,
      cancellation_reason: oo.cancellation_reason,
      delivered_verified_by: oo.delivered_verified_by,
      delivered_verified_name: oo.delivered_verified_by
        ? names[oo.delivered_verified_by] || '—'
        : null,
      placed_by: oo.placed_by,
      placed_by_name: names[oo.placed_by] || '—',
      placed_by_phone: phones[oo.placed_by] ?? null,
      store_name: oo.stores?.name || 'Unknown store',
      store_address: oo.stores?.address ?? null,
      store_state: oo.stores?.state ?? null,
      store_contact: oo.stores?.contact_number ?? null,
      items: (oo.order_items || []).map((it: any) => ({
        product_name: it.products?.name || 'Unknown',
        cases: it.cases,
        bottles: it.bottles,
        free_cases: it.free_cases,
        free_bottles: it.free_bottles,
        price_per_case: it.price_per_case,
        price_per_bottle: it.price_per_bottle,
      })),
    });
    setHistory(
      (hist || []).map((h) => ({
        ...h,
        changed_by_name: names[h.changed_by] || '—',
      }))
    );
    setLoading(false);
  }, [orderId]);

  useFocusEffect(
    useCallback(() => {
      loadDetail();
    }, [loadDetail])
  );

  const doTransition = async (to: string, reason: string | null = null) => {
    setActionBusy(true);
    const { error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_new_status: to,
      p_reason: reason,
    });
    if (error) {
      Alert.alert('Error', error.message || 'Action failed.');
      setActionBusy(false);
      return;
    }
    await loadDetail();
    setActionBusy(false);
  };

  const confirmForward = (label: string, to: string) => {
    Alert.alert(label, `${label} this order?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, onPress: () => doTransition(to) },
    ]);
  };

  const submitReason = () => {
    const r = reasonText.trim();
    if (!r) {
      Alert.alert('Reason needed', 'Please enter a reason.');
      return;
    }
    const to = reasonFor === 'cancel' ? 'cancelled' : 'delivered';
    setReasonFor(null);
    setReasonText('');
    doTransition(to, r);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }
  if (!order) {
    return (
      <View style={styles.container}>
        <Header title="Order" onBack={() => navigation.goBack()} />
        <Text style={styles.emptyText}>Order not found.</Text>
      </View>
    );
  }

  const value = orderValue(order.items);
  const next = NEXT_ACTION[order.status];
  const isTerminal = order.status === 'delivered' || order.status === 'cancelled';

  return (
    <View style={styles.container}>
      <Header title={order.store_name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badgeRow}>
          <Text style={[styles.badge, { backgroundColor: orderStatusColor(order.status) }]}>
            {orderStatusLabel(order.status)}
          </Text>
          <Text style={styles.date}>{fmtDate(order.created_at)}</Text>
        </View>

        {/* Items */}
        <Card>
          <Text style={styles.sectionLabel}>ITEMS</Text>
          {order.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemName}>{it.product_name}</Text>
              <Text style={styles.itemQty}>
                {it.cases} cs / {it.bottles} btl
                {it.free_cases || it.free_bottles
                  ? `  (+${it.free_cases} cs / ${it.free_bottles} btl free)`
                  : ''}
              </Text>
            </View>
          ))}
          {value > 0 ? (
            <Text style={styles.valueLine}>Order value: {fmtOrderPrice(value)}</Text>
          ) : null}
          {order.order_notes ? (
            <Text style={styles.notes}>Notes: {order.order_notes}</Text>
          ) : null}
        </Card>

        {/* Store */}
        <Card>
          <Text style={styles.sectionLabel}>STORE</Text>
          <Text style={styles.storeName}>{order.store_name}</Text>
          {order.store_address ? (
            <Text style={styles.muted}>{order.store_address}</Text>
          ) : null}
          {order.store_state ? (
            <Text style={styles.muted}>{order.store_state}</Text>
          ) : null}
          {order.store_contact ? (
            <TouchableOpacity
              style={styles.callRow}
              onPress={() => Linking.openURL(`tel:${order.store_contact}`)}
            >
              <Ionicons name="call" size={16} color={Colors.accent} />
              <Text style={styles.callText}>{order.store_contact}</Text>
            </TouchableOpacity>
          ) : null}
        </Card>

        {/* Placed by */}
        <Card>
          <Text style={styles.sectionLabel}>PLACED BY</Text>
          <View style={styles.placedRow}>
            <Text style={styles.storeName}>{order.placed_by_name}</Text>
            {order.placed_by_phone ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(`tel:${order.placed_by_phone}`)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="call" size={20} color={Colors.accent} />
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>

        {/* Timeline */}
        <Card>
          <Text style={styles.sectionLabel}>STATUS HISTORY</Text>
          <View style={styles.timelineRow}>
            <View style={styles.dot} />
            <Text style={styles.timelineText}>
              Placed by {order.placed_by_name} · {fmtDateTime(order.created_at)}
            </Text>
          </View>
          {history.map((h) => (
            <View key={h.id} style={styles.timelineRow}>
              <View style={styles.dot} />
              <Text style={styles.timelineText}>
                {orderStatusLabel(h.to_status)} by {h.changed_by_name} ·{' '}
                {fmtDateTime(h.changed_at)}
                {h.reason ? `\nReason: ${h.reason}` : ''}
              </Text>
            </View>
          ))}
          {order.status === 'delivered' && order.delivered_verified_name ? (
            <Text style={styles.verifiedNote}>
              Verified at store by {order.delivered_verified_name}
            </Text>
          ) : null}
          {order.status === 'cancelled' && order.cancellation_reason ? (
            <Text style={styles.cancelNote}>
              Cancelled: {order.cancellation_reason}
            </Text>
          ) : null}
        </Card>

        {/* Delivered photos */}
        {photoUrls.length > 0 ? (
          <Card>
            <Text style={styles.sectionLabel}>DELIVERED PHOTOS</Text>
            <View style={styles.photoRow}>
              {photoUrls.map((u, i) => (
                <Image key={i} source={{ uri: u }} style={styles.photo} />
              ))}
            </View>
          </Card>
        ) : null}

        {/* Manager actions */}
        {isManager && !isTerminal ? (
          <View style={styles.actions}>
            {next ? (
              next.reason ? (
                <Button
                  title={next.label}
                  onPress={() => {
                    setReasonText('');
                    setReasonFor('deliver');
                  }}
                  loading={actionBusy}
                />
              ) : (
                <Button
                  title={next.label}
                  onPress={() => confirmForward(next.label, next.to)}
                  loading={actionBusy}
                />
              )
            ) : null}
            <Button
              title="Cancel Order"
              variant="danger"
              onPress={() => {
                setReasonText('');
                setReasonFor('cancel');
              }}
              style={{ marginTop: 10 }}
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Reason modal */}
      <Modal
        visible={reasonFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReasonFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {reasonFor === 'cancel' ? 'Cancel order' : 'Delivered override'}
            </Text>
            <Text style={styles.modalHint}>
              {reasonFor === 'cancel'
                ? 'A reason is required to cancel.'
                : 'A reason is required to override delivery.'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={reasonText}
              onChangeText={setReasonText}
              placeholder="Enter reason"
              placeholderTextColor={Colors.muted}
              multiline
            />
            <Button title="Submit" onPress={submitReason} loading={actionBusy} />
            <Button
              title="Back"
              variant="secondary"
              onPress={() => setReasonFor(null)}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  content: { padding: 24, paddingBottom: 40 },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badge: {
    fontFamily: Typography.fontFamily,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  date: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  sectionLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
  },
  itemRow: { marginBottom: 6 },
  itemName: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
  },
  itemQty: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 1,
  },
  valueLine: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
    marginTop: 8,
  },
  notes: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 8,
    fontStyle: 'italic',
  },
  storeName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  muted: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 2,
  },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  callText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.accent,
  },
  placedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    marginTop: 5,
    marginRight: 10,
  },
  timelineText: {
    flex: 1,
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.text,
  },
  verifiedNote: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.success,
    fontWeight: '600',
    marginTop: 4,
  },
  cancelNote: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.alert,
    fontWeight: '600',
    marginTop: 4,
  },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 100, height: 100, borderRadius: 4, backgroundColor: Colors.background },
  actions: { marginTop: 8 },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    padding: 24,
  },
  // Reason modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 20,
  },
  modalTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
  },
  modalHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
    marginBottom: 12,
  },
  modalInput: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    padding: 12,
    minHeight: 80,
    marginBottom: 16,
  },
});
