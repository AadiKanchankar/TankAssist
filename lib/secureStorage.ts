import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * SecureStore-backed storage adapter for the Supabase auth session.
 *
 * Why this exists: expo-secure-store stores values in the Android Keystore /
 * iOS Keychain (encrypted at rest), but rejects values larger than ~2048
 * bytes. A Supabase session (access JWT + refresh token + user object) is
 * several KB, so we split the value into fixed-size chunks stored under
 * `${key}.<index>` and keep the chunk count at the base `${key}`.
 *
 * It also performs a one-time migration: if a legacy plaintext session is
 * found in AsyncStorage (the previous adapter), it is moved into SecureStore
 * and deleted from AsyncStorage — so existing users are not force-logged-out
 * by the upgrade.
 */

// Worst case UTF-8 is 3 bytes per JS UTF-16 code unit (BMP), so 600 units
// stays comfortably under the 2048-byte SecureStore limit (600 * 3 = 1800).
const CHUNK_SIZE = 600;

// SecureStore keys allow only [A-Za-z0-9._-]. Supabase keys already comply;
// sanitize defensively for anything else.
function baseKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function splitChunks(value: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < value.length) {
    let end = Math.min(i + CHUNK_SIZE, value.length);
    // Never split a surrogate pair across a chunk boundary — an unpaired
    // surrogate would corrupt on UTF-8 round-trip.
    if (end < value.length) {
      const code = value.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    chunks.push(value.substring(i, end));
    i = end;
  }
  return chunks;
}

async function getChunkCount(bk: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(bk);
  if (raw == null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function setItem(key: string, value: string): Promise<void> {
  const bk = baseKey(key);
  const prevCount = await getChunkCount(bk);
  const chunks = splitChunks(value);

  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(`${bk}.${i}`, chunks[i]);
  }
  // Remove any stale trailing chunks left over from a previously longer value.
  for (let i = chunks.length; i < prevCount; i++) {
    await SecureStore.deleteItemAsync(`${bk}.${i}`);
  }
  await SecureStore.setItemAsync(bk, String(chunks.length));
}

async function getItem(key: string): Promise<string | null> {
  const bk = baseKey(key);
  const count = await getChunkCount(bk);

  if (count > 0) {
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${bk}.${i}`);
      if (part == null) return null; // partial/corrupt write — treat as absent
      parts.push(part);
    }
    return parts.join('');
  }

  // One-time migration from the legacy AsyncStorage adapter.
  const legacy = await AsyncStorage.getItem(key);
  if (legacy != null) {
    await setItem(key, legacy);
    await AsyncStorage.removeItem(key);
    return legacy;
  }

  return null;
}

async function removeItem(key: string): Promise<void> {
  const bk = baseKey(key);
  const count = await getChunkCount(bk);
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(`${bk}.${i}`);
  }
  await SecureStore.deleteItemAsync(bk);
  // Clear any legacy copy as well.
  await AsyncStorage.removeItem(key);
}

/** Storage adapter conforming to Supabase's `SupportedStorage` interface. */
export const SecureStorageAdapter = {
  getItem,
  setItem,
  removeItem,
};
