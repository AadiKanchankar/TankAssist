/**
 * Bounding-box and ordering checks, verified against REAL coordinates rather
 * than invented ones — the task called for exactly that.
 *
 * Reference points (Maharashtra + Delhi, matching live store data):
 *   Pune       18.5204 N,  73.8567 E
 *   Mumbai     19.0760 N,  72.8777 E   (~120 km WNW of Pune)
 *   Nashik     19.9975 N,  73.7898 E   (~165 km N of Pune)
 *   New Delhi  28.6139 N,  77.2090 E   (~1170 km N of Pune)
 *
 * Run: npx --yes tsx lib/geoScope.test.ts
 */
import assert from 'node:assert/strict';
import { boundingBox, byDistanceFrom, DEFAULT_SCOPE_KM } from './geoScope.ts';
import { haversineKm } from './haversine.ts';

const PUNE = { latitude: 18.5204, longitude: 73.8567 };
const MUMBAI = { latitude: 19.076, longitude: 72.8777 };
const NASHIK = { latitude: 19.9975, longitude: 73.7898 };
const DELHI = { latitude: 28.6139, longitude: 77.209 };

const inBox = (p: { latitude: number; longitude: number }, b: ReturnType<typeof boundingBox>) =>
  p.latitude >= b.minLat && p.latitude <= b.maxLat && p.longitude >= b.minLng && p.longitude <= b.maxLng;

// ── sanity: the reference distances are what we think they are ─────────────
{
  const puneMumbai = haversineKm(PUNE.latitude, PUNE.longitude, MUMBAI.latitude, MUMBAI.longitude);
  assert.ok(puneMumbai > 110 && puneMumbai < 130, `Pune-Mumbai ~120km, got ${puneMumbai.toFixed(1)}`);
  const puneDelhi = haversineKm(PUNE.latitude, PUNE.longitude, DELHI.latitude, DELHI.longitude);
  assert.ok(puneDelhi > 1100 && puneDelhi < 1250, `Pune-Delhi ~1170km, got ${puneDelhi.toFixed(1)}`);
}

// ── the box actually spans the requested radius ────────────────────────────
{
  const b = boundingBox(PUNE.latitude, PUNE.longitude, DEFAULT_SCOPE_KM);
  // North edge must be at least the radius away (box is inscribed-square-ish).
  const north = haversineKm(PUNE.latitude, PUNE.longitude, b.maxLat, PUNE.longitude);
  assert.ok(north >= DEFAULT_SCOPE_KM - 1, `north edge ${north.toFixed(1)}km >= 100km`);
  // East edge too — this is the one that breaks if cos(lat) is forgotten.
  const east = haversineKm(PUNE.latitude, PUNE.longitude, PUNE.latitude, b.maxLng);
  assert.ok(east >= DEFAULT_SCOPE_KM - 1, `east edge ${east.toFixed(1)}km >= 100km`);
}

// ── longitude degrees are WIDER than latitude degrees away from the equator ─
// Forgetting cos(lat) is the classic bug: it under-fetches east/west.
{
  const b = boundingBox(PUNE.latitude, PUNE.longitude, 100);
  const latSpan = b.maxLat - b.minLat;
  const lngSpan = b.maxLng - b.minLng;
  assert.ok(lngSpan > latSpan, 'at 18.5N a 100km lng span needs more degrees than lat');
  // cos(18.52) ~ 0.948, so the ratio should be ~1/0.948 ~ 1.055
  assert.ok(Math.abs(lngSpan / latSpan - 1 / Math.cos((18.5204 * Math.PI) / 180)) < 0.01);
}

// ── who lands in a 100km box around Pune ───────────────────────────────────
{
  const b = boundingBox(PUNE.latitude, PUNE.longitude, DEFAULT_SCOPE_KM);
  assert.equal(inBox(PUNE, b), true, 'the origin is in its own box');
  assert.equal(inBox(DELHI, b), false, 'Delhi is 1170km away — correctly out of scope');
  // Nashik at ~165km is outside a 100km box; widen and it comes in.
  assert.equal(inBox(NASHIK, b), false, 'Nashik is beyond 100km');
  assert.equal(inBox(NASHIK, boundingBox(PUNE.latitude, PUNE.longitude, 250)), true);
}

// ── polar safety: cos(lat) -> 0 must not produce Infinity ──────────────────
{
  const b = boundingBox(89.9, 10, 100);
  assert.ok(Number.isFinite(b.minLng) && Number.isFinite(b.maxLng), 'no Infinity near the pole');
  assert.ok(b.maxLat <= 90 && b.minLat >= -90, 'latitude stays on the globe');
  assert.ok(b.maxLng <= 180 && b.minLng >= -180, 'longitude stays on the globe');
}

// ── ordering, including the live "store with no coordinates" case ──────────
{
  const stores = [
    { id: 'delhi', ...DELHI },
    { id: 'nocoords', latitude: null, longitude: null },
    { id: 'mumbai', ...MUMBAI },
    { id: 'pune', ...PUNE },
  ];
  const sorted = byDistanceFrom(stores, PUNE.latitude, PUNE.longitude, haversineKm);
  assert.deepEqual(
    sorted.map((s) => s.id),
    ['pune', 'mumbai', 'delhi', 'nocoords'],
    'nearest first; a coordinate-less store sorts last but is NOT dropped',
  );
  assert.equal(sorted.length, stores.length, 'nothing is silently hidden');
}

console.log('geoScope.test.ts: all assertions passed');
