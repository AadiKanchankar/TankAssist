/**
 * Run: npx --yes tsx lib/photoHash.test.ts
 * Same scene → (near-)identical hash; different scene → far apart; and the
 * value fits a Postgres bigint.
 */
import assert from 'node:assert/strict';
import { encode as jpegEncode } from 'jpeg-js';
import { dHash, dHashFromJpeg, hamming, HASH_W, HASH_H } from './photoHash.ts';

const img = (f: (x: number, y: number) => number) => {
  const d = new Uint8Array(HASH_W * HASH_H * 4);
  for (let y = 0; y < HASH_H; y++)
    for (let x = 0; x < HASH_W; x++) {
      const v = Math.max(0, Math.min(255, Math.round(f(x, y))));
      const i = (y * HASH_W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  return d;
};

const scene = (x: number, y: number) => 128 + 90 * Math.sin(x * 1.3 + y * 0.7);
const a = dHash(img(scene));
const brighter = dHash(img((x, y) => scene(x, y) + 15));
const other = dHash(img((x, y) => 128 + 90 * Math.cos(x * 0.4 - y * 1.9)));

assert.equal(hamming(a, a), 0);
assert.ok(hamming(a, brighter) <= 4, `brightness moved the hash: ${hamming(a, brighter)}`);
assert.ok(hamming(a, other) > 12, `different scenes too close: ${hamming(a, other)}`);

// Signed 64-bit range (Postgres bigint).
for (const h of [a, other]) {
  const n = BigInt(h);
  assert.ok(n >= -(2n ** 63n) && n < 2n ** 63n);
}

// Through a real JPEG round trip, as on the phone.
const viaJpeg = dHashFromJpeg(Uint8Array.from(jpegEncode({ data: img(scene), width: HASH_W, height: HASH_H }, 90).data));
assert.ok(hamming(a, viaJpeg) <= 4, `JPEG round trip moved the hash: ${hamming(a, viaJpeg)}`);

// Matches the server's arithmetic: bit_count((a # b)::bit(64)).
assert.equal(hamming('123456789', '123456788'), 1);

console.log('photoHash: all checks passed');
