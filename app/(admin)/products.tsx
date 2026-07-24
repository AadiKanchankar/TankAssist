import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { supabase } from '../../lib/supabase';
import { uploadProductImage, getSignedUrls } from '../../lib/storage';
import { useAuthStore } from '../../store/useAuthStore';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useProducts, Product, caseConfig } from '../../hooks/useProducts';

const fmtPrice = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const UNIT_TYPES = ['Bottle', 'Can', 'Packet', 'Box', 'Pouch', 'Jar'];
const UOMS = ['ml', 'L', 'g', 'kg', 'pcs'];

interface FormState {
  name: string;
  brand: string;
  category: string;
  unitType: string;
  unitSize: string;
  uom: string;
  unitsPerCase: string;
  productCode: string;
  priceCase: string;
  priceBottle: string;
  gst: string;
  shelfLife: string;
  sku: string;
  barcode: string;
  hsn: string;
  imageUri: string | null; // freshly captured (local)
  imagePath: string | null; // existing/persisted storage path
  isActive: boolean;
  isOutOfStock: boolean;
}

const emptyForm = (): FormState => ({
  name: '', brand: '', category: '', unitType: '', unitSize: '', uom: '', unitsPerCase: '',
  productCode: '', priceCase: '', priceBottle: '', gst: '', shelfLife: '', sku: '', barcode: '',
  hsn: '', imageUri: null, imagePath: null, isActive: true, isOutOfStock: false,
});

const formFromProduct = (p: Product): FormState => ({
  name: p.name,
  brand: p.brand || '',
  category: p.category || '',
  unitType: p.unit_type || '',
  unitSize: p.unit_size != null ? String(p.unit_size) : '',
  uom: p.unit_of_measure || '',
  unitsPerCase: String(p.qty_per_carton),
  productCode: p.product_code || '',
  priceCase: p.price_per_case != null ? String(p.price_per_case) : '',
  priceBottle: p.price_per_bottle != null ? String(p.price_per_bottle) : '',
  gst: p.gst_percent != null ? String(p.gst_percent) : '',
  shelfLife: p.shelf_life_months != null ? String(p.shelf_life_months) : '',
  sku: p.sku || '',
  barcode: p.barcode || '',
  hsn: p.hsn_code || '',
  imageUri: null,
  imagePath: p.image_path,
  isActive: p.is_active,
  isOutOfStock: p.is_out_of_stock,
});

