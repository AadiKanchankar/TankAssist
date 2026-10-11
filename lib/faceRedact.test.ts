/**
 * Face redaction checks. Pins the two things that must never regress: the
 * face region comes out as flat blocks (no detail survives), and pixels
 * outside it are untouched. Also proves the JPEG round trip works with NO
 * global Buffer, which is the React Native situation.
 *
 * Run: npx --yes tsx lib/faceRedact.test.ts
 */
import assert from 'node:assert/strict';
import { encode as jpegEncode, decode as jpegDecode } from 'jpeg-js';
import { redactRegions, redactJpeg, paddedBox, MOSAIC_BLOCKS } from './faceRedact.ts';

const W = 200;
const H = 160;
// High-frequency checkerboard: the worst case for "did detail survive".
const noisy = () => {
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = (x + y) % 2 ? 230 : 20;
      d[i] = v; d[i + 1] = 255 - v; d[i + 2] = (x * 7) % 256; d[i + 3] = 255;
    }
  return d;
};
const face = { x: 80, y: 60, w: 40, h: 40 };

// ── in-place mosaic ────────────────────────────────────────────────────────
{
  const before = noisy();
  const d = noisy();
  assert.equal(redactRegions(d, W, H, [face]), 1);
  const b = paddedBox(face, W, H);
  // The padded box covers the face with room to spare.
  assert.ok(b.x < face.x && b.y < face.y);
  assert.ok(b.x + b.w > face.x + face.w && b.y + b.h > face.y + face.h);

  // Distinct colours inside the box ≤ blocks², i.e. only flat blocks remain.
  const colours = new Set<string>();
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = (y * W + x) * 4;
      colours.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    }
  assert.ok(colours.size <= MOSAIC_BLOCKS * MOSAIC_BLOCKS, `too much detail: ${colours.size} colours`);

  // Outside the box: byte-identical.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
      const i = (y * W + x) * 4;
      assert.equal(d[i], before[i]);
    }
}

// ── edge-clamped and empty boxes never throw ───────────────────────────────
{
  const d = noisy();
  assert.equal(redactRegions(d, W, H, [{ x: -30, y: -30, w: 50, h: 50 }]), 1);
  assert.equal(redactRegions(d, W, H, [{ x: W + 10, y: 0, w: 20, h: 20 }]), 0);
  assert.equal(redactRegions(d, W, H, []), 0);
}

// ── JPEG round trip, with no global Buffer (React Native) ──────────────────
{
  const g = globalThis as any;
  const realBuffer = g.Buffer;
  const src = jpegEncode({ data: noisy(), width: W, height: H }, 95).data;
  const srcBytes = Uint8Array.from(src);
  delete g.Buffer;
  try {
    const out = redactJpeg(srcBytes, [face]);
    assert.ok(out instanceof Uint8Array && out.length > 100);
    assert.equal(typeof g.Buffer, 'undefined', 'the lent Buffer must be returned');
    g.Buffer = realBuffer;
    const back = jpegDecode(out, { useTArray: true });
    // At the centre of a mosaic block the checkerboard is gone: spread is JPEG
    // noise, not the original 20↔230 swing. (Block edges bleed a little from
    // their neighbours through chroma subsampling, so sample the middle.)
    const b = paddedBox(face, W, H);
    const block = Math.ceil(Math.max(b.w, b.h) / MOSAIC_BLOCKS);
    const cx = b.x + block + Math.floor(block / 2);
    const cy = b.y + block + Math.floor(block / 2);
    let min = 255, max = 0;
    for (let y = cy - 3; y <= cy + 3; y++)
      for (let x = cx - 3; x <= cx + 3; x++) {
        const v = back.data[(y * W + x) * 4];
        min = Math.min(min, v); max = Math.max(max, v);
      }
    assert.ok(max - min < 40, `detail survived the round trip: ${min}..${max}`);
  } finally {
    g.Buffer = realBuffer;
  }
}

console.log('faceRedact: all checks passed');
