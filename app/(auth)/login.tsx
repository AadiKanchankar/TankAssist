import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
} from 'react-native';
import { Colors, Typography } from '../../constants/colors';
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

const NO_ACCOUNT_MSG = 'No account found. Contact your management team.';

export default function LoginScreen({ navigation }: { navigation: any }) {
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [showCodePicker, setShowCodePicker] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const { sendOtp, loading } = useAuthStore();

  // Pre-OTP registration check (anon RPC, boolean only). Results are cached
  // per full phone number so the eager check below usually has the verdict
  // ready before "Send OTP" is even tapped — no SMS is sent for unknown numbers.
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
  // already cached by the time the user taps "Send OTP".
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
      setError('Please enter a valid phone number.');
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.brand}>TANK NO.90</Text>
          <Text style={styles.appName}>TankAssist</Text>
          <Text style={styles.subtitle}>Field Sales Operations</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>PHONE NUMBER</Text>
          <View style={styles.phoneRow}>
            <TouchableOpacity
              style={styles.codeSelector}
              onPress={() => setShowCodePicker(true)}
            >
              <Text style={styles.codeText}>{countryCode}</Text>
              <Text style={styles.codeArrow}>▼</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={(text) => {
                setPhone(text);
                setError('');
              }}
              placeholder="Enter phone number"
              placeholderTextColor={Colors.muted}
              keyboardType="phone-pad"
              maxLength={15}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            title="Send OTP"
            onPress={handleSendOtp}
            loading={loading || checking}
            style={styles.loginButton}
          />
        </View>
      </ScrollView>

      {/* Country Code Picker Modal */}
      <Modal
        visible={showCodePicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCodePicker(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Country Code</Text>
            <TouchableOpacity onPress={() => setShowCodePicker(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={COUNTRY_CODES}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.codeItem,
                  item.code === countryCode && styles.codeItemSelected,
                ]}
                onPress={() => {
                  setCountryCode(item.code);
                  setShowCodePicker(false);
                }}
              >
                <Text style={styles.codeItemText}>
                  {item.code} — {item.country}
                </Text>
                {item.code === countryCode && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  header: {
    marginBottom: 48,
  },
  brand: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
  },
  appName: {
    fontFamily: Typography.fontFamily,
    ...Typography.pageTitle,
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  form: {},
  label: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 6,
  },
  codeText: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.text,
    fontWeight: '600',
  },
  codeArrow: {
    fontSize: 10,
    color: Colors.muted,
  },
  phoneInput: {
    flex: 1,
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
  error: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.alert,
    marginTop: 16,
  },
  loginButton: {
    marginTop: 32,
  },
  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 16,
  },
  modalTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
  },
  modalClose: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.accent,
    fontWeight: '600',
  },
  codeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  codeItemSelected: {
    backgroundColor: Colors.white,
  },
  codeItemText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
  },
  checkmark: {
    fontSize: 18,
    color: Colors.accent,
    fontWeight: '600',
  },
});
