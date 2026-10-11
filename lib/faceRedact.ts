/**
 * Face redaction — the pure half of on-device face blur (lib/faceBlur.ts).
 *
 * Kept free of react-native imports so it runs under `npx tsx` (see
 * faceRedact.test.ts), the same split as inventoryMath vs useInventoryAnalytics.
 *
 * The redaction is a COARSE mosaic: each padded face box is cut into at most
 * MOSAIC_BLOCKS blocks across, and every block is replaced by its mean colour.
 * At that resolution the face is a few flat patches of skin and hair tone —
 * nothing a recogniser can match. A fine mosaic (8+ blocks across a face) is
 * known to be partly reversible by trained models; this one is deliberately
 * not, at the cost of looking blunt. The pixels are overwritten in the decoded
 * image and the result is re-encoded, so the original values are not in the
 * output file in any form.
 */
import { decode as jpegDecode, encode as jpegEncode } from 'jpeg-js';

/** A face box in image pixels, as ML Kit reports it (origin + size). */
export interface FaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Blocks across the PADDED box. The face itself spans ~3 of them. */
export const MOSAIC_BLOCKS = 4;
/**
 * ML Kit's box is tight around the face; hair, ears and chin sit outside it.
 * Pad generously — over-covering a shoulder costs nothing, under-covering an
 * ear-to-jaw outline can be enough to recognise someone.
 */
const PAD_X = 0.35;
const PAD_TOP = 0.5;
const PAD_BOTTOM = 0.35;

/** The padded, image-clamped box that actually gets redacted. */
export function paddedBox(r: FaceRect, width: number, height: number): FaceRect {
  const x0 = Math.max(0, Math.floor(r.x - r.w * PAD_X));
  const y0 = Math.max(0, Math.floor(r.y - r.h * PAD_TOP));
  const x1 = Math.min(width, Math.ceil(r.x + r.w * (1 + PAD_X)));
  const y1 = Math.min(height, Math.ceil(r.y + r.h * (1 + PAD_BOTTOM)));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Overwrite each face region of an RGBA buffer with a coarse mosaic, in place.
 * Returns the number of regions actually redacted (empty boxes are skipped).
 */
export function redactRegions(
  data: Uint8Array,
  width: number,
  height: number,
  faces: FaceRect[],
): number {
  let done = 0;
  for (const f of faces) {
    const b = paddedBox(f, width, height);
    if (b.w <= 0 || b.h <= 0) continue;
    const block = Math.max(1, Math.ceil(Math.max(b.w, b.h) / MOSAIC_BLOCKS));
    for (let by = b.y; by < b.y + b.h; by += block) {
      for (let bx = b.x; bx < b.x + b.w; bx += block) {
        const ex = Math.min(bx + block, b.x + b.w);
        const ey = Math.min(by + block, b.y + b.h);
        let r = 0, g = 0, bl = 0, n = 0;
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            const i = (y * width + x) * 4;
            r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
          }
        }
        r = Math.round(r / n); g = Math.round(g / n); bl = Math.round(bl / n);
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            const i = (y * width + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = bl; data[i + 3] = 255;
          }
        }
      }
    }
    done++;
  }
  return done;
}

/**
 * Decode a JPEG, mosaic the faces, re-encode. Throws on a JPEG it cannot read,
 * which the caller treats as "not checked" — never as "nothing to blur".
 */
export function redactJpeg(jpeg: Uint8Array, faces: FaceRect[], quality = 85): Uint8Array {
  const img = jpegDecode(jpeg, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 30 });
  redactRegions(img.data, img.width, img.height, faces);
  // jpeg-js's encoder ends with `Buffer.from(bytes)` whenever `module` exists,
  // which it does under Metro — and React Native has no Buffer. Lend it a
  // minimal one for this synchronous call only, so nothing else in the app
  // ever feature-detects a half-implemented global.
  const g = globalThis as any;
  const lent = typeof g.Buffer === 'undefined';
  if (lent) g.Buffer = { from: (a: ArrayLike<number>) => Uint8Array.from(a) };
  try {
    const out = jpegEncode({ data: img.data, width: img.width, height: img.height }, quality);
    return out.data instanceof Uint8Array ? out.data : Uint8Array.from(out.data as any);
  } finally {
    if (lent) delete g.Buffer;
  }
}
