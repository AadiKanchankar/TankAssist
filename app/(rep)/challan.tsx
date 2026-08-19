import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Header from '../../components/Header';
import Button from '../../components/Button';
import VoiceInput from '../../components/VoiceInput';
import { useAuthStore } from '../../store/useAuthStore';
import { useRepDashboard } from '../../hooks/useRepDashboard';
import { useChallanProducts, useCreateChallan, ChallanLinesError } from '../../hooks/useChallans';
import {
  ChallanLine,
  SIZE_CLASSES,
  SIZE_LABEL,
  SizeClass,
  challanDateError,
  challanTotals,
  filledLines,
  isOwnBrand,
  toQty,
  todayStr,
} from '../../lib/challan';

type QtyDraft = Record<string, Partial<Record<SizeClass, string>>>;

/**
 * Delivery-challan capture + manual entry (rep-side).
 *
 * Photograph the challan, then transcribe its quantity table by hand. There is
 * NO auto-extraction: many challans are handwritten in mixed English/Hindi/
 * Devanagari on carbon paper, and betting the feature on an offline recogniser
 * that cannot read them would collect nothing. Manual entry starts collecting
 * structured data today — see lib/challan.ts for the seam a future
 * printed-challan parser would populate.
 *
 * Every field is editable, including the ones we pre-fill. Pre-filling is a
 * shortcut for the common case, never an assertion about what the paper says.
 */
