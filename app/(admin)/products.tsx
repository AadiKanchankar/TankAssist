import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

interface Product {
  id: string;
  name: string;
  unit: string;
  qty_per_carton: number;
  product_code: string | null;
  price_per_case: number | null;
  price_per_bottle: number | null;
  is_active: boolean;
}

const fmtPrice = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function ProductsScreen() {
  const { profile } = useAuthStore();
  const [products, setProducts] = useState<Product[]>([]);
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

  const load = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').order('name');
    setProducts((data as Product[]) || []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const { refreshing, onRefresh } = usePullToRefresh(load);

  const sections = useMemo(() => {
    const active = products.filter((p) => p.is_active);
    const archived = products.filter((p) => !p.is_active);
    const secs: {
      title: string;
      collapsible: boolean;
      count: number;
      data: Product[];
    }[] = [{ title: 'Active', collapsible: false, count: active.length, data: active }];
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
    setShowModal(true);
  };

  const handleSave = async () => {
    const n = name.trim();
    const u = unit.trim();
    if (!n || !u) {
      Alert.alert('Error', 'Name and unit are required.');
      return;
    }
    const qtyNum = parseInt(qty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      Alert.alert('Error', 'Qty per carton must be a whole number greater than 0.');
      return;
    }
    if (priceCase.trim() && !Number.isFinite(Number(priceCase.trim()))) {
      Alert.alert('Error', 'Price per case must be a number.');
      return;
    }
    if (priceBottle.trim() && !Number.isFinite(Number(priceBottle.trim()))) {
      Alert.alert('Error', 'Price per bottle must be a number.');
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
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('products')
          .insert({ ...payload, created_by: profile?.id, is_active: true });
        if (error) throw error;
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save product.');
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
              Alert.alert('Error', error.message || 'Update failed.');
              return;
            }
            setShowModal(false);
            await load();
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
    if (p.price_per_bottle != null)
      parts.push(`${fmtPrice(p.price_per_bottle)}/bottle`);
    return parts.join(' · ');
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerPad}>
        <Text style={styles.title}>Products</Text>
        <Button title="+ Add Product" onPress={openAdd} style={styles.addBtn} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderSectionHeader={({ section }) =>
          section.collapsible ? (
            <TouchableOpacity
              style={styles.sectionHeaderRow}
              onPress={() => setArchivedExpanded((v) => !v)}
            >
              <Text style={styles.sectionHeader}>
                {section.title} ({section.count})
              </Text>
              <Ionicons
                name={archivedExpanded ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color={Colors.muted}
              />
            </TouchableOpacity>
          ) : (
            <Text style={styles.sectionHeaderPlain}>
              {section.title} ({section.count})
            </Text>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => openEdit(item)}>
            <Card style={item.is_active ? undefined : styles.inactiveCard}>
              <Text style={styles.productName}>{item.name}</Text>
              <Text style={styles.productMeta}>{metaLine(item)}</Text>
              {priceLine(item) ? (
                <Text style={styles.productPrice}>{priceLine(item)}</Text>
              ) : null}
              <Text style={styles.tapHint}>Tap to edit →</Text>
            </Card>
          </TouchableOpacity>
        )}
        renderSectionFooter={({ section }) =>
          section.title === 'Active' && section.count === 0 ? (
            <Card>
              <Text style={styles.emptyText}>
                No active products. Add one to get started.
              </Text>
            </Card>
          ) : null
        }
      />

      {/* Add/Edit Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalContainer}>
          <Header
            title={editing ? 'Edit Product' : 'Add Product'}
            onBack={() => setShowModal(false)}
          />
          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Product name"
              placeholderTextColor={Colors.muted}
            />

            <Text style={styles.fieldLabel}>UNIT</Text>
            <TextInput
              style={styles.input}
              value={unit}
              onChangeText={setUnit}
              placeholder="e.g. ml, kg, pieces"
              placeholderTextColor={Colors.muted}
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>QTY PER CARTON</Text>
            <TextInput
              style={styles.input}
              value={qty}
              onChangeText={setQty}
              placeholder="e.g. 12"
              placeholderTextColor={Colors.muted}
              keyboardType="number-pad"
            />

            <Text style={styles.fieldLabel}>PRODUCT CODE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="SKU / code"
              placeholderTextColor={Colors.muted}
              autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>PRICE PER CASE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={priceCase}
              onChangeText={setPriceCase}
              placeholder="₹ per case"
              placeholderTextColor={Colors.muted}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>PRICE PER BOTTLE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={priceBottle}
              onChangeText={setPriceBottle}
              placeholder="₹ per bottle"
              placeholderTextColor={Colors.muted}
              keyboardType="decimal-pad"
            />

            <Button
              title={editing ? 'Save Changes' : 'Create Product'}
              onPress={handleSave}
              loading={saving}
              style={styles.submitBtn}
            />

            {editing ? (
              <Button
                title={editing.is_active ? 'Archive Product' : 'Unarchive Product'}
                onPress={handleArchiveToggle}
                variant={editing.is_active ? 'danger' : 'secondary'}
                style={styles.archiveBtn}
              />
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 8 },
  title: {
    fontFamily: Typography.fontFamily,
    ...Typography.pageTitle,
    color: Colors.text,
    marginBottom: 12,
  },
  addBtn: { marginBottom: 8 },
  list: { paddingHorizontal: 24, paddingBottom: 24 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 4,
  },
  sectionHeader: {
    fontFamily: Typography.fontFamily,
    ...Typography.accordionHeader,
    color: Colors.text,
  },
  sectionHeaderPlain: {
    fontFamily: Typography.fontFamily,
    ...Typography.accordionHeader,
    color: Colors.text,
    marginTop: 8,
    marginBottom: 8,
  },
  inactiveCard: { opacity: 0.6 },
  productName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  productMeta: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 2,
  },
  productPrice: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.text,
    marginTop: 2,
  },
  tapHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.accent,
    marginTop: 8,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalContent: { padding: 24 },
  fieldLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  submitBtn: { marginTop: 32 },
  archiveBtn: { marginTop: 12 },
});
