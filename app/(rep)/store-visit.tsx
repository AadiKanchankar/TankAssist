import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import {
  Colors,
  Type,
  Space,
  Radius,
  Layout,
  tabularNums,
} from '../../constants/colors';
import { Motion } from '../../constants/motion';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import StatusPill from '../../components/StatusPill';
import PipelineStrip from '../../components/PipelineStrip';
import SuccessOverlay from '../../components/SuccessOverlay';
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

// Sentence case (DESIGN §9). Order drives the progress indicator.
const STEP_ORDER: Step[] = ['prev', 'stock', 'shop', 'stockphoto', 'order', 'notes'];
const STEP_TITLES: Record<Step, string> = {
  prev: 'Previous order',
  stock: 'Update stock',
  shop: 'Shop photos',
  stockphoto: 'Stock photo',
  order: 'Place order',
  notes: 'Feedback',
};

const CANCEL_REASONS = ['Store refused', 'Wrong order', 'Duplicate', 'Other'];

const toInt = (s: string): number => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtPrice = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function StoreVisitScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const { store } = route.params as { store: StoreParam };
  const { profile } = useAuthStore();
  const reduce = useReducedMotion();

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
  const [showSuccess, setShowSuccess] = useState(false);

  // ─── Mount: lock check-in (unchanged), then load stepper data ───
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Location needed', 'Location permission is required to check in.');
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
            await supabase.from('store_visits').update({ address: addr }).eq('id', data.id);
          });
        }

        await loadStepperData();
      } catch (err: any) {
        Alert.alert('Couldn’t check in', err.message || 'Try again.');
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
    // Auto-close after each shot; reopen ("Take another photo") for more.
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
      Alert.alert('Couldn’t mark delivered', err.message || 'Try again.');
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
            Alert.alert('Couldn’t cancel', error.message || 'Try again.');
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
              Alert.alert('Couldn’t place order', err.message || 'Try again.');
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

      // Peak-end: success overlay + haptic, then return.
      setSubmitting(false);
      setShowSuccess(true);
      setTimeout(() => navigation.goBack(), 1400);
      return;
    } catch (err: any) {
      Alert.alert('Couldn’t check out', err.message || 'Try again.');
    }
    setSubmitting(false);
  };

  // ─── Render ───
  if (initializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.initText}>Locking check-in…</Text>
      </View>
    );
  }

  if (cameraTarget) {
    return (
      <View style={styles.container}>
        <Header title="Take photo" onBack={() => setCameraTarget(null)} />
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

  const idx = STEP_ORDER.indexOf(current);

  return (
    <View style={styles.container}>
      <Header title={store.name} onBack={goBack} />

      {/* Progress indicator — chunking + goal-gradient; the one lime spotlight */}
      <View style={styles.progress}>
        <View style={styles.progressTrack}>
          {STEP_ORDER.map((s, i) => (
            <View
              key={s}
              style={[
                styles.progressSeg,
                {
                  backgroundColor:
                    i < idx ? Colors.accent : i === idx ? Colors.spotlight : Colors.border,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.progressMeta}>
          <Text style={[Type.label, { color: Colors.text }]}>
            Step {idx + 1} of {STEP_ORDER.length} · {STEP_TITLES[current]}
          </Text>
          <Text style={[Type.caption, tabularNums, { color: Colors.textMuted }]}>
            {checkInTime
              ? new Date(checkInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              : ''}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <MotiView
          key={current}
          from={{ opacity: 0, translateX: reduce ? 0 : 20 }}
          animate={{ opacity: 1, translateX: 0 }}
          transition={{ type: 'timing', duration: reduce ? Motion.dur.fast : Motion.dur.base }}
        >
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
              touched={stockTouched}
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
            <BentoTile>
              <Text style={styles.fieldLabel}>Feedback / notes (optional)</Text>
              <VoiceInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything worth noting about this visit…"
                inputStyle={styles.textInput}
              />
            </BentoTile>
          )}
        </MotiView>
      </ScrollView>

      {/* Footer nav — the prev step drives its own actions */}
      {current !== 'prev' && (
        <View style={styles.footer}>
          {current === 'stock' ? (
            <Text style={styles.footerHint}>Enter what you can verify, or leave blank to skip.</Text>
          ) : null}
          <Button
            title={
              current === 'notes'
                ? 'Complete check-out'
                : current === 'stockphoto'
                ? 'Next'
                : current === 'order'
                ? orderPlaced
                  ? 'Next'
                  : 'Skip — no order'
                : 'Next'
            }
            onPress={goNext}
            loading={submitting}
            disabled={current === 'stockphoto' && !stockPhotoUri}
          />
        </View>
      )}

      {showSuccess && <SuccessOverlay label="Checked out" />}
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
    <View style={{ gap: Space.md }}>
      <BentoTile>
        <View style={styles.rowBetween}>
          <Text style={[Type.section, { color: Colors.text }]}>Pending order</Text>
          <StatusPill status={order.status} />
        </View>
        <View style={{ marginTop: Space.sm }}>
          {/* Progress header owns the screen's single lime — keep this olive. */}
          <PipelineStrip status={order.status} spotlightCurrent={false} />
        </View>
        <Text style={[Type.caption, { color: Colors.textMuted, marginTop: Space.md }]}>
          Placed {fmtDate(order.created_at)}
        </Text>
        {order.items.map((it: PrevOrderItem, i: number) => (
          <Text key={i} style={[Type.body, { color: Colors.text, marginTop: 2 }]}>
            • {it.product_name}: {it.cases} cs / {it.bottles} btl
            {it.free_cases || it.free_bottles
              ? `  (+${it.free_cases} cs / ${it.free_bottles} btl free)`
              : ''}
          </Text>
        ))}
      </BentoTile>

      <BentoTile>
        <Text style={styles.fieldLabel}>Mark delivered</Text>
        <Text style={styles.helpText}>Verify the stock arrived. Optionally add delivered-stock photos.</Text>
        <Button
          title={
            deliveredPhotoCount > 0
              ? `Add another photo (${deliveredPhotoCount})`
              : 'Add delivered photo (optional)'
          }
          onPress={onCapture}
          variant="secondary"
          style={{ marginBottom: Space.sm }}
        />
        <Button title="Mark delivered" onPress={onDeliver} loading={busy} />
      </BentoTile>

      <BentoTile>
        <Text style={styles.fieldLabel}>Cancel order</Text>
        {isPlacer ? (
          <>
            <View style={styles.chipWrap}>
              {CANCEL_REASONS.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.chip, cancelReason === r && styles.chipSelected]}
                  onPress={() => setCancelReason(r)}
                >
                  <Text style={[styles.chipText, cancelReason === r && styles.chipTextSelected]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.textInput}
              value={cancelFreeText}
              onChangeText={setCancelFreeText}
              placeholder={cancelReason === 'Other' ? 'Describe the reason' : 'Add detail (optional)'}
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <Button
              title="Cancel order"
              onPress={onCancel}
              variant="danger"
              loading={busy}
              style={{ marginTop: Space.sm }}
            />
          </>
        ) : (
          <Text style={styles.mutedNote}>Store wants to cancel? Contact your manager.</Text>
        )}
      </BentoTile>

      <Button title="Skip — no new stock visible" onPress={onSkip} variant="secondary" />
    </View>
  );
}

// ─── Step 2: stock ───
function StockStep({ products, stock, setField, latest, touched, selfId }: any) {
  if (products.length === 0) {
    return (
      <BentoTile>
        <Text style={styles.mutedNote}>No active products in the catalog.</Text>
      </BentoTile>
    );
  }
  return (
    <View style={{ gap: Space.md }}>
      {products.map((p: ProductRow) => {
        const l = latest[p.id] as StockLatest | undefined;
        const e = stock[p.id] || { cases: '', bottles: '' };
        const isTouched = touched.has(p.id);
        return (
          <BentoTile key={p.id} style={isTouched ? styles.touchedCard : undefined}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>{p.name}</Text>
            {l ? (
              <Text style={styles.subHint}>
                Last recorded {l.cases} cs / {l.bottles} btl · {fmtDate(l.recorded_at)}
                {l.recorded_by === selfId ? ' · by you' : ''}
              </Text>
            ) : (
              <Text style={styles.subHint}>Never recorded</Text>
            )}
            <View style={styles.qtyRow}>
              <QtyField label="Cases" value={e.cases} onChange={(v) => setField(p.id, 'cases', v)} />
              <QtyField label="Bottles" value={e.bottles} onChange={(v) => setField(p.id, 'bottles', v)} />
            </View>
          </BentoTile>
        );
      })}
    </View>
  );
}

// ─── Step 3: shop photos ───
function ShopPhotosStep({ uris, onOpenCamera, onRemove }: any) {
  return (
    <BentoTile>
      <Text style={styles.fieldLabel}>Shop photos</Text>
      <Text style={styles.helpText}>Live photos only — gallery disabled.</Text>
      {uris.length > 0 && (
        <View style={styles.thumbRow}>
          {uris.map((uri: string, i: number) => (
            <View key={`${uri}-${i}`} style={styles.thumbWrapper}>
              <Image source={{ uri }} style={styles.thumb} />
              <Pressable
                style={styles.thumbRemove}
                onPress={() => onRemove(i)}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <Ionicons name="close" size={14} color={Colors.white} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <CaptureCard
        label={uris.length > 0 ? 'Take another photo' : 'Open camera'}
        onPress={onOpenCamera}
      />
    </BentoTile>
  );
}

// ─── Step 4: stock photo ───
function StockPhotoStep({ uri, onOpenCamera, onRemove }: any) {
  return (
    <BentoTile>
      <Text style={styles.fieldLabel}>Stock photo (required)</Text>
      <Text style={styles.helpText}>You entered stock levels — capture a shelf photo as evidence.</Text>
      {uri ? (
        <View style={styles.thumbWrapper}>
          <Image source={{ uri }} style={styles.stockThumb} />
          <Pressable
            style={styles.thumbRemove}
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
          >
            <Ionicons name="close" size={14} color={Colors.white} />
          </Pressable>
        </View>
      ) : (
        <CaptureCard label="Open camera" onPress={onOpenCamera} />
      )}
    </BentoTile>
  );
}

// Framed capture affordance shared by the photo steps.
function CaptureCard({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.captureCard} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name="camera-outline" size={26} color={Colors.accent} />
      <Text style={[Type.label, { color: Colors.accent }]}>{label}</Text>
    </Pressable>
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
      <BentoTile>
        <View style={styles.rowGap}>
          <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
          <Text style={[Type.section, { color: Colors.success }]}>Order placed</Text>
        </View>
        <Text style={[styles.helpText, { marginTop: Space.xs }]}>
          The order is registered for this store. Tap Next to continue.
        </Text>
      </BentoTile>
    );
  }
  if (products.length === 0) {
    return (
      <BentoTile>
        <Text style={styles.mutedNote}>No active products to order.</Text>
      </BentoTile>
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
    <View style={{ gap: Space.md }}>
      <Text style={styles.helpText}>Optional — add products the store wants to order.</Text>
      {products.map((p: ProductRow) => {
        const l = lines[p.id] || {};
        return (
          <BentoTile key={p.id}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>{p.name}</Text>
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
          </BentoTile>
        );
      })}
      <BentoTile>
        <Text style={styles.fieldLabel}>Order notes (optional)</Text>
        <VoiceInput
          value={orderNotes}
          onChangeText={setOrderNotes}
          placeholder="Delivery instructions, scheme, etc."
          inputStyle={styles.textInput}
        />
      </BentoTile>
      {total > 0 ? <Text style={styles.orderTotal}>Order value: {fmtPrice(total)}</Text> : null}
      <Button title="Place order" onPress={onPlace} loading={busy} />
    </View>
  );
}

// ─── Numeric stepper field ───
function QtyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const num = toInt(value);
  return (
    <View style={styles.qtyField}>
      <Text style={styles.qtyLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(String(Math.max(0, num - 1)))}
          style={styles.stepBtn}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
        >
          <Ionicons name="remove" size={18} color={Colors.accent} />
        </Pressable>
        <TextInput
          style={styles.qtyInput}
          value={value}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          textAlign="center"
        />
        <Pressable
          onPress={() => onChange(String(num + 1))}
          style={styles.stepBtn}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
        >
          <Ionicons name="add" size={18} color={Colors.accent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  initText: { ...Type.body, color: Colors.textMuted, marginTop: Space.md },
  // Progress
  progress: {
    paddingHorizontal: Layout.screenPad,
    paddingVertical: Space.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Space.sm,
  },
  progressTrack: { flexDirection: 'row', gap: 4 },
  progressSeg: { flex: 1, height: 5, borderRadius: Radius.pill },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scroll: { flex: 1 },
  content: { padding: Layout.screenPad },
  fieldLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  helpText: { ...Type.caption, color: Colors.textMuted, marginBottom: Space.md },
  mutedNote: { ...Type.body, color: Colors.textMuted },
  textInput: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Space.md,
    minHeight: 80,
  },
  footer: {
    padding: Layout.screenPad,
    paddingTop: Space.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  footerHint: { ...Type.caption, color: Colors.textMuted, marginBottom: Space.sm, textAlign: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  // chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, marginBottom: Space.sm },
  chip: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    minHeight: Layout.tap,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  chipText: { ...Type.label, color: Colors.text },
  chipTextSelected: { color: Colors.white },
  // stock/order
  touchedCard: { borderColor: Colors.accent, backgroundColor: Colors.surfaceAlt },
  subHint: { ...Type.caption, color: Colors.textMuted, marginTop: 2, marginBottom: Space.sm },
  qtyRow: { flexDirection: 'row', gap: Space.md, marginTop: Space.xs },
  qtyField: { flex: 1 },
  qtyLabel: { ...Type.caption, color: Colors.textMuted, marginBottom: Space.xs },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  stepBtn: { width: Layout.tap, height: Layout.tap, alignItems: 'center', justifyContent: 'center' },
  qtyInput: { flex: 1, ...Type.section, color: Colors.text, paddingVertical: Space.sm },
  orderTotal: { ...Type.bodyMed, color: Colors.text, textAlign: 'right' },
  // camera
  fullCamera: { flex: 1 },
  cameraActions: { flexDirection: 'row', gap: Space.sm, padding: Space.lg, backgroundColor: Colors.background },
  captureBtn: { flex: 1 },
  captureCard: {
    borderWidth: 1.5,
    borderColor: Colors.borderStrong,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    paddingVertical: Space.xl,
    alignItems: 'center',
    gap: Space.xs,
  },
  // thumbs
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, marginBottom: Space.md },
  thumbWrapper: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  stockThumb: { width: 120, height: 120, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
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
});