export default function ProductsScreen() {
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();
  const { data, refetch, isPending, isError } = useProducts();
  const products = data ?? [];
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingOos, setTogglingOos] = useState<string | null>(null);

  // Camera (product image capture — reuses the existing capture pattern, no gallery dep)
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const cameraRef = React.useRef<CameraView>(null);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Sign image thumbnails for the list.
  useEffect(() => {
    const paths = products.map((p) => p.image_path).filter((p): p is string => !!p);
    if (paths.length === 0) { setThumbs({}); return; }
    getSignedUrls(paths).then(setThumbs);
  }, [products]);

  const sections = useMemo(() => {
    const active = products.filter((p) => p.is_active);
    const archived = products.filter((p) => !p.is_active);
    const secs: { title: string; collapsible: boolean; count: number; data: Product[] }[] = [
      { title: 'Active', collapsible: false, count: active.length, data: active },
    ];
    if (archived.length) {
      secs.push({ title: 'Archived', collapsible: true, count: archived.length, data: archivedExpanded ? archived : [] });
    }
    return secs;
  }, [products, archivedExpanded]);

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setErrors({}); setStep(1); setShowModal(true); };
  const openEdit = (p: Product) => { setEditing(p); setForm(formFromProduct(p)); setErrors({}); setStep(1); setShowModal(true); };

  // Quick OOS toggle straight from the list row (management-only RLS).
  const toggleOos = async (p: Product) => {
    setTogglingOos(p.id);
    const { error } = await supabase.from('products').update({ is_out_of_stock: !p.is_out_of_stock }).eq('id', p.id);
    setTogglingOos(null);
    if (error) { Alert.alert('Couldn’t update', error.message || 'Try again.'); return; }
    await refetch();
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required.';
    const upc = parseInt(form.unitsPerCase, 10);
    if (!Number.isFinite(upc) || upc <= 0) e.unitsPerCase = 'Enter units per case (a whole number > 0).';
    if (form.unitSize.trim() && !Number.isFinite(Number(form.unitSize.trim()))) e.unitSize = 'Must be a number.';
    if (form.priceCase.trim() && !Number.isFinite(Number(form.priceCase.trim()))) e.priceCase = 'Must be a number.';
    if (form.priceBottle.trim() && !Number.isFinite(Number(form.priceBottle.trim()))) e.priceBottle = 'Must be a number.';
    if (form.gst.trim() && !Number.isFinite(Number(form.gst.trim()))) e.gst = 'Must be a number.';
    if (form.shelfLife.trim() && !Number.isFinite(Number(form.shelfLife.trim()))) e.shelfLife = 'Must be a whole number.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const numOrNull = (s: string) => (s.trim() ? Number(s.trim()) : null);
  const intOrNull = (s: string) => (s.trim() ? parseInt(s.trim(), 10) : null);
  const strOrNull = (s: string) => (s.trim() ? s.trim() : null);

  const handleSave = async () => {
    if (!validate()) {
      // Jump to the step holding the first error so it's visible.
      if (errors.name) setStep(1);
      else if (errors.unitsPerCase || errors.unitSize) setStep(2);
      else setStep(3);
      return;
    }
    setSaving(true);
    try {
      // Legacy `unit` (NOT NULL) is derived from the structured fields so it never drifts.
      const derivedUnit =
        form.unitSize.trim() && form.uom
          ? `${form.unitSize.trim()} ${form.uom}`
          : form.uom || form.unitType || 'unit';

      let imagePath = form.imagePath;
      if (form.imageUri) imagePath = await uploadProductImage(form.imageUri);

      const payload = {
        name: form.name.trim(),
        unit: derivedUnit,
        qty_per_carton: parseInt(form.unitsPerCase, 10),
        product_code: strOrNull(form.productCode),
        price_per_case: numOrNull(form.priceCase),
        price_per_bottle: numOrNull(form.priceBottle),
        brand: strOrNull(form.brand),
        category: strOrNull(form.category),
        unit_type: strOrNull(form.unitType),
        unit_size: numOrNull(form.unitSize),
        unit_of_measure: strOrNull(form.uom),
        gst_percent: numOrNull(form.gst),
        shelf_life_months: intOrNull(form.shelfLife),
        sku: strOrNull(form.sku),
        barcode: strOrNull(form.barcode),
        hsn_code: strOrNull(form.hsn),
        image_path: imagePath,
        is_out_of_stock: form.isOutOfStock,
      };

      if (editing) {
        const { error } = await supabase.from('products').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('products').insert({ ...payload, created_by: profile?.id, is_active: true });
        if (error) throw error;
      }
      setShowModal(false);
      await refetch();
    } catch (err: any) {
      Alert.alert('Couldn’t save the product', err.message || 'Try again.');
    }
    setSaving(false);
  };

  const handleArchiveToggle = () => {
    if (!editing) return;
    const archiving = editing.is_active;
    Alert.alert(
      archiving ? 'Archive product' : 'Unarchive product',
      archiving
        ? `${editing.name} will be hidden from new orders and stock entry. Existing orders keep referencing it.`
        : `${editing.name} will be available again for new orders and stock entry.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: archiving ? 'Archive' : 'Unarchive',
          style: archiving ? 'destructive' : 'default',
          onPress: async () => {
            const { error } = await supabase.from('products').update({ is_active: !archiving }).eq('id', editing.id);
            if (error) { Alert.alert('Couldn’t update', error.message || 'Try again.'); return; }
            setShowModal(false);
            await refetch();
          },
        },
      ]
    );
  };

  const openCamera = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { Alert.alert('Camera needed', 'Camera permission is required to add a product photo.'); return; }
    }
    setCapturing(true);
  };
  const takePhoto = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (photo) set({ imageUri: photo.uri });
    setCapturing(false);
  };

  const livePreview = caseConfig({
    qty_per_carton: parseInt(form.unitsPerCase, 10) || 0,
    unit_size: form.unitSize.trim() ? Number(form.unitSize.trim()) : null,
    unit_of_measure: form.uom || null,
    unit: '',
  });

  return (
    <View style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + Space.md }]}>
        <Text style={[Type.title, { color: Colors.text, marginBottom: Space.md }]}>Products</Text>
        <Button title="Add product" spotlight onPress={openAdd} />
      </View>

      {isPending && !data ? (
        <ListSkeleton />
      ) : isError && !data ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: Layout.tabBar + insets.bottom + Space.md }]}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderSectionHeader={({ section }) =>
            section.collapsible ? (
              <Pressable style={styles.sectionHeaderRow} onPress={() => setArchivedExpanded((v) => !v)}>
                <Text style={[Type.section, { color: Colors.text }]}>{section.title} ({section.count})</Text>
                <Ionicons name={archivedExpanded ? 'chevron-down' : 'chevron-forward'} size={16} color={Colors.textMuted} />
              </Pressable>
            ) : (
              <Text style={[Type.section, styles.sectionHeaderPlain]}>{section.title} ({section.count})</Text>
            )
          }
          renderItem={({ item }) => {
            const price =
              item.price_per_case != null
                ? `${fmtPrice(item.price_per_case)}/case`
                : item.price_per_bottle != null
                ? `${fmtPrice(item.price_per_bottle)}/bottle`
                : '';
            return (
              <View style={styles.rowWrap}>
                <BentoTile style={!item.is_active ? styles.inactiveCard : undefined}>
                  <View style={styles.row}>
                    <Pressable style={styles.rowMain} onPress={() => openEdit(item)} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}>
                      {thumbs[item.image_path ?? ''] ? (
                        <Image source={{ uri: thumbs[item.image_path as string] }} style={styles.thumb} />
                      ) : (
                        <View style={[styles.thumb, styles.thumbEmpty]}>
                          <Ionicons name="cube-outline" size={20} color={Colors.textMuted} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>{item.name}</Text>
                        <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
                          {[item.brand, caseConfig(item)].filter(Boolean).join(' · ') || item.unit}
                        </Text>
                        <View style={styles.tagRow}>
                          {price ? <Text style={[Type.caption, { color: Colors.text }]}>{price}</Text> : null}
                          {item.is_out_of_stock && item.is_active ? (
                            <Text style={styles.oosTag}>Out of stock</Text>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>

                    {/* Quick OOS toggle — active products only; visually distinct (amber) from Archive. */}
                    {item.is_active && (
                      <Pressable
                        onPress={() => toggleOos(item)}
                        disabled={togglingOos === item.id}
                        style={[styles.oosBtn, item.is_out_of_stock && styles.oosBtnActive]}
                        accessibilityRole="button"
                        accessibilityLabel={item.is_out_of_stock ? `Mark ${item.name} in stock` : `Mark ${item.name} out of stock`}
                      >
                        <Ionicons
                          name={item.is_out_of_stock ? 'refresh' : 'close-circle-outline'}
                          size={16}
                          color={item.is_out_of_stock ? Colors.onSpotlight : Colors.warning}
                        />
                        <Text style={[styles.oosBtnText, item.is_out_of_stock && { color: Colors.onSpotlight }]}>
                          {item.is_out_of_stock ? 'In stock' : 'Out of stock'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </BentoTile>
              </View>
            );
          }}
          renderSectionFooter={({ section }) =>
            section.title === 'Active' && section.count === 0 ? (
              <EmptyState icon="cube-outline" title="No active products" message="Add your first product to start taking orders." actionLabel="Add product" onAction={openAdd} />
            ) : null
          }
        />
      )}

      {/* Add/Edit — 3-step wizard */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalContainer}>
          {capturing ? (
            <>
              <Header title="Product photo" onBack={() => setCapturing(false)} />
              <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
              <View style={styles.cameraActions}>
                <Button title="Capture" onPress={takePhoto} style={{ flex: 1 }} />
                <Button title="Cancel" onPress={() => setCapturing(false)} variant="secondary" style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <>
              <Header
                title={editing ? 'Edit product' : 'Add product'}
                onBack={step > 1 ? () => setStep((s) => (s - 1) as 1 | 2 | 3) : () => setShowModal(false)}
              />
              <View style={styles.stepper}>
                <View style={styles.stepTrack}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={[styles.stepSeg, { backgroundColor: i <= step ? Colors.accent : Colors.border }]} />
                  ))}
                </View>
                <Text style={[Type.label, { color: Colors.text }]}>
                  Step {step} of 3 · {step === 1 ? 'Basic info' : step === 2 ? 'Packaging' : 'Commercial & availability'}
                </Text>
              </View>

              <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
                {step === 1 && (
                  <>
                    <Field label="Name" error={errors.name}>
                      <TextInput style={[styles.input, errors.name && styles.inputError]} value={form.name}
                        onChangeText={(t) => { set({ name: t }); if (errors.name) setErrors((e) => ({ ...e, name: '' })); }}
                        placeholder="Product name" placeholderTextColor={Colors.textMuted} />
                    </Field>
                    <Field label="Brand (optional)">
                      <TextInput style={styles.input} value={form.brand} onChangeText={(t) => set({ brand: t })}
                        placeholder="Brand" placeholderTextColor={Colors.textMuted} />
                    </Field>
                    <Field label="Category (optional)">
                      <TextInput style={styles.input} value={form.category} onChangeText={(t) => set({ category: t })}
                        placeholder="e.g. Whisky, Snacks" placeholderTextColor={Colors.textMuted} />
                    </Field>
                    <Field label="Photo (optional)">
                      {form.imageUri || (form.imagePath && thumbs[form.imagePath]) ? (
                        <View style={styles.imageRow}>
                          <Image source={{ uri: form.imageUri ?? thumbs[form.imagePath as string] }} style={styles.imagePreview} />
                          <Button title="Retake" onPress={openCamera} variant="secondary" style={{ flex: 1 }} />
                        </View>
                      ) : (
                        <Pressable style={styles.captureCard} onPress={openCamera} accessibilityRole="button" accessibilityLabel="Add product photo">
                          <Ionicons name="camera-outline" size={24} color={Colors.accent} />
                          <Text style={[Type.label, { color: Colors.accent }]}>Take photo</Text>
                        </Pressable>
                      )}
                    </Field>
                  </>
                )}

                {step === 2 && (
                  <>
                    <Field label="Unit type (optional)">
                      <Picker options={UNIT_TYPES} value={form.unitType} onSelect={(v) => set({ unitType: v })} />
                    </Field>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <Field label="Unit size (optional)" error={errors.unitSize}>
                          <TextInput style={[styles.input, errors.unitSize && styles.inputError]} value={form.unitSize}
                            onChangeText={(t) => { set({ unitSize: t }); if (errors.unitSize) setErrors((e) => ({ ...e, unitSize: '' })); }}
                            placeholder="e.g. 180" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
                        </Field>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field label="Measure">
                          <Picker options={UOMS} value={form.uom} onSelect={(v) => set({ uom: v })} />
                        </Field>
                      </View>
                    </View>
                    <Field label="Units per case" error={errors.unitsPerCase}>
                      <TextInput style={[styles.input, errors.unitsPerCase && styles.inputError]} value={form.unitsPerCase}
                        onChangeText={(t) => { set({ unitsPerCase: t }); if (errors.unitsPerCase) setErrors((e) => ({ ...e, unitsPerCase: '' })); }}
                        placeholder="e.g. 24" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" />
                    </Field>
                    {livePreview ? (
                      <View style={styles.previewCard}>
                        <Text style={[Type.label, { color: Colors.textMuted }]}>Case config</Text>
                        <Text style={[Type.section, { color: Colors.text, marginTop: 2 }]}>{livePreview}</Text>
                      </View>
                    ) : null}
                  </>
                )}

                {step === 3 && (
                  <>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <Field label="Price / case (optional)" error={errors.priceCase}>
                          <TextInput style={[styles.input, errors.priceCase && styles.inputError]} value={form.priceCase}
                            onChangeText={(t) => { set({ priceCase: t }); if (errors.priceCase) setErrors((e) => ({ ...e, priceCase: '' })); }}
                            placeholder="₹ per case" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
                        </Field>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field label="Price / bottle (optional)" error={errors.priceBottle}>
                          <TextInput style={[styles.input, errors.priceBottle && styles.inputError]} value={form.priceBottle}
                            onChangeText={(t) => { set({ priceBottle: t }); if (errors.priceBottle) setErrors((e) => ({ ...e, priceBottle: '' })); }}
                            placeholder="₹ per bottle" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
                        </Field>
                      </View>
                    </View>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <Field label="GST % (optional)" error={errors.gst}>
                          <TextInput style={[styles.input, errors.gst && styles.inputError]} value={form.gst}
                            onChangeText={(t) => { set({ gst: t }); if (errors.gst) setErrors((e) => ({ ...e, gst: '' })); }}
                            placeholder="e.g. 18" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
                        </Field>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field label="Shelf life (months)" error={errors.shelfLife}>
                          <TextInput style={[styles.input, errors.shelfLife && styles.inputError]} value={form.shelfLife}
                            onChangeText={(t) => { set({ shelfLife: t }); if (errors.shelfLife) setErrors((e) => ({ ...e, shelfLife: '' })); }}
                            placeholder="e.g. 12" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" />
                        </Field>
                      </View>
                    </View>
                    <Field label="SKU (optional)">
                      <TextInput style={styles.input} value={form.sku} onChangeText={(t) => set({ sku: t })} placeholder="SKU" placeholderTextColor={Colors.textMuted} autoCapitalize="characters" />
                    </Field>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <Field label="Barcode (optional)">
                          <TextInput style={styles.input} value={form.barcode} onChangeText={(t) => set({ barcode: t })} placeholder="Barcode" placeholderTextColor={Colors.textMuted} />
                        </Field>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field label="HSN (optional)">
                          <TextInput style={styles.input} value={form.hsn} onChangeText={(t) => set({ hsn: t })} placeholder="HSN code" placeholderTextColor={Colors.textMuted} />
                        </Field>
                      </View>
                    </View>

                    {/* Availability — OOS toggle, distinct from Archive below */}
                    <View style={styles.availRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[Type.bodyMed, { color: Colors.text }]}>Out of stock</Text>
                        <Text style={[Type.caption, { color: Colors.textMuted }]}>Temporarily unsellable everywhere; still a live SKU.</Text>
                      </View>
                      <Pressable
                        onPress={() => set({ isOutOfStock: !form.isOutOfStock })}
                        style={[styles.switch, form.isOutOfStock && styles.switchOn]}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: form.isOutOfStock }}
                        accessibilityLabel="Out of stock"
                      >
                        <View style={[styles.knob, form.isOutOfStock && styles.knobOn]} />
                      </Pressable>
                    </View>
                  </>
                )}
              </ScrollView>

              <View style={styles.modalFooter}>
                {step < 3 ? (
                  <Button title="Next" spotlight onPress={() => setStep((s) => (s + 1) as 1 | 2 | 3)} />
                ) : (
                  <>
                    <Button title={editing ? 'Save changes' : 'Create product'} spotlight onPress={handleSave} loading={saving} />
                    {editing ? (
                      <Button
                        title={editing.is_active ? 'Archive product' : 'Unarchive product'}
                        onPress={handleArchiveToggle}
                        variant={editing.is_active ? 'danger' : 'secondary'}
                        style={{ marginTop: Space.sm }}
                      />
                    ) : null}
                  </>
                )}
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function Picker({ options, value, onSelect }: { options: string[]; value: string; onSelect: (v: string) => void }) {
  return (
    <View style={styles.pickerWrap}>
      {options.map((o) => {
        const active = value === o;
        return (
          <Pressable key={o} onPress={() => onSelect(active ? '' : o)} style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={o}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.sm },
  list: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.md, marginBottom: Space.sm, minHeight: Layout.tap },
  sectionHeaderPlain: { color: Colors.text, marginTop: Space.sm, marginBottom: Space.sm },
  inactiveCard: { opacity: 0.6 },
  rowWrap: { marginBottom: Space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  thumb: { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: 2, flexWrap: 'wrap' },
  oosTag: { ...Type.caption, fontWeight: '700', color: Colors.warning, borderWidth: 1, borderColor: Colors.warning, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  oosBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: Colors.warning, borderRadius: Radius.pill, paddingHorizontal: Space.sm, minHeight: 36, justifyContent: 'center' },
  oosBtnActive: { backgroundColor: Colors.spotlight, borderColor: Colors.spotlight },
  oosBtnText: { ...Type.caption, fontWeight: '700', color: Colors.warning },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  stepper: { paddingHorizontal: Layout.screenPad, paddingVertical: Space.md, gap: Space.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  stepTrack: { flexDirection: 'row', gap: 4 },
  stepSeg: { flex: 1, height: 5, borderRadius: Radius.pill },
  modalContent: { padding: Layout.screenPad, paddingBottom: Space.xxl },
  modalFooter: { padding: Layout.screenPad, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
  field: { marginTop: Space.lg },
  fieldLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  input: { ...Type.body, color: Colors.text, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Space.lg, paddingVertical: Space.md },
  inputError: { borderColor: Colors.alert },
  errorText: { ...Type.caption, color: Colors.alert, marginTop: Space.xs },
  twoCol: { flexDirection: 'row', gap: Space.md },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.pill, paddingHorizontal: Space.md, minHeight: Layout.tap, justifyContent: 'center', backgroundColor: Colors.surface },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  chipText: { ...Type.label, color: Colors.text },
  chipTextActive: { color: Colors.white },
  previewCard: { marginTop: Space.lg, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.md, padding: Space.md, borderWidth: 1, borderColor: Colors.border },
  captureCard: { borderWidth: 1.5, borderColor: Colors.borderStrong, borderStyle: 'dashed', borderRadius: Radius.md, paddingVertical: Space.xl, alignItems: 'center', gap: Space.xs },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  imagePreview: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  cameraActions: { flexDirection: 'row', gap: Space.sm, padding: Space.lg, backgroundColor: Colors.background },
  availRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: Space.xl },
  switch: { width: 48, height: 28, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.warning },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.white, alignSelf: 'flex-start' },
  knobOn: { alignSelf: 'flex-end' },
});
