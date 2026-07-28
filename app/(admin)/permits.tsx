import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Linking,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { supabase } from '../../lib/supabase';
import { getSignedUrl } from '../../lib/storage';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useFacilities } from '../../hooks/useFacilities';
import { useProducts } from '../../hooks/useProducts';
import {
  usePermits,
  usePermitDetail,
  permitDetailKey,
  computeAllocation,
  CONVERSION_FORMULA_VERSION,
  DIRECTION_LABEL,
  MovementDirection,
  Permit,
} from '../../hooks/usePermits';

const BUCKET = 'excise-permits';
const STATUS_META: Record<string, { label: string; color: string }> = {
  pending_review: { label: 'Pending', color: Colors.warning },
  approved: { label: 'Approved', color: Colors.success },
  rejected: { label: 'Rejected', color: Colors.alert },
};
const DIRECTIONS: MovementDirection[] = [
  'factory_to_warehouse',
  'warehouse_to_l1',
  'internal_transfer',
];

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Management-only Excise Permits screen: upload → review → approve/reject. */
export default function PermitsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { data, refetch, isPending, isError } = usePermits();
  const permits = data ?? [];
  const { refreshing, onRefresh } = usePullToRefresh(refetch);
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const pending = useMemo(() => permits.filter((p) => p.status === 'pending_review').length, [permits]);

  const handleUpload = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const file = res.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) {
      Alert.alert('File too large', 'Permits must be under 10 MB.');
      return;
    }

    setUploading(true);
    try {
      const ext = (file.name?.split('.').pop() || 'pdf').toLowerCase();
      const path = `permits/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, decode(base64), { contentType: file.mimeType || 'application/pdf', upsert: false });
      if (upErr) throw upErr;

      // Parsing runs server-side; the app never parses an untrusted file.
      const { data: result, error: fnErr } = await supabase.functions.invoke('parse-excise-permit', {
        body: { storage_path: path },
      });
      if (fnErr) throw fnErr;

      await refetch();
      const notes: string[] = result?.parser_notes ?? [];
      Alert.alert(
        'Permit uploaded',
        [
          result?.extraction === 'text_layer'
            ? 'Read from the document’s text layer.'
            : result?.extraction === 'image_no_ocr'
            ? 'Images can’t be read automatically — fill the fields in manually.'
            : 'No readable text layer — fill the fields in manually.',
          result?.movement_direction === 'unclassified' ? 'Movement direction needs to be set.' : '',
          ...notes,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      if (result?.permit_id) setOpenId(result.permit_id);
    } catch (err: any) {
      Alert.alert('Couldn’t upload the permit', err?.message || 'Try again.');
    }
    setUploading(false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <Header title="Excise permits" onBack={onClose} />
        <View style={styles.headerPad}>
          <Text style={[Type.caption, { color: Colors.textSecondary }]}>
            Upload a permit to extract its details. Nothing reaches the inventory ledger until you review and approve it.
          </Text>
          <Button
            title={uploading ? 'Uploading…' : 'Upload permit'}
            spotlight
            onPress={handleUpload}
            loading={uploading}
            style={{ marginTop: Space.md }}
          />
          {pending > 0 ? (
            <Text style={[Type.label, { color: Colors.warning, marginTop: Space.sm }]}>
              {pending} awaiting review
            </Text>
          ) : null}
        </View>

        {isPending && !data ? (
          <ListSkeleton />
        ) : isError && !data ? (
          <ErrorState onRetry={refetch} />
        ) : (
          <FlatList
            data={permits}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => <PermitRow permit={item} onOpen={() => setOpenId(item.id)} />}
            ListEmptyComponent={
              <EmptyState
                icon="document-text-outline"
                title="No permits yet"
                message="Upload an excise permit and its shipment details are extracted for review."
              />
            }
          />
        )}

        <ReviewModal permitId={openId} onClose={() => setOpenId(null)} onChanged={refetch} />
      </View>
    </Modal>
  );
}

function PermitRow({ permit, onOpen }: { permit: Permit; onOpen: () => void }) {
  const meta = STATUS_META[permit.status];
  return (
    <Pressable onPress={onOpen} style={{ marginBottom: Space.md }}>
      <BentoTile>
        <View style={styles.rowTop}>
          <Text style={[Type.bodyMed, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
            {permit.permit_number}
          </Text>
          <View style={[styles.pill, { backgroundColor: meta.color }]}>
            <Text style={styles.pillText}>{meta.label}</Text>
          </View>
        </View>
        <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
          {permit.state} · {permit.liquor_class ?? 'Class unknown'} ·{' '}
          <Text style={tabularNums}>
            {permit.quantity_value} {permit.quantity_type}
          </Text>
        </Text>
        <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
          {DIRECTION_LABEL[permit.movement_direction]} · uploaded {fmtDate(permit.uploaded_at)}
        </Text>
        {permit.movement_direction === 'unclassified' && permit.status === 'pending_review' ? (
          <Text style={[Type.caption, { color: Colors.warning, marginTop: 4 }]}>Needs classification</Text>
        ) : null}
      </BentoTile>
    </Pressable>
  );
}

/** Review + correct + classify + allocate, then approve or reject. */
function ReviewModal({
  permitId,
  onClose,
  onChanged,
}: {
  permitId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data, refetch, isPending } = usePermitDetail(permitId);
  const { data: facilities } = useFacilities();
  const { data: products } = useProducts();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const permit = data?.permit;
  const allocations = data?.allocations ?? [];
  const activeProducts = (products ?? []).filter((p) => p.is_active);
  const editable = permit?.status === 'pending_review';

  const refreshAll = async () => {
    await refetch();
    onChanged();
    if (permitId) qc.invalidateQueries({ queryKey: permitDetailKey(permitId) });
  };

  const patchPermit = async (patch: Record<string, unknown>) => {
    if (!permit) return;
    setBusy(true);
    const { error } = await supabase.from('excise_permits').update(patch).eq('id', permit.id);
    setBusy(false);
    if (error) { Alert.alert('Couldn’t update', error.message); return; }
    await refreshAll();
  };

  const openOriginal = async () => {
    if (!permit) return;
    const url = await getSignedUrl(permit.original_file_path, 300);
    if (url) Linking.openURL(url);
    else Alert.alert('Unavailable', 'Couldn’t open the original file.');
  };

  const addAllocation = async (productId: string) => {
    if (!permit) return;
    const product = activeProducts.find((p) => p.id === productId);
    if (!product) return;
    const already = allocations.reduce((s, a) => s + Number(a.allocated_bl), 0);
    const remaining = Math.max(0, Number(permit.quantity_value) - already);
    const c = computeAllocation(remaining, permit.quantity_type, product);
    setBusy(true);
    const { error } = await supabase.from('permit_product_allocations').insert({
      permit_id: permit.id,
      product_id: productId,
      allocated_bl: remaining,
      computed_bottles: c.computed_bottles,
      computed_cases: c.computed_cases,
      remainder_bottles: c.remainder_bottles,
      needs_review: c.needs_review,
      conversion_formula_version: CONVERSION_FORMULA_VERSION,
    });
    setBusy(false);
    if (error) { Alert.alert('Couldn’t add allocation', error.message); return; }
    await refreshAll();
  };

  const removeAllocation = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from('permit_product_allocations').delete().eq('id', id);
    setBusy(false);
    if (error) { Alert.alert('Couldn’t remove', error.message); return; }
    await refreshAll();
  };

  /** Manual override of the case count — clears needs_review since a human set it. */
  const setAllocationCases = async (id: string, casesText: string, remainderText: string) => {
    const cases = parseInt(casesText, 10);
    const rem = Number(remainderText);
    if (!Number.isFinite(cases) || cases < 0 || !Number.isFinite(rem) || rem < 0) {
      Alert.alert('Check the numbers', 'Cases and remainder bottles must be zero or more.');
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from('permit_product_allocations')
      .update({ computed_cases: cases, remainder_bottles: rem, needs_review: false })
      .eq('id', id);
    setBusy(false);
    if (error) { Alert.alert('Couldn’t save', error.message); return; }
    await refreshAll();
  };

  const approve = async () => {
    if (!permit) return;
    setBusy(true);
    const { error } = await supabase.rpc('approve_excise_permit', { p_permit_id: permit.id });
    setBusy(false);
    if (error) { Alert.alert('Can’t approve yet', error.message); return; }
    await refreshAll();
    Alert.alert('Approved', 'The shipment has been written to the inventory ledger.');
    onClose();
  };

  const reject = async () => {
    if (!permit || !reason.trim()) { Alert.alert('Reason needed', 'Enter why this permit is rejected.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('reject_excise_permit', { p_permit_id: permit.id, p_reason: reason.trim() });
    setBusy(false);
    if (error) { Alert.alert('Couldn’t reject', error.message); return; }
    setRejecting(false);
    setReason('');
    await refreshAll();
    onClose();
  };

  const allocSum = allocations.reduce((s, a) => s + Number(a.allocated_bl), 0);
  const sumOk = permit ? Math.abs(allocSum - Number(permit.quantity_value)) <= 0.01 : false;
  const flagged = allocations.some((a) => a.needs_review || a.computed_cases === null);
  const canApprove =
    editable && permit?.movement_direction !== 'unclassified' && allocations.length > 0 && sumOk && !flagged;

  const notes: string[] = permit?.extracted_json?.parser_notes ?? [];
  const missing: string[] = permit?.extracted_json?.missing_fields ?? [];

  return (
    <Modal visible={!!permitId} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <Header title="Review permit" onBack={onClose} />
        {isPending || !permit ? (
          <ListSkeleton rows={5} height={90} />
        ) : (
          <ScrollView contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
            {/* Status + source document */}
            <BentoTile>
              <View style={styles.rowTop}>
                <Text style={[Type.section, { color: Colors.text, flex: 1 }]}>{permit.permit_number}</Text>
                <View style={[styles.pill, { backgroundColor: STATUS_META[permit.status].color }]}>
                  <Text style={styles.pillText}>{STATUS_META[permit.status].label}</Text>
                </View>
              </View>
              <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 4 }]}>
                {permit.state} · parser {permit.parser_version}
              </Text>
              <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>
                Uploaded {fmtDate(permit.uploaded_at)}
                {permit.reviewed_at ? ` · reviewed ${fmtDate(permit.reviewed_at)}` : ''}
              </Text>
              <Button title="View original document" onPress={openOriginal} variant="secondary" style={{ marginTop: Space.md }} />
            </BentoTile>

            {/* What the parser could not do */}
            {(notes.length > 0 || missing.length > 0) && editable ? (
              <BentoTile style={styles.warnCard}>
                <Text style={[Type.label, { color: Colors.warning }]}>Needs your input</Text>
                {missing.length > 0 ? (
                  <Text style={[Type.caption, { color: Colors.textSecondary, marginTop: 4 }]}>
                    Not found on the document: {missing.join(', ')}
                  </Text>
                ) : null}
                {notes.map((n, i) => (
                  <Text key={i} style={[Type.caption, { color: Colors.textSecondary, marginTop: 4 }]}>{n}</Text>
                ))}
              </BentoTile>
            ) : null}

            {/* Extracted shipment details */}
            <BentoTile>
              <Text style={styles.cardLabel}>Shipment</Text>
              <Row k="Quantity" v={`${permit.quantity_value} ${permit.quantity_type}`} />
              <Row k="Liquor class" v={permit.liquor_class ?? '—'} />
              <Row k="Permit date" v={fmtDate(permit.permit_date)} />
              <Row k="Valid until" v={fmtDate(permit.valid_until)} />
              <Row k="From (supplier)" v={permit.licensee_name_source ?? '—'} />
              <Row k="Supplier licence" v={permit.license_no_source ?? 'not on document'} />
              <Row k="To (licensee)" v={permit.licensee_name_dest ?? '—'} />
              <Row k="Licensee licence" v={permit.license_no_dest ?? '—'} />
            </BentoTile>

            {/* Classification */}
            <BentoTile>
              <Text style={styles.cardLabel}>Movement direction</Text>
              {permit.movement_direction === 'unclassified' && editable ? (
                <Text style={[Type.caption, { color: Colors.textMuted, marginBottom: Space.sm }]}>
                  {facilities?.length
                    ? 'Licence numbers didn’t match your facilities — set this manually.'
                    : 'No facilities registered yet. Add them in Profile → Excise facilities, or set the direction manually.'}
                </Text>
              ) : null}
              <View style={styles.chipWrap}>
                {DIRECTIONS.map((d) => {
                  const active = permit.movement_direction === d;
                  return (
                    <Pressable
                      key={d}
                      disabled={!editable || busy}
                      onPress={() => patchPermit({ movement_direction: d })}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{DIRECTION_LABEL[d]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.cardLabel, { marginTop: Space.lg }]}>From facility</Text>
              <FacilityPicker
                facilities={facilities ?? []}
                selected={permit.facility_from_id}
                disabled={!editable || busy}
                onSelect={(id) => patchPermit({ facility_from_id: id })}
              />
              <Text style={[styles.cardLabel, { marginTop: Space.lg }]}>To facility</Text>
              <FacilityPicker
                facilities={facilities ?? []}
                selected={permit.facility_to_id}
                disabled={!editable || busy}
                onSelect={(id) => patchPermit({ facility_to_id: id })}
              />
            </BentoTile>

            {/* Product allocations */}
            <BentoTile>
              <Text style={styles.cardLabel}>Product allocation</Text>
              <Text style={[Type.caption, { color: sumOk ? Colors.success : Colors.warning, marginBottom: Space.sm }]}>
                Allocated {allocSum} of {permit.quantity_value} {permit.quantity_type}
                {sumOk ? '' : ' — must match the permit total'}
              </Text>

              {allocations.map((a) => {
                const product = (products ?? []).find((p) => p.id === a.product_id);
                return (
                  <AllocationRow
                    key={a.id}
                    name={product?.name ?? 'Unknown product'}
                    alloc={a}
                    editable={!!editable}
                    busy={busy}
                    onRemove={() => removeAllocation(a.id)}
                    onSetCases={(c, r) => setAllocationCases(a.id, c, r)}
                  />
                );
              })}

              {editable ? (
                <>
                  <Text style={[styles.cardLabel, { marginTop: Space.md }]}>Add product</Text>
                  <View style={styles.chipWrap}>
                    {activeProducts
                      .filter((p) => !allocations.some((a) => a.product_id === p.id))
                      .map((p) => (
                        <Pressable key={p.id} disabled={busy} onPress={() => addAllocation(p.id)} style={styles.chip}>
                          <Text style={styles.chipText}>{p.name}</Text>
                        </Pressable>
                      ))}
                  </View>
                </>
              ) : null}
            </BentoTile>

            {permit.notes ? (
              <BentoTile>
                <Text style={styles.cardLabel}>Notes</Text>
                <Text style={[Type.body, { color: Colors.text }]}>{permit.notes}</Text>
              </BentoTile>
            ) : null}

            {/* Actions */}
            {editable ? (
              rejecting ? (
                <BentoTile>
                  <Text style={styles.cardLabel}>Reason for rejection</Text>
                  <TextInput
                    style={styles.input}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Why is this permit rejected?"
                    placeholderTextColor={Colors.textMuted}
                    multiline
                  />
                  <Button title="Confirm reject" variant="danger" onPress={reject} loading={busy} style={{ marginTop: Space.md }} />
                  <Button title="Cancel" variant="secondary" onPress={() => setRejecting(false)} style={{ marginTop: Space.sm }} />
                </BentoTile>
              ) : (
                <>
                  {!canApprove ? (
                    <Text style={[Type.caption, { color: Colors.textMuted, marginBottom: Space.sm }]}>
                      {permit.movement_direction === 'unclassified'
                        ? 'Set the movement direction to approve.'
                        : allocations.length === 0
                        ? 'Add at least one product allocation to approve.'
                        : !sumOk
                        ? 'Allocations must add up to the permit quantity to approve.'
                        : 'Resolve the flagged allocation(s) to approve.'}
                    </Text>
                  ) : null}
                  <Button title="Approve & add to ledger" spotlight onPress={approve} loading={busy} disabled={!canApprove} />
                  <Button title="Reject" variant="danger" onPress={() => setRejecting(true)} style={{ marginTop: Space.sm }} />
                </>
              )
            ) : (
              <Text style={[Type.caption, { color: Colors.textMuted, textAlign: 'center' }]}>
                This permit is {STATUS_META[permit.status].label.toLowerCase()} and can no longer be edited.
              </Text>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kv}>
      <Text style={[Type.caption, { color: Colors.textMuted, flex: 1 }]}>{k}</Text>
      <Text style={[Type.caption, { color: Colors.text, flex: 1.4, textAlign: 'right' }]}>{v}</Text>
    </View>
  );
}

function FacilityPicker({
  facilities,
  selected,
  disabled,
  onSelect,
}: {
  facilities: { id: string; name: string; facility_type: string }[];
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
}) {
  if (facilities.length === 0) {
    return <Text style={[Type.caption, { color: Colors.textMuted }]}>No facilities registered.</Text>;
  }
  return (
    <View style={styles.chipWrap}>
      <Pressable disabled={disabled} onPress={() => onSelect(null)} style={[styles.chip, selected === null && styles.chipActive]}>
        <Text style={[styles.chipText, selected === null && styles.chipTextActive]}>None</Text>
      </Pressable>
      {facilities.map((f) => (
        <Pressable key={f.id} disabled={disabled} onPress={() => onSelect(f.id)} style={[styles.chip, selected === f.id && styles.chipActive]}>
          <Text style={[styles.chipText, selected === f.id && styles.chipTextActive]}>{f.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AllocationRow({
  name,
  alloc,
  editable,
  busy,
  onRemove,
  onSetCases,
}: {
  name: string;
  alloc: { allocated_bl: number; computed_cases: number | null; remainder_bottles: number | null; needs_review: boolean };
  editable: boolean;
  busy: boolean;
  onRemove: () => void;
  onSetCases: (cases: string, remainder: string) => void;
}) {
  const [cases, setCases] = useState(alloc.computed_cases != null ? String(alloc.computed_cases) : '');
  const [rem, setRem] = useState(alloc.remainder_bottles != null ? String(alloc.remainder_bottles) : '');
  const flagged = alloc.needs_review || alloc.computed_cases === null;

  return (
    <View style={[styles.allocRow, flagged && styles.allocFlagged]}>
      <View style={styles.rowTop}>
        <Text style={[Type.bodyMed, { color: Colors.text, flex: 1 }]} numberOfLines={1}>{name}</Text>
        {editable ? (
          <Pressable onPress={onRemove} disabled={busy} hitSlop={8} accessibilityLabel={`Remove ${name}`}>
            <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>
        <Text style={tabularNums}>{alloc.allocated_bl}</Text> BL allocated
      </Text>

      {flagged && editable ? (
        <>
          <Text style={[Type.caption, { color: Colors.warning, marginTop: Space.xs }]}>
            Cases couldn’t be calculated automatically — enter them.
          </Text>
          <View style={styles.qtyRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.qtyLabel}>Cases</Text>
              <TextInput style={styles.qtyInput} value={cases} onChangeText={setCases} keyboardType="number-pad" placeholder="0" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.qtyLabel}>Loose bottles</Text>
              <TextInput style={styles.qtyInput} value={rem} onChangeText={setRem} keyboardType="number-pad" placeholder="0" placeholderTextColor={Colors.textMuted} />
            </View>
          </View>
          <Button title="Save cases" variant="secondary" onPress={() => onSetCases(cases, rem)} loading={busy} style={{ marginTop: Space.sm }} />
        </>
      ) : (
        <Text style={[Type.bodyMed, tabularNums, { color: Colors.text, marginTop: 2 }]}>
          {alloc.computed_cases ?? '—'} cases
          {alloc.remainder_bottles ? ` + ${alloc.remainder_bottles} bottles` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.md },
  list: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm, paddingBottom: Space.xxl },
  reviewContent: { padding: Layout.screenPad, paddingBottom: Space.xxl, gap: Space.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.pill },
  pillText: { ...Type.caption, fontWeight: '700', color: Colors.white },
  cardLabel: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  warnCard: { borderColor: Colors.warning },
  kv: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, paddingVertical: 3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    minHeight: 38,
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  chipText: { ...Type.caption, fontWeight: '600', color: Colors.text },
  chipTextActive: { color: Colors.white },
  allocRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Space.md,
    marginBottom: Space.sm,
    backgroundColor: Colors.surfaceAlt,
  },
  allocFlagged: { borderColor: Colors.warning },
  qtyRow: { flexDirection: 'row', gap: Space.md, marginTop: Space.sm },
  qtyLabel: { ...Type.caption, color: Colors.textMuted, marginBottom: Space.xs },
  qtyInput: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    textAlign: 'center',
  },
  input: {
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Space.md,
    minHeight: 70,
  },
});
