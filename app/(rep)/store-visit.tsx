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
import {
  STOCK_BUCKETS,
  BUCKET_LABEL,
  BUCKET_HINT,
  emptyBuckets,
  bucketTotals,
  snapshotPayload,
  bucketBreakdown,
  SNAPSHOT_COLUMNS,
  type StockBucket,
  type BucketEntries,
  type SnapshotRow,
} from '../../lib/stockBuckets';
import { emptyDraft, type VisitDraft } from '../../lib/visitDraft';
import { saveDraft, loadDraft, clearDraft } from '../../lib/visitDraftStore';

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
  is_out_of_stock: boolean;
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

interface StockLatest extends SnapshotRow {
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
  // Set when the mount found an existing open visit, so the draft restore runs
  // only for a genuine resume and never over a fresh check-in.
  const [resumedVisitId, setResumedVisitId] = useState<string | null>(null);
  const draftLoadedRef = useRef(false);

  // Data
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stockLatest, setStockLatest] = useState<Record<string, StockLatest>>({});
  const [prevOrder, setPrevOrder] = useState<PrevOrder | null>(null);

  // Step state
  const [stock, setStock] = useState<Record<string, BucketEntries>>({});
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
          // Resuming: the server row is the source of truth. The encrypted
          // draft only layers back what was typed but never committed, and is
          // applied after the catalog load below so it wins over the prefill.
          setVisitId(existing.id);
          setCheckInTime(existing.check_in_time);
          setNotes(existing.notes || '');
          setCheckInAddress(existing.address ?? null);
          setResumedVisitId(existing.id);
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
              // The only STORED anti-cheat flag: a device fact at capture time
              // that cannot be reconstructed later. Flag-only — check-in is
              // never blocked.
              //
              // ⚠️ ANDROID ONLY. expo-location fills `mocked` from
              // Location.isFromMockProvider() in its native Android module; on
              // iOS the key is absent, so every iOS visit records false and a
              // spoofed iOS device would NOT be flagged. Acceptable today
              // because the fleet is Android APKs (eas.json `preview`). If iOS
              // ever ships, this flag needs an iOS-side equivalent or the
              // exception queue will quietly under-report.
              is_mock_location: loc.mocked ?? false,
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
      // NO price columns. Reps never see or receive pricing: order value is
      // derived server-side by trg_snapshot_order_item_price from the catalog
      // price and the quantities below, so the device has no reason to hold it.
      .select('id, name, unit, qty_per_carton, is_out_of_stock')
      .eq('is_active', true)
      .order('name');
    setProducts((prods as ProductRow[]) || []);

    // Latest stock snapshot per product for this store
    const { data: snaps } = await supabase
      .from('store_stock_snapshots')
      .select(`product_id, ${SNAPSHOT_COLUMNS}, recorded_at, recorded_by`)
      .eq('store_id', store.id)
      .order('recorded_at', { ascending: false });
    const latest: Record<string, StockLatest> = {};
    for (const s of (snaps as any[]) || []) {
      if (!latest[s.product_id]) latest[s.product_id] = s as StockLatest;
    }
    setStockLatest(latest);

    // Prefill each bucket from the latest snapshot. A bucket that was never
    // recorded stays blank rather than prefilling 0 — otherwise "this store has
    // no godown" would silently become "the godown is empty" on the next visit.
    const prefill: Record<string, BucketEntries> = {};
    for (const p of (prods as ProductRow[]) || []) {
      const l = latest[p.id];
      const b = emptyBuckets();
      if (l) {
        for (const k of STOCK_BUCKETS) {
          const c = l[`${k}_cases` as keyof SnapshotRow] as number | null;
          const bt = l[`${k}_bottles` as keyof SnapshotRow] as number | null;
          if (c !== null || bt !== null) b[k] = { cases: String(c ?? 0), bottles: String(bt ?? 0) };
        }
      }
      prefill[p.id] = b;
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

  // ─── Form draft (encrypted, tiny) ───
  // Restores only what was TYPED. The visit itself resumes from the server row;
  // if this draft is missing or corrupt the rep simply re-enters the numbers.
  useEffect(() => {
    if (!resumedVisitId || draftLoadedRef.current || products.length === 0) return;
    draftLoadedRef.current = true;
    loadDraft(resumedVisitId).then((d) => {
      if (!d) return;
      setStock((prev) => {
        const next = { ...prev };
        for (const [pid, buckets] of Object.entries(d.stock)) {
          // Ignore products that have since left the catalog.
          if (!next[pid]) continue;
          next[pid] = { ...emptyBuckets(), ...(buckets as BucketEntries) };
        }
        return next;
      });
      if (d.touched.length) setStockTouched(new Set(d.touched.filter((p) => !!products.find((x) => x.id === p))));
      if (d.notes) setNotes(d.notes);
      if (d.orderNotes) setOrderNotes(d.orderNotes);
      const step = STEP_ORDER[d.step];
      // Never resume onto the prior-order step: that order may already have
      // been delivered or cancelled since, and it is re-resolved on mount.
      if (step && step !== 'prev') setStepStack([step]);
    });
  }, [resumedVisitId, products]);

  // Persist on change. Cheap and debounced — each save is a Keystore write.
  useEffect(() => {
    if (!visitId) return;
    const t = setTimeout(() => {
      const draft: VisitDraft = {
        ...emptyDraft(),
        step: Math.max(0, STEP_ORDER.indexOf(current)),
        stock,
        touched: [...stockTouched],
        notes,
        orderNotes,
        savedAt: '',
      };
      saveDraft(visitId, draft);
    }, 800);
    return () => clearTimeout(t);
  }, [visitId, current, stock, stockTouched, notes, orderNotes]);

  const setStockField = (pid: string, bucket: StockBucket, field: 'cases' | 'bottles', v: string) => {
    const clean = v.replace(/[^0-9]/g, '');
    setStock((prev) => {
      const cur = prev[pid] ?? emptyBuckets();
      return {
        ...prev,
        [pid]: { ...cur, [bucket]: { ...cur[bucket], [field]: clean } },
      };
    });
    setStockTouched((prev) => (prev.has(pid) ? prev : new Set(prev).add(pid)));
  };

  // Any TOUCHED product with a positive TOTAL across its buckets — drives the
  // stock-photo requirement and the shop→stockphoto routing.
  const stockEnteredPositive = () =>
    products.some((p) => {
      if (!stockTouched.has(p.id)) return false;
      const t = bucketTotals(stock[p.id] ?? emptyBuckets(), p.qty_per_carton);
      return t.cases > 0 || t.bottles > 0;
    });

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
  // No order total on this device. Value is computed server-side from the
  // catalog price and the quantities the rep enters; the rep is shown neither.

  const handlePlaceOrder = async () => {
    const lines = products
      .map((p) => ({ p, l: orderLines[p.id] }))
      .filter(
        ({ p, l }) =>
          // OOS products can't be ordered (the DB trigger is the real guard; this
          // just avoids a doomed submit if a product went OOS mid-session).
          !p.is_out_of_stock &&
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
    Alert.alert(
      'Place order',
      `${lines.length} product${lines.length === 1 ? '' : 's'}`,
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
                // Quantities ONLY. trg_snapshot_order_item_price fills
                // price_per_case/price_per_bottle from the catalog server-side
                // and overwrites anything sent, so the rep neither knows nor
                // influences the price.
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
    const anyPositive = touchedProducts.some((p) => {
      const t = bucketTotals(stock[p.id] ?? emptyBuckets(), p.qty_per_carton);
      return t.cases > 0 || t.bottles > 0;
    });
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
        const b = stock[p.id] ?? emptyBuckets();
        // A product marked touched but left entirely blank across all three
        // buckets records nothing — the rep opened it and moved on.
        if (!bucketTotals(b, p.qty_per_carton).anyRecorded) continue;
        const { error } = await supabase.from('store_stock_snapshots').insert({
          store_id: store.id,
          product_id: p.id,
          visit_id: visitId,
          recorded_by: profile!.id,
          ...snapshotPayload(b, p.qty_per_carton),
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

      // The visit is committed server-side, so the draft has nothing left to
      // protect — drop it rather than leaving trade data in the Keystore.
      await clearDraft(visitId);

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
              ? `  (+${it.free_cases} cs / ${it.free_bottles} btl scheme)`
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
        const e: BucketEntries = stock[p.id] ?? emptyBuckets();
        const isTouched = touched.has(p.id);
        const total = bucketTotals(e, p.qty_per_carton);
        const prior = l ? bucketBreakdown(l) : [];
        return (
          <BentoTile key={p.id} style={isTouched ? styles.touchedCard : undefined}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>{p.name}</Text>
            {l ? (
              <Text style={styles.subHint}>
                Last recorded{' '}
                {prior.length
                  ? prior.map((b) => `${b.label.replace(' stock', '')} ${b.cases} cs`).join(' · ')
                  : `${l.cases} cs / ${l.bottles} btl (total only)`}{' '}
                · {fmtDate(l.recorded_at)}
                {l.recorded_by === selfId ? ' · by you' : ''}
              </Text>
            ) : (
              <Text style={styles.subHint}>Never recorded</Text>
            )}

            {STOCK_BUCKETS.map((k: StockBucket) => (
              <View key={k} style={styles.bucketGroup}>
                <Text style={styles.bucketLabel}>{BUCKET_LABEL[k]}</Text>
                <Text style={styles.bucketHint}>{BUCKET_HINT[k]}</Text>
                <View style={styles.qtyRow}>
                  <QtyField
                    label="Cases"
                    value={e[k].cases}
                    onChange={(v: string) => setField(p.id, k, 'cases', v)}
                  />
                  <QtyField
                    label="Bottles"
                    value={e[k].bottles}
                    onChange={(v: string) => setField(p.id, k, 'bottles', v)}
                  />
                </View>
              </View>
            ))}

            {total.anyRecorded ? (
              <Text style={styles.bucketTotal}>
                Total {total.cases} cs{total.bottles ? ` + ${total.bottles} btl` : ''}
              </Text>
            ) : null}
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
        // OOS products are DISABLED, not hidden (brief §1) — visibly unavailable.
        if (p.is_out_of_stock) {
          return (
            <BentoTile key={p.id} style={styles.oosCard}>
              <View style={styles.oosHeadRow}>
                <Text style={[Type.bodyMed, { color: Colors.textMuted }]}>{p.name}</Text>
                <Text style={styles.oosTag}>Out of stock</Text>
              </View>
              <Text style={styles.subHint}>Temporarily unavailable to order.</Text>
            </BentoTile>
          );
        }
        return (
          <BentoTile key={p.id}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>{p.name}</Text>
            <View style={styles.qtyRow}>
              <QtyField label="Cases" value={l.cases || ''} onChange={(v) => setField(p.id, 'cases', v)} />
              <QtyField label="Bottles" value={l.bottles || ''} onChange={(v) => setField(p.id, 'bottles', v)} />
            </View>
            <View style={styles.qtyRow}>
              {/* Labelled "scheme" (trade usage: "Buy 20 Get 1 Free" IS a scheme).
                  The columns stay free_cases/free_bottles — see CLAUDE.md. */}
              <QtyField label="Scheme cases" value={l.free_cases || ''} onChange={(v) => setField(p.id, 'free_cases', v)} />
              <QtyField label="Scheme btl" value={l.free_bottles || ''} onChange={(v) => setField(p.id, 'free_bottles', v)} />
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
  oosCard: { opacity: 0.6 },
  oosHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  oosTag: { ...Type.caption, fontWeight: '700', color: Colors.warning, borderWidth: 1, borderColor: Colors.warning, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  qtyRow: { flexDirection: 'row', gap: Space.md, marginTop: Space.xs },
  bucketGroup: { marginTop: Space.sm },
  bucketLabel: { ...Type.label, color: Colors.text },
  bucketHint: { ...Type.caption, color: Colors.textMuted, marginTop: 1 },
  bucketTotal: { ...Type.caption, color: Colors.textSecondary, marginTop: Space.sm },
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
