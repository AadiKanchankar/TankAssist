import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  Platform,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
import { entrance } from '../../constants/motion';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import Breadcrumbs from '../../components/Breadcrumbs';
import Metric from '../../components/Metric';
import StatusPill from '../../components/StatusPill';
import { StoreDetailSkeleton } from '../../components/skeleton/StoreDetailSkeleton';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import { fmtOrderPrice } from '../../lib/orders';
import { useStoreDetail, Store, StockRow } from '../../hooks/useStores';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default function StoreDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const { store: routeStore } = route.params as { store: Store };
  const { profile } = useAuthStore();
  const isManager = profile?.role !== 'rep';
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();

  const { data, refetch, isPending } = useStoreDetail(routeStore, isManager, profile?.id);
  const store = data?.store ?? routeStore;
  const visits = data?.visits ?? [];
  const stock = data?.stock ?? [];
  const totalCasesOrdered = data?.totalCasesOrdered ?? 0;
  const recentOrders = data?.recentOrders ?? [];
  const repStatus = data?.repStatus ?? 'pending';
  const dayEnded = data?.dayEnded ?? false;
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const callNumber = () => {
    if (store.contact_number) Linking.openURL(`tel:${store.contact_number}`);
  };

  const navigateToStore = () => {
    if (store.latitude == null || store.longitude == null) {
      Alert.alert('No location', 'Store coordinates aren’t available.');
      return;
    }
    const url = Platform.select({
      ios: `maps:0,0?q=${store.latitude},${store.longitude}`,
      android: `geo:${store.latitude},${store.longitude}?q=${store.latitude},${store.longitude}`,
    });
    if (url) Linking.openURL(url);
  };

  const handleDelete = () => {
    Alert.alert('Delete store', `Delete "${store.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const { error } = await supabase.from('stores').delete().eq('id', store.id);
          setDeleting(false);
          if (error) Alert.alert('Couldn’t delete', error.message);
          else navigation.goBack();
        },
      },
    ]);
  };

  let s = 0;

  return (
    <View style={styles.container}>
      <Header title={store.name} onBack={() => navigation.goBack()} />
      <View style={styles.crumbs}>
        <Breadcrumbs
          items={[{ label: 'Stores', onPress: () => navigation.goBack() }, { label: store.name }]}
        />
      </View>

      {isPending && !data ? (
        <StoreDetailSkeleton />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Layout.tabBar + insets.bottom + Space.md },
          ]}
        >
          {/* Current stock */}
          <MotiView {...entrance(s++, reduce)}>
            <BentoTile>
              <Text style={styles.sectionLabel}>Current stock</Text>
              {stock.length === 0 ? (
                <Text style={styles.mutedNote}>No products in the catalog.</Text>
              ) : (
                stock.map((row: StockRow, i: number) => (
                  <View key={row.product_id} style={[styles.stockRowWrap, i > 0 && styles.divider]}>
                    <View style={styles.stockRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[Type.bodyMed, { color: Colors.text }]}>{row.product_name}</Text>
                        {row.cases < 0 ? (
                          <Text style={styles.stockNever}>Never recorded</Text>
                        ) : (
                          <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>
                            {fmtDate(row.recorded_at)}
                            {row.recorder_name ? ` · ${row.recorder_name}` : ''}
                          </Text>
                        )}
                      </View>
                      {row.cases >= 0 && (
                        <Text style={[Type.bodyMed, tabularNums, styles.stockTotal]}>
                          {row.cases} cs / {row.bottles} btl
                        </Text>
                      )}
                    </View>
                    {/* Total is the sum of the recorded buckets. A snapshot taken
                        before the split carries no breakdown — say so rather
                        than implying it was all on display. */}
                    {row.cases >= 0 &&
                      (row.breakdown.length > 0 ? (
                        <>
                          <View style={styles.breakdownRow}>
                            {row.breakdown.map((b) => (
                              <View key={b.label} style={styles.breakdownChip}>
                                <Text style={styles.breakdownChipText}>
                                  {b.label.replace(' stock', '')} {b.cases} cs
                                  {b.bottles ? ` / ${b.bottles} btl` : ''}
                                </Text>
                              </View>
                            ))}
                          </View>
                          {/* Honesty about historical data, same rule as the
                              unattributed ledger rows: this shelf number is two
                              older readings added together, and was never taken
                              as a single shelf count. Say so rather than let it
                              pass as one. */}
                          {row.breakdown.some((b) => b.legacy) ? (
                            <Text style={styles.breakdownNote}>
                              Shelf figure combines the older separate floor and display counts
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={styles.breakdownNone}>Breakdown not recorded</Text>
                      ))}
                  </View>
                ))
              )}
            </BentoTile>
          </MotiView>

          {/* Cases ordered · visits */}
          <MotiView {...entrance(s++, reduce)} style={styles.row}>
            <BentoTile style={styles.flex}>
              <Metric label="Cases ordered · all-time" value={totalCasesOrdered} />
            </BentoTile>
            <BentoTile style={styles.flex}>
              <Metric label="Visits" value={visits.length} />
            </BentoTile>
          </MotiView>

          {/* Store info (non-null fields) */}
          {(store.address || store.state || store.license_number || store.contact_number ||
            store.contact_person || store.owner_name) && (
            <MotiView {...entrance(s++, reduce)}>
              <BentoTile>
                {store.address ? <InfoRow icon="location-outline" text={store.address} /> : null}
                {store.state ? <InfoRow icon="map-outline" text={store.state} /> : null}
                {store.license_number ? (
                  <InfoRow icon="document-text-outline" text={`License: ${store.license_number}`} />
                ) : null}
                {store.contact_number ? (
                  <InfoRow icon="call" text={store.contact_number} link onPress={callNumber} />
                ) : null}
                {store.contact_person ? (
                  <InfoRow icon="person-outline" text={`Store manager: ${store.contact_person}`} />
                ) : null}
                {store.owner_name ? (
                  <InfoRow icon="business-outline" text={`Owner: ${store.owner_name}`} />
                ) : null}
              </BentoTile>
            </MotiView>
          )}

          {/* Rep actions — Check-in is the rep's one spotlight */}
          {!isManager && (
            <MotiView {...entrance(s++, reduce)} style={{ gap: Space.md }}>
              {store.latitude != null && store.longitude != null && (
                <Button title="Navigate to store" onPress={navigateToStore} variant="secondary" />
              )}
              {dayEnded ? (
                <BentoTile>
                  <Text style={styles.repStatusText}>Day ended</Text>
                </BentoTile>
              ) : repStatus === 'visited' ? (
                <BentoTile>
                  <Text style={styles.repStatusText}>Visit completed</Text>
                </BentoTile>
              ) : (
                <Button
                  title={repStatus === 'in-progress' ? 'Continue visit' : 'Check in'}
                  spotlight
                  onPress={() => navigation.navigate('StoreVisit', { store })}
                />
              )}
            </MotiView>
          )}

          {/* Recent orders (managers) */}
          {isManager && recentOrders.length > 0 && (
            <MotiView {...entrance(s++, reduce)}>
              <Text style={styles.sectionTitle}>Recent orders</Text>
              <BentoTile>
                {recentOrders.map((o, i) => (
                  <Pressable
                    key={o.id}
                    onPress={() => navigation.navigate('OrderDetail', { orderId: o.id })}
                    style={[styles.orderRow, i > 0 && styles.divider]}
                    accessibilityRole="button"
                    accessibilityLabel={`Order ${fmtDate(o.created_at)}`}
                  >
                    <StatusPill status={o.status} />
                    <Text style={[Type.caption, { color: Colors.textMuted, flex: 1, textAlign: 'right' }]}>
                      {fmtDate(o.created_at)}
                      {o.value > 0 ? ` · ${fmtOrderPrice(o.value)}` : ''}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                  </Pressable>
                ))}
              </BentoTile>
            </MotiView>
          )}

          {/* Visits & notes */}
          <MotiView {...entrance(s++, reduce)}>
            <Text style={styles.sectionTitle}>Visits & notes</Text>
            {visits.length === 0 ? (
              <BentoTile>
                <Text style={styles.mutedNote}>No visits recorded yet.</Text>
              </BentoTile>
            ) : (
              visits.map((v) => (
                <BentoTile key={v.id} style={{ marginBottom: Space.md }}>
                  <View style={styles.rowBetween}>
                    <Text style={[Type.bodyMed, { color: Colors.text }]}>
                      {v.users?.name || 'Unknown rep'}
                    </Text>
                    <Text style={[Type.caption, { color: Colors.textMuted }]}>
                      {fmtDate(v.check_in_time)}
                    </Text>
                  </View>
                  {v.cases_sold ? (
                    <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 4 }]}>
                      {v.cases_sold} cases sold (legacy)
                    </Text>
                  ) : null}
                  {v.notes ? (
                    <Text style={[Type.body, { color: Colors.text, marginTop: Space.sm }]}>{v.notes}</Text>
                  ) : (
                    <Text style={[Type.caption, { color: Colors.textMuted, marginTop: Space.sm }]}>No notes</Text>
                  )}
                </BentoTile>
              ))
            )}
          </MotiView>

          {/* Manager actions */}
          {isManager && (
            <MotiView {...entrance(s++, reduce)} style={styles.managerActions}>
              <Button
                title="Edit store"
                onPress={() => navigation.navigate('StoreForm', { store })}
                variant="secondary"
                style={styles.flex}
              />
              <Button
                title="Delete store"
                onPress={handleDelete}
                variant="danger"
                loading={deleting}
                style={styles.flex}
              />
            </MotiView>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function InfoRow({
  icon,
  text,
  link,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  link?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={link ? Colors.accent : Colors.textMuted} style={styles.infoIcon} />
      <Text style={[Type.body, { flex: 1, color: link ? Colors.accent : Colors.text }]}>{text}</Text>
    </View>
  );
  return link && onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={text}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  crumbs: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.sm },
  scroll: { flex: 1 },
  content: { padding: Layout.screenPad, gap: Space.md },
  sectionLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  sectionTitle: { ...Type.section, color: Colors.text, marginBottom: Space.sm },
  mutedNote: { ...Type.body, color: Colors.textMuted },
  stockRowWrap: { paddingVertical: Space.md },
  // flex-start, not center: a two-line name block would otherwise pull the
  // total down to its vertical midpoint and sit it against the chips below.
  stockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  // flexShrink 0 keeps "12 cs / 3 btl" on one line however long the name is.
  stockTotal: { color: Colors.text, flexShrink: 0 },
  breakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Space.xs,
    rowGap: Space.xs, // explicit: wrapped chip lines need their own gap
    marginTop: Space.sm,
  },
  // A View wrapper, NOT a styled Text. A Text with background + padding draws
  // its box from the line box, so Type.caption's lineHeight overflowed the
  // padding and wrapped chips overlapped each other and the next product row.
  breakdownChip: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
  },
  breakdownChipText: { ...Type.caption, color: Colors.textSecondary },
  breakdownNone: { ...Type.caption, color: Colors.textMuted, fontStyle: 'italic', marginTop: Space.sm },
  breakdownNote: { ...Type.caption, color: Colors.textMuted, fontStyle: 'italic', marginTop: Space.xs },
  // No padding here: it is merged after stockRowWrap and would override its
  // paddingVertical top, pulling content back up against the rule. The
  // Space.md padding on stockRowWrap is what keeps the rule clear of chips.
  divider: { borderTopWidth: 1, borderTopColor: Colors.border },
  stockNever: { ...Type.caption, color: Colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  row: { flexDirection: 'row', gap: Layout.gridGap },
  flex: { flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Space.xs, minHeight: 28 },
  infoIcon: { marginRight: Space.sm, marginTop: 2 },
  repStatusText: { ...Type.bodyMed, color: Colors.success, textAlign: 'center' },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm, minHeight: Layout.tap },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  managerActions: { flexDirection: 'row', gap: Space.md },
});
