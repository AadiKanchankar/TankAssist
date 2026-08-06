import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius } from '../constants/colors';
import Header from './Header';
import Button from './Button';
import StoreLocationPicker from './StoreLocationPicker';
import type { StoreLocationValue } from './StoreLocationPicker';
import { supabase } from '../lib/supabase';
import { haversineKm } from '../lib/haversine';
import { findDuplicateCandidates, DuplicateMatch } from '../lib/journeyPlan';

export interface CreatedStore {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  visible: boolean;
  /** Prefills the name — usually whatever the rep just searched for. */
  initialName?: string;
  createdByUserId: string;
  onClose: () => void;
  /**
   * Fired with the store the rep ended up with — either the one just created,
   * or an existing store they picked out of the duplicate prompt. Callers
   * decide what to do next (check in, add to a plan, ...).
   */
  onResolved: (store: CreatedStore) => void;
}

const emptyLocation: StoreLocationValue = {
  latitude: null,
  longitude: null,
  address: '',
  state: null,
};

/**
 * Add-store form with the anti-duplicate check built in.
 *
 * Shared by the rep dashboard and the plan screen ON PURPOSE: adding a store
 * from a journey plan must not become a backdoor around the dedup prompt. One
 * component, one guarded path — a second copy would drift and one of them
 * would end up without the check.
 *
 * Creating a genuinely new store stays possible; the prompt only makes the
 * duplicate a deliberate choice rather than the silent default. A client that
 * skips it is still caught by the manager-visible flag, which derives from
 * store coordinates rather than from whether this dialog appeared.
 */
export default function AddStoreModal({
  visible,
  initialName = '',
  createdByUserId,
  onClose,
  onResolved,
}: Props) {
  const [name, setName] = useState(initialName);
  const [license, setLicense] = useState('');
  const [location, setLocation] = useState<StoreLocationValue>(emptyLocation);
  const [creating, setCreating] = useState(false);
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setLicense('');
      setLocation(emptyLocation);
      setDupes([]);
    }
  }, [visible, initialName]);

  const checkForDuplicates = async (): Promise<DuplicateMatch[]> => {
    const { data } = await supabase.from('stores').select('id, name, latitude, longitude');
    return findDuplicateCandidates(
      name.trim(),
      location.latitude,
      location.longitude,
      (data as any[]) ?? [],
      haversineKm,
    );
  };

  const create = async (skipDuplicateCheck = false) => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Enter a store name to continue.');
      return;
    }
    if (!skipDuplicateCheck) {
      const matches = await checkForDuplicates();
      if (matches.length) {
        setDupes(matches);
        return;
      }
    }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('stores')
        .insert({
          name: name.trim(),
          address: location.address.trim() || null,
          latitude: location.latitude,
          longitude: location.longitude,
          license_number: license.trim() || null,
          state: location.state,
          created_by_user_id: createdByUserId,
        })
        .select()
        .single();
      if (error) throw error;
      setDupes([]);
      onResolved({
        id: data.id,
        name: data.name,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
      });
    } catch (err: any) {
      Alert.alert('Couldn’t add the store', err.message || 'Try again.');
    }
    setCreating(false);
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={styles.screen}>
          <Header title="Add a store" onBack={onClose} />
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Store name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Store name"
              placeholderTextColor={Colors.textMuted}
            />

            <StoreLocationPicker value={location} onChange={setLocation} />

            <Text style={styles.fieldLabel}>License number (optional)</Text>
            <TextInput
              style={styles.input}
              value={license}
              onChangeText={setLicense}
              placeholder="Store license number"
              placeholderTextColor={Colors.textMuted}
            />

            <Button
              title="Save store"
              onPress={() => create()}
              loading={creating}
              disabled={!name.trim()}
              style={{ marginTop: Space.xl, marginBottom: 48 }}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* "Did you mean this one?" — steer, never block. */}
      <Modal visible={dupes.length > 0} transparent animationType="fade" onRequestClose={() => setDupes([])}>
        <View style={styles.dupWrap}>
          <View style={styles.dupCard}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>Is it one of these?</Text>
            <Text style={styles.dupHint}>
              These stores are already on the system nearby or under a similar name. Picking the
              existing one keeps its history and stock together.
            </Text>
            <ScrollView style={{ maxHeight: 260 }}>
              {dupes.map((d) => (
                <Pressable
                  key={d.store.id}
                  style={styles.dupRow}
                  onPress={() => {
                    setDupes([]);
                    onResolved({
                      id: d.store.id,
                      name: d.store.name,
                      address: null,
                      latitude: d.store.latitude,
                      longitude: d.store.longitude,
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use existing store ${d.store.name}`}
                >
                  <Ionicons name="storefront-outline" size={18} color={Colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                      {d.store.name}
                    </Text>
                    <Text style={[Type.caption, { color: Colors.textMuted }]}>
                      {d.meters !== null ? `${Math.round(d.meters)} m away` : 'Similar name'}
                      {d.why === 'both' ? ' · similar name' : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
            <Button
              title="No — this is a new store"
              variant="secondary"
              onPress={() => {
                setDupes([]);
                create(true);
              }}
              style={{ marginTop: Space.md }}
            />
            <Button
              title="Go back and edit"
              variant="secondary"
              onPress={() => setDupes([])}
              style={{ marginTop: Space.sm }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Space.lg },
  fieldLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm, marginTop: Space.lg },
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
  dupWrap: { flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: Space.lg },
  dupCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Space.lg },
  dupHint: { ...Type.caption, color: Colors.textMuted, marginTop: Space.xs, lineHeight: 18 },
  dupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
});
