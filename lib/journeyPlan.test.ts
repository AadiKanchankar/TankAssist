/**
 * PJP flag-derivation checks. These pin down the rules that are easy to break
 * silently: an approved plan clears the flag, a near-midnight visit is worded
 * gently, and mock-location NULL is not evidence.
 *
 * Run: npx --yes tsx lib/journeyPlan.test.ts
 */
import assert from 'node:assert/strict';
import {
  planDateFor,
  nearDateBoundary,
  flagsForVisit,
  sortFlags,
  editDistance,
  nameLooksSame,
  findDuplicateCandidates,
  JourneyPlan,
  VisitForFlags,
} from './journeyPlan.ts';
import { haversineKm } from './haversine.ts';

const plan = (o: Partial<JourneyPlan> = {}): JourneyPlan => ({
  id: 'pl1',
  rep_id: 'r1',
  plan_date: '2026-08-04',
  status: 'approved',
  submitted_at: '2026-08-04T02:00:00Z',
  reviewed_by: 'm1',
  reviewed_at: '2026-08-04T03:00:00Z',
  reject_reason: null,
  store_ids: ['s1', 's2'],
  ...o,
});

const visit = (o: Partial<VisitForFlags> = {}): VisitForFlags => ({
  id: 'v1',
  store_id: 's1',
  check_in_time: '2026-08-04T10:00:00',
  latitude: 18.52,
  longitude: 73.85,
  distance_from_store_meters: 20,
  is_mock_location: false,
  ...o,
});

// ── local date ────────────────────────────────────────────────────────────
assert.equal(planDateFor(new Date(2026, 7, 4, 9, 0)), '2026-08-04');
assert.equal(planDateFor(new Date(2026, 0, 9, 23, 30)), '2026-01-09', 'zero-padded');

// ── the clean case: nothing to flag ───────────────────────────────────────
{
  const f = flagsForVisit(visit(), plan(), null, haversineKm);
  assert.deepEqual(f, [], 'an on-plan, approved, nearby, non-mocked visit is silent');
}

// ── an APPROVED plan clears the status flag; submitted/rejected do not ────
{
  const sub = flagsForVisit(visit(), plan({ status: 'submitted' }), null, haversineKm);
  assert.equal(sub.length, 1);
  assert.equal(sub[0].kind, 'plan_not_approved');
  assert.equal(sub[0].soft, true, 'awaiting approval is the managers own backlog - soft');

  const rej = flagsForVisit(visit(), plan({ status: 'rejected' }), null, haversineKm);
  assert.equal(rej[0].kind, 'plan_not_approved');
  assert.notEqual(rej[0].soft, true, 'working under a rejected plan is not soft');

  const none = flagsForVisit(visit(), null, null, haversineKm);
  assert.equal(none[0].kind, 'plan_not_approved');
}

// ── mock location: only `true` is evidence ────────────────────────────────
{
  assert.equal(flagsForVisit(visit({ is_mock_location: null }), plan(), null, haversineKm).length, 0,
    'NULL = an older build never reported; not an accusation');
  const f = flagsForVisit(visit({ is_mock_location: true }), plan(), null, haversineKm);
  assert.equal(f[0].kind, 'mock_location');
}

// ── far from store, and unknown distance is not a flag ────────────────────
{
  assert.equal(flagsForVisit(visit({ distance_from_store_meters: 900 }), plan(), null, haversineKm)[0].kind,
    'far_from_store');
  assert.equal(flagsForVisit(visit({ distance_from_store_meters: null }), plan(), null, haversineKm).length, 0,
    'unknown distance flags nothing');
}

