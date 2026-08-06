import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

const BUCKET = 'visit-photos';
/** Locked bucket for original excise-permit documents (PDF/JPEG/PNG only). */
export const PERMITS_BUCKET = 'excise-permits';
/** The only file types that may ever be stored or parsed for a permit. */
export const PERMIT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
/**
 * Locked bucket for odometer evidence photos. NOT visit-photos: that bucket is
 * readable by any authenticated user, and an anti-cheat photo every rep can
 * read defeats its own purpose. Rep-insert, manager/management-select only.
 *
 * ⚠️ Like PERMITS_BUCKET, any odometer path MUST pass this bucket explicitly
 * when signing — signing it against the default bucket is the exact bug that
 * already shipped once with permits.
 */
export const ODOMETER_BUCKET = 'odometer-photos';

/** Local date as YYYY-MM-DD (used as a storage path segment). */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Make a store name safe for use in a storage path segment. */
function sanitizeName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || 'store';
}

/**
 * Low-level: read a local file and upload it to `path`.
 *
 * `bucket` defaults to visit-photos because that is where almost everything
 * goes; anything landing in a locked bucket passes it EXPLICITLY at the call
 * site, so the bucket is visible in the caller rather than assumed.
 */
async function uploadToPath(uri: string, path: string, bucket: string = BUCKET): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, decode(base64), {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) throw error;
  return path;
}

/**
 * Upload an attendance selfie (single photo per punch-in).
 * Path: selfies/{repId}/{YYYY-MM-DD}/{timestamp}.jpg
 */
export async function uploadSelfie(uri: string, repId: string): Promise<string> {
  const path = `selfies/${repId}/${todayStr()}/${Date.now()}.jpg`;
  return uploadToPath(uri, path);
}

/**
 * Upload one store-visit photo (multi-photo per visit).
 * Path: store-photos/{YYYY-MM-DD}/{storeId}-{sanitizedName}/{visitId}-{index}.jpg
 * storeId is the stable path key; the name is decorative and sanitized.
 */
export async function uploadStoreVisitPhoto(
  uri: string,
  storeId: string,
  storeName: string,
  visitId: string,
  index: number
): Promise<string> {
  const folder = `${storeId}-${sanitizeName(storeName)}`;
  const path = `store-photos/${todayStr()}/${folder}/${visitId}-${index}.jpg`;
  return uploadToPath(uri, path);
}

/**
 * Upload one stock-verification photo for a visit.
 * Path: stock-photos/{YYYY-MM-DD}/{storeId}/{visitId}-{index}.jpg
 */
export async function uploadStockPhoto(
  uri: string,
  storeId: string,
  visitId: string,
  index: number
): Promise<string> {
  const path = `stock-photos/${todayStr()}/${storeId}/${visitId}-${index}.jpg`;
  return uploadToPath(uri, path);
}

/**
 * Upload one delivered-stock photo captured when a rep marks an order delivered.
 * Path: delivered-photos/{YYYY-MM-DD}/{storeId}/{orderId}-{index}.jpg
 */
export async function uploadDeliveredPhoto(
  uri: string,
  storeId: string,
  orderId: string,
  index: number
): Promise<string> {
  const path = `delivered-photos/${todayStr()}/${storeId}/${orderId}-${index}.jpg`;
  return uploadToPath(uri, path);
}

/**
 * Upload a product master image (management add/edit). Client-keyed path so it
 * doesn't need the product id (works before the row is inserted).
 * Path: product-images/{timestamp}-{rand}.jpg
 */
export async function uploadProductImage(uri: string): Promise<string> {
  const path = `product-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  return uploadToPath(uri, path);
}

/**
 * Upload an odometer photo into the LOCKED odometer bucket.
 * Path: odometer/{repId}/{YYYY-MM-DD}/{start|end}.jpg
 *
 * One object per reading per day, so a re-take overwrites rather than
 * accumulating — hence upsert is not used and the caller handles the rare
 * conflict by re-reading. Reading the object back needs ODOMETER_BUCKET.
 */
export async function uploadOdometerPhoto(
  uri: string,
  repId: string,
  which: 'start' | 'end'
): Promise<string> {
  const path = `odometer/${repId}/${todayStr()}/${which}-${Date.now()}.jpg`;
  return uploadToPath(uri, path, ODOMETER_BUCKET);
}

/**
 * Signs a path and reports WHY it failed, so a caller can tell a genuinely
 * missing object apart from a transient/network failure.
 */
export async function signedUrlResult(
  filePath: string,
  expiresInSeconds: number = 3600,
  bucket: string = BUCKET
): Promise<{ url: string | null; notFound: boolean; message: string | null }> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data) {
    const message = error?.message ?? 'unknown error';
    return {
      url: null,
      notFound: /not\s*found|does not exist|no such|404/i.test(message),
      message,
    };
  }
  return { url: data.signedUrl, notFound: false, message: null };
}

/**
 * Gets a signed URL for a private file.
 * Default expiry is 1 hour (in-app display). The CSV export passes a
 * 90-day expiry explicitly — see lib/reportExport.ts.
 *
 * `bucket` defaults to visit-photos; excise permits live in their own locked
 * bucket and MUST pass PERMITS_BUCKET (signing a permit path against
 * visit-photos always fails, which is what broke "View original document").
 */
export async function getSignedUrl(
  filePath: string,
  expiresInSeconds: number = 3600,
  bucket: string = BUCKET
): Promise<string | null> {
  return (await signedUrlResult(filePath, expiresInSeconds, bucket)).url;
}

/**
 * Batch version: signs many paths in one round-trip.
 * Returns a map of path → signed URL (paths that failed are omitted).
 */
export async function getSignedUrls(
  filePaths: string[],
  expiresInSeconds: number = 3600
): Promise<Record<string, string>> {
  if (filePaths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(filePaths, expiresInSeconds);

  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) {
      map[item.path] = item.signedUrl;
    }
  }
  return map;
}
