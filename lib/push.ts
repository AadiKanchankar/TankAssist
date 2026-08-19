import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Push notification registration.
 *
 * WHY PUSH AT ALL: the existing Realtime subscription only delivers while the
 * app is open. A manager with the app closed learned nothing until they next
 * opened it, which for an 8am plan submission is the entire point. Push wakes
 * them; Realtime still updates any screen already open.
 *
 * NOTHING HERE EVER THROWS INTO THE CALLER. Registration is wired into login,
 * and a rep who declines notifications, runs an emulator, or has a flaky
 * network must still get all the way in. Every failure degrades to "no push,
 * everything else works".
 *
 * The FCM service-account key is NOT involved on this side: we obtain an Expo
 * push token and Expo relays to FCM using the credential held in EAS. No
 * notification secret exists in this app or in the database.
 */

// Foreground behaviour. SDK 56 replaced shouldShowAlert with the
// banner/list pair; using the old field silently shows nothing.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * The token for THIS device, cached once obtained.
 *
 * Kept so logout can delete precisely this row. Without it, a logout that
 * cannot re-derive the token would have to delete every row for the user,
 * silently unregistering their other devices.
 */
let cachedToken: string | null = null;

/** Matches the channelId the notify_plan_submitted trigger sends. */
const ANDROID_CHANNEL = 'default';

/**
 * Resolve this device's Expo push token, or null if it cannot be had.
 *
 * Returns null (never throws) for: an emulator, a declined permission prompt,
 * or a missing projectId.
 */
async function getToken(): Promise<string | null> {
  // Push tokens only exist on real hardware; an emulator throws rather than
  // returning empty, which would otherwise surface as a login error.
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    // Heads-up delivery on Android needs a channel to exist BEFORE the
    // notification arrives, and the trigger names this one explicitly.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Plan approvals',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  // Only prompt when the OS has not already decided. Asking again after a
  // denial is a no-op on both platforms and just costs a round-trip.
  if (status !== 'granted' && existing.canAskAgain) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data || null;
}

/**
 * Register this device against the signed-in user. Call after a session
 * exists — the RPC keys off auth.uid().
 */
export async function registerPushToken(): Promise<void> {
  try {
    const token = await getToken();
    if (!token) return;
    cachedToken = token;
    // register_push_token is the only legal writer: it reassigns the token if
    // another user held this handset, so a shared device follows whoever is
    // actually signed in.
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) {
      // Logged, not surfaced: a failed registration costs notifications, not
      // access, and the user is already past the login screen.
      console.warn('[push] register failed:', error.message);
    }
  } catch (e: any) {
    console.warn('[push] register skipped:', e?.message ?? e);
  }
}

/**
 * Drop this device's registration on logout.
 *
 * MUST be called BEFORE supabase.auth.signOut(): the delete policy is
 * `user_id = auth.uid()`, so after sign-out there is no uid and the row would
 * survive — leaving the next person to hold the phone receiving a manager's
 * plan notifications.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = cachedToken ?? (await getToken());
    if (token) {
      await supabase.from('push_tokens').delete().eq('token', token);
    } else {
      // Last resort: we could not identify this device, so clear every
      // registration this user owns. Over-deleting silences push on their
      // other devices until next login — annoying, but strictly better than
      // leaving a logged-out handset subscribed to their notifications.
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await supabase.from('push_tokens').delete().eq('user_id', data.user.id);
      }
    }
  } catch (e: any) {
    console.warn('[push] unregister failed:', e?.message ?? e);
  } finally {
    cachedToken = null;
  }
}
