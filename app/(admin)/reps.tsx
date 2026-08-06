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
  Linking,
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
import Autocomplete, { AutocompleteItem } from '../../components/Autocomplete';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { supabase, enrollClient } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useTeam, Member, Role } from '../../hooks/useTeam';
import {
  usePendingPlans,
  useFlaggedVisits,
  useOdometerFlags,
  usePlanSubmissions,
} from '../../hooks/useJourneyPlans';

type EnrollStep = 'form' | 'otp' | 'done';

interface ManagerOption {
  id: string;
  name: string;
}

const ROLE_GROUPS: { role: Role; title: string }[] = [
  { role: 'sales_manager', title: 'Sales managers' },
  { role: 'rep', title: 'Sales reps' },
  { role: 'management', title: 'Management' },
];
const ROLE_TITLE: Record<Role, string> = {
  rep: 'Sales rep',
  sales_manager: 'Sales manager',
  management: 'Management',
};
const ADD_ROLES: { value: Role; label: string }[] = [
  { value: 'rep', label: 'Rep' },
  { value: 'sales_manager', label: 'Sales manager' },
  { value: 'management', label: 'Management' },
];

/** Normalize a typed number to E.164 +91 (India). Unchanged. */
function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  let local: string;
  if (digits.length === 10) local = digits;
  else if (digits.length === 12 && digits.startsWith('91')) local = digits.slice(2);
  else return null;
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

function buildSections(members: Member[], visibleRoles: Role[], expanded: Set<string>) {
  return ROLE_GROUPS.filter((g) => visibleRoles.includes(g.role))
    .map((g) => {
      const data = members
        .filter((m) => m.role === g.role)
        .sort((a, b) =>
          a.is_active === b.is_active ? a.name.localeCompare(b.name) : a.is_active ? -1 : 1
        );
      return { title: g.title, count: data.length, data };
    })
    .filter((s) => s.count > 0)
    .map((s) => ({ ...s, data: expanded.has(s.title) ? s.data : [] }));
}

