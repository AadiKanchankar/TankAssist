// @ts-ignore — no type declarations for side-effect polyfill
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { SecureStorageAdapter } from './secureStorage';

const SUPABASE_URL = 'https://ldgunrxceogfrohjrlxz.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkZ3VucnhjZW9nZnJvaGpybHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDg5NzgsImV4cCI6MjA5NjQ4NDk3OH0.A16lbHx701b6sT_-to4Y2CrcyghNgD4eDQxGvJ7gRpk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Session is stored encrypted (Android Keystore / iOS Keychain) via a
    // chunked expo-secure-store adapter — not plaintext AsyncStorage.
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Ephemeral client used ONLY for Management's "Add User" OTP enrollment. It
// never persists a session and has no auth-state listener, so sending/verifying
// the NEW employee's OTP here can never touch the signed-in manager's session
// on the main client. The manager's session stays put; the new profile row is
// then INSERTed via the MAIN client under the management session.
export const enrollClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'tankassist-enroll-ephemeral',
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
