/**
 * Stock-bucket arithmetic checks. The point is to pin down the two rules that
 * are easy to break silently: absent != zero, and totals must roll loose
 * bottles up into cases instead of drifting.
 *
 * Run: npx --yes tsx lib/stockBuckets.test.ts
 */
import assert from 'node:assert/strict';
import {
  emptyBuckets,
  bucketBottles,
  bucketTotals,
  snapshotPayload,
  bucketBreakdown,
  BucketEntries,
} from './stockBuckets.ts';

const PER = 24; // Tank 90 select: 24 bottles per carton

const buckets = (o: Partial<Record<'floor' | 'display' | 'godown', [string, string]>>): BucketEntries => {
  const b = emptyBuckets();
  for (const [k, v] of Object.entries(o)) {
    b[k as 'floor'] = { cases: v![0], bottles: v![1] };
  }
  return b;
};

// ── absent is not zero ─────────────────────────────────────────────────────
{
  assert.equal(bucketBottles({ cases: '', bottles: '' }, PER), null, 'blank bucket -> null');
  assert.equal(bucketBottles({ cases: '0', bottles: '0' }, PER), 0, 'explicit zero -> 0, not null');
  assert.equal(bucketBottles(undefined, PER), null, 'missing bucket -> null');

  const p = snapshotPayload(buckets({ floor: ['1', '0'] }), PER);
  assert.equal(p.floor_cases, 1);
  assert.equal(p.godown_cases, null, 'untouched godown stays null, never 0');
  assert.equal(p.godown_bottles, null);

  const z = snapshotPayload(buckets({ godown: ['0', '0'] }), PER);
  assert.equal(z.godown_cases, 0, 'a counted-and-empty godown is a real 0');
}

// ── totals normalise, they do not drift ────────────────────────────────────
// floor 2cs+20btl = 68, display 1cs+10btl = 34  ->  102 bottles
// 102 = 4 cases + 6 loose (naive string-sum would say 3 cs + 30 btl)
{
  const t = bucketTotals(buckets({ floor: ['2', '20'], display: ['1', '10'] }), PER);
  assert.equal(t.cases, 4, 'loose bottles roll up into whole cases');
  assert.equal(t.bottles, 6);
  assert.equal(t.anyRecorded, true);
}

// ── all three buckets ──────────────────────────────────────────────────────
{
  const t = bucketTotals(buckets({ floor: ['1', '0'], display: ['2', '0'], godown: ['3', '0'] }), PER);
  assert.equal(t.cases, 6, 'total is the sum of the three buckets');
  assert.equal(t.bottles, 0);
}

// ── nothing recorded ───────────────────────────────────────────────────────
{
  const t = bucketTotals(emptyBuckets(), PER);
  assert.equal(t.anyRecorded, false, 'drives "do not write a snapshot for this product"');
  assert.equal(t.cases, 0);
  const p = snapshotPayload(emptyBuckets(), PER);
  assert.equal(p.cases, 0);
  assert.equal(p.floor_cases, null);
}

// ── a product with no usable units-per-case never fabricates cases ─────────
{
  const t = bucketTotals(buckets({ display: ['0', '17'] }), 0);
  assert.equal(t.cases, 0, 'no per-case figure -> no case arithmetic');
  assert.equal(t.bottles, 17);
}

// ── legacy rows: total survives, breakdown is honestly absent ──────────────
{
  const legacy = {
    cases: 12, bottles: 3,
    floor_cases: null, floor_bottles: null,
    display_cases: null, display_bottles: null,
    godown_cases: null, godown_bottles: null,
  };
  assert.deepEqual(bucketBreakdown(legacy), [], 'no split is invented for pre-split rows');

  const split = { ...legacy, floor_cases: 5, floor_bottles: 0, display_cases: 7, display_bottles: 3 };
  const b = bucketBreakdown(split);
  assert.equal(b.length, 2, 'only recorded buckets appear — godown is still absent');
  assert.equal(b[0].label, 'Floor stock');
  assert.equal(b[1].cases, 7);
}

console.log('stockBuckets.test.ts: all assertions passed');