// ── impossible movement ───────────────────────────────────────────────────
{
  // Pune -> Mumbai (~120 km) in 15 minutes is not happening on the ground.
  const prev = visit({ id: 'v0', check_in_time: '2026-08-04T09:45:00', latitude: 19.076, longitude: 72.877 });
  const f = flagsForVisit(visit(), plan(), prev, haversineKm);
  assert.equal(f[0].kind, 'impossible_movement');

  // The same journey over 4 hours is an ordinary drive.
  const slow = visit({ id: 'v0', check_in_time: '2026-08-04T06:00:00', latitude: 19.076, longitude: 72.877 });
  assert.deepEqual(flagsForVisit(visit(), plan(), slow, haversineKm), []);
}

// ── off-plan, and the near-midnight false positive ────────────────────────
{
  const off = flagsForVisit(visit({ store_id: 's9' }), plan(), null, haversineKm);
  assert.equal(off[0].kind, 'off_plan');
  assert.notEqual(off[0].soft, true, 'a midday off-plan visit is a plain flag');
  assert.match(off[0].reason, /not on the approved plan/);

  // Same visit at 23:30 — the local-date rule may have resolved it to the
  // wrong plan, so the wording must invite a check, not level an accusation.
  assert.equal(nearDateBoundary('2026-08-04T23:30:00'), true);
  assert.equal(nearDateBoundary('2026-08-04T02:00:00'), true);
  assert.equal(nearDateBoundary('2026-08-04T14:00:00'), false);

  const late = flagsForVisit(
    visit({ store_id: 's9', check_in_time: '2026-08-04T23:30:00' }), plan(), null, haversineKm);
  const lateOffPlan = late.find((x) => x.kind === 'off_plan')!;
  assert.equal(lateOffPlan.soft, true, 'date-boundary off-plan is soft');
  assert.match(lateOffPlan.reason, /neighbouring day/, 'names the benign explanation');
  assert.match(lateOffPlan.reason, /Worth confirming/, 'invites a check rather than accusing');
  assert.doesNotMatch(lateOffPlan.reason, /not on the approved plan for this day/);
}

// ── ordering: hard flags first, soft ones last ────────────────────────────
{
  const sorted = sortFlags([
    { kind: 'off_plan', reason: 'x', soft: true },
    { kind: 'far_from_store', reason: 'y' },
    { kind: 'mock_location', reason: 'z' },
  ]);
  assert.deepEqual(sorted.map((f) => f.kind), ['mock_location', 'far_from_store', 'off_plan']);
}

// ── store de-duplication ──────────────────────────────────────────────────
{
  assert.equal(editDistance('suraj', 'sruaj'), 1, 'an adjacent swap is one typo, not two');
  assert.equal(editDistance('suraj', 'surajx'), 1, 'plain insertion still costs 1');
  assert.equal(nameLooksSame('Suraj Wines', 'Sruaj wines'), true, 'transposed typo still matches');
  assert.equal(nameLooksSame('Suraj Wines', 'Deccan Brews Cafe'), false);

  const existing = [
    { id: 's1', name: 'Suraj Wines', latitude: 18.5200, longitude: 73.8500 },
    { id: 's2', name: 'Deccan Brews Cafe', latitude: 18.6000, longitude: 73.9000 },
    { id: 's3', name: 'Sruaj Wines', latitude: null, longitude: null },
  ];
  // New store ~30 m from s1 AND fuzzy-matching its name.
  const m = findDuplicateCandidates('Suraj Wine', 18.5202, 73.8501, existing, haversineKm);
  assert.equal(m[0].store.id, 's1');
  assert.equal(m[0].why, 'both', 'proximity + name is the strongest signal, ranked first');
  assert.ok(m.some((x) => x.store.id === 's3' && x.why === 'name'),
    'a coordinate-less typo duplicate is still caught by name');
  assert.ok(!m.some((x) => x.store.id === 's2'), 'an unrelated distant store is not offered');

  // A genuinely new shop in an empty area offers nothing and blocks nothing.
  assert.deepEqual(findDuplicateCandidates('Brand New Bar', 19.9, 72.1, existing, haversineKm), []);
}

console.log('journeyPlan.test.ts: all assertions passed');
