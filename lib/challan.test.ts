/**
 * Challan helper checks — the brand-seeding heuristic, the all-zero-line rule
 * the DB also enforces, and the date validation a rep can type past.
 *
 * Run: npx --yes tsx lib/challan.test.ts
 */
import assert from 'node:assert/strict';
import {
  isOwnBrand,
  sortOwnBrandFirst,
  toQty,
  filledLines,
  challanTotals,
  challanDateError,
  todayStr,
  ChallanLine,
} from './challan.ts';

// ── own-brand detection, against the LIVE catalog's actual spellings ──────
assert.ok(isOwnBrand('Tank 90 select', 'AVPL'), 'name carries the brand');
assert.ok(isOwnBrand('Tank 90 z', 'Tank90'), 'brand written without a space');
assert.ok(isOwnBrand('Tank x', 'AVPL'), 'the x variant');
assert.ok(isOwnBrand('T-90 Strong', null), 'hyphenated short form');
assert.ok(isOwnBrand('Tank 900', null), '900 is not truncated to 90');
assert.ok(!isOwnBrand('Kingfisher Premium', 'UB'), 'a competitor is not ours');
assert.ok(!isOwnBrand('Texas 90 Lager', null), 'letters between t and 90 do not match');

// ── sorting floats our line to the top without dropping anything ──────────
{
  const products = [
    { name: 'Kingfisher', brand: 'UB' },
    { name: 'Tank 90 z', brand: 'Tank90' },
    { name: 'Budweiser', brand: 'AB' },
    { name: 'Tank x', brand: 'AVPL' },
  ];
  const sorted = sortOwnBrandFirst(products);
  assert.deepEqual(
    sorted.map((p) => p.name),
    ['Tank 90 z', 'Tank x', 'Budweiser', 'Kingfisher'],
    'ours first, then alphabetical within each group',
  );
  assert.equal(sorted.length, products.length, 'sorting never drops a product');
}

// ── quantity cells ────────────────────────────────────────────────────────
assert.equal(toQty(''), 0, 'blank is zero');
assert.equal(toQty('12'), 12);
assert.equal(toQty('-5'), 5, 'a typed minus cannot make a negative quantity');
assert.equal(toQty('abc'), 0, 'junk is zero, never NaN');

// ── an all-zero line must never be sent: the DB refuses it (23514) ────────
{
  const lines: ChallanLine[] = [
    { product_id: 'p1', qty_qts: 0, qty_pints: 0, qty_nips: 0 },
    { product_id: 'p2', qty_qts: 0, qty_pints: 48, qty_nips: 0 },
  ];
  const kept = filledLines(lines);
  assert.equal(kept.length, 1, 'the untouched product row is dropped');
  assert.equal(kept[0].product_id, 'p2');

  const t = challanTotals(kept);
  assert.deepEqual(t, { qts: 0, pints: 48, nips: 0, bottles: 48 });
}

// ── date validation ───────────────────────────────────────────────────────
{
  const today = '2026-08-18';
  assert.equal(challanDateError('2026-08-18', today), null, 'today is fine');
  assert.equal(challanDateError('2026-08-17', today), null, 'yesterday is fine');
  assert.ok(challanDateError('2026-08-19', today), 'a delivery cannot be in the future');
  assert.ok(challanDateError('2026-02-31', today), '31 Feb does not exist');
  assert.ok(challanDateError('18-08-2026', today), 'wrong format is rejected');
  assert.ok(challanDateError('', today), 'empty is rejected');
  // The default argument must agree with the helper the form seeds itself from.
  assert.equal(challanDateError(todayStr()), null, 'the default date always validates');
}

console.log('challan.test.ts: all assertions passed');
