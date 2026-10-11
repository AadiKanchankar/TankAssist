/**
 * Run: npx --yes tsx lib/sellThrough.test.ts
 */
import assert from 'node:assert/strict';
import {
  sellThroughIntervals,
  unexplainedSpotBottles,
  depletionFlagged,
  corroboratedSpotIds,
  fmtBottles,
  DEPLETION_SLACK_BOTTLES,
} from './sellThrough.ts';

const S = 'store', P = 'prod';
const c = (at: string, bottles: number) => ({ store_id: S, product_id: P, at, bottles });

// start 48 + delivered 24 − end 30 = sold 42
{
  const iv = sellThroughIntervals(
    [c('2026-10-01T10:00:00Z', 48), c('2026-10-08T10:00:00Z', 30)],
    [{ store_id: S, product_id: P, at: '2026-10-03T09:00:00Z', bottles: 24 }],
    [
      { store_id: S, product_id: P, at: '2026-10-05T12:00:00Z', bottles: 3, visit_id: 'v1', user_id: 'u' },
      { store_id: S, product_id: P, at: '2026-10-05T12:05:00Z', bottles: 2, visit_id: 'v1', user_id: 'u' },
    ],
  );
  assert.equal(iv.length, 1);
  assert.equal(iv[0].soldBottles, 42);
  assert.equal(iv[0].spotBottles, 5);
  assert.deepEqual(iv[0].spotVisitIds, ['v1']);
  assert.equal(unexplainedSpotBottles(iv[0]), 0);
  assert.equal(depletionFlagged(iv[0]), false);
}

// Window edges: a delivery AT the earlier count belongs before it; at the later count, inside.
{
  const iv = sellThroughIntervals(
    [c('2026-10-01T10:00:00Z', 10), c('2026-10-02T10:00:00Z', 10)],
    [
      { store_id: S, product_id: P, at: '2026-10-01T10:00:00Z', bottles: 100 },
      { store_id: S, product_id: P, at: '2026-10-02T10:00:00Z', bottles: 5 },
    ],
  );
  assert.equal(iv[0].deliveredBottles, 5);
  assert.equal(iv[0].soldBottles, 5);
}

// Spot sales claimed with no stock movement → flagged beyond the slack only.
{
  const spots = (n: number) => [{ store_id: S, product_id: P, at: '2026-10-05T12:00:00Z', bottles: n, visit_id: 'v', user_id: 'u' }];
  const counts = [c('2026-10-01T10:00:00Z', 24), c('2026-10-08T10:00:00Z', 24)];
  assert.equal(depletionFlagged(sellThroughIntervals(counts, [], spots(DEPLETION_SLACK_BOTTLES))[0]), false);
  assert.equal(depletionFlagged(sellThroughIntervals(counts, [], spots(DEPLETION_SLACK_BOTTLES + 1))[0]), true);
}

// Stock rose with no delivery → negative sold, counted as zero for spot checks.
{
  const iv = sellThroughIntervals([c('2026-10-01T10:00:00Z', 10), c('2026-10-02T10:00:00Z', 30)], [], [
    { store_id: S, product_id: P, at: '2026-10-01T12:00:00Z', bottles: 2, visit_id: 'v', user_id: 'u' },
  ]);
  assert.equal(iv[0].soldBottles, -20);
  assert.equal(unexplainedSpotBottles(iv[0]), 2);
}

// One count → no interval; separate products/stores don't mix; unordered input is sorted.
{
  const iv = sellThroughIntervals(
    [
      c('2026-10-08T10:00:00Z', 5),
      { store_id: 'other', product_id: P, at: '2026-10-02T10:00:00Z', bottles: 99 },
      c('2026-10-01T10:00:00Z', 20),
    ],
    [],
  );
  assert.equal(iv.length, 1);
  assert.equal(iv[0].soldBottles, 15);
}

// Corroboration: strict, per interval; pending (after the last count) never counts.
{
  const sp = (id: string, at: string, bottles: number) => ({ id, store_id: S, product_id: P, at, bottles, visit_id: 'v', user_id: 'u' });
  const iv = sellThroughIntervals(
    [c('2026-10-01T10:00:00Z', 24), c('2026-10-05T10:00:00Z', 20), c('2026-10-09T10:00:00Z', 20)],
    [],
    [sp('a', '2026-10-02T10:00:00Z', 3), sp('b', '2026-10-03T10:00:00Z', 1), sp('c', '2026-10-06T10:00:00Z', 2), sp('d', '2026-10-10T10:00:00Z', 1)],
  );
  // interval 1 sold 4, claims 4 → a, b; interval 2 sold 0, claims 2 → none; d after last count → pending.
  assert.deepEqual([...corroboratedSpotIds(iv)].sort(), ['a', 'b']);
}

assert.equal(fmtBottles(52, 24), '2 cs 4 btl');
assert.equal(fmtBottles(48, 24), '2 cs');
assert.equal(fmtBottles(5, 24), '5 btl');
assert.equal(fmtBottles(-26, 24), '−1 cs 2 btl');

console.log('sellThrough: all checks passed');
