import * as Location from 'expo-location';

/**
 * A position taken NOW, not one the phone remembered.
 *
 * Android's fused provider will answer getCurrentPositionAsync with a fix from
 * a minute or two ago when it considers that "recent enough" — and for a rep
 * walking between shops 50 m apart, recent-enough is the PREVIOUS shop. That is
 * how a check-in recorded the last store's position and a new store was saved
 * with its neighbour's coordinates. The fix carries its own timestamp, so we
 * check it: too old, and we watch for a genuinely new one.
 *
 * If no fresh fix arrives in time (indoors, weak signal) the old one comes back
 * with `fresh: false`, so the screen can SAY the position may be out of date
 * rather than silently using it.
 */

/** Older than this, a fix was taken somewhere else. */
export const MAX_FIX_AGE_MS = 10_000;
/** How long to wait for a new fix before settling for the old one. */
const WAIT_FOR_FRESH_MS = 15_000;

export interface Fix {
  loc: Location.LocationObject;
  fresh: boolean;
}

export function isFreshFix(fixTimestamp: number, askedAt: number, maxAgeMs = MAX_FIX_AGE_MS): boolean {
  return askedAt - fixTimestamp <= maxAgeMs;
}

export async function freshPosition(
  accuracy: Location.Accuracy = Location.Accuracy.BestForNavigation,
): Promise<Fix> {
  const askedAt = Date.now();
  const first = await Location.getCurrentPositionAsync({ accuracy });
  if (isFreshFix(first.timestamp, askedAt)) return { loc: first, fresh: true };

  return new Promise<Fix>((resolve) => {
    let sub: Location.LocationSubscription | null = null;
    let settled = false;
    const finish = (fix: Fix) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.remove();
      resolve(fix);
    };
    const timer = setTimeout(() => finish({ loc: first, fresh: false }), WAIT_FOR_FRESH_MS);
    Location.watchPositionAsync({ accuracy, timeInterval: 1000, distanceInterval: 0 }, (loc) => {
      if (isFreshFix(loc.timestamp, askedAt)) finish({ loc, fresh: true });
    })
      .then((s) => {
        if (settled) s.remove();
        else sub = s;
      })
      .catch(() => finish({ loc: first, fresh: false }));
  });
}

/**
 * Fire-and-forget warm-up: one request, result discarded, so the GPS already
 * has satellites when the rep reaches a screen that needs a fix. Never prompts
 * for permission and never tracks — it is a single ask.
 */
export function warmLocation(): void {
  Location.getForegroundPermissionsAsync()
    .then((p) => {
      if (p.status === 'granted') {
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => {});
      }
    })
    .catch(() => {});
}
