import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';

const COUNTRY_CODES = [
  { code: '+91', country: 'India' },
  { code: '+1', country: 'USA' },
  { code: '+44', country: 'UK' },
  { code: '+971', country: 'UAE' },
  { code: '+65', country: 'Singapore' },
  { code: '+61', country: 'Australia' },
];

const NO_ACCOUNT_MSG = 'No account found for this number. Contact your management team to get set up.';

export default function LoginScreen({ navigation }: { navigation: any }) {
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [showCodePicker, setShowCodePicker] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const { sendOtp, loading } = useAuthStore();

  // Pre-OTP registration check (anon RPC, boolean only). Results are cached
  // per full phone number so the eager check below usually has the verdict
  // ready before "Send code" is even tapped — no SMS is sent for unknown numbers.
  const checkCache = useRef<Map<string, Promise<boolean>>>(new Map());
  // The full phone currently in the input — guards eager results against
  // resolving after the user has edited the number.
  const currentPhoneRef = useRef('');

  const checkPhoneRegistered = (fullPhone: string): Promise<boolean> => {
    const cached = checkCache.current.get(fullPhone);
    if (cached) return cached;
    const pending = (async () => {
      const { data, error: rpcError } = await supabase.rpc('phone_registered', {
        p_phone: fullPhone,
      });
      if (rpcError) {
        // Don't cache failures — allow a retry on the next attempt.
        checkCache.current.delete(fullPhone);
        throw rpcError;
      }
      return data === true;
    })();
    checkCache.current.set(fullPhone, pending);
    return pending;
  };

  // Eagerly check as soon as a complete number is typed, so the verdict is
  // already cached by the time the user taps "Send code".
  useEffect(() => {
    const cleaned = phone.replace(/\s/g, '');
    const fullPhone = cleaned.length >= 10 ? `${countryCode}${cleaned}` : '';
    currentPhoneRef.current = fullPhone;
    if (!fullPhone) return;
    const timer = setTimeout(() => {
      checkPhoneRegistered(fullPhone)
        .then((registered) => {
          if (!registered && currentPhoneRef.current === fullPhone) {
            setError(NO_ACCOUNT_MSG);
          }
        })
        .catch(() => {
          // Network hiccup on the eager check — handleSendOtp retries it.
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [phone, countryCode]);

  const handleSendOtp = async () => {
    setError('');
    const cleaned = phone.replace(/\s/g, '');
    if (!cleaned || cleaned.length < 10) {
      setError('Enter a valid phone number.');
      return;
    }
    const fullPhone = `${countryCode}${cleaned}`;

    // Usually resolved already by the eager check; awaits it if still in flight.
    setChecking(true);
    let registered = true; // fail open: an RPC outage must not lock every user out
    try {
      registered = await checkPhoneRegistered(fullPhone);
    } catch {}
    setChecking(false);
    if (!registered) {
      setError(NO_ACCOUNT_MSG);
      return;
    }

    const result = await sendOtp(fullPhone);
    if (result.error) {
      setError(result.error);
    } else {
      navigation.navigate('VerifyOtp', { phone: fullPhone });
    }
  };

  const isInvite = error === NO_ACCOUNT_MSG; // calm microcopy, not an error-shout

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.brand}>Tank No. 90</Text>
            <Text style={styles.appName}>TankAssist</Text>
            <Text style={styles.subtitle}>Field sales operations</Text>
          </View>

          <View>
            <Text style={styles.label}>Phone number</Text>
            <View style={styles.phoneRow}>
              <Pressable style={styles.codeSelector} onPress={() => setShowCodePicker(true)}>
                <Text style={styles.codeText}>{countryCode}</Text>
                <Ionicons name="chevron-down" size={14} color={Colors.textMuted} />
              </Pressable>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.phoneInput}
                  value={phone}
                  onChangeText={(text) => {
                    setPhone(text);
                    setError('');
                  }}
                  placeholder="Enter phone number"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={15}
                  accessibilityLabel="Phone number"
                />
                {checking && (
                  <ActivityIndicator size="small" color={Colors.textMuted} style={styles.fieldDot} />
                )}
              </View>
            </View>

            {error ? (
              <Text style={[styles.msg, isInvite ? styles.invite : styles.error]}>{error}</Text>
            ) : null}

            <Button
              title="Send code"
              spotlight
              onPress={handleSendOtp}
              loading={loading}
              style={styles.loginButton}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country code picker */}
      <Modal
        visible={showCodePicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCodePicker(false)}
      >
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={[Type.section, { color: Colors.text }]}>Select country code</Text>
            <Pressable onPress={() => setShowCodePicker(false)} hitSlop={8}>
              <Text style={[Type.bodyMed, { color: Colors.accent }]}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={COUNTRY_CODES}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.codeItem, item.code === countryCode && styles.codeItemSelected]}
                onPress={() => {
                  setCountryCode(item.code);
                  setShowCodePicker(false);
                }}
              >
                <Text style={[Type.body, { color: Colors.text }]}>
                  {item.code} — {item.country}
                </Text>
                {item.code === countryCode && (
                  <Ionicons name="checkmark" size={18} color={Colors.accent} />
                )}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Space.xl, paddingVertical: Space.xxl },
  header: { marginBottom: Space.xxl },
  brand: { ...Type.label, color: Colors.accent, marginBottom: Space.sm },
  appName: { ...Type.display, color: Colors.text },
  subtitle: { ...Type.body, color: Colors.textSecondary, marginTop: Space.xs },
  label: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  phoneRow: { flexDirection: 'row', gap: Space.sm },
  codeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    gap: Space.xs,
    minHeight: Layout.tap,
  },
  codeText: { ...Type.bodyMed, color: Colors.text },
  inputWrap: { flex: 1, justifyContent: 'center' },
  phoneInput: {
    fontFamily: Typography.fontFamily,
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingRight: 40,
    minHeight: Layout.tap,
  },
  fieldDot: { position: 'absolute', right: Space.md },
  msg: { ...Type.body, marginTop: Space.lg },
  error: { color: Colors.alert },
  invite: { color: Colors.textSecondary },
  loginButton: { marginTop: Space.xl },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Space.xl,
    paddingVertical: Space.lg,
  },
  codeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.xl,
    paddingVertical: Space.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  codeItemSelected: { backgroundColor: Colors.surfaceAlt },
});
