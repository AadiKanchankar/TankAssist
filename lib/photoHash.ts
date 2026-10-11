/**
 * 64-bit difference hash (dHash) for spot-sale photos.
 *
 * The caller shrinks the uploaded image to exactly 9×8 (expo-image-manipulator)
 * and hands the JPEG bytes here. Each bit says whether a pixel is brighter than
 * its right-hand neighbour, so the hash survives recompression, small
 * brightness changes and resizing — what changes it is different content.
 * Near-duplicates are found SERVER-side (spot_sale_before_insert: Hamming
 * distance ≤ 4 against every earlier hash), because a sales manager can't read
 * other managers' rows and the company-wide comparison must still happen.
 *
 * Returned as a signed 64-bit decimal string — Postgres bigint, sent through
 * PostgREST as a string so no precision is lost in JSON.
 *
 * ponytail: client-computed, so a tampered client could send any hash. That
 * defeats this one flag only; it is a flag, never a gate. Server-side hashing
 * would need an Edge Function reading the object — add it if reuse is seen.
 */
import { decode as jpegDecode } from 'jpeg-js';

export const HASH_W = 9;
export const HASH_H = 8;

/** dHash of a 9×8 RGBA buffer. */
export function dHash(rgba: Uint8Array, width = HASH_W, height = HASH_H): string {
  if (width !== HASH_W || height !== HASH_H) throw new Error('dHash needs a 9×8 image.');
  const g = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  let h = 0n;
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) h = (h << 1n) | (g(x, y) > g(x + 1, y) ? 1n : 0n);
  }
  return BigInt.asIntN(64, h).toString();
}

/** dHash straight from the 9×8 JPEG produced by the resize step. */
export function dHashFromJpeg(jpeg: Uint8Array): string {
  const img = jpegDecode(jpeg, { useTArray: true, formatAsRGBA: true });
  return dHash(img.data, img.width, img.height);
}

/** Bits that differ between two hashes (what the server compares). */
export function hamming(a: string, b: string): number {
  let x = BigInt.asUintN(64, BigInt(a) ^ BigInt(b));
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
