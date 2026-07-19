/**
 * Google Places Autocomplete via REST API.
 * Used for address search when creating/editing stores.
 *
 * Uses the same server-side API key as geocoding.ts.
 * Requires Places API to be enabled on the key.
 */

const GOOGLE_MAPS_API_KEY = 'AIzaSyCiO0QLSvsKN6XMsu4PYqAb701GnIwRfrc';

export interface PlacePrediction {
  place_id: string;
  description: string;
}

export interface PlaceDetails {
  address: string;
  latitude: number;
  longitude: number;
}

/**
 * Returns autocomplete predictions for a partial address query.
 * Results are restricted to India.
 */
export async function searchPlaces(input: string): Promise<PlacePrediction[]> {
  if (!input.trim() || input.length < 3) return [];

  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
      `?input=${encodeURIComponent(input)}` +
      `&key=${GOOGLE_MAPS_API_KEY}` +
      `&components=country:in`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK') {
      return data.predictions.map((p: any) => ({
        place_id: p.place_id,
        description: p.description,
      }));
    }

    console.warn('[places] Search failed:', data.status, data.error_message);
    return [];
  } catch (err) {
    console.warn('[places] Search error:', err);
    return [];
  }
}

/**
 * Returns the full address + lat/lng for a given place_id.
 */
export async function getPlaceDetails(
  placeId: string
): Promise<PlaceDetails | null> {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${placeId}` +
      `&fields=formatted_address,geometry` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.result) {
      return {
        address: data.result.formatted_address,
        latitude: data.result.geometry.location.lat,
        longitude: data.result.geometry.location.lng,
      };
    }

    console.warn('[places] Details failed:', data.status, data.error_message);
    return null;
  } catch (err) {
    console.warn('[places] Details error:', err);
    return null;
  }
}
