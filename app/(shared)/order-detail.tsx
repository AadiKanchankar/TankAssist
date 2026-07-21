import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  TextInput,
  Image,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import StatusPill from '../../components/StatusPill';
import PipelineStrip from '../../components/PipelineStrip';
import Breadcrumbs from '../../components/Breadcrumbs';
import SuccessOverlay from '../../components/SuccessOverlay';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import { orderStatusLabel, orderValue, fmtOrderPrice } from '../../lib/orders';
import { useOrderDetail, orderDetailKey, OrderDetailData } from '../../hooks/useOrders';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (iso: string) =>
  `${fmtDate(iso)} ${new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

// Manager forward action per current status (strict-sequential; the RPC enforces).
const NEXT_ACTION: Record<string, { label: string; to: string; reason?: boolean }> = {
  placed: { label: 'Acknowledge', to: 'in_process' },
  in_process: { label: 'Mark dispatched', to: 'dispatched' },
  dispatched: { label: 'Mark in transit', to: 'in_transit' },
  in_transit: { label: 'Mark delivered (override)', to: 'delivered', reason: true },
};

export default function OrderDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const { orderId } = route.params as { orderId: string };
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isManager = profile?.role === 'sales_manager' || profile?.role === 'management';
  const key = orderDetailKey(orderId);

  const { data, refetch, isPending } = useOrderDetail(orderId);

  const [reasonFor, setReasonFor] = useState<'cancel' | 'deliver' | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Optimistic status advance — update the cache immediately, roll back on error.
  // The update_order_status RPC remains the only mutator.
  const advance = useMutation({
    mutationFn: async ({ to, reason }: { to: string; reason: string | null }) => {
      const { error } = await supabase.rpc('update_order_status', {
        p_order_id: orderId,
        p_new_status: to,
        p_reason: reason,
      });
      if (error) throw error;
      return to;
    },
    onMutate: async ({ to }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<OrderDetailData | null>(key);
      if (prev) {
        queryClient.setQueryData(key, { ...prev, order: { ...prev.order, status: to } });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(key, ctx.prev);
      Alert.alert('Couldn’t update the order', (err as any)?.message || 'Try again.');
    },
    onSuccess: (to) => {
      if (to === 'delivered') {
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 1800);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const confirmForward = (label: string, to: string) => {
    Alert.alert(label, `${label} this order?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, onPress: () => advance.mutate({ to, reason: null }) },
    ]);
  };

  const submitReason = () => {
    const r = reasonText.trim();
    if (!r) {
      Alert.alert('Reason needed', 'Enter a reason to continue.');
      return;
    }
    const to = reasonFor === 'cancel' ? 'cancelled' : 'delivered';
    setReasonFor(null);
    setReasonText('');
    advance.mutate({ to, reason: r });
  };

  if (isPending && data === undefined) {
    return (
      <View style={styles.container}>
        <Header title="Order" onBack={() => navigation.goBack()} />
        <ListSkeleton rows={5} height={100} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.container}>
        <Header title="Order" onBack={() => navigation.goBack()} />
        <Text style={styles.emptyText}>Order not found.</Text>
      </View>
    );
  }

  const { order, history, photoUrls } = data;
  const value = orderValue(order.items);
  const next = NEXT_ACTION[order.status];
  const isTerminal = order.status === 'delivered' || order.status === 'cancelled';
  const actionBusy = advance.isPending;

  const routes = navigation.getState?.()?.routes ?? [];
  const prevName = routes.length > 1 ? routes[routes.length - 2]?.name : undefined;
  const backLabel = prevName === 'StoreDetail' ? 'Store' : 'Orders';

  return (
    <View style={styles.container}>
      <Header title={order.store_name} onBack={() => navigation.goBack()} />
      <View style={styles.crumbs}>
        <Breadcrumbs items={[{ label: backLabel, onPress: () => navigation.goBack() }, { label: 'Order' }]} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Layout.tabBar + insets.bottom + Space.md }]}
      >
        <View style={styles.badgeRow}>
          <StatusPill status={order.status} />
          <Text style={[Type.body, { color: Colors.textMuted }]}>{fmtDate(order.created_at)}</Text>
        </View>

        {/* Pipeline — the one lime spotlight (hidden for cancelled) */}
        {order.status !== 'cancelled' && (
          <View style={styles.pipeline}>
            <PipelineStrip status={order.status} />
          </View>
        )}

        {/* Items */}
        <BentoTile style={styles.card}>
          <Text style={styles.sectionLabel}>Items</Text>
          {order.items.map((it, i) => (
            <View key={i} style={[styles.itemRow, i > 0 && styles.divider]}>
              <Text style={[Type.bodyMed, { color: Colors.text }]}>{it.product_name}</Text>
              <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 1 }]}>
                {it.cases} cs / {it.bottles} btl
                {it.free_cases || it.free_bottles
                  ? `  (+${it.free_cases} cs / ${it.free_bottles} btl free)`
                  : ''}
              </Text>
            </View>
          ))}
          {value > 0 ? (
            <Text style={[Type.bodyMed, tabularNums, { color: Colors.text, marginTop: Space.sm }]}>
              Order value: {fmtOrderPrice(value)}
            </Text>
          ) : null}
          {order.order_notes ? (
            <Text style={[Type.caption, { color: Colors.textMuted, fontStyle: 'italic', marginTop: Space.sm }]}>
              Notes: {order.order_notes}
            </Text>
          ) : null}
        </BentoTile>

        {/* Store */}
        <BentoTile style={styles.card}>
          <Text style={styles.sectionLabel}>Store</Text>
          <Text style={[Type.bodyMed, { color: Colors.text }]}>{order.store_name}</Text>
          {order.store_address ? <Text style={styles.muted}>{order.store_address}</Text> : null}
          {order.store_state ? <Text style={styles.muted}>{order.store_state}</Text> : null}
          {order.store_contact ? (
            <Pressable style={styles.callRow} onPress={() => Linking.openURL(`tel:${order.store_contact}`)}>
              <Ionicons name="call" size={16} color={Colors.accent} />
              <Text style={[Type.body, { color: Colors.accent }]}>{order.store_contact}</Text>
            </Pressable>
          ) : null}
        </BentoTile>

        {/* Placed by */}
        <BentoTile style={styles.card}>
          <Text style={styles.sectionLabel}>Placed by</Text>
          <View style={styles.rowBetween}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>{order.placed_by_name}</Text>
            {order.placed_by_phone ? (
              <Pressable
                onPress={() => Linking.openURL(`tel:${order.placed_by_phone}`)}
                hitSlop={10}
                accessibilityLabel={`Call ${order.placed_by_name}`}
              >
                <Ionicons name="call" size={20} color={Colors.accent} />
              </Pressable>
            ) : null}
          </View>
        </BentoTile>

        {/* Timeline */}
        <BentoTile style={styles.card}>
          <Text style={styles.sectionLabel}>Status history</Text>
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
                {orderStatusLabel(h.to_status)} by {h.changed_by_name} · {fmtDateTime(h.changed_at)}
                {h.reason ? `\nReason: ${h.reason}` : ''}
              </Text>
            </View>
          ))}
          {order.status === 'delivered' && order.delivered_verified_name ? (
            <Text style={styles.verifiedNote}>Verified at store by {order.delivered_verified_name}</Text>
          ) : null}
          {order.status === 'cancelled' && order.cancellation_reason ? (
            <Text style={styles.cancelNote}>Cancelled: {order.cancellation_reason}</Text>
          ) : null}
        </BentoTile>

        {/* Delivered photos */}
        {photoUrls.length > 0 ? (
          <BentoTile style={styles.card}>
            <Text style={styles.sectionLabel}>Delivered photos</Text>
            <View style={styles.photoRow}>
              {photoUrls.map((u, i) => (
                <Image key={i} source={{ uri: u }} style={styles.photo} />
              ))}
            </View>
          </BentoTile>
        ) : null}

        {/* Manager actions */}
        {isManager && !isTerminal ? (
          <View style={{ gap: Space.md }}>
            {next ? (
              next.reason ? (
                <Button title={next.label} onPress={() => { setReasonText(''); setReasonFor('deliver'); }} loading={actionBusy} />
              ) : (
                <Button title={next.label} onPress={() => confirmForward(next.label, next.to)} loading={actionBusy} />
              )
            ) : null}
            <Button
              title="Cancel order"
              variant="danger"
              onPress={() => { setReasonText(''); setReasonFor('cancel'); }}
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Reason modal (cancel / delivered-override) */}
      <Modal visible={reasonFor !== null} transparent animationType="fade" onRequestClose={() => setReasonFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={[Type.section, { color: Colors.text }]}>
              {reasonFor === 'cancel' ? 'Cancel order' : 'Delivered override'}
            </Text>
            <Text style={[Type.caption, { color: Colors.textMuted, marginTop: Space.xs, marginBottom: Space.md }]}>
              {reasonFor === 'cancel' ? 'A reason is required to cancel.' : 'A reason is required to override delivery.'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={reasonText}
              onChangeText={setReasonText}
              placeholder="Enter reason"
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <Button title="Submit" onPress={submitReason} loading={actionBusy} style={{ marginTop: Space.md }} />
            <Button title="Back" variant="secondary" onPress={() => setReasonFor(null)} style={{ marginTop: Space.sm }} />
          </View>
        </View>
      </Modal>

      {showSuccess && <SuccessOverlay label="Delivered" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  crumbs: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.sm },
  content: { padding: Layout.screenPad },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Space.md },
  pipeline: { marginBottom: Space.lg },
  card: { marginBottom: Space.md },
  sectionLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  itemRow: { paddingVertical: Space.xs },
  divider: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Space.xs, paddingTop: Space.sm },
  muted: { ...Type.caption, color: Colors.textMuted, marginTop: 2 },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.sm, minHeight: Layout.tap },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent, marginTop: 5, marginRight: Space.sm },
  timelineText: { flex: 1, ...Type.caption, color: Colors.text },
  verifiedNote: { ...Type.caption, color: Colors.success, fontWeight: '600', marginTop: Space.xs },
  cancelNote: { ...Type.caption, color: Colors.alert, fontWeight: '600', marginTop: Space.xs },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  photo: { width: 100, height: 100, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  emptyText: { ...Type.body, color: Colors.textMuted, padding: Layout.screenPad },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: Layout.screenPad },
  modalCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Space.xl },
  modalInput: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Space.md,
    minHeight: 80,
  },
});
