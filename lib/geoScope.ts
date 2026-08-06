/**
 * Geographic scoping for store lists.
 *
 * A rep works roughly a 100 km radius, so showing every store in the country
 * is both slow and noise. We scope the DEFAULT list and let search reach
 * everything — a store outside the box is always still findable by name.
 *
 * Why a bounding box rather than a real distance query: PostGIS/earthdistance
 * are not installed, and a box is expressible in plain PostgREST range filters
 * (`gte`/`lte`) against the existing latitude/longitude columns. We over-fetch
 * a slightly larger square, then order precisely client-side with the
 * haversine helper the app already has. No extension, no RPC.
 *
 * Pure — see lib/geoScope.test.ts.
 */

/** A rep's working radius. Generous: better to over-fetch than hide a store. */
export const DEFAULT_SCOPE_KM = 100;

/** Mean Earth radius, same constant lib/haversine.ts uses. */
const EARTH_R_KM = 6371;

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Square-ish box of `radiusKm` around a point.
 *
 * Latitude degrees are ~constant (111 km), but longitude degrees shrink toward
 * the poles by cos(latitude) — at Pune (18.5°N) a degree of longitude is ~105
 * km, and ignoring that would under-fetch east/west. Near the poles cos()
 * approaches 0, so the longitude span is clamped to the whole world rather
 * than exploding to infinity.
 */
export function boundingBox(lat: number, lng: number, radiusKm = DEFAULT_SCOPE_KM): BoundingBox {
  const degLat = (radiusKm / EARTH_R_KM) * (180 / Math.PI);
  const cos = Math.cos((lat * Math.PI) / 180);
  const degLng = Math.abs(cos) < 1e-6 ? 180 : degLat / Math.abs(cos);
  return {
    minLat: Math.max(-90, lat - degLat),
    maxLat: Math.min(90, lat + degLat),
    minLng: Math.max(-180, lng - Math.min(degLng, 180)),
    maxLng: Math.min(180, lng + Math.min(degLng, 180)),
  };
}

export interface Locatable {
  latitude: number | null;
  longitude: number | null;
}

/**
 * Order by distance from a point, nearest first.
 *
 * Rows with no coordinates sort LAST rather than being dropped: live data
 * already contains stores with a null latitude, and silently hiding one from
 * the rep who needs it would be worse than showing it at the bottom.
 */
export function byDistanceFrom<T extends Locatable>(
  items: T[],
  lat: number,
  lng: number,
  distanceKm: (aLat: number, aLng: number, bLat: number, bLng: number) => number,
): T[] {
  const d = (s: T) =>
    s.latitude == null || s.longitude == null
      ? Number.POSITIVE_INFINITY
      : distanceKm(lat, lng, s.latitude, s.longitude);
  return [...items].sort((a, b) => d(a) - d(b));
}
