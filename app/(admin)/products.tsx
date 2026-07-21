import React, { useState, useCallback, useMemo } from 'react';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useProducts, Product } from '../../hooks/useProducts';

const fmtPrice = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function ProductsScreen() {
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();
  const { data, refetch, isPending, isError } = useProducts();
  const products = data ?? [];
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  // Add/Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [qty, setQty] = useState('');
  const [code, setCode] = useState('');
  const [priceCase, setPriceCase] = useState('');
  const [priceBottle, setPriceBottle] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const sections = useMemo(() => {
    const active = products.filter((p) => p.is_active);
    const archived = products.filter((p) => !p.is_active);
    const secs: { title: string; collapsible: boolean; count: number; data: Product[] }[] = [
      { title: 'Active', collapsible: false, count: active.length, data: active },
    ];
    if (archived.length) {
      secs.push({
        title: 'Archived',
        collapsible: true,
        count: archived.length,
        data: archivedExpanded ? archived : [],
      });
    }
    return secs;
  }, [products, archivedExpanded]);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setUnit('');
    setQty('');
    setCode('');
    setPriceCase('');
    setPriceBottle('');
    setErrors({});
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setName(p.name);
    setUnit(p.unit);
    setQty(String(p.qty_per_carton));
    setCode(p.product_code || '');
    setPriceCase(p.price_per_case != null ? String(p.price_per_case) : '');
    setPriceBottle(p.price_per_bottle != null ? String(p.price_per_bottle) : '');
    setErrors({});
    setShowModal(true);
  };

  const handleSave = async () => {
    const n = name.trim();
    const u = unit.trim();
    const errs: Record<string, string> = {};
    if (!n) errs.name = 'Name is required.';
    if (!u) errs.unit = 'Unit is required.';
    const qtyNum = parseInt(qty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) errs.qty = 'Enter a whole number greater than 0.';
    if (priceCase.trim() && !Number.isFinite(Number(priceCase.trim()))) errs.priceCase = 'Must be a number.';
    if (priceBottle.trim() && !Number.isFinite(Number(priceBottle.trim()))) errs.priceBottle = 'Must be a number.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    const payload = {
      name: n,
      unit: u,
      qty_per_carton: qtyNum,
      product_code: code.trim() || null,
      price_per_case: priceCase.trim() ? Number(priceCase.trim()) : null,
      price_per_bottle: priceBottle.trim() ? Number(priceBottle.trim()) : null,
    };
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from('products').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('products')
          .insert({ ...payload, created_by: profile?.id, is_active: true });
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
            const { error } = await supabase
              .from('products')
              .update({ is_active: !archiving })
              .eq('id', editing.id);
            if (error) {
              Alert.alert('Couldn’t update', error.message || 'Try again.');
              return;
            }
            setShowModal(false);
            await refetch();
          },
        },
      ]
    );
  };

  const metaLine = (p: Product) => {
    const parts = [`${p.qty_per_carton} ${p.unit}/carton`];
    if (p.product_code) parts.push(`Code ${p.product_code}`);
    return parts.join(' · ');
  };
  const priceLine = (p: Product) => {
    const parts: string[] = [];
    if (p.price_per_case != null) parts.push(`${fmtPrice(p.price_per_case)}/case`);
    if (p.price_per_bottle != null) parts.push(`${fmtPrice(p.price_per_bottle)}/bottle`);
    return parts.join(' · ');
  };

  return (
    <View style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + Space.md }]}>
        <Text style={[Type.title, { color: Colors.text, marginBottom: Space.md }]}>Products</Text>
        {/* Spotlight = Add product */}
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
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Layout.tabBar + insets.bottom + Space.md },
          ]}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderSectionHeader={({ section }) =>
            section.collapsible ? (
              <Pressable style={styles.sectionHeaderRow} onPress={() => setArchivedExpanded((v) => !v)}>
                <Text style={[Type.section, { color: Colors.text }]}>
                  {section.title} ({section.count})
                </Text>
                <Ionicons
                  name={archivedExpanded ? 'chevron-down' : 'chevron-forward'}
                  size={16}
                  color={Colors.textMuted}
                />
              </Pressable>
            ) : (
              <Text style={[Type.section, styles.sectionHeaderPlain]}>
                {section.title} ({section.count})
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => openEdit(item)} style={styles.rowWrap}>
              <BentoTile style={item.is_active ? undefined : styles.inactiveCard}>
                <Text style={[Type.bodyMed, { color: Colors.text }]}>{item.name}</Text>
                <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>{metaLine(item)}</Text>
                {priceLine(item) ? (
                  <Text style={[Type.caption, { color: Colors.text, marginTop: 2 }]}>{priceLine(item)}</Text>
                ) : null}
              </BentoTile>
            </Pressable>
          )}
          renderSectionFooter={({ section }) =>
            section.title === 'Active' && section.count === 0 ? (
              <EmptyState
                icon="cube-outline"
                title="No active products"
                message="Add your first product to start taking orders."
                actionLabel="Add product"
                onAction={openAdd}
              />
            ) : null
          }
        />
      )}

      {/* Add/Edit modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalContainer}>
          <Header title={editing ? 'Edit product' : 'Add product'} onBack={() => setShowModal(false)} />
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <ProductField label="Name" error={errors.name}>
              <TextInput
                style={[styles.input, errors.name && styles.inputError]}
                value={name}
                onChangeText={(t) => { setName(t); if (errors.name) setErrors((e) => ({ ...e, name: '' })); }}
                placeholder="Product name"
                placeholderTextColor={Colors.textMuted}
              />
            </ProductField>

            <ProductField label="Unit" error={errors.unit}>
              <TextInput
                style={[styles.input, errors.unit && styles.inputError]}
                value={unit}
                onChangeText={(t) => { setUnit(t); if (errors.unit) setErrors((e) => ({ ...e, unit: '' })); }}
                placeholder="e.g. ml, kg, pieces"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
              />
            </ProductField>

            <ProductField label="Qty per carton" error={errors.qty}>
              <TextInput
                style={[styles.input, errors.qty && styles.inputError]}
                value={qty}
                onChangeText={(t) => { setQty(t); if (errors.qty) setErrors((e) => ({ ...e, qty: '' })); }}
                placeholder="e.g. 12"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
              />
            </ProductField>

            <ProductField label="Product code (optional)">
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="SKU / code"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
              />
            </ProductField>

            <ProductField label="Price per case (optional)" error={errors.priceCase}>
              <TextInput
                style={[styles.input, errors.priceCase && styles.inputError]}
                value={priceCase}
                onChangeText={(t) => { setPriceCase(t); if (errors.priceCase) setErrors((e) => ({ ...e, priceCase: '' })); }}
                placeholder="₹ per case"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </ProductField>

            <ProductField label="Price per bottle (optional)" error={errors.priceBottle}>
              <TextInput
                style={[styles.input, errors.priceBottle && styles.inputError]}
                value={priceBottle}
                onChangeText={(t) => { setPriceBottle(t); if (errors.priceBottle) setErrors((e) => ({ ...e, priceBottle: '' })); }}
                placeholder="₹ per bottle"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </ProductField>

            <Button
              title={editing ? 'Save changes' : 'Create product'}
              spotlight
              onPress={handleSave}
              loading={saving}
              style={{ marginTop: Space.xl }}
            />

            {editing ? (
              <Button
                title={editing.is_active ? 'Archive product' : 'Unarchive product'}
                onPress={handleArchiveToggle}
                variant={editing.is_active ? 'danger' : 'secondary'}
                style={{ marginTop: Space.md }}
              />
            ) : null}
            <View style={{ height: Space.xxl }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function ProductField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.sm },
  list: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Space.md,
    marginBottom: Space.sm,
    minHeight: Layout.tap,
  },
  sectionHeaderPlain: { color: Colors.text, marginTop: Space.sm, marginBottom: Space.sm },
  inactiveCard: { opacity: 0.6 },
  rowWrap: { marginBottom: Space.md },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalContent: { padding: Layout.screenPad },
  field: { marginTop: Space.lg },
  fieldLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  input: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  inputError: { borderColor: Colors.alert },
  errorText: { ...Type.caption, color: Colors.alert, marginTop: Space.xs },
});
