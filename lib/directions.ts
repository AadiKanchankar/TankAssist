/**
 * Google Directions API — real road-network route distance.
 *
 * Used ONCE per day at punch-out to compute the rep's total travel
 * distance for TA (travel allowance) purposes, following the rep's
 * ACTUAL visited sequence (origin → ordered waypoints → destination).
 *
 * This intentionally does NOT optimize the waypoint order — the rep's
 * real path is what matters for payout, not the theoretically shortest
 * route. Hence `optimize:false`.
 *
 * Uses the same server-side API key as geocoding.ts / places.ts.
 * Requires the Directions API to be enabled on the key.
 *
 * Straight-line Haversine (lib/haversine.ts) is still used for the
 * passive per-store proximity logging — only this end-of-day total
 * uses the road network.
 */

const GOOGLE_MAPS_API_KEY = 'AIzaSyCiO0QLSvsKN6XMsu4PYqAb701GnIwRfrc';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface DirectionsRoute {
  /** Total driving distance, km (2 dp). */
  km: number;
  /** One entry per leg: waypoints[i] -> waypoints[i+1], km (2 dp). */
  legsKm: number[];
}

const toKm = (meters: number) => Math.round((meters / 1000) * 100) / 100;

/**
 * Driving distance along the ordered list of points: waypoints[0] is the
 * origin, the last element is the destination, and everything in between is
 * passed as intermediate waypoints in the given order (optimize:false).
 *
 * Returns the per-leg distances too — they used to be summed and thrown away,
 * which left the manager's route drill-down nothing but straight lines.
 *
 * Returns `null` on any failure (network error, API error status, or
 * fewer than 2 points) so the caller can fall back to Haversine.
 * This function never throws.
 */
export async function directionsRoute(waypoints: LatLng[]): Promise<DirectionsRoute | null> {
  // Need at least an origin and a destination to form a route.
  if (!waypoints || waypoints.length < 2) return null;

  try {
    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediate = waypoints.slice(1, -1);

    let url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    if (intermediate.length > 0) {
      // optimize:false — preserve the rep's actual visited order.
      const waypointStr = intermediate
        .map((w) => `${w.latitude},${w.longitude}`)
        .join('|');
      url += `&waypoints=optimize:false|${waypointStr}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.routes && data.routes.length > 0) {
      const legMeters: number[] = data.routes[0].legs.map((leg: any) => leg.distance?.value || 0);
      // Total from raw meters, not from the rounded legs, so it matches what
      // was stored before legs were kept.
      return { km: toKm(legMeters.reduce((s, m) => s + m, 0)), legsKm: legMeters.map(toKm) };
    }

    console.warn(
      '[directions] Route failed:',
      data.status,
      data.error_message
    );
    return null;
  } catch (err) {
    console.warn('[directions] Error:', err);
    return null;
  }
}
