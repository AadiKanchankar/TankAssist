/**
 * Run:  npx --yes tsx supabase/functions/parse-excise-permit/classify.test.ts
 */
import assert from 'node:assert/strict';
import { classifyMovement, isUsable, type FacilityRow } from './classify.ts';

const TODAY = '2026-07-29';

const fac = (over: Partial<FacilityRow> & Pick<FacilityRow, 'id' | 'license_no' | 'facility_type'>): FacilityRow => ({
  is_active: true,
  valid_from: null,
  valid_until: null,
  ...over,
});

const FACTORY = fac({ id: 'f1', license_no: 'FAC-1', facility_type: 'factory' });
const WAREHOUSE = fac({ id: 'w1', license_no: 'WH-1', facility_type: 'warehouse' });
const WAREHOUSE2 = fac({ id: 'w2', license_no: 'WH-2', facility_type: 'warehouse' });

// ── licence validity ──────────────────────────────────────────────────────
assert.equal(isUsable(WAREHOUSE, TODAY), true, 'no dates set -> usable');
assert.equal(isUsable(fac({ ...WAREHOUSE, valid_until: '2026-07-28' }), TODAY), false, 'expired yesterday');
assert.equal(isUsable(fac({ ...WAREHOUSE, valid_until: TODAY }), TODAY), true, 'expires today -> still valid today');
assert.equal(isUsable(fac({ ...WAREHOUSE, valid_from: '2026-08-01' }), TODAY), false, 'not yet in force');
assert.equal(isUsable(fac({ ...WAREHOUSE, is_active: false }), TODAY), false, 'retired facility');

// ── the happy paths ───────────────────────────────────────────────────────
{
  const c = classifyMovement('FAC-1', 'WH-1', [FACTORY, WAREHOUSE], TODAY);
  assert.equal(c.direction, 'factory_to_warehouse');
  assert.equal(c.facilityFromId, 'f1');
  assert.equal(c.facilityToId, 'w1');
}
{
  const c = classifyMovement('WH-1', 'WH-2', [WAREHOUSE, WAREHOUSE2], TODAY);
  assert.equal(c.direction, 'internal_transfer', 'both ours');
}
{
  // Destination licence is nowhere in the registry -> genuinely an outside party.
  const c = classifyMovement('WH-1', 'L1-9999', [WAREHOUSE], TODAY);
  assert.equal(c.direction, 'warehouse_to_l1');
  assert.equal(c.facilityToId, null);
}

// ── THE REGRESSION: expired ≠ external ────────────────────────────────────
// Our own warehouse whose licence lapsed must never be read as an external L1;
// booking that as warehouse_to_l1 would record an internal transfer as a sale.
{
  const expired = fac({ ...WAREHOUSE2, valid_until: '2026-01-01' });
  const c = classifyMovement('WH-1', 'WH-2', [WAREHOUSE, expired], TODAY);
  assert.equal(c.direction, 'unclassified', 'expired destination of OURS -> human decides, not warehouse_to_l1');
  assert.equal(c.facilityToId, null, 'an expired licence still must not auto-populate');
  assert.equal(c.facilityFromId, 'w1', 'the side that IS valid is still populated');
}
{
  const retired = fac({ ...WAREHOUSE2, is_active: false });
  const c = classifyMovement('WH-1', 'WH-2', [WAREHOUSE, retired], TODAY);
  assert.equal(c.direction, 'unclassified', 'retired destination of OURS -> not an external L1');
}

// ── partial resolution ────────────────────────────────────────────────────
{
  // Source unknown (L-32 never prints the supplier licence number).
  const c = classifyMovement(null, 'WH-1', [WAREHOUSE], TODAY);
  assert.equal(c.direction, 'unclassified', 'one side unknown -> no guess');
  assert.equal(c.facilityToId, 'w1', 'the side that resolved is still auto-populated');
  assert.equal(c.facilityFromId, null);
}
{
  const c = classifyMovement('FAC-1', 'L1-9999', [FACTORY], TODAY);
  assert.equal(c.direction, 'unclassified', 'factory -> outside party is not a modelled movement');
}

console.log('classify.test.ts: all assertions passed');
