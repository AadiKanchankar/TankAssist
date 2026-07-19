import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { useAuthStore } from '../../store/useAuthStore';

export default function VerifyOtpScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const { phone } = route.params as { phone: string };
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const { verifyOtp, sendOtp, loading } = useAuthStore();

  const handleVerify = async () => {
    setError('');
    if (token.length !== 6) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    const result = await verifyOtp(phone, token);
    if (result.error) {
      setError(result.error);
    }
    // On success, auth state change triggers routing automatically
  };

  const handleResend = async () => {
    setError('');
    const result = await sendOtp(phone);
    if (result.error) {
      setError(result.error);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Header title="Verify OTP" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.instruction}>
          Enter the 6-digit code sent to
        </Text>
        <Text style={styles.phone}>{phone}</Text>

        <TextInput
          style={styles.otpInput}
          value={token}
          onChangeText={setToken}
          placeholder="000000"
          placeholderTextColor={Colors.muted}
          keyboardType="number-pad"
          maxLength={6}
          textAlign="center"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Verify"
          onPress={handleVerify}
          loading={loading}
          style={styles.verifyBtn}
        />

        <Button
          title="Resend OTP"
          onPress={handleResend}
          variant="secondary"
          style={styles.resendBtn}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 32,
    paddingTop: 32,
  },
  instruction: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
  phone: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
    marginTop: 4,
    marginBottom: 32,
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
  error: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.alert,
    marginTop: 16,
  },
  verifyBtn: {
    marginTop: 32,
  },
  resendBtn: {
    marginTop: 12,
    borderWidth: 0,
  },
});
