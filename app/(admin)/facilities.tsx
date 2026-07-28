import React, { useState, useMemo } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useFacilities, Facility, FacilityType } from '../../hooks/useFacilities';

const FACILITY_TYPES: { value: FacilityType; label: string }[] = [
  { value: 'factory', label: 'Factory' },
  { value: 'warehouse', label: 'Warehouse' },
];

interface FormState {
  name: string;
  licenseNo: string;
  licenseType: string;
  state: string;
  facilityType: FacilityType;
  isActive: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  licenseNo: '',
  licenseType: '',
  state: '',
  facilityType: 'warehouse',
  isActive: true,
});

/**
 * Facilities admin (management-only). This registry is what makes excise-permit
 * movement classification possible at all: a permit only carries two licence
 * numbers, so direction is derived by matching them against OUR OWN facilities.
 * Anything not listed here counts as an external party (distributor / L1).
 * Rendered as a full-screen modal from Profile.
 */
export default function FacilitiesScreen({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { data, refetch, isPending, isError } = useFacilities();
  const facilities = data ?? [];
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const sections = useMemo(() => {
    const out: { title: string; data: Facility[] }[] = [];
    for (const t of FACILITY_TYPES) {
      const rows = facilities.filter((f) => f.facility_type === t.value);
      if (rows.length) out.push({ title: `${t.label}s (${rows.length})`, data: rows });
    }
    return out;
  }, [facilities]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setErrors({});
    setShowForm(true);
  };

  const openEdit = (f: Facility) => {
    setEditing(f);
    setForm({
      name: f.name,
      licenseNo: f.license_no,
      licenseType: f.license_type || '',
      state: f.state,
      facilityType: f.facility_type,
      isActive: f.is_active,
    });
    setErrors({});
    setShowForm(true);
  };

  const handleSave = async () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required.';
    if (!form.licenseNo.trim()) e.licenseNo = 'Licence number is required — this is what permits are matched on.';
    if (!form.state.trim()) e.state = 'State is required.';
    setErrors(e);
    if (Object.keys(e).length) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        license_no: form.licenseNo.trim(),
        license_type: form.licenseType.trim() || null,
        state: form.state.trim(),
        facility_type: form.facilityType,
        is_active: form.isActive,
      };
      if (editing) {
        const { error } = await supabase.from('company_facilities').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('company_facilities').insert(payload);
        if (error) throw error;
      }
      setShowForm(false);
      await refetch();
    } catch (err: any) {
      const msg = String(err?.message || '');
      Alert.alert(
        'Couldn’t save the facility',
        msg.includes('duplicate') || msg.includes('unique')
          ? 'That licence number is already registered to another facility.'
          : msg.includes('Licence number is locked')
          ? 'Permits already reference this facility, so its licence number is locked. Set it inactive and add a new facility instead.'
          : msg || 'Try again.'
      );
    }
    setSaving(false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <Header title="Excise facilities" onBack={onClose} />

        <View style={styles.headerPad}>
          <Text style={[Type.caption, { color: Colors.textSecondary }]}>
            Your own factories and warehouses. Permit movement direction is worked out by matching a
            permit’s licence numbers against this list — anything not listed counts as an outside party (L1).
          </Text>
          <Button title="Add facility" spotlight onPress={openAdd} style={{ marginTop: Space.md }} />
        </View>

        {isPending && !data ? (
          <ListSkeleton />
        ) : isError && !data ? (
          <ErrorState onRetry={refetch} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderSectionHeader={({ section }) => (
              <Text style={[Type.section, styles.sectionHeader]}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <Pressable onPress={() => openEdit(item)} style={styles.rowWrap}>
                <BentoTile style={!item.is_active ? styles.inactive : undefined}>
                  <View style={styles.row}>
                    <Ionicons
                      name={item.facility_type === 'factory' ? 'business' : 'cube'}
                      size={20}
                      color={Colors.accent}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
                        {item.license_no}
                        {item.license_type ? ` · ${item.license_type}` : ''} · {item.state}
                      </Text>
                      {!item.is_active ? <Text style={styles.inactiveTag}>Inactive</Text> : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                  </View>
                </BentoTile>
              </Pressable>
            )}
            ListEmptyComponent={
              <EmptyState
                icon="business-outline"
                title="No facilities yet"
                message="Add your factory and warehouse licence numbers. Until then every uploaded permit stays unclassified — which is expected, not an error."
                actionLabel="Add facility"
                onAction={openAdd}
              />
            }
          />
        )}

        {/* Add / edit form */}
        <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
          <View style={styles.container}>
            <Header title={editing ? 'Edit facility' : 'Add facility'} onBack={() => setShowForm(false)} />
            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <Field label="Name" error={errors.name}>
                <TextInput
                  style={[styles.input, errors.name && styles.inputError]}
                  value={form.name}
                  onChangeText={(t) => { set({ name: t }); if (errors.name) setErrors((x) => ({ ...x, name: '' })); }}
                  placeholder="e.g. Tank 90 Bhiwadi warehouse"
                  placeholderTextColor={Colors.textMuted}
                />
              </Field>

              <Field label="Licence number" error={errors.licenseNo}>
                <TextInput
                  style={[styles.input, errors.licenseNo && styles.inputError]}
                  value={form.licenseNo}
                  onChangeText={(t) => { set({ licenseNo: t }); if (errors.licenseNo) setErrors((x) => ({ ...x, licenseNo: '' })); }}
                  placeholder="Exactly as printed on permits"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="characters"
                />
                {editing ? (
                  <Text style={styles.hint}>
                    Correctable until a permit references this facility. After that it’s locked as
                    historical evidence — retire the facility below and add a new one instead.
                  </Text>
                ) : null}
              </Field>

              <Field label="Licence type (optional)">
                <TextInput
                  style={styles.input}
                  value={form.licenseType}
                  onChangeText={(t) => set({ licenseType: t })}
                  placeholder="e.g. L-1, L-1AB1"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="characters"
                />
              </Field>

              <Field label="State" error={errors.state}>
                <TextInput
                  style={[styles.input, errors.state && styles.inputError]}
                  value={form.state}
                  onChangeText={(t) => { set({ state: t }); if (errors.state) setErrors((x) => ({ ...x, state: '' })); }}
                  placeholder="e.g. Haryana"
                  placeholderTextColor={Colors.textMuted}
                />
              </Field>

              <Field label="Facility type">
                <View style={styles.typeRow}>
                  {FACILITY_TYPES.map((t) => {
                    const active = form.facilityType === t.value;
                    return (
                      <Pressable
                        key={t.value}
                        onPress={() => set({ facilityType: t.value })}
                        style={[styles.typeBtn, active && styles.typeBtnActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.typeText, active && styles.typeTextActive]}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              <View style={styles.activeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[Type.bodyMed, { color: Colors.text }]}>Active</Text>
                  <Text style={[Type.caption, { color: Colors.textMuted }]}>
                    Inactive facilities stay on historical permits but aren’t offered for new ones.
                  </Text>
                </View>
                <Pressable
                  onPress={() => set({ isActive: !form.isActive })}
                  style={[styles.switch, form.isActive && styles.switchOn]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: form.isActive }}
                  accessibilityLabel="Active"
                >
                  <View style={[styles.knob, form.isActive && styles.knobOn]} />
                </Pressable>
              </View>

              <Button
                title={editing ? 'Save changes' : 'Add facility'}
                spotlight
                onPress={handleSave}
                loading={saving}
                style={{ marginTop: Space.xl }}
              />
            </ScrollView>
          </View>
        </Modal>
      </View>
    </Modal>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.md },
  list: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm, paddingBottom: Space.xxl },
  sectionHeader: { color: Colors.text, marginTop: Space.md, marginBottom: Space.sm },
  rowWrap: { marginBottom: Space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  inactive: { opacity: 0.6 },
  inactiveTag: { ...Type.caption, fontWeight: '700', color: Colors.textMuted, marginTop: 2 },
  formContent: { padding: Layout.screenPad, paddingBottom: Space.xxl },
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
  hint: { ...Type.caption, color: Colors.textMuted, marginTop: Space.xs },
  typeRow: { flexDirection: 'row', gap: Space.sm },
  typeBtn: {
    flex: 1,
    minHeight: Layout.tap,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  typeBtnActive: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  typeText: { ...Type.label, color: Colors.text },
  typeTextActive: { color: Colors.white },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: Space.xl },
  switch: { width: 48, height: 28, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.white, alignSelf: 'flex-start' },
  knobOn: { alignSelf: 'flex-end' },
});
