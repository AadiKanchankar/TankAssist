import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Image,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../constants/colors';
import Header from './Header';
import Button from './Button';
import ZoomCamera, { type ZoomCameraHandle } from './ZoomCamera';
import PhotoViewer from './PhotoViewer';
import { blurFacesForUpload, discardPhoto, type BlurredPhoto } from '../lib/faceBlur';
import { freshPosition } from '../lib/freshLocation';
import { userMessage } from '../lib/userError';
import { useAuthStore } from '../store/useAuthStore';
import {
  useCompetitorBrands,
  useMySpotSalesHere,
  useLogSpotSale,
  useUndoSpotSale,
  type MySpotSale,
} from '../hooks/useSpotSales';

export interface SpotProduct {
  id: string;
  name: string;
}

const UNDO_SECONDS = 60;
/** Position is evidence, not a gate: never hold the save hostage to GPS. */
const POSITION_WAIT_MS = 3000;

/**
 * The persistent spot-sale bar on the store-visit screen: live tally for this
 * store today + "Log a sale". Sits ABOVE the stepper for the whole open visit
 * (owner's placement), because conversions happen at unpredictable moments,
 * not at a step.
 */
export function SpotSaleBar({
  visitId,
  storeId,
  products,
}: {
  visitId: string;
  storeId: string;
  products: SpotProduct[];
}) {
  const { profile } = useAuthStore();
  const { data: mine = [] } = useMySpotSalesHere(storeId, profile?.id);
  const undo = useUndoSpotSale();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<MySpotSale | null>(null);
  const [now, setNow] = useState(Date.now());

  // Ticks only while an undo is on offer.
  const undoLeft = last ? Math.max(0, UNDO_SECONDS - Math.floor((now - Date.parse(last.created_at)) / 1000)) : 0;
  useEffect(() => {
    if (!last) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [last]);
  useEffect(() => {
    if (last && undoLeft === 0) setLast(null);
  }, [last, undoLeft]);

  const doUndo = async () => {
    if (!last) return;
    try {
      await undo(last.id);
      setLast(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } catch (e) {
      setLast(null);
      Alert.alert('Couldn’t undo', userMessage(e));
    }
  };

  const count = mine.length;
  return (
    <>
      <View style={styles.bar}>
        <View style={{ flex: 1 }}>
          <Text style={[Type.label, { color: Colors.textOnDark }]}>Spot sales</Text>
          {last && undoLeft > 0 ? (
            <Text style={[Type.caption, tabularNums, { color: Colors.textOnDark }]}>
              Logged · undo available for {undoLeft}s
            </Text>
          ) : (
            <Text style={[Type.caption, tabularNums, { color: Colors.textOnDark, opacity: 0.8 }]}>
              {count === 0 ? 'None logged here today' : `${count} logged here today`}
            </Text>
          )}
        </View>
        {last && undoLeft > 0 ? (
          <Pressable onPress={doUndo} style={styles.undoBtn} accessibilityRole="button" accessibilityLabel="Undo last spot sale">
            <Text style={[Type.label, { color: Colors.textOnDark }]}>Undo</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setOpen(true)}
          style={styles.logBtn}
          accessibilityRole="button"
          accessibilityLabel="Log a spot sale"
        >
          <Ionicons name="camera" size={16} color={Colors.text} />
          <Text style={[Type.label, { color: Colors.text }]}>Log sale</Text>
        </Pressable>
      </View>
      {open ? (
        <SpotSaleCapture
          visitId={visitId}
          storeId={storeId}
          products={products}
          onClose={() => setOpen(false)}
          onLogged={(row) => {
            setOpen(false);
            setNow(Date.now());
            setLast(row);
          }}
        />
      ) : null}
    </>
  );
}

type Blur = { state: 'working' } | { state: 'done'; photo: BlurredPhoto } | { state: 'failed'; message: string };

/**
 * Capture flow: camera → (blur runs in the background) → product · quantity ·
 * switched-from → save. Mounted fresh per opening so nothing carries over.
 */
function SpotSaleCapture({
  visitId,
  storeId,
  products,
  onClose,
  onLogged,
}: {
  visitId: string;
  storeId: string;
  products: SpotProduct[];
  onClose: () => void;
  onLogged: (row: MySpotSale) => void;
}) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<ZoomCameraHandle>(null);
  const { data: brands = [], isLoading: brandsLoading } = useCompetitorBrands();
  const log = useLogSpotSale();

  const [shot, setShot] = useState<{ zoom: number; at: string } | null>(null);
  const [blur, setBlur] = useState<Blur>({ state: 'working' });
  const posRef = useRef<Promise<any> | null>(null);
  const [productId, setProductId] = useState<string | null>(products.length === 1 ? products[0].id : null);
  const [qty, setQty] = useState(1);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [shooting, setShooting] = useState(false);
  // Full-screen check of the BLURRED image — the thumbnail is too small to be
  // sure a face didn't slip past the detector.
  const [inspecting, setInspecting] = useState(false);
  // A blurred file still on the device when this screen goes away is deleted.
  const pendingUri = useRef<string | null>(null);
  // Bumped on every shot, retake and unmount: a blur that finishes for an
  // abandoned shot deletes its own file instead of landing on screen.
  const gen = useRef(0);
  useEffect(() => () => {
    gen.current++;
    void discardPhoto(pendingUri.current);
  }, []);

  const shoot = async () => {
    if (!cam.current || shooting) return;
    setShooting(true);
    try {
      const p = await cam.current.takePictureAsync({ quality: 0.8 });
      if (!p) return;
      setShot({ zoom: p.zoom, at: new Date().toISOString() });
      setBlur({ state: 'working' });
      posRef.current = freshPosition().catch(() => null);
      const mine = ++gen.current;
      blurFacesForUpload(p.uri).then(
        (photo) => {
          if (mine !== gen.current) return void discardPhoto(photo.uri);
          pendingUri.current = photo.uri;
          setBlur({ state: 'done', photo });
        },
        (e) => {
          if (mine === gen.current) setBlur({ state: 'failed', message: userMessage(e) });
        },
      );
    } catch (e) {
      Alert.alert('Camera', userMessage(e));
    } finally {
      setShooting(false);
    }
  };

  const retake = () => {
    gen.current++;
    if (blur.state === 'done') void discardPhoto(blur.photo.uri);
    pendingUri.current = null;
    setShot(null);
    setBlur({ state: 'working' });
  };

  const save = async () => {
    if (blur.state !== 'done' || !shot || !productId || !brandId || !profile) return;
    setBusy(true);
    try {
      const fix = await Promise.race([
        posRef.current ?? Promise.resolve(null),
        new Promise((r) => setTimeout(() => r(null), POSITION_WAIT_MS)),
      ]) as any;
      const c = fix?.loc?.coords;
      const row = await log({
        visitId,
        storeId,
        userId: profile.id,
        productId,
        quantity: qty,
        switchedFromId: brandId,
        note,
        photo: blur.photo,
        zoom: shot.zoom,
        capturedAt: shot.at,
        position: c
          ? { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy ?? null, mocked: fix.loc.mocked ?? false }
          : null,
      });
      pendingUri.current = null; // log() deleted it
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onLogged(row);
    } catch (e) {
      // log() already deleted the local file, so this photo is gone: start over.
      pendingUri.current = null;
      setShot(null);
      setBlur({ state: 'working' });
      Alert.alert('Spot sale not saved', `${userMessage(e)}\n\nTake the photo again to retry.`);
    }
    setBusy(false);
  };

  const canSave = blur.state === 'done' && !!productId && !!brandId && !busy;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <Header title="Log a spot sale" onBack={onClose} />
        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={[Type.body, { color: Colors.textSecondary, textAlign: 'center' }]}>
              Camera access is needed to log a spot sale.
            </Text>
            <Button title="Allow camera" onPress={requestPermission} style={{ marginTop: Space.md }} />
          </View>
        ) : !shot ? (
          <View style={{ flex: 1 }}>
            <ZoomCamera ref={cam} style={{ flex: 1 }} facing="back">
              <View style={styles.guide} pointerEvents="none">
                <Text style={styles.guideText}>Show the bottle and the counter — faces aren’t needed.</Text>
              </View>
            </ZoomCamera>
            <View style={[styles.shootBar, { paddingBottom: insets.bottom + Space.md }]}>
              <Button title="Capture" onPress={shoot} loading={shooting} />
            </View>
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <View style={styles.previewRow}>
                <Pressable
                  style={styles.preview}
                  onPress={() => blur.state === 'done' && setInspecting(true)}
                  disabled={blur.state !== 'done'}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="View the blurred photo full screen"
                >
                  {blur.state === 'done' ? (
                    <>
                      <Image source={{ uri: blur.photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      <View style={styles.expand}>
                        <Ionicons name="expand" size={14} color={Colors.white} />
                      </View>
                    </>
                  ) : blur.state === 'working' ? (
                    <ActivityIndicator color={Colors.accent} />
                  ) : (
                    <Ionicons name="alert-circle" size={28} color={Colors.alert} />
                  )}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={[Type.bodyMed, { color: Colors.text }]}>
                    {blur.state === 'working'
                      ? 'Checking for faces…'
                      : blur.state === 'failed'
                      ? 'Photo can’t be saved'
                      : blur.photo.faces === 0
                      ? 'No faces in this photo'
                      : `${blur.photo.faces} face${blur.photo.faces === 1 ? '' : 's'} blurred`}
                  </Text>
                  <Text style={[Type.caption, { color: Colors.textSecondary, marginTop: 2 }]}>
                    {blur.state === 'failed'
                      ? blur.message
                      : 'Only the blurred photo leaves this phone. Tap it to check — retake if a face is still visible.'}
                  </Text>
                  <Pressable onPress={retake} style={styles.retake} accessibilityRole="button">
                    <Text style={[Type.label, { color: Colors.accent }]}>Retake</Text>
                  </Pressable>
                </View>
              </View>

              {products.length > 1 ? (
                <>
                  <Text style={styles.label}>Product</Text>
                  <Chips items={products} value={productId} onChange={setProductId} />
                </>
              ) : products.length === 1 ? (
                <Text style={[Type.bodyMed, { color: Colors.text, marginTop: Space.lg }]}>{products[0].name}</Text>
              ) : (
                <Text style={[Type.body, { color: Colors.alert, marginTop: Space.lg }]}>No active products in the catalogue.</Text>
              )}

              <Text style={styles.label}>Bottles this customer took</Text>
              <View style={styles.qtyRow}>
                <Pressable
                  onPress={() => setQty((q) => Math.max(1, q - 1))}
                  style={styles.qtyBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Fewer bottles"
                >
                  <Ionicons name="remove" size={20} color={Colors.accent} />
                </Pressable>
                <Text style={[Type.display, tabularNums, styles.qtyVal]}>{qty}</Text>
                <Pressable
                  onPress={() => setQty((q) => Math.min(48, q + 1))}
                  style={styles.qtyBtn}
                  accessibilityRole="button"
                  accessibilityLabel="More bottles"
                >
                  <Ionicons name="add" size={20} color={Colors.accent} />
                </Pressable>
              </View>

              <Text style={styles.label}>Came in for</Text>
              {brandsLoading ? (
                <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start' }} />
              ) : (
                <Chips items={brands} value={brandId} onChange={setBrandId} />
              )}

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                maxLength={200}
                placeholder="One line, if anything stands out"
                placeholderTextColor={Colors.textMuted}
                style={styles.note}
              />
            </ScrollView>
            <View style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
              <Button
                title={blur.state === 'working' ? 'Checking photo…' : 'Save spot sale'}
                onPress={save}
                loading={busy}
                disabled={!canSave}
              />
            </View>
          </>
        )}
      </View>
      {blur.state === 'done' ? (
        <PhotoViewer
          photos={[{ uri: blur.photo.uri, caption: 'This is exactly what will be saved' }]}
          index={inspecting ? 0 : null}
          onClose={() => setInspecting(false)}
        />
      ) : null}
    </Modal>
  );
}

function Chips({
  items,
  value,
  onChange,
}: {
  items: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {items.map((it) => {
        const on = value === it.id;
        return (
          <Pressable
            key={it.id}
            onPress={() => onChange(it.id)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[Type.label, { color: on ? Colors.white : Colors.text }]}>{it.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Layout.screenPad,
    paddingVertical: Space.sm,
    backgroundColor: Colors.surfaceDark,
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    minHeight: Layout.tap,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
  },
  undoBtn: {
    minHeight: Layout.tap,
    paddingHorizontal: Space.md,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.textOnDark,
  },
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.lg },
  guide: { position: 'absolute', top: Space.md, left: Space.md, right: Space.md, alignItems: 'center' },
  guideText: {
    ...Type.label,
    color: Colors.white,
    textAlign: 'center',
    backgroundColor: Colors.scrim,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  shootBar: { padding: Space.md, backgroundColor: Colors.background },
  form: { padding: Layout.screenPad },
  previewRow: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  preview: {
    width: 104,
    height: 138,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  expand: {
    position: 'absolute',
    right: Space.xs,
    bottom: Space.xs,
    padding: Space.xs,
    borderRadius: Radius.sm,
    backgroundColor: Colors.scrim,
  },
  retake: { minHeight: Layout.tap, justifyContent: 'center', alignSelf: 'flex-start' },
  label: { ...Type.label, color: Colors.textMuted, marginTop: Space.lg, marginBottom: Space.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  qtyBtn: {
    width: Layout.tap,
    height: Layout.tap,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyVal: { color: Colors.text, minWidth: 40, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: {
    minHeight: Layout.tap,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  note: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    minHeight: Layout.tap,
  },
  footer: {
    padding: Layout.screenPad,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
});
