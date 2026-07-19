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
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { supabase, enrollClient } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

type Role = 'rep' | 'sales_manager' | 'management';
type EnrollStep = 'form' | 'otp' | 'done';

interface Member {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  is_active: boolean;
  assigned_manager_id: string | null;
}

interface ManagerOption {
  id: string;
  name: string;
}

// Group order + display labels for the role accordion. Sales managers only ever
// see the 'rep' group (filtered below); management sees all three.
const ROLE_GROUPS: { role: Role; title: string }[] = [
  { role: 'sales_manager', title: 'Sales Managers' },
  { role: 'rep', title: 'Sales Reps' },
  { role: 'management', title: 'Management' },
];

const ADD_ROLES: { value: Role; label: string }[] = [
  { value: 'rep', label: 'Rep' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'management', label: 'Management' },
];

/**
 * Normalize a typed number to E.164 +91 (India). Accepts a bare 10-digit
 * mobile or a 12-digit 91-prefixed one; returns null if it isn't a valid
 * Indian mobile (must start 6-9).
 */
function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  let local: string;
  if (digits.length === 10) local = digits;
  else if (digits.length === 12 && digits.startsWith('91')) local = digits.slice(2);
  else return null;
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

/**
 * Group members into role sections (same collapsible pattern as the stores
 * state accordion). Empty groups are dropped; within a group, active members
 * sort first, then by name. Collapsed sections keep their header, render no rows.
 */
function buildSections(
  members: Member[],
  visibleRoles: Role[],
  expanded: Set<string>
) {
  return ROLE_GROUPS.filter((g) => visibleRoles.includes(g.role))
    .map((g) => {
      const data = members
        .filter((m) => m.role === g.role)
        .sort((a, b) =>
          a.is_active === b.is_active
            ? a.name.localeCompare(b.name)
            : a.is_active
            ? -1
            : 1
        );
      return { title: g.title, count: data.length, data };
    })
    .filter((s) => s.count > 0)
    .map((s) => ({ ...s, data: expanded.has(s.title) ? s.data : [] }));
}

