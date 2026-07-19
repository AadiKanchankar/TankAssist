import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Alert } from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import StoreLocationPicker from '../../components/StoreLocationPicker';
import type { StoreLocationValue } from '../../components/StoreLocationPicker';

interface StoreParam {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  contact_person: string | null; // Store Manager Name
  contact_number: string | null;
  license_number: string | null;
  owner_name: string | null;
  state: string | null;
}

/**
 * Add / Edit Store form (manager-only). Pushed from the Stores list ("Add
 * Store", no param) and from Store Detail ("Edit Store", with `store`).
 * On save it navigates back; the list/detail refetch on focus.
 */
export default function StoreFormScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const editingStore: StoreParam | undefined = route.params?.store;
  const { profile } = useAuthStore();

  const [name, setName] = useState(editingStore?.name || '');
  const [storeLocation, setStoreLocation] = useState<StoreLocationValue>({
    latitude: editingStore?.latitude ?? null,
    longitude: editingStore?.longitude ?? null,
    address: editingStore?.address || '',
    state: editingStore?.state ?? null,
  });
  const [licenseNumber, setLicenseNumber] = useState(
    editingStore?.license_number || ''
  );
  const [storeManagerName, setStoreManagerName] = useState(
    editingStore?.contact_person || ''
  );
  const [contactNumber, setContactNumber] = useState(
    editingStore?.contact_number || ''
  );
  const [ownerName, setOwnerName] = useState(editingStore?.owner_name || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Store name is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        address: storeLocation.address.trim() || null,
        latitude: storeLocation.latitude,
        longitude: storeLocation.longitude,
        state: storeLocation.state,
        // contact_person carries the Store Manager Name (relabeled in UI)
        contact_person: storeManagerName.trim() || null,
        contact_number: contactNumber.trim() || null,
        license_number: licenseNumber.trim() || null,
        owner_name: ownerName.trim() || null,
      };

      if (editingStore) {
        const { error } = await supabase
          .from('stores')
          .update(payload)
          .eq('id', editingStore.id);
        if (error) throw error;
      } else {
        // RLS requires created_by_user_id = auth.uid() on INSERT
        const { error } = await supabase
          .from('stores')
          .insert({ ...payload, created_by_user_id: profile!.id });
        if (error) throw error;
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save store.');
    }
    setSaving(false);
  };

  return (
    <View style={styles.container}>
      <Header
        title={editingStore ? 'Edit Store' : 'Add Store'}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.fieldLabel}>NAME *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Store name"
          placeholderTextColor={Colors.muted}
        />

        <StoreLocationPicker value={storeLocation} onChange={setStoreLocation} />

        <Text style={styles.fieldLabel}>LICENSE NUMBER (OPTIONAL)</Text>
        <TextInput
          style={styles.input}
          value={licenseNumber}
          onChangeText={setLicenseNumber}
          placeholder="Store license number"
          placeholderTextColor={Colors.muted}
        />

        <Text style={styles.fieldLabel}>STORE MANAGER NAME</Text>
        <TextInput
          style={styles.input}
          value={storeManagerName}
          onChangeText={setStoreManagerName}
          placeholder="Store manager name"
          placeholderTextColor={Colors.muted}
        />

        <Text style={styles.fieldLabel}>CONTACT NUMBER</Text>
        <TextInput
          style={styles.input}
          value={contactNumber}
          onChangeText={setContactNumber}
          placeholder="Phone number"
          placeholderTextColor={Colors.muted}
          keyboardType="phone-pad"
        />

        <Text style={styles.fieldLabel}>OWNER NAME</Text>
        <TextInput
          style={styles.input}
          value={ownerName}
          onChangeText={setOwnerName}
          placeholder="Owner name"
          placeholderTextColor={Colors.muted}
        />

        <Button
          title={editingStore ? 'Update Store' : 'Create Store'}
          onPress={handleSave}
          loading={saving}
          style={styles.submitBtn}
        />
        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 24 },
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
});