export default function AdminTeamScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();
  const isManagement = profile?.role === 'management';
  const { data, refetch, isPending, isError } = useTeam(profile?.role);
  const { data: plansData, refetch: refetchPlans } = usePendingPlans();
  const { data: flaggedData, refetch: refetchFlagged } = useFlaggedVisits();
  const { data: odoData, refetch: refetchOdo } = useOdometerFlags();
  const pendingPlans = plansData ?? [];
  const flaggedVisits = flaggedData ?? [];
  const odoMismatches = odoData ?? [];
  const reviewCount = pendingPlans.length + flaggedVisits.length + odoMismatches.length;
  // Realtime: a rep submitting a plan updates the badge without a pull.
  usePlanSubmissions(true);
  const members = data ?? [];

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [memberQuery, setMemberQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // ─── Add User (OTP enrollment) state — unchanged ───
  const [step, setStep] = useState<EnrollStep>('form');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('rep');
  const [newPhone, setNewPhone] = useState('');
  const [newPhoneE164, setNewPhoneE164] = useState('');
  const [newManagerId, setNewManagerId] = useState<string | null>(null);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [otpToken, setOtpToken] = useState('');
  const [newAuthUserId, setNewAuthUserId] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enrollError, setEnrollError] = useState('');

  const refreshAll = useCallback(async () => {
    await Promise.all([refetch(), refetchPlans(), refetchFlagged(), refetchOdo()]);
  }, [refetch, refetchPlans, refetchFlagged, refetchOdo]);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll])
  );
  const { refreshing, onRefresh } = usePullToRefresh(refreshAll);

  const toggleSection = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const visibleRoles: Role[] = isManagement ? ['sales_manager', 'rep', 'management'] : ['rep'];
  const sections = useMemo(
    () => buildSections(members, visibleRoles, expanded),
    [members, isManagement, expanded]
  );

  const searchResults: AutocompleteItem[] = memberQuery.trim()
    ? members
        .filter((m) => m.name.toLowerCase().includes(memberQuery.trim().toLowerCase()))
        .map((m) => ({
          id: m.id,
          label: m.name,
          sublabel: `${ROLE_TITLE[m.role]}${m.phone ? ` · ${m.phone}` : ''}`,
        }))
    : [];

  const resetEnroll = () => {
    setStep('form');
    setNewName('');
    setNewRole('rep');
    setNewPhone('');
    setNewPhoneE164('');
    setNewManagerId(null);
    setOtpToken('');
    setNewAuthUserId(null);
    setVerified(false);
    setEnrollError('');
  };

  const openAddModal = async () => {
    resetEnroll();
    setShowAddModal(true);
    const { data } = await supabase.rpc('get_sales_managers');
    setManagers((data as ManagerOption[]) || []);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    resetEnroll();
  };

  // Step 1 → send the OTP to the NEW employee's phone (ephemeral client).
  const handleSendOtp = async () => {
    setEnrollError('');
    if (!newName.trim()) {
      setEnrollError('Name is required.');
      return;
    }
    const phone = normalizeIndianPhone(newPhone);
    if (!phone) {
      setEnrollError('Enter a valid Indian mobile number (10 digits).');
      return;
    }
    setNewPhoneE164(phone);
    setSending(true);
    try {
      const { data: reg } = await supabase.rpc('phone_registered', { p_phone: phone });
      if (reg === true) {
        setEnrollError('This number already has an active account.');
        setSending(false);
        return;
      }
      const { error } = await enrollClient.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStep('otp');
    } catch (err: any) {
      setEnrollError(err.message || 'Failed to send code.');
    }
    setSending(false);
  };

  // Insert the profile row via the MAIN client (management session). Unchanged.
  const saveProfile = async (id: string) => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('users')
        .select('id, is_active')
        .eq('id', id)
        .maybeSingle();
      if (existing) {
        setEnrollError(
          existing.is_active
            ? 'This number is already registered.'
            : 'This number belongs to a deactivated account. Reactivate them from the Team list instead.'
        );
        return;
      }
      const { error } = await supabase.from('users').insert({
        id,
        name: newName.trim(),
        email: null,
        phone: newPhoneE164,
        role: newRole,
        assigned_manager_id: newRole === 'rep' ? newManagerId : null,
        is_active: true,
      });
      if (error) {
        setEnrollError(
          `Code verified, but saving the profile failed: ${
            error.message || 'unknown error'
          }. Tap "Retry save" to finish.`
        );
        return;
      }
      setStep('done');
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyAndCreate = async () => {
    setEnrollError('');
    if (otpToken.length !== 6) {
      setEnrollError('Enter the 6-digit code.');
      return;
    }
    setVerifying(true);
    try {
      const { data, error } = await enrollClient.auth.verifyOtp({
        phone: newPhoneE164,
        token: otpToken,
        type: 'sms',
      });
      if (error) throw error;
      const id = data.user?.id;
      if (!id) throw new Error('Verification failed — no user returned.');
      setNewAuthUserId(id);
      setVerified(true);
      try {
        await enrollClient.auth.signOut();
      } catch {}
      await saveProfile(id);
    } catch (e: any) {
      setEnrollError(e.message || 'Verification failed.');
    }
    setVerifying(false);
  };

  const handleRetrySave = async () => {
    if (!newAuthUserId) return;
    setEnrollError('');
    await saveProfile(newAuthUserId);
  };

  const managerName = managers.find((m) => m.id === newManagerId)?.name || null;

  return (
    <View style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + Space.md }]}>
        <Text style={[Type.title, { color: Colors.text, marginBottom: Space.md }]}>Team</Text>

        {/* Exception queue: surfaces only what needs a decision. The count is
            the hook — "review these 3", never "audit all 300". */}
        <Pressable
          onPress={() => navigation.navigate('Exceptions')}
          style={[styles.reviewBanner, reviewCount > 0 && styles.reviewBannerActive]}
          accessibilityRole="button"
          accessibilityLabel={
            reviewCount > 0 ? `Review queue, ${reviewCount} items need review` : 'Review queue, nothing waiting'
          }
        >
          <Ionicons
            name={reviewCount > 0 ? 'alert-circle' : 'shield-checkmark-outline'}
            size={18}
            color={reviewCount > 0 ? Colors.alert : Colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[Type.bodyMed, { color: Colors.text }]}>Review queue</Text>
            <Text style={[Type.caption, { color: Colors.textMuted }]}>
              {pendingPlans.length > 0
                ? `${pendingPlans.length} plan${pendingPlans.length === 1 ? '' : 's'} awaiting approval`
                : 'No plans awaiting approval'}
              {flaggedVisits.length > 0
                ? ` · ${flaggedVisits.length} flagged visit${flaggedVisits.length === 1 ? '' : 's'}`
                : ''}
              {odoMismatches.length > 0
                ? ` · ${odoMismatches.length} travel-allowance check${odoMismatches.length === 1 ? '' : 's'}`
                : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </Pressable>

        {isManagement && (
          <Button title="Add user" spotlight onPress={openAddModal} style={{ marginBottom: Space.md }} />
        )}
        <Autocomplete
          placeholder="Find a team member"
          results={searchResults}
          debounceMs={0}
          onQueryChange={setMemberQuery}
          onSelect={(item) => {
            const m = members.find((x) => x.id === item.id);
            if (m) navigation.navigate('RepDetail', { rep: m });
          }}
        />
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
          renderSectionHeader={({ section }) => (
            <Pressable style={styles.sectionHeaderRow} onPress={() => toggleSection(section.title)}>
              <Text style={[Type.section, { color: Colors.text }]}>
                {section.title} ({section.count})
              </Text>
              <Ionicons
                name={expanded.has(section.title) ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color={Colors.textMuted}
              />
            </Pressable>
          )}
          renderItem={({ item }) => (
            <View style={styles.rowWrap}>
              <BentoTile style={item.is_active ? undefined : styles.inactiveCard}>
                <View style={styles.memberRow}>
                  <View style={[styles.dot, { backgroundColor: item.is_active ? Colors.success : Colors.alert }]} />
                  <Pressable
                    style={styles.memberMain}
                    onPress={() => navigation.navigate('RepDetail', { rep: item })}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}, ${ROLE_TITLE[item.role]}`}
                  >
                    <Text style={[Type.bodyMed, { color: Colors.text }]}>{item.name}</Text>
                    {item.phone ? (
                      <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]}>{item.phone}</Text>
                    ) : null}
                    {!item.is_active ? <Text style={styles.deactivatedBadge}>Deactivated</Text> : null}
                  </Pressable>
                  {item.phone ? (
                    <Pressable
                      style={styles.callBtn}
                      onPress={() => Linking.openURL(`tel:${item.phone}`)}
                      hitSlop={10}
                      accessibilityLabel={`Call ${item.name}`}
                    >
                      <Ionicons name="call" size={20} color={Colors.accent} />
                    </Pressable>
                  ) : null}
                </View>
              </BentoTile>
            </View>
          )}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No team members yet" />}
        />
      )}

      {/* Add User modal — OTP enrollment (management only) */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeAddModal}
      >
        <View style={styles.modalContainer}>
          <Header title="Add user" onBack={step === 'otp' ? () => setStep('form') : closeAddModal} />

          {step !== 'done' && (
            <View style={styles.miniStepper}>
              <View style={styles.miniTrack}>
                {['form', 'otp'].map((s, i) => {
                  const idx = step === 'form' ? 0 : 1;
                  return <View key={s} style={[styles.miniSeg, { backgroundColor: i <= idx ? Colors.accent : Colors.border }]} />;
                })}
              </View>
              <Text style={[Type.label, { color: Colors.text }]}>
                Step {step === 'form' ? 1 : 2} of 2 · {step === 'form' ? 'Details' : 'Verify'}
              </Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {step === 'form' && (
              <>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Full name"
                  placeholderTextColor={Colors.textMuted}
                />

                <Text style={[styles.fieldLabel, { marginTop: Space.lg }]}>Role</Text>
                <View style={styles.roleGrid}>
                  {ADD_ROLES.map((r) => (
                    <Pressable
                      key={r.value}
                      style={[styles.roleCard, newRole === r.value && styles.roleCardSelected]}
                      onPress={() => {
                        setNewRole(r.value);
                        if (r.value !== 'rep') setNewManagerId(null);
                      }}
                    >
                      <Text style={[styles.roleLabel, newRole === r.value && styles.roleLabelSelected]}>
                        {r.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.fieldLabel, { marginTop: Space.lg }]}>Phone (India +91)</Text>
                <TextInput
                  style={styles.input}
                  value={newPhone}
                  onChangeText={setNewPhone}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={15}
                />

                {newRole === 'rep' && (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: Space.lg }]}>Assign to manager (optional)</Text>
                    <View style={styles.chipWrap}>
                      <Pressable
                        style={[styles.chip, newManagerId === null && styles.chipSelected]}
                        onPress={() => setNewManagerId(null)}
                      >
                        <Text style={[styles.chipText, newManagerId === null && styles.chipTextSelected]}>None</Text>
                      </Pressable>
                      {managers.map((m) => (
                        <Pressable
                          key={m.id}
                          style={[styles.chip, newManagerId === m.id && styles.chipSelected]}
                          onPress={() => setNewManagerId(m.id)}
                        >
                          <Text style={[styles.chipText, newManagerId === m.id && styles.chipTextSelected]}>
                            {m.name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}

                <Text style={styles.resumeHint}>
                  A one-time code is sent to this number. If this employee was partially added before,
                  re-entering their number finishes their setup.
                </Text>
                {enrollError ? <Text style={styles.enrollError}>{enrollError}</Text> : null}

                <Button title="Send code" spotlight onPress={handleSendOtp} loading={sending} style={styles.submitBtn} />
              </>
            )}

            {step === 'otp' && (
              <>
                <Text style={[Type.body, { color: Colors.textSecondary, marginTop: Space.sm }]}>
                  Ask {newName.trim()} for the 6-digit code just sent to
                </Text>
                <Text style={[Type.section, { color: Colors.text, marginTop: 2, marginBottom: Space.lg }]}>
                  {newPhoneE164}
                </Text>

                <TextInput
                  style={styles.otpInput}
                  value={otpToken}
                  onChangeText={setOtpToken}
                  placeholder="000000"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  textAlign="center"
                  editable={!verified}
                />

                {enrollError ? <Text style={styles.enrollError}>{enrollError}</Text> : null}

                {verified ? (
                  <Button title="Retry save" spotlight onPress={handleRetrySave} loading={saving} style={styles.submitBtn} />
                ) : (
                  <Button
                    title="Verify & create"
                    spotlight
                    onPress={handleVerifyAndCreate}
                    loading={verifying || saving}
                    style={styles.submitBtn}
                  />
                )}
              </>
            )}

            {step === 'done' && (
              <View style={styles.doneWrap}>
                <Ionicons name="checkmark-circle" size={56} color={Colors.success} />
                <Text style={[Type.section, { color: Colors.text, marginTop: Space.md }]}>
                  {newName.trim()} added
                </Text>
                <Text style={[Type.body, { color: Colors.textSecondary, textAlign: 'center', marginTop: Space.sm }]}>
                  {newName.trim()} can now log in with their phone number
                  {managerName ? ` · Manager: ${managerName}` : ''}.
                </Text>
                <Button title="Done" onPress={closeAddModal} style={styles.submitBtn} />
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.sm },
  list: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    marginBottom: Space.md,
    borderRadius: Radius.card,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  reviewBannerActive: { borderColor: Colors.alert },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Space.md,
    marginBottom: Space.sm,
    minHeight: Layout.tap,
  },
  rowWrap: { marginBottom: Space.md },
  inactiveCard: { opacity: 0.6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  memberMain: { flex: 1 },
  deactivatedBadge: { ...Type.caption, fontWeight: '700', color: Colors.alert, marginTop: 4 },
  callBtn: {
    width: Layout.tap,
    height: Layout.tap,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  miniStepper: {
    paddingHorizontal: Layout.screenPad,
    paddingVertical: Space.md,
    gap: Space.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  miniTrack: { flexDirection: 'row', gap: 4 },
  miniSeg: { flex: 1, height: 5, borderRadius: Radius.pill },
  modalContent: { padding: Layout.screenPad, paddingBottom: Space.xxl },
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
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  roleCard: {
    flexGrow: 1,
    minWidth: '30%',
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    alignItems: 'center',
    minHeight: Layout.tap,
    justifyContent: 'center',
  },
  roleCardSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  roleLabel: { ...Type.label, color: Colors.text },
  roleLabelSelected: { color: Colors.white },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    minHeight: Layout.tap,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  chipText: { ...Type.label, color: Colors.text },
  chipTextSelected: { color: Colors.white },
  resumeHint: { ...Type.caption, color: Colors.textMuted, marginTop: Space.lg, lineHeight: 18 },
  enrollError: { ...Type.body, color: Colors.alert, marginTop: Space.md },
  submitBtn: { marginTop: Space.xl },
  otpInput: {
    ...Type.title,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.lg,
    letterSpacing: 12,
  },
  doneWrap: { alignItems: 'center', paddingTop: Space.xxl },
});
