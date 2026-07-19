import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import Card from '../../components/Card';
import VoiceInput from '../../components/VoiceInput';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  uploadStoreVisitPhoto,
  uploadStockPhoto,
  uploadDeliveredPhoto,
} from '../../lib/storage';
import { reverseGeocode } from '../../lib/geocoding';
import { haversineKm } from '../../lib/haversine';

interface StoreParam {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

interface ProductRow {
  id: string;
  name: string;
  unit: string;
  qty_per_carton: number;
  price_per_case: number | null;
  price_per_bottle: number | null;
}

interface PrevOrderItem {
  product_name: string;
  cases: number;
  bottles: number;
  free_cases: number;
  free_bottles: number;
}
interface PrevOrder {
  id: string;
  status: string;
  created_at: string;
  placed_by: string;
  items: PrevOrderItem[];
}

interface StockLatest {
  cases: number;
  bottles: number;
  recorded_at: string;
  recorded_by: string;
}

interface QtyEntry {
  cases: string;
  bottles: string;
  free_cases: string;
  free_bottles: string;
}

type Step = 'prev' | 'stock' | 'shop' | 'stockphoto' | 'order' | 'notes';
type CameraTarget = 'shop' | 'stock' | 'delivered';

const STEP_TITLES: Record<Step, string> = {
  prev: 'Previous Order',
  stock: 'Update Stock',
  shop: 'Shop Photos',
  stockphoto: 'Stock Photo',
  order: 'Place Order',
  notes: 'Feedback',
};

const CANCEL_REASONS = ['Store refused', 'Wrong order', 'Duplicate', 'Other'];
const STATUS_LABEL: Record<string, string> = {
  placed: 'Order Registered',
  in_process: 'Acknowledged',
  dispatched: 'Dispatched',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const toInt = (s: string): number => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
const fmtPrice = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function StoreVisitScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const { store } = route.params as { store: StoreParam };
  const { profile } = useAuthStore();

  // Visit / check-in lock
  const [visitId, setVisitId] = useState<string | null>(null);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [checkInAddress, setCheckInAddress] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Stepper
  const [stepStack, setStepStack] = useState<Step[]>(['stock']);
  const current = stepStack[stepStack.length - 1];

  // Data
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stockLatest, setStockLatest] = useState<Record<string, StockLatest>>({});
  const [prevOrder, setPrevOrder] = useState<PrevOrder | null>(null);

  // Step state
  const [stock, setStock] = useState<Record<string, { cases: string; bottles: string }>>({});
  // Products the rep actually engaged with this visit — only these get a
  // snapshot at checkout. Prefill is a convenience; leaving a product untouched
  // means "not verified", keeping the whole step skippable.
  const [stockTouched, setStockTouched] = useState<Set<string>>(new Set());
  const [shopPhotoUris, setShopPhotoUris] = useState<string[]>([]);
  const [stockPhotoUri, setStockPhotoUri] = useState<string | null>(null);
  const [orderLines, setOrderLines] = useState<Record<string, QtyEntry>>({});
  const [orderNotes, setOrderNotes] = useState('');
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [notes, setNotes] = useState('');

  // Step 1 cancel/deliver
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [cancelFreeText, setCancelFreeText] = useState('');
  const [deliveredPhotoUris, setDeliveredPhotoUris] = useState<string[]>([]);
  const [prevBusy, setPrevBusy] = useState(false);

  // Camera
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const cameraRef = useRef<CameraView>(null);