export default function AdminTeamScreen({
  navigation,
}: {
  navigation: any;
}) {
  const { profile } = useAuthStore();
  const isManagement = profile?.role === 'management';

  const [members, setMembers] = useState<Member[]>([]);
  // Accordion: all groups start collapsed (matches the stores accordion).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);

  // ─── Add User (OTP enrollment) state ───
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

  const toggleSection = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const loadMembers = useCallback(async () => {
    // Management sees everyone; sales managers see reps only. (RLS would let a
    // sales manager read all users, so this is a UI-level scope, not security.)
    let query = supabase
      .from('users')
      .select('id, name, email, phone, role, is_active, assigned_manager_id')
      .order('name');
    if (profile?.role !== 'management') query = query.eq('role', 'rep');
    const { data } = await query;
    setMembers((data as Member[]) || []);
  }, [profile?.role]);

  // Refetch on focus so a deactivate/reactivate from member detail reflects here.
  useFocusEffect(
    useCallback(() => {
      loadMembers();
    }, [loadMembers])
  );

  const { refreshing, onRefresh } = usePullToRefresh(loadMembers);

  const visibleRoles: Role[] = isManagement
    ? ['sales_manager', 'rep', 'management']
    : ['rep'];

  const sections = useMemo(
    () => buildSections(members, visibleRoles, expanded),
    [members, isManagement, expanded]
  );

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
    // Active sales managers for the (rep-only) assignment picker.
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
      // Don't spend an SMS on a number that already has an active account.
      const { data: reg } = await supabase.rpc('phone_registered', {
        p_phone: phone,
      });
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

  // Insert the profile row via the MAIN client (management session). Guards
  // genuine duplicates and doubles as the orphan-recovery / retry path.
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
        // Orphan: auth user exists, profile insert failed. "Retry Save" re-runs
        // this insert with the id we already captured — no re-OTP needed.
        setEnrollError(
          `Code verified, but saving the profile failed: ${
            error.message || 'unknown error'
          }. Tap "Retry Save" to finish.`
        );
        return;
      }
      setStep('done');
      await loadMembers();
    } finally {
      setSaving(false);
    }
  };

  // Step 2 → verify the relayed code, capture the new id, discard the ephemeral
  // session, then save the profile.
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
      // Discard the ephemeral session immediately; never touch the manager's.
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

  const managerName =
    managers.find((m) => m.id === newManagerId)?.name || null;

  return (
    <View style={styles.container}>
      <View style={styles.headerPad}>
        <Text style={styles.title}>Team</Text>
        {isManagement && (
          <Button
            title="+ Add User"
            onPress={openAddModal}
            style={styles.addBtn}
          />
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderSectionHeader={({ section }) => (
          <TouchableOpacity
            style={styles.sectionHeaderRow}
            onPress={() => toggleSection(section.title)}
          >
            <Text style={styles.sectionHeader}>
              {section.title} ({section.count})
            </Text>
            <Ionicons
              name={
                expanded.has(section.title) ? 'chevron-down' : 'chevron-forward'
              }
              size={16}
              color={Colors.muted}
            />
          </TouchableOpacity>
        )}
        renderItem={({ item }) => (
          <Card style={item.is_active ? undefined : styles.inactiveCard}>
            <View style={styles.memberRow}>
              <TouchableOpacity
                style={styles.memberMain}
                onPress={() => navigation.navigate('RepDetail', { rep: item })}
              >
                <Text style={styles.memberName}>{item.name}</Text>
                {item.phone ? (
                  <Text style={styles.memberMeta}>{item.phone}</Text>
                ) : null}
                {item.email ? (
                  <Text style={styles.memberMeta}>{item.email}</Text>
                ) : null}
                {!item.is_active ? (
                  <Text style={styles.deactivatedBadge}>DEACTIVATED</Text>
                ) : null}
                <Text style={styles.tapHint}>Tap to view details →</Text>
              </TouchableOpacity>

              {item.phone ? (
                <TouchableOpacity
                  style={styles.callBtn}
                  onPress={() => Linking.openURL(`tel:${item.phone}`)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="call" size={22} color={Colors.accent} />
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyText}>No team members yet.</Text>
          </Card>
        }
      />

      {/* Add User Modal (management only) — OTP enrollment */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeAddModal}
      >
        <View style={styles.modalContainer}>
          <Header
            title="Add User"
            onBack={step === 'otp' ? () => setStep('form') : closeAddModal}
          />
          <ScrollView style={styles.modalContent}>
            {step === 'form' && (
              <>
                <Text style={styles.fieldLabel}>NAME</Text>
                <TextInput
                  style={styles.input}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Full name"
                  placeholderTextColor={Colors.muted}
                />

                <Text style={styles.fieldLabel}>ROLE</Text>
                <View style={styles.roleGrid}>
                  {ADD_ROLES.map((r) => (
                    <TouchableOpacity
                      key={r.value}
                      style={[
                        styles.roleCard,
                        newRole === r.value && styles.roleCardSelected,
                      ]}
                      onPress={() => {
                        setNewRole(r.value);
                        if (r.value !== 'rep') setNewManagerId(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.roleLabel,
                          newRole === r.value && styles.roleLabelSelected,
                        ]}
                      >
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>PHONE (INDIA +91)</Text>
                <TextInput
                  style={styles.input}
                  value={newPhone}
                  onChangeText={setNewPhone}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={Colors.muted}
                  keyboardType="phone-pad"
                  maxLength={15}
                />

                {newRole === 'rep' && (
                  <>
                    <Text style={styles.fieldLabel}>
                      ASSIGN TO MANAGER (OPTIONAL)
                    </Text>
                    <View style={styles.chipWrap}>
                      <TouchableOpacity
                        style={[
                          styles.chip,
                          newManagerId === null && styles.chipSelected,
                        ]}
                        onPress={() => setNewManagerId(null)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            newManagerId === null && styles.chipTextSelected,
                          ]}
                        >
                          None
                        </Text>
                      </TouchableOpacity>
                      {managers.map((m) => (
                        <TouchableOpacity
                          key={m.id}
                          style={[
                            styles.chip,
                            newManagerId === m.id && styles.chipSelected,
                          ]}
                          onPress={() => setNewManagerId(m.id)}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              newManagerId === m.id && styles.chipTextSelected,
                            ]}
                          >
                            {m.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <Text style={styles.resumeHint}>
                  A one-time code is sent to this number. If this employee was
                  partially added before, re-entering their number finishes
                  their setup.
                </Text>

                {enrollError ? (
                  <Text style={styles.enrollError}>{enrollError}</Text>
                ) : null}

                <Button
                  title="Send Code"
                  onPress={handleSendOtp}
                  loading={sending}
                  style={styles.submitBtn}
                />
              </>
            )}

            {step === 'otp' && (
              <>
                <Text style={styles.otpInstruction}>
                  Ask {newName.trim()} for the 6-digit code just sent to
                </Text>
                <Text style={styles.otpPhone}>{newPhoneE164}</Text>

                <TextInput
                  style={styles.otpInput}
                  value={otpToken}
                  onChangeText={setOtpToken}
                  placeholder="000000"
                  placeholderTextColor={Colors.muted}
                  keyboardType="number-pad"
                  maxLength={6}
                  textAlign="center"
                  editable={!verified}
                />

                {enrollError ? (
                  <Text style={styles.enrollError}>{enrollError}</Text>
                ) : null}

                {verified ? (
                  <Button
                    title="Retry Save"
                    onPress={handleRetrySave}
                    loading={saving}
                    style={styles.submitBtn}
                  />
                ) : (
                  <Button
                    title="Verify & Create"
                    onPress={handleVerifyAndCreate}
                    loading={verifying || saving}
                    style={styles.submitBtn}
                  />
                )}
              </>
            )}

            {step === 'done' && (
              <View style={styles.doneWrap}>
                <Ionicons
                  name="checkmark-circle"
                  size={56}
                  color={Colors.success}
                />
                <Text style={styles.doneTitle}>{newName.trim()} added</Text>
                <Text style={styles.doneSub}>
                  {newName.trim()} can now log in with their phone number
                  {managerName ? ` · Manager: ${managerName}` : ''}.
                </Text>
                <Button
                  title="Done"
                  onPress={closeAddModal}
                  style={styles.submitBtn}
                />
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
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  memberMain: { flex: 1 },
  inactiveCard: { opacity: 0.6 },
  memberName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  memberMeta: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 2,
  },
  deactivatedBadge: {
    fontFamily: Typography.fontFamily,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.alert,
    marginTop: 6,
  },
  tapHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.accent,
    marginTop: 8,
  },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  // Add User modal
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
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  roleCard: {
    flexGrow: 1,
    minWidth: '30%',
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
  },
  roleCardSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  roleLabel: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.text,
    fontWeight: '600',
  },
  roleLabelSelected: { color: Colors.white },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  chipText: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.text,
    fontWeight: '600',
  },
  chipTextSelected: { color: Colors.white },
  resumeHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 20,
    lineHeight: 18,
  },
  enrollError: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.alert,
    marginTop: 16,
  },
  submitBtn: { marginTop: 24 },
  // OTP step
  otpInstruction: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    marginTop: 12,
  },
  otpPhone: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
    marginTop: 4,
    marginBottom: 24,
  },
  otpInput: {
    fontFamily: Typography.fontFamily,
    fontSize: 32,
    fontWeight: '700',
    color: Colors.text,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 16,
    letterSpacing: 12,
  },
  // Done step
  doneWrap: { alignItems: 'center', paddingTop: 48 },
  doneTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
    marginTop: 16,
  },
  doneSub: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
});
