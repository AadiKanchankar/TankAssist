import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
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
 * store", no param) and from Store Detail ("Edit store", with `store`).
 * On save it navigates back; the list/detail refetch on focus.
 */
export default function StoreFormScreen({ route, navigation }: { route: any; navigation: any }) {
  const editingStore: StoreParam | undefined = route.params?.store;
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(editingStore?.name || '');
  const [nameError, setNameError] = useState('');
  const [storeLocation, setStoreLocation] = useState<StoreLocationValue>({
    latitude: editingStore?.latitude ?? null,
    longitude: editingStore?.longitude ?? null,
    address: editingStore?.address || '',
    state: editingStore?.state ?? null,
  });
  const [licenseNumber, setLicenseNumber] = useState(editingStore?.license_number || '');
  const [storeManagerName, setStoreManagerName] = useState(editingStore?.contact_person || '');
  const [contactNumber, setContactNumber] = useState(editingStore?.contact_number || '');
  const [ownerName, setOwnerName] = useState(editingStore?.owner_name || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError('Store name is required.');
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
        const { error } = await supabase.from('stores').update(payload).eq('id', editingStore.id);
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
      Alert.alert('Couldn’t save the store', err.message || 'Try again.');
    }
    setSaving(false);
  };

  return (
    <View style={styles.container}>
      <Header title={editingStore ? 'Edit store' : 'Add store'} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Layout.tabBar + insets.bottom + Space.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Field label="Name" required>
            <TextInput
              style={[styles.input, nameError ? styles.inputError : null]}
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (nameError) setNameError('');
              }}
              placeholder="Store name"
              placeholderTextColor={Colors.textMuted}
            />
          </Field>
          {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}

          <StoreLocationPicker value={storeLocation} onChange={setStoreLocation} />

          <Field label="License number (optional)">
            <TextInput
              style={styles.input}
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              placeholder="Store license number"
              placeholderTextColor={Colors.textMuted}
            />
          </Field>

          <Field label="Store manager name">
            <TextInput
              style={styles.input}
              value={storeManagerName}
              onChangeText={setStoreManagerName}
              placeholder="Store manager name"
              placeholderTextColor={Colors.textMuted}
            />
          </Field>

          <Field label="Contact number">
            <TextInput
              style={styles.input}
              value={contactNumber}
              onChangeText={setContactNumber}
              placeholder="Phone number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="Owner name">
            <TextInput
              style={styles.input}
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="Owner name"
              placeholderTextColor={Colors.textMuted}
            />
          </Field>

          <Button
            title={editingStore ? 'Update store' : 'Create store'}
            spotlight
            onPress={handleSave}
            loading={saving}
            style={{ marginTop: Space.xl }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { padding: Layout.screenPad },
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
