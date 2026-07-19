/**
 * Reverse geocoding via Google Maps Geocoding API.
 * Converts lat/lng coordinates → human-readable address (and, for store
 * location capture, the Indian state).
 *
 * Note: This requires the Geocoding API to be enabled on the
 * Google Maps Platform API key below.
 */

const GOOGLE_MAPS_API_KEY = 'AIzaSyCiO0QLSvsKN6XMsu4PYqAb701GnIwRfrc';

export interface ReverseGeocodeResult {
  address: string;
  /** administrative_area_level_1 long_name (e.g. "Maharashtra"), or null. */
  state: string | null;
}

interface GeocodingComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GeocodingResult {
  formatted_address: string;
  address_components?: GeocodingComponent[];
}

interface GeocodingResponse {
  status: string;
  results: GeocodingResult[];
  error_message?: string;
}

/** First administrative_area_level_1 long_name found across results, or null. */
function extractState(results: GeocodingResult[]): string | null {
  for (const r of results) {
    for (const c of r.address_components || []) {
      if (c.types?.includes('administrative_area_level_1')) {
        return c.long_name;
      }
    }
  }
  return null;
}

/**
 * Reverse-geocodes to both the formatted address and the Indian state, from
 * a single API response. Never throws — on failure returns a "lat, lng"
 * address and null state, so callers don't need try/catch.
 */
export async function reverseGeocodeDetailed(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult> {
  const fallback = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${latitude},${longitude}` +
      `&key=${GOOGLE_MAPS_API_KEY}` +
      `&result_type=street_address|route|sublocality|locality`;

    const response = await fetch(url);
    const data: GeocodingResponse = await response.json();

    if (data.status === 'OK' && data.results.length > 0) {
      return {
        address: data.results[0].formatted_address,
        state: extractState(data.results),
      };
    }

    console.warn('[geocoding] No results:', data.status, data.error_message);
    return { address: fallback, state: null };
  } catch (err) {
    console.warn('[geocoding] Failed:', err);
    return { address: fallback, state: null };
  }
}

/**
 * Returns a human-readable address for the given GPS coordinates.
 * Falls back to a formatted lat/lng string if the API call fails,
 * so this function never throws — callers don't need try/catch.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<string> {
  return (await reverseGeocodeDetailed(latitude, longitude)).address;
}
