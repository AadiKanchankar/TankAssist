import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from './supabase';
import { haversineKm } from './haversine';
import { FAR_AT_CHECKOUT_METERS } from './journeyPlan';

/**
 * Closing a visit, in one place.
 *
 * Both the stepper's final step and the dashboard's persistent checkout card
 * close visits, and they must agree exactly — same position capture, same
 * warning, same columns written. Two copies of this would drift, and the one
 * that drifted would be the one writing the anti-cheat evidence.
 */

export interface CheckoutPosition {
  lat: number;
  lng: number;
  /** Metres from the store, or null when the store has no saved coordinates. */
  distance: number | null;
}

export interface StoreCoords {
  name: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * The rep's position as they close the visit.
 *
 * Returns null when there is no fix. Checkout must NEVER be blocked on GPS — a
 * rep in a basement still has to close their visit — and a null reads as "not
 * observed" downstream rather than "close enough".
 */
export async function readCheckoutPosition(store: StoreCoords): Promise<CheckoutPosition | null> {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });
    const lat = loc.coords.latitude;
    const lng = loc.coords.longitude;
    return {
      lat,
      lng,
      distance:
        store.latitude != null && store.longitude != null
          ? Math.round(haversineKm(lat, lng, store.latitude, store.longitude) * 1000)
          : null,
    };
  } catch {
    return null;
  }
}

/** True when this exit will be flagged for the manager. */
export function isFarCheckout(pos: CheckoutPosition | null): boolean {
  return pos?.distance != null && pos.distance > FAR_AT_CHECKOUT_METERS;
}

/**
 * Tell the rep the exit will be flagged, and let them decide anyway.
 * Flag-don't-block: resolving false means they chose to go back, not that we
 * refused them.
 */
export function confirmFarCheckout(pos: CheckoutPosition, storeName: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'You’re away from the store',
      `You’re about ${pos.distance} m from ${storeName}. You can still check out, but it will be flagged for your manager to review.`,
      [
        { text: 'Go back', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Check out anyway', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

/**
 * Close a visit the rep is deliberately checking out of.
 *
 * `extra` carries anything the caller alone knows (notes, cover photo). The
 * dashboard card passes none — by the time it is used, the interstitial has
 * already committed that data.
 */
export async function closeVisit(opts: {
  visitId: string;
  checkInTime: string | null;
  pos: CheckoutPosition | null;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const checkOutTime = new Date().toISOString();
  const durationMinutes = opts.checkInTime
    ? Math.round((Date.parse(checkOutTime) - Date.parse(opts.checkInTime)) / 60000)
    : null;

  const { error } = await supabase
    .from('store_visits')
    .update({
      check_out_time: checkOutTime,
      duration_minutes: durationMinutes,
      // Stored, not merely checked: far_at_checkout is derived from these on
      // the manager's side, so a client that skips the warning is still caught.
      checkout_latitude: opts.pos?.lat ?? null,
      checkout_longitude: opts.pos?.lng ?? null,
      checkout_distance_meters: opts.pos?.distance ?? null,
      ...(opts.extra ?? {}),
    })
    .eq('id', opts.visitId);
  if (error) throw error;
}

/**
 * Close the visit a rep left open at the previous shop, because they are
 * checking in at the next one.
 *
 * Writes the marker and NOTHING else. duration_minutes stays null — we know
 * when we closed it, not when they actually left — and no checkout position is
 * recorded, because the only position available is the NEXT store's and
 * stamping it here would be a fabricated exit. Same discipline as the 22:30
 * sweep, and the flag it raises is deliberately not soft: this rep had a
 * working phone, they just checked in with it.
 */
export async function closeVisitOnNextCheckin(visitId: string): Promise<void> {
  const { error } = await supabase
    .from('store_visits')
    .update({ check_out_time: new Date().toISOString(), closed_on_next_checkin: true })
    .eq('id', visitId);
  if (error) throw error;
}
