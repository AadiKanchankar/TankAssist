import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

const BUCKET = 'visit-photos';

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

/** Low-level: read a local file and upload it to `path` in the private bucket. */
async function uploadToPath(uri: string, path: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { error } = await supabase.storage
    .from(BUCKET)
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
 * Gets a signed URL for a private photo.
 * Default expiry is 1 hour (in-app display). The CSV export passes a
 * 90-day expiry explicitly — see lib/reportExport.ts.
 */
export async function getSignedUrl(
  filePath: string,
  expiresInSeconds: number = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data) return null;
  return data.signedUrl;
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