  const [orderBusy, setOrderBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ─── Mount: lock check-in (unchanged), then load stepper data ───
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Error', 'Location permission required.');
          navigation.goBack();
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });
        const now = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];

        const { data: existing } = await supabase
          .from('store_visits')
          .select('*')
          .eq('user_id', profile!.id)
          .eq('store_id', store.id)
          .gte('check_in_time', `${today}T00:00:00`)
          .lt('check_in_time', `${today}T23:59:59`)
          .is('check_out_time', null)
          .maybeSingle();

        if (existing) {
          setVisitId(existing.id);
          setCheckInTime(existing.check_in_time);
          setNotes(existing.notes || '');
          setCheckInAddress(existing.address ?? null);
        } else {
          const lat = loc.coords.latitude;
          const lng = loc.coords.longitude;
          let distanceMeters: number | null = null;
          if (store.latitude != null && store.longitude != null) {
            distanceMeters = Math.round(
              haversineKm(lat, lng, store.latitude, store.longitude) * 1000
            );
          }
          const { data, error } = await supabase
            .from('store_visits')
            .insert({
              user_id: profile!.id,
              store_id: store.id,
              check_in_time: now,
              latitude: lat,
              longitude: lng,
              distance_from_store_meters: distanceMeters,
            })
            .select()
            .single();
          if (error) throw error;
          setVisitId(data.id);
          setCheckInTime(now);
          reverseGeocode(lat, lng).then(async (addr) => {
            setCheckInAddress(addr);
            await supabase
              .from('store_visits')
              .update({ address: addr })
              .eq('id', data.id);
          });
        }

        await loadStepperData();
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to check in.');
        navigation.goBack();
      }
      setInitializing(false);
    })();
  }, []);

  const loadStepperData = async () => {
    // Active catalog
    const { data: prods } = await supabase
      .from('products')
      .select('id, name, unit, qty_per_carton, price_per_case, price_per_bottle')
      .eq('is_active', true)
      .order('name');
    setProducts((prods as ProductRow[]) || []);

    // Latest stock snapshot per product for this store
    const { data: snaps } = await supabase
      .from('store_stock_snapshots')
      .select('product_id, cases, bottles, recorded_at, recorded_by')
      .eq('store_id', store.id)
      .order('recorded_at', { ascending: false });
    const latest: Record<string, StockLatest> = {};
    for (const s of snaps || []) {
      if (!latest[s.product_id]) {
        latest[s.product_id] = {
          cases: s.cases,
          bottles: s.bottles,
          recorded_at: s.recorded_at,
          recorded_by: s.recorded_by,
        };
      }
    }
    setStockLatest(latest);

    // Prefill stock inputs from the latest snapshot
    const prefill: Record<string, { cases: string; bottles: string }> = {};
    for (const p of (prods as ProductRow[]) || []) {
      const l = latest[p.id];
      prefill[p.id] = {
        cases: l ? String(l.cases) : '',
        bottles: l ? String(l.bottles) : '',
      };
    }
    setStock(prefill);

    // Most recent non-terminal order at this store
    const { data: orders } = await supabase
      .from('orders')
      .select(
        'id, status, created_at, placed_by, order_items(cases, bottles, free_cases, free_bottles, products(name))'
      )
      .eq('store_id', store.id)
      .in('status', ['placed', 'in_process', 'dispatched', 'in_transit'])
      .order('created_at', { ascending: false })
      .limit(1);
    const o = (orders || [])[0] as any;
    if (o) {
      setPrevOrder({
        id: o.id,
        status: o.status,
        created_at: o.created_at,
        placed_by: o.placed_by,
        items: (o.order_items || []).map((it: any) => ({
          product_name: it.products?.name || 'Unknown',
          cases: it.cases,
          bottles: it.bottles,
          free_cases: it.free_cases,
          free_bottles: it.free_bottles,
        })),
      });
      setStepStack(['prev']);
    } else {
      setStepStack(['stock']);
    }
  };

  const setStockField = (pid: string, field: 'cases' | 'bottles', v: string) => {
    const clean = v.replace(/[^0-9]/g, '');
    setStock((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] || { cases: '', bottles: '' }), [field]: clean },
    }));
    setStockTouched((prev) => (prev.has(pid) ? prev : new Set(prev).add(pid)));
  };

  // Any TOUCHED product with a positive reading — drives the stock-photo
  // requirement and the shop→stockphoto routing.
  const stockEnteredPositive = () =>
    products.some(
      (p) =>
        stockTouched.has(p.id) &&
        (toInt(stock[p.id]?.cases) > 0 || toInt(stock[p.id]?.bottles) > 0)
    );

  const goNext = () => {
    // Leaving the prior-order step resolves it — replace the stack so Back
    // can't return to a now-handled (nulled) prev order.
    if (current === 'prev') {
      setStepStack(['stock']);
      return;
    }
    let next: Step | 'checkout';
    switch (current) {
      case 'stock': next = 'shop'; break;
      case 'shop': next = stockEnteredPositive() ? 'stockphoto' : 'order'; break;
      case 'stockphoto': next = 'order'; break;
      case 'order': next = 'notes'; break;
      case 'notes': next = 'checkout'; break;
      default: next = 'checkout';
    }
    if (next === 'checkout') handleCheckout();
    else setStepStack((s) => [...s, next as Step]);
  };

  const goBack = () => {
    if (stepStack.length > 1) setStepStack((s) => s.slice(0, -1));
    else navigation.goBack();
  };

  // ─── Camera ───
  const openCamera = (target: CameraTarget) => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    setCameraTarget(target);
  };
  const takePhoto = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (!photo) return;
    if (cameraTarget === 'shop') setShopPhotoUris((p) => [...p, photo.uri]);
    else if (cameraTarget === 'delivered') setDeliveredPhotoUris((p) => [...p, photo.uri]);
    else if (cameraTarget === 'stock') setStockPhotoUri(photo.uri);
    // Auto-close after each shot; reopen ("Take Another Photo") for more.
    setCameraTarget(null);
  };

  // ─── Step 1 actions ───
  const handleMarkDelivered = async () => {
    if (!prevOrder) return;
    setPrevBusy(true);
    try {
      let paths: string[] | null = null;
      if (deliveredPhotoUris.length > 0) {
        paths = [];
        for (let i = 0; i < deliveredPhotoUris.length; i++) {
          paths.push(await uploadDeliveredPhoto(deliveredPhotoUris[i], store.id, prevOrder.id, i));
        }
      }
      const { error } = await supabase.rpc('update_order_status', {
        p_order_id: prevOrder.id,
        p_new_status: 'delivered',
        p_reason: null,
        p_delivered_photo_paths: paths,
      });
      if (error) throw error;
      setPrevOrder(null);
      setDeliveredPhotoUris([]);
      goNext();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to mark delivered.');
    }
    setPrevBusy(false);
  };

  const handleCancelOrder = () => {
    if (!prevOrder) return;
    const base = cancelReason === 'Other' ? '' : cancelReason || '';
    const extra = cancelFreeText.trim();
    const reason = cancelReason === 'Other' ? extra : extra ? `${base}: ${extra}` : base;
    if (!reason) {
      Alert.alert('Reason needed', 'Select or enter a cancellation reason.');
      return;
    }
    Alert.alert('Cancel order', `Cancel this order?\n\nReason: ${reason}`, [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: async () => {
          setPrevBusy(true);
          const { error } = await supabase.rpc('update_order_status', {
            p_order_id: prevOrder.id,
            p_new_status: 'cancelled',
            p_reason: reason,
          });
          if (error) {
            Alert.alert('Error', error.message || 'Failed to cancel.');
            setPrevBusy(false);
            return;
          }
          setPrevOrder(null);
          setPrevBusy(false);
          goNext();
        },
      },
    ]);
  };

  // ─── Step 5: place order (immediate) ───
  const orderTotal = () => {
    let total = 0;
    for (const p of products) {
      const l = orderLines[p.id];
      if (!l) continue;
      if (p.price_per_case != null) total += toInt(l.cases) * p.price_per_case;
      if (p.price_per_bottle != null) total += toInt(l.bottles) * p.price_per_bottle;
    }
    return total;
  };

  const handlePlaceOrder = async () => {
    const lines = products
      .map((p) => ({ p, l: orderLines[p.id] }))
      .filter(
        ({ l }) =>
          l &&
          (toInt(l.cases) > 0 ||
            toInt(l.bottles) > 0 ||
            toInt(l.free_cases) > 0 ||
            toInt(l.free_bottles) > 0)
      );
    if (lines.length === 0) {
      Alert.alert('Add products', 'Add at least one product with a quantity.');
      return;
    }
    const total = orderTotal();
    Alert.alert(
      'Place order',
      `${lines.length} product${lines.length === 1 ? '' : 's'}${
        total > 0 ? ` · ${fmtPrice(total)}` : ''
      }`,
      [
        { text: 'Review', style: 'cancel' },
        {
          text: 'Place order',
          onPress: async () => {
            setOrderBusy(true);
            try {
              const { data: order, error } = await supabase
                .from('orders')
                .insert({
                  store_id: store.id,
                  placed_by: profile!.id,
                  visit_id: visitId,
                  status: 'placed',
                  order_notes: orderNotes.trim() || null,
                })
                .select()
                .single();
              if (error) throw error;
              const itemRows = lines.map(({ p, l }) => ({
                order_id: order.id,
                product_id: p.id,
                cases: toInt(l.cases),
                bottles: toInt(l.bottles),
                free_cases: toInt(l.free_cases),
                free_bottles: toInt(l.free_bottles),
                price_per_case: p.price_per_case,
                price_per_bottle: p.price_per_bottle,
              }));
              const { error: itErr } = await supabase.from('order_items').insert(itemRows);
              if (itErr) throw itErr;
              setOrderPlaced(true);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to place order.');
            }
            setOrderBusy(false);
          },
        },
      ]
    );
  };

  // ─── Checkout ───
  const handleCheckout = async () => {
    if (!visitId) return;
    // Only products the rep engaged with get a snapshot (0 is a valid "sold out"
    // reading; untouched products are simply not re-recorded this visit).
    const touchedProducts = products.filter((p) => stockTouched.has(p.id));
    const anyPositive = touchedProducts.some(
      (p) => toInt(stock[p.id]?.cases) > 0 || toInt(stock[p.id]?.bottles) > 0
    );
    if (anyPositive && !stockPhotoUri) {
      Alert.alert('Stock photo needed', 'You entered stock levels — add a stock photo before finishing.');
      setStepStack((s) => [...s, 'stockphoto']);
      return;
    }
    setSubmitting(true);
    try {
      const checkOutTime = new Date().toISOString();
      const durationMinutes = Math.round(
        (Date.parse(checkOutTime) - Date.parse(checkInTime!)) / 60000
      );

      let firstPhotoPath: string | null = null;
      for (let i = 0; i < shopPhotoUris.length; i++) {
        const path = await uploadStoreVisitPhoto(shopPhotoUris[i], store.id, store.name, visitId, i);
        if (i === 0) firstPhotoPath = path;
        const { error } = await supabase
          .from('store_visit_photos')
          .insert({ visit_id: visitId, user_id: profile!.id, storage_path: path, position: i });
        if (error) throw error;
      }

      if (stockPhotoUri) {
        const path = await uploadStockPhoto(stockPhotoUri, store.id, visitId, shopPhotoUris.length);
        const { error } = await supabase.from('store_visit_photos').insert({
          visit_id: visitId,
          user_id: profile!.id,
          storage_path: path,
          position: shopPhotoUris.length,
        });
        if (error) throw error;
      }

      for (const p of touchedProducts) {
        const e = stock[p.id] || { cases: '', bottles: '' };
        const { error } = await supabase.from('store_stock_snapshots').insert({
          store_id: store.id,
          product_id: p.id,
          visit_id: visitId,
          cases: toInt(e.cases),
          bottles: toInt(e.bottles),
          recorded_by: profile!.id,
        });
        if (error) throw error;
      }

      const { error } = await supabase
        .from('store_visits')
        .update({
          check_out_time: checkOutTime,
          duration_minutes: durationMinutes,
          notes: notes.trim() || null,
          photo_url: firstPhotoPath,
        })
        .eq('id', visitId);
      if (error) throw error;

      Alert.alert('Visit Complete', store.name, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to check out.');
    }
    setSubmitting(false);
  };

  // ─── Render ───
  if (initializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.initText}>Locking check-in...</Text>
      </View>
    );
  }

  if (cameraTarget) {
    return (
      <View style={styles.container}>
        <Header title="Camera" onBack={() => setCameraTarget(null)} />
        <CameraView ref={cameraRef} style={styles.fullCamera} facing="back" />
        <View style={styles.cameraActions}>
          <Button title="Capture" onPress={takePhoto} style={styles.captureBtn} />
          <Button
            title="Cancel"
            onPress={() => setCameraTarget(null)}
            variant="secondary"
            style={styles.captureBtn}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title={store.name} onBack={goBack} />
      <View style={styles.stepBar}>
        <Text style={styles.stepBarText}>{STEP_TITLES[current]}</Text>
        <Text style={styles.stepBarTime}>
          {checkInTime
            ? new Date(checkInTime).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {current === 'prev' && prevOrder && (
          <PrevOrderStep
            order={prevOrder}
            isPlacer={prevOrder.placed_by === profile?.id}
            busy={prevBusy}
            deliveredPhotoCount={deliveredPhotoUris.length}
            onCapture={() => openCamera('delivered')}
            onDeliver={handleMarkDelivered}
            cancelReason={cancelReason}
            setCancelReason={setCancelReason}
            cancelFreeText={cancelFreeText}
            setCancelFreeText={setCancelFreeText}
            onCancel={handleCancelOrder}
            onSkip={goNext}
          />
        )}

        {current === 'stock' && (
          <StockStep
            products={products}
            stock={stock}
            setField={setStockField}
            latest={stockLatest}
            selfId={profile?.id}
          />
        )}

        {current === 'shop' && (
          <ShopPhotosStep
            uris={shopPhotoUris}
            onOpenCamera={() => openCamera('shop')}
            onRemove={(i: number) => setShopPhotoUris((p) => p.filter((_, idx) => idx !== i))}
          />
        )}

        {current === 'stockphoto' && (
          <StockPhotoStep
            uri={stockPhotoUri}
            onOpenCamera={() => openCamera('stock')}
            onRemove={() => setStockPhotoUri(null)}
          />
        )}

        {current === 'order' && (
          <OrderStep
            products={products}
            lines={orderLines}
            setLines={setOrderLines}
            orderNotes={orderNotes}
            setOrderNotes={setOrderNotes}
            placed={orderPlaced}
            busy={orderBusy}
            total={orderTotal()}
            onPlace={handlePlaceOrder}
          />
        )}

        {current === 'notes' && (
          <Card>
            <Text style={styles.label}>FEEDBACK / NOTES (OPTIONAL)</Text>
            <VoiceInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth noting about this visit..."
              inputStyle={styles.textInput}
            />
          </Card>
        )}
      </ScrollView>

      {/* Footer nav — the prev step drives its own actions */}
      {current !== 'prev' && (
        <View style={styles.footer}>
          {current === 'stock' ? (
            <Text style={styles.footerHint}>
              Enter what you can verify, or leave blank to skip.
            </Text>
          ) : null}
          <Button
            title={
              current === 'notes'
                ? 'Complete Check-Out'
                : current === 'stockphoto'
                ? 'Next'
                : current === 'order'
                ? orderPlaced
                  ? 'Next'
                  : 'Skip — No Order'
                : 'Next'
            }
            onPress={goNext}
            loading={submitting}
            disabled={current === 'stockphoto' && !stockPhotoUri}
          />
        </View>
      )}
    </View>
  );
}

// ─── Step 1: previous order ───
function PrevOrderStep({
  order,
  isPlacer,
  busy,
  deliveredPhotoCount,
  onCapture,
  onDeliver,
  cancelReason,
  setCancelReason,
  cancelFreeText,
  setCancelFreeText,
  onCancel,
  onSkip,
}: any) {
  return (
    <>
      <Card>
        <View style={styles.badgeRow}>
          <Text style={styles.prevTitle}>Pending order</Text>
          <Text style={styles.statusBadge}>
            {STATUS_LABEL[order.status] || order.status}
          </Text>
        </View>
        <Text style={styles.prevDate}>Placed {fmtDate(order.created_at)}</Text>
        {order.items.map((it: PrevOrderItem, i: number) => (
          <Text key={i} style={styles.prevItem}>
            • {it.product_name}: {it.cases} cs / {it.bottles} btl
            {it.free_cases || it.free_bottles
              ? `  (+${it.free_cases} cs / ${it.free_bottles} btl free)`
              : ''}
          </Text>
        ))}
      </Card>

      <Card>
        <Text style={styles.label}>MARK DELIVERED</Text>
        <Text style={styles.helpText}>
          Verify the stock arrived. Optionally add delivered-stock photos.
        </Text>
        <Button
          title={
            deliveredPhotoCount > 0
              ? `Add Another Photo (${deliveredPhotoCount})`
              : 'Add Delivered Photo (optional)'
          }
          onPress={onCapture}
          variant="secondary"
          style={{ marginBottom: 10 }}
        />
        <Button title="Mark Delivered" onPress={onDeliver} loading={busy} />
      </Card>

      <Card>
        <Text style={styles.label}>CANCEL ORDER</Text>
        {isPlacer ? (
          <>
            <View style={styles.chipWrap}>
              {CANCEL_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, cancelReason === r && styles.chipSelected]}
                  onPress={() => setCancelReason(r)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      cancelReason === r && styles.chipTextSelected,
                    ]}
                  >
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.textInput}
              value={cancelFreeText}
              onChangeText={setCancelFreeText}
              placeholder={
                cancelReason === 'Other'
                  ? 'Describe the reason'
                  : 'Add detail (optional)'
              }
              placeholderTextColor={Colors.muted}
              multiline
            />
            <Button
              title="Cancel Order"
              onPress={onCancel}
              variant="danger"
              loading={busy}
              style={{ marginTop: 10 }}
            />
          </>
        ) : (
          <Text style={styles.mutedNote}>
            Store wants to cancel? Contact your manager.
          </Text>
        )}
      </Card>

      <Button
        title="Skip — No New Stock Visible"
        onPress={onSkip}
        variant="secondary"
        style={{ marginTop: 4 }}
      />
    </>
  );
}

