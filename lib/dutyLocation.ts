import { Alert } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

/**
 * On-duty background GPS (owner decision 2026-10-03).
 *
 * Between punch-in and punch-out the phone reports its position every few
 * minutes to `report_duty_position`, so a manager's "Get location" answers
 * instantly from `rep_positions`. It replaced an ask/answer Realtime handshake
 * that never completed once in production: a pocketed phone's websocket is
 * suspended, so the rep's app never heard the question.
 *
 * Android requires a visible foreground-service notification for this and a
 * one-time "Allow all the time" grant; neither can be hidden or skipped.
 *
 * The SERVER decides when to stop: the RPC stores nothing and returns false
 * once the rep has no open attendance row (punch-out, the 22:30 sweep), and
 * the task then stops itself — so tracking never outlives the day even if the
 * app is never opened again.
 */

const TASK = 'duty-location';
const INTERVAL_MS = 3 * 60_000;

// Defined at module load and imported from index.ts: when Android restarts
// the service headless, the task must exist before any screen mounts.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return stopDutyTracking(); // signed out under a running service
  const loc = data.locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  const { data: onDuty, error: rpcError } = await supabase.rpc('report_duty_position', {
    p_lat: loc.coords.latitude,
    p_lng: loc.coords.longitude,
    p_accuracy: loc.coords.accuracy,
    p_mocked: loc.mocked ?? false,
    p_at: new Date(loc.timestamp).toISOString(),
  });
  // A network failure is not "off duty": keep running and try the next fix.
  if (!rpcError && onDuty === false) await stopDutyTracking();
});

const explain = () =>
  new Promise<void>((resolve) =>
    Alert.alert(
      'Share location while on duty',
      'Your manager can see where you are between punch-in and punch-out. ' +
        'On the next screen choose “Allow all the time”. Sharing stops when you punch out.',
      [{ text: 'Continue', onPress: () => resolve() }],
      { cancelable: false },
    ),
  );

/** Start tracking if permitted. Never throws: a rep must always be able to work. */
export async function startDutyTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) return;
    if ((await Location.getForegroundPermissionsAsync()).status !== 'granted') return;
    let bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== 'granted' && bg.canAskAgain) {
      await explain();
      bg = await Location.requestBackgroundPermissionsAsync();
    }
    if (bg.status !== 'granted') return; // manager's screen says "not updating"
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: INTERVAL_MS,
      distanceInterval: 0, // a rep standing in a shop must still refresh recorded_at
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'On duty',
        notificationBody: 'Your location is shared with your manager until you punch out.',
      },
    });
  } catch (e: any) {
    console.warn('[duty-location] start failed:', e?.message ?? e);
  }
}

export async function stopDutyTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) {
      await Location.stopLocationUpdatesAsync(TASK);
    }
  } catch (e: any) {
    console.warn('[duty-location] stop failed:', e?.message ?? e);
  }
}
