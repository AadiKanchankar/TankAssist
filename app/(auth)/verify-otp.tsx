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
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { useAuthStore } from '../../store/useAuthStore';

const RESEND_SECONDS = 30;
const CODE_LEN = 6;

/** Goal-gradient countdown ring around the resend affordance. */
function CountdownRing({ remaining, total }: { remaining: number; total: number }) {
  const size = 40;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - remaining / total);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={Colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringLabel}>
        <Text style={[Type.caption, { color: Colors.textSecondary }]}>{remaining}</Text>
      </View>
    </View>
  );
}

export default function VerifyOtpScreen({ route, navigation }: { route: any; navigation: any }) {
  const { phone } = route.params as { phone: string };
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const { verifyOtp, sendOtp, loading } = useAuthStore();
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const handleVerify = async () => {
    setError('');
    if (token.length !== CODE_LEN) {
      setError('Enter the 6-digit code.');
      return;
    }
    const result = await verifyOtp(phone, token);
    if (result.error) {
      setError(result.error);
    }
    // On success, auth state change triggers routing automatically.
  };

  const handleResend = async () => {
    if (secondsLeft > 0) return;
    setError('');
    const result = await sendOtp(phone);
    if (result.error) {
      setError(result.error);
    } else {
      setToken('');
      setSecondsLeft(RESEND_SECONDS);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Verify code" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[Type.body, { color: Colors.textSecondary }]}>
            Enter the 6-digit code sent to
          </Text>
          <Text style={[Type.section, { color: Colors.text, marginTop: 2, marginBottom: Space.xl }]}>
            {phone}
          </Text>

          {/* Chunked code input */}
          <Pressable style={styles.cellsRow} onPress={() => inputRef.current?.focus()}>
            {Array.from({ length: CODE_LEN }).map((_, i) => {
              const filled = i < token.length;
              const active = i === token.length;
              return (
                <View
                  key={i}
                  style={[styles.cell, filled && styles.cellFilled, active && styles.cellActive]}
                >
                  <Text style={styles.cellText}>{token[i] ?? ''}</Text>
                </View>
              );
            })}
            <TextInput
              ref={inputRef}
              value={token}
              onChangeText={(t) => {
                setToken(t.replace(/\D/g, '').slice(0, CODE_LEN));
                setError('');
              }}
              keyboardType="number-pad"
              maxLength={CODE_LEN}
              // SMS OTP autofill: Android (sms-otp) + iOS (oneTimeCode). The
              // overlay stays a real, focusable, full-size TextInput so the OS
              // can fill it — this is strictly more than the old screen had.
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              importantForAutofill="yes"
              style={styles.hiddenInput}
              autoFocus
              caretHidden
              accessibilityLabel="6-digit verification code"
            />
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title="Verify" spotlight onPress={handleVerify} loading={loading} style={styles.verifyBtn} />

          {/* Resend with countdown ring */}
          <View style={styles.resendRow}>
            {secondsLeft > 0 ? (
              <>
                <CountdownRing remaining={secondsLeft} total={RESEND_SECONDS} />
                <Text style={[Type.body, { color: Colors.textMuted }]}>Resend code in {secondsLeft}s</Text>
              </>
            ) : (
              <Pressable onPress={handleResend} hitSlop={8} style={styles.resendBtn}>
                <Text style={[Type.bodyMed, { color: Colors.accent }]}>Resend code</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: Space.xl, paddingTop: Space.xl },
  cellsRow: { flexDirection: 'row', gap: Space.sm, position: 'relative' },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    maxWidth: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: Colors.borderStrong },
  cellActive: { borderColor: Colors.accent, borderWidth: 2 },
  cellText: { ...Type.title, color: Colors.text },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },
  error: { ...Type.body, color: Colors.alert, marginTop: Space.lg },
  verifyBtn: { marginTop: Space.xl },
  resendRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: Space.xl, justifyContent: 'center' },
  ringLabel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resendBtn: { minHeight: Layout.tap, justifyContent: 'center' },
});