export default function ChallanScreen({ route, navigation }: { route: any; navigation: any }) {
  const { profile } = useAuthStore();
  const paramStore = route?.params?.store ?? null;
  const visitId: string | null = route?.params?.visitId ?? null;

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);

  const [storeId, setStoreId] = useState<string | null>(paramStore?.id ?? null);
  const [storeName, setStoreName] = useState<string>(paramStore?.name ?? '');
  const [pickingStore, setPickingStore] = useState(false);

  const [date, setDate] = useState(todayStr());
  const [challanNumber, setChallanNumber] = useState('');
  const [qty, setQty] = useState<QtyDraft>({});
  const [notes, setNotes] = useState('');

  /** Set when the header saved but its lines did not — enables Retry. */
  const [pendingChallanId, setPendingChallanId] = useState<string | null>(null);

  const { data: products, isPending: productsLoading } = useChallanProducts();
  const { data: dash } = useRepDashboard(profile?.id);
  const create = useCreateChallan(profile?.id);

  const assignedStores = useMemo(
    () => (dash?.assignments ?? []).map((a) => a.stores).filter(Boolean),
    [dash],
  );

  const lines: ChallanLine[] = useMemo(
    () =>
      (products ?? []).map((p) => ({
        product_id: p.id,
        qty_qts: toQty(qty[p.id]?.qts ?? ''),
        qty_pints: toQty(qty[p.id]?.pints ?? ''),
        qty_nips: toQty(qty[p.id]?.nips ?? ''),
      })),
    [products, qty],
  );
  const totals = useMemo(() => challanTotals(filledLines(lines)), [lines]);

  const yesterday = todayStr(new Date(Date.now() - 86_400_000));
  const dateError = challanDateError(date);

  const setCell = (productId: string, size: SizeClass, text: string) =>
    setQty((q) => ({ ...q, [productId]: { ...q[productId], [size]: text } }));

  const shoot = async () => {
    if (!cameraRef) return;
    setShooting(true);
    try {
      const photo = await cameraRef.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) setPhotoUri(photo.uri);
    } catch {
      Alert.alert('Camera', 'Could not take the photo. Try again.');
    }
    setShooting(false);
  };

  const save = async () => {
    if (!photoUri) {
      Alert.alert('Photo needed', 'Photograph the challan before saving it.');
      return;
    }
    if (!storeId) {
      Alert.alert('Store needed', 'Choose which store this challan is for.');
      return;
    }
    if (dateError) {
      Alert.alert('Check the date', dateError);
      return;
    }
    if (!filledLines(lines).length) {
      Alert.alert(
        'Nothing to record',
        'Enter a quantity against at least one product before saving.',
      );
      return;
    }

    try {
      await create.mutateAsync({
        storeId,
        visitId,
        challanDate: date,
        challanNumber: challanNumber.trim() || null,
        notes: notes.trim() || null,
        photoUri,
        lines,
        existingChallanId: pendingChallanId,
      });
      navigation.goBack();
    } catch (err: any) {
      // The header exists and cannot be deleted, so the only way to clear it is
      // to finish it. Keep the id and let the rep retry just the lines.
      if (err instanceof ChallanLinesError) {
        setPendingChallanId(err.challanId);
        Alert.alert('Quantities not saved', `${err.message}\n\nTap Save again to retry.`);
        return;
      }
      Alert.alert('Could not save the challan', err?.message ?? 'Try again.');
    }
  };

  // ── Capture step ─────────────────────────────────────────────────────────
  if (!photoUri) {
    return (
      <View style={styles.screen}>
        <Header title="Delivery challan" onBack={() => navigation.goBack()} />
        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.help}>
              Camera access is needed to photograph the challan.
            </Text>
            <Button
              title="Allow camera"
              onPress={requestPermission}
              style={{ marginTop: Space.md }}
            />
          </View>
        ) : (
          <>
            <CameraView style={styles.camera} facing="back" ref={setCameraRef} />
            <View style={styles.shutterBar}>
              <Text style={styles.shutterHint}>
                Fill the frame with the challan. You will type the quantities next.
              </Text>
              <Pressable
                onPress={shoot}
                disabled={shooting}
                style={[styles.shutter, shooting && styles.shutterBusy]}
                accessibilityRole="button"
                accessibilityLabel="Take a photo of the challan"
              >
                {shooting ? (
                  <ActivityIndicator color={Colors.onSpotlight} />
                ) : (
                  <Ionicons name="camera" size={26} color={Colors.onSpotlight} />
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>
    );
  }

  // ── Manual entry step ────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <Header title="Delivery challan" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.body}
        // Without this the keyboard-dismiss gesture eats the first tap on a
        // chip or product cell while a field is focused.
        keyboardShouldPersistTaps="handled"
      >
        {/* Photo */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Challan photo</Text>
            <Pressable
              onPress={() => setPhotoUri(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Retake the challan photo"
            >
              <Text style={styles.link}>Retake</Text>
            </Pressable>
          </View>
          <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
        </View>

        {/* Store */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Store</Text>
            {assignedStores.length > 0 && (
              <Pressable
                onPress={() => setPickingStore((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Change the store this challan is for"
              >
                <Text style={styles.link}>{pickingStore ? 'Done' : 'Change'}</Text>
              </Pressable>
            )}
          </View>
          <Text style={[styles.value, !storeId && styles.valueMissing]}>
            {storeName || 'Not chosen yet'}
          </Text>
          {(pickingStore || !storeId) &&
            assignedStores.map((s: any) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  setStoreId(s.id);
                  setStoreName(s.name);
                  setPickingStore(false);
                }}
                style={[styles.pickRow, storeId === s.id && styles.pickRowActive]}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${s.name}`}
              >
                <Text style={styles.pickText}>{s.name}</Text>
                {storeId === s.id && (
                  <Ionicons name="checkmark" size={18} color={Colors.accent} />
                )}
              </Pressable>
            ))}
        </View>

        {/* Date + number */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Challan date</Text>
          <View style={styles.chipRow}>
            {[
              { label: 'Today', value: todayStr() },
              { label: 'Yesterday', value: yesterday },
            ].map((c) => (
              <Pressable
                key={c.label}
                onPress={() => setDate(c.value)}
                style={[styles.chip, date === c.value && styles.chipActive]}
                accessibilityRole="button"
                accessibilityLabel={`Set the challan date to ${c.label}`}
              >
                <Text style={[styles.chipText, date === c.value && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textMuted}
            style={[styles.input, !!dateError && styles.inputError]}
            accessibilityLabel="Challan date"
          />
          {!!dateError && <Text style={styles.error}>{dateError}</Text>}

          <Text style={[styles.cardTitle, { marginTop: Space.lg }]}>Challan number</Text>
          <TextInput
            value={challanNumber}
            onChangeText={setChallanNumber}
            placeholder="Optional — leave blank if unreadable"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            autoCapitalize="characters"
            accessibilityLabel="Challan number, optional"
          />
        </View>

        {/* Quantities */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quantities</Text>
          <Text style={styles.hint}>
            Enter what the challan shows for our products. Leave the rest blank.
          </Text>

          {productsLoading ? (
            <ActivityIndicator style={{ marginTop: Space.lg }} color={Colors.accent} />
          ) : (
            <>
              <View style={styles.qtyHeadRow}>
                <Text style={[styles.qtyHeadName]} />
                {SIZE_CLASSES.map((s) => (
                  <Text key={s} style={styles.qtyHead}>
                    {SIZE_LABEL[s]}
                  </Text>
                ))}
              </View>

              {(products ?? []).map((p) => (
                <View key={p.id} style={styles.qtyRow}>
                  <View style={styles.qtyName}>
                    <Text style={styles.productName} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text style={styles.productMeta}>
                      {isOwnBrand(p.name, p.brand) ? 'Our product' : p.brand || p.unit}
                    </Text>
                  </View>
                  {SIZE_CLASSES.map((s) => (
                    <TextInput
                      key={s}
                      value={qty[p.id]?.[s] ?? ''}
                      onChangeText={(t) => setCell(p.id, s, t)}
                      placeholder="0"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="number-pad"
                      style={styles.qtyCell}
                      accessibilityLabel={`${SIZE_LABEL[s]} of ${p.name}`}
                    />
                  ))}
                </View>
              ))}

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total bottles</Text>
                <Text style={styles.totalValue}>{totals.bottles}</Text>
              </View>
            </>
          )}
        </View>

        {/* Notes */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notes</Text>
          <VoiceInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything worth recording about this delivery"
          />
        </View>

        <Button
          title={pendingChallanId ? 'Retry saving quantities' : 'Save challan'}
          spotlight
          loading={create.isPending}
          onPress={save}
          style={{ marginTop: Space.lg }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Layout.screenPad },
  help: { ...Type.body, color: Colors.textSecondary, textAlign: 'center' },
  camera: { flex: 1 },
  shutterBar: {
    padding: Layout.screenPad,
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: Colors.background,
  },
  shutterHint: { ...Type.caption, color: Colors.textSecondary, textAlign: 'center' },
  shutter: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spotlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: { opacity: 0.6 },

  body: { padding: Layout.screenPad, paddingBottom: Space.xxl },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Layout.cardPad,
    marginBottom: Space.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { ...Type.section, color: Colors.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { ...Type.label, color: Colors.accent },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: Radius.md,
    marginTop: Space.sm,
    backgroundColor: Colors.surfaceAlt,
  },

  value: { ...Type.body, color: Colors.text, marginTop: Space.xs },
  valueMissing: { color: Colors.textMuted },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: Layout.tap,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.sm,
    marginTop: Space.xs,
    backgroundColor: Colors.surfaceAlt,
  },
  pickRowActive: { borderWidth: 1, borderColor: Colors.accent },
  pickText: { ...Type.body, color: Colors.text, flex: 1 },

  chipRow: { flexDirection: 'row', gap: Space.sm, marginTop: Space.sm },
  chip: {
    paddingHorizontal: Space.md,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { ...Type.label, color: Colors.text },
  chipTextActive: { color: Colors.white },

  input: {
    ...Type.body,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.md,
    minHeight: Layout.tap,
    marginTop: Space.sm,
    backgroundColor: Colors.surfaceAlt,
  },
  inputError: { borderColor: Colors.alert },
  error: { ...Type.caption, color: Colors.alert, marginTop: Space.xs },
  hint: { ...Type.caption, color: Colors.textSecondary, marginTop: Space.xs },

  qtyHeadRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.md },
  qtyHeadName: { flex: 1 },
  qtyHead: {
    ...Type.label,
    color: Colors.textSecondary,
    width: 56,
    textAlign: 'center',
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: Space.sm,
  },
  qtyName: { flex: 1 },
  productName: { ...Type.bodyMed, color: Colors.text },
  productMeta: { ...Type.caption, color: Colors.textSecondary },
  qtyCell: {
    ...Type.body,
    color: Colors.text,
    width: 56,
    minHeight: Layout.tap,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Space.lg,
    paddingTop: Space.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  totalLabel: { ...Type.label, color: Colors.textSecondary },
  totalValue: { ...Type.section, color: Colors.text },
});
