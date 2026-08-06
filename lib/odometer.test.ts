/**
 * Odometer rules. The three that matter:
 *   1. a reading below the day's start is refused (odometers don't reverse)
 *   2. the OCR candidate picker prefers the odometer over the trip meter
 *   3. the GPS mismatch flag is GENEROUS — honest detours must not flag
 *
 * Run: npx --yes tsx lib/odometer.test.ts
 */
import assert from 'node:assert/strict';
import {
  extractOdometerCandidate,
  checkReading,
  dailyDistance,
  mismatchFlag,
  MISMATCH_FLOOR_KM,
  MAX_DAILY_KM,
} from './odometer.ts';

// ── picking the odometer out of a dashboard ───────────────────────────────
{
  // The classic: odometer 12345, trip meter 67.8 — the decimal point is the tell.
  assert.equal(extractOdometerCandidate('12345 67.8'), 12345);
  assert.equal(extractOdometerCandidate('67.8 12345'), 12345, 'order does not matter');
  // A speed readout is too short to qualify.
  assert.equal(extractOdometerCandidate('45120 km/h 60'), 45120);
  // Longest run wins over merely largest.
  assert.equal(extractOdometerCandidate('999 104523'), 104523);
  // Noise / nothing usable.
  assert.equal(extractOdometerCandidate('km/h ---'), null);
  assert.equal(extractOdometerCandidate(''), null);
  assert.equal(extractOdometerCandidate('12'), null, 'too few digits to be an odometer');
  assert.equal(extractOdometerCandidate('123456789012'), null, 'too many digits');
}

// ── plausibility ──────────────────────────────────────────────────────────
{
  assert.equal(checkReading(45120).ok, true);
  assert.equal(checkReading(null).ok, false);
  assert.equal(checkReading(-1).reason, 'not-a-number');
  assert.equal(checkReading(12).reason, 'too-few-digits');
  assert.equal(checkReading(12345678).reason, 'too-many-digits');
}

// ── ODOMETERS DO NOT GO BACKWARDS ─────────────────────────────────────────
{
  const bad = checkReading(45000, 45120);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'below-start');
  assert.match(bad.message!, /don't go backwards/);
  assert.match(bad.message!, /45120/, 'tells the rep what the morning reading was');

  assert.equal(checkReading(45120, 45120).ok, true, 'a day with no travel is legitimate');
  assert.equal(checkReading(45195, 45120).ok, true);

  const far = checkReading(45120 + MAX_DAILY_KM + 1, 45120);
  assert.equal(far.reason, 'implausible-daily');
}

// ── daily distance ────────────────────────────────────────────────────────
{
  assert.equal(dailyDistance(45120, 45195), 75);
  assert.equal(dailyDistance(45120, 45120), 0, 'a zero-travel day is a real answer, not null');
  assert.equal(dailyDistance(null, 45195), null);
  assert.equal(dailyDistance(45120, null), null);
  assert.equal(dailyDistance(45195, 45120), null, 'negative is never a distance');
}

// ── the mismatch flag must tolerate an honest day ─────────────────────────
{
  // Rep's tracked route was 40 km; they also rode to petrol, lunch, a xerox
  // shop and took a wrong turn — 58 km on the clock. That is a normal day.
  const honest = mismatchFlag(45120, 45178, 40);
  assert.equal(honest.flagged, false, 'ordinary detours must NOT flag');
  assert.equal(honest.odoKm, 58);

  // Even a fairly loose day stays clean.
  assert.equal(mismatchFlag(45120, 45184, 40).flagged, false, '64km vs 40km route is still fine');

  // The gross case the feature exists for: route 5 km, claims 80 km.
  const gross = mismatchFlag(45120, 45200, 5);
  assert.equal(gross.flagged, true);
  assert.equal(gross.excessKm, 75);
  assert.match(gross.reason!, /80 km/);
  assert.match(gross.reason!, /5 km/);
  assert.match(gross.reason!, /Worth asking/, 'wording invites a question, not an accusation');

  // The absolute floor protects short days from percentage noise:
  // a 2km route with 20km on the clock is 10x over but under the floor.
  assert.equal(mismatchFlag(45120, 45140, 2).flagged, false, 'floor shields tiny routes');
  assert.ok(20 - 2 < MISMATCH_FLOOR_KM);
}

// ── under-claiming is not an anti-cheat signal ─────────────────────────────
{
  // Odometer says 10 km, GPS route says 90 km. Odd, but it cannot inflate TA,
  // so it must not consume a manager's attention.
  const under = mismatchFlag(45120, 45130, 90);
  assert.equal(under.flagged, false, 'under-reporting cannot overclaim TA');
  assert.equal(under.excessKm, -80);
}

// ── missing data never flags ──────────────────────────────────────────────
{
  assert.equal(mismatchFlag(null, 45195, 40).flagged, false, 'no start reading');
  assert.equal(mismatchFlag(45120, null, 40).flagged, false, 'no end reading');
  assert.equal(mismatchFlag(45120, 45195, null).flagged, false, 'not punched out yet');
  assert.equal(mismatchFlag(null, null, null).odoKm, null);
}

console.log('odometer.test.ts: all assertions passed');