// ─── Step 2: stock ───
function StockStep({ products, stock, setField, latest, selfId }: any) {
  if (products.length === 0) {
    return (
      <Card>
        <Text style={styles.mutedNote}>No active products in the catalog.</Text>
      </Card>
    );
  }
  return (
    <>
      {products.map((p: ProductRow) => {
        const l = latest[p.id] as StockLatest | undefined;
        const e = stock[p.id] || { cases: '', bottles: '' };
        return (
          <Card key={p.id}>
            <Text style={styles.productName}>{p.name}</Text>
            {l ? (
              <Text style={styles.subHint}>
                Last recorded {l.cases} cs / {l.bottles} btl · {fmtDate(l.recorded_at)}
                {l.recorded_by === selfId ? ' · by you' : ''}
              </Text>
            ) : (
              <Text style={styles.subHint}>Never recorded</Text>
            )}
            <View style={styles.qtyRow}>
              <QtyField
                label="Cases"
                value={e.cases}
                onChange={(v) => setField(p.id, 'cases', v)}
              />
              <QtyField
                label="Bottles"
                value={e.bottles}
                onChange={(v) => setField(p.id, 'bottles', v)}
              />
            </View>
          </Card>
        );
      })}
    </>
  );
}

// ─── Step 3: shop photos ───
function ShopPhotosStep({ uris, onOpenCamera, onRemove }: any) {
  return (
    <Card>
      <Text style={styles.label}>SHOP PHOTOS</Text>
      <Text style={styles.helpText}>Live photos only — gallery disabled.</Text>
      {uris.length > 0 && (
        <View style={styles.thumbRow}>
          {uris.map((uri: string, i: number) => (
            <View key={`${uri}-${i}`} style={styles.thumbWrapper}>
              <Image source={{ uri }} style={styles.thumb} />
              <TouchableOpacity style={styles.thumbRemove} onPress={() => onRemove(i)}>
                <Text style={styles.thumbRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Button
        title={uris.length > 0 ? 'Take Another Photo' : 'Open Camera'}
        onPress={onOpenCamera}
        variant="secondary"
      />
    </Card>
  );
}

// ─── Step 4: stock photo ───
function StockPhotoStep({ uri, onOpenCamera, onRemove }: any) {
  return (
    <Card>
      <Text style={styles.label}>STOCK PHOTO (REQUIRED)</Text>
      <Text style={styles.helpText}>
        You entered stock levels — capture a shelf photo as evidence.
      </Text>
      {uri ? (
        <View style={styles.thumbWrapper}>
          <Image source={{ uri }} style={styles.stockThumb} />
          <TouchableOpacity style={styles.thumbRemove} onPress={onRemove}>
            <Text style={styles.thumbRemoveText}>×</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Button title="Open Camera" onPress={onOpenCamera} variant="secondary" />
      )}
    </Card>
  );
}

// ─── Step 5: place order ───
function OrderStep({
  products,
  lines,
  setLines,
  orderNotes,
  setOrderNotes,
  placed,
  busy,
  total,
  onPlace,
}: any) {
  if (placed) {
    return (
      <Card>
        <Text style={styles.orderPlacedTitle}>✓ Order placed</Text>
        <Text style={styles.helpText}>
          The order is registered for this store. Tap Next to continue.
        </Text>
      </Card>
    );
  }
  if (products.length === 0) {
    return (
      <Card>
        <Text style={styles.mutedNote}>No active products to order.</Text>
      </Card>
    );
  }
  const setField = (pid: string, field: keyof QtyEntry, v: string) =>
    setLines((prev: any) => ({
      ...prev,
      [pid]: {
        cases: '',
        bottles: '',
        free_cases: '',
        free_bottles: '',
        ...(prev[pid] || {}),
        [field]: v.replace(/[^0-9]/g, ''),
      },
    }));
  return (
    <>
      <Text style={styles.helpText}>
        Optional — add products the store wants to order.
      </Text>
      {products.map((p: ProductRow) => {
        const l = lines[p.id] || {};
        return (
          <Card key={p.id}>
            <Text style={styles.productName}>{p.name}</Text>
            {p.price_per_case != null || p.price_per_bottle != null ? (
              <Text style={styles.subHint}>
                {p.price_per_case != null ? `${fmtPrice(p.price_per_case)}/case` : ''}
                {p.price_per_case != null && p.price_per_bottle != null ? ' · ' : ''}
                {p.price_per_bottle != null ? `${fmtPrice(p.price_per_bottle)}/bottle` : ''}
              </Text>
            ) : null}
            <View style={styles.qtyRow}>
              <QtyField label="Cases" value={l.cases || ''} onChange={(v) => setField(p.id, 'cases', v)} />
              <QtyField label="Bottles" value={l.bottles || ''} onChange={(v) => setField(p.id, 'bottles', v)} />
            </View>
            <View style={styles.qtyRow}>
              <QtyField label="Free cases" value={l.free_cases || ''} onChange={(v) => setField(p.id, 'free_cases', v)} />
              <QtyField label="Free btl" value={l.free_bottles || ''} onChange={(v) => setField(p.id, 'free_bottles', v)} />
            </View>
          </Card>
        );
      })}
      <Card>
        <Text style={styles.label}>ORDER NOTES (OPTIONAL)</Text>
        <VoiceInput
          value={orderNotes}
          onChangeText={setOrderNotes}
          placeholder="Delivery instructions, scheme, etc."
          inputStyle={styles.textInput}
        />
      </Card>
      {total > 0 ? (
        <Text style={styles.orderTotal}>Order value: {fmtPrice(total)}</Text>
      ) : null}
      <Button title="Place Order" onPress={onPlace} loading={busy} />
    </>
  );
}

// ─── Small numeric field ───
function QtyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.qtyField}>
      <Text style={styles.qtyLabel}>{label}</Text>
      <TextInput
        style={styles.qtyInput}
        value={value}
        onChangeText={onChange}
        placeholder="0"
        placeholderTextColor={Colors.muted}
        keyboardType="number-pad"
      />
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
  initText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    marginTop: 12,
  },
  stepBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stepBarText: {
    fontFamily: Typography.fontFamily,
    ...Typography.accordionHeader,
    color: Colors.text,
  },
  stepBarTime: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
  },
  scroll: { flex: 1 },
  content: { padding: 24, paddingBottom: 24 },
  label: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
  },
  helpText: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginBottom: 12,
  },
  mutedNote: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  textInput: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    padding: 12,
    minHeight: 80,
  },
  footer: {
    padding: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  footerHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    marginBottom: 10,
    textAlign: 'center',
  },
  // Prev order
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prevTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  statusBadge: {
    fontFamily: Typography.fontFamily,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.white,
    backgroundColor: Colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  prevDate: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
    marginBottom: 8,
  },
  prevItem: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.text,
    marginTop: 2,
  },
  // chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  chipText: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600',
  },
  chipTextSelected: { color: Colors.white },
  // products / qty
  productName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  subHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    marginBottom: 8,
  },
  qtyRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  qtyField: { flex: 1 },
  qtyLabel: {
    fontFamily: Typography.fontFamily,
    fontSize: 11,
    color: Colors.muted,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  qtyInput: {
    fontFamily: Typography.fontFamily,
    fontSize: 18,
    color: Colors.text,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: 'center',
  },
  orderTotal: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
    textAlign: 'right',
    marginBottom: 12,
  },
  orderPlacedTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.success,
    marginBottom: 6,
  },
  // camera
  fullCamera: { flex: 1 },
  cameraActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: Colors.background,
  },
  captureBtn: { flex: 1 },
  cameraHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    paddingBottom: 12,
  },
  // thumbs
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  thumbWrapper: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: 4, backgroundColor: Colors.background },
  stockThumb: { width: 120, height: 120, borderRadius: 4, backgroundColor: Colors.background },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.alert,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: Colors.white, fontSize: 16, fontWeight: '700', lineHeight: 18 },
});
