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
  shelfFigure,
  BucketEntries,
} from './stockBuckets.ts';

const PER = 24; // Tank 90 select: 24 bottles per carton

const buckets = (o: Partial<Record<'shelf' | 'godown', [string, string]>>): BucketEntries => {
  const b = emptyBuckets();
  for (const [k, v] of Object.entries(o)) {
    b[k as 'shelf'] = { cases: v![0], bottles: v![1] };
  }
  return b;
};

// ── absent is not zero ─────────────────────────────────────────────────────
{
  assert.equal(bucketBottles({ cases: '', bottles: '' }, PER), null, 'blank bucket -> null');
  assert.equal(bucketBottles({ cases: '0', bottles: '0' }, PER), 0, 'explicit zero -> 0, not null');
  assert.equal(bucketBottles(undefined, PER), null, 'missing bucket -> null');

  const p = snapshotPayload(buckets({ shelf: ['1', '0'] }), PER);
  assert.equal(p.shelf_cases, 1);
  assert.equal(p.godown_cases, null, 'untouched godown stays null, never 0');
  assert.equal(p.godown_bottles, null);

  const z = snapshotPayload(buckets({ godown: ['0', '0'] }), PER);
  assert.equal(z.godown_cases, 0, 'a counted-and-empty godown is a real 0');
}

// ── totals normalise, they do not drift ────────────────────────────────────
// shelf 3cs+30btl = 102 bottles -> 4 cases + 6 loose
// (a naive string-sum would report 3 cs + 30 btl)
{
  const t = bucketTotals(buckets({ shelf: ['3', '30'] }), PER);
  assert.equal(t.cases, 4, 'loose bottles roll up into whole cases');
  assert.equal(t.bottles, 6);
  assert.equal(t.anyRecorded, true);
}

// ── both buckets ───────────────────────────────────────────────────────────
{
  const t = bucketTotals(buckets({ shelf: ['3', '0'], godown: ['3', '0'] }), PER);
  assert.equal(t.cases, 6, 'total is the sum of the two buckets');
  assert.equal(t.bottles, 0);
}

// ── nothing recorded ───────────────────────────────────────────────────────
{
  const t = bucketTotals(emptyBuckets(), PER);
  assert.equal(t.anyRecorded, false, 'drives "do not write a snapshot for this product"');
  assert.equal(t.cases, 0);
  const p = snapshotPayload(emptyBuckets(), PER);
  assert.equal(p.cases, 0);
  assert.equal(p.shelf_cases, null);
}

// ── a product with no usable units-per-case never fabricates cases ─────────
{
  const t = bucketTotals(buckets({ shelf: ['0', '17'] }), 0);
  assert.equal(t.cases, 0, 'no per-case figure -> no case arithmetic');
  assert.equal(t.bottles, 17);
}

// ── pre-split rows: total survives, no split is invented ───────────────────
{
  const preSplit = {
    cases: 12, bottles: 3,
    shelf_cases: null, shelf_bottles: null,
    floor_cases: null, floor_bottles: null,
    display_cases: null, display_bottles: null,
    godown_cases: null, godown_bottles: null,
  };
  assert.deepEqual(bucketBreakdown(preSplit), [], 'no split is invented for pre-split rows');
  assert.equal(shelfFigure(preSplit, 'cases').value, null, 'absent stays absent');
}

// ── THE MERGE: old floor+display rows read as one shelf figure, marked legacy
// Nothing is rewritten in the DB; the sum happens on read.
{
  const preMerge = {
    cases: 12, bottles: 3,
    shelf_cases: null, shelf_bottles: null,
    floor_cases: 5, floor_bottles: 0,
    display_cases: 7, display_bottles: 3,
    godown_cases: null, godown_bottles: null,
  };
  const sc = shelfFigure(preMerge, 'cases');
  assert.equal(sc.value, 12, 'floor 5 + display 7 = 12 on the shelf');
  assert.equal(sc.legacy, true, 'MUST be flagged: two readings summed, not one shelf count');

  const b = bucketBreakdown(preMerge);
  assert.equal(b.length, 1, 'godown was never recorded, so it does not appear');
  assert.equal(b[0].label, 'Shelf stock');
  assert.equal(b[0].cases, 12);
  assert.equal(b[0].legacy, true, 'the UI has to be able to say this is a merged figure');
}

// ── a post-merge row is NOT legacy ─────────────────────────────────────────
{
  const modern = {
    cases: 9, bottles: 0,
    shelf_cases: 9, shelf_bottles: 0,
    floor_cases: null, floor_bottles: null,
    display_cases: null, display_bottles: null,
    godown_cases: 0, godown_bottles: 0,
  };
  const sc = shelfFigure(modern, 'cases');
  assert.equal(sc.value, 9);
  assert.equal(sc.legacy, false, 'a real shelf reading is never labelled legacy');
  const b = bucketBreakdown(modern);
  assert.equal(b.length, 2, 'a counted-and-empty godown DOES appear');
  assert.equal(b[1].cases, 0);
}

// ── shelf_* wins over stale legacy columns if both somehow exist ───────────
{
  const both = {
    cases: 4, bottles: 0,
    shelf_cases: 4, shelf_bottles: 0,
    floor_cases: 99, floor_bottles: 0,
    display_cases: 99, display_bottles: 0,
    godown_cases: null, godown_bottles: null,
  };
  assert.equal(shelfFigure(both, 'cases').value, 4, 'the modern column is authoritative');
  assert.equal(shelfFigure(both, 'cases').legacy, false);
}

// ── null-vs-zero survives the merge ────────────────────────────────────────
{
  const zeroFloorOnly = {
    cases: 0, bottles: 0,
    shelf_cases: null, shelf_bottles: null,
    floor_cases: 0, floor_bottles: null,
    display_cases: null, display_bottles: null,
    godown_cases: null, godown_bottles: null,
  };
  const sc = shelfFigure(zeroFloorOnly, 'cases');
  assert.equal(sc.value, 0, 'a counted-and-empty floor is a real 0, not absent');
  assert.equal(sc.legacy, true);
}

console.log('stockBuckets.test.ts: all assertions passed');
