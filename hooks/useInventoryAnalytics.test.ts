/**
 * Ledger arithmetic checks. Numbers are chosen so every expected value can be
 * verified by hand — the point is to catch sign errors, double-counting of
 * internal transfers, and bad bottle/case normalisation.
 *
 * Run: npx --yes tsx hooks/useInventoryAnalytics.test.ts
 */
import assert from 'node:assert/strict';
import { computeAnalytics, fmtQty, MovementRow } from '../lib/inventoryMath.ts';
import { financialYearStartYmd, financialYearLabel } from '../lib/financialYear.ts';

const PROD = [{ id: 'p1', name: 'Tank 90 select', qty_per_carton: 24 }];
const FAC = [
  { id: 'fct', name: 'Factory', facility_type: 'factory' },
  { id: 'wh1', name: 'Warehouse 1', facility_type: 'warehouse' },
  { id: 'wh2', name: 'Warehouse 2', facility_type: 'warehouse' },
];
const FY = '2026-04-01';

const mv = (o: Partial<MovementRow>): MovementRow => ({
  product_id: 'p1',
  direction: 'factory_to_warehouse',
  facility_from_id: null,
  facility_to_id: null,
  cases: 0,
  remainder_bottles: 0,
  movement_date: '2026-06-01',
  ...o,
} as MovementRow);

// ── financial year ────────────────────────────────────────────────────────
assert.equal(financialYearStartYmd(new Date(2026, 5, 15)), '2026-04-01', 'June -> FY starts this Apr');
assert.equal(financialYearStartYmd(new Date(2026, 2, 15)), '2025-04-01', 'March -> FY started last Apr');
assert.equal(financialYearStartYmd(new Date(2026, 3, 1)), '2026-04-01', 'Apr 1 is the boundary');
assert.equal(financialYearLabel(new Date(2026, 5, 1)), 'FY 2026–27');

// ── inbound only ──────────────────────────────────────────────────────────
{
  const a = computeAnalytics([mv({ facility_to_id: 'wh1', cases: 100, remainder_bottles: 10 })], PROD, FAC, FY);
  assert.equal(a.ytdFactoryToWarehouse.cases, 100);
  assert.equal(a.ytdFactoryToWarehouse.bottles, 10);
  assert.equal(a.totalBalance.cases, 100);
  assert.equal(a.totalBalance.bottles, 10);
}

// ── the case the naive approach gets wrong ────────────────────────────────
// in 46 cases + 8 bottles, out 24 cases + 17 bottles.
// Naive: 46-24 = 22 cases, 8-17 = -9 bottles  ✗
// Correct in bottles: (46*24+8) - (24*24+17) = 1112 - 593 = 519 = 21 cases + 15
{
  const a = computeAnalytics(
    [
      mv({ facility_to_id: 'wh1', cases: 46, remainder_bottles: 8 }),
      mv({ direction: 'warehouse_to_l1', facility_from_id: 'wh1', cases: 24, remainder_bottles: 17 }),
    ],
    PROD,
    FAC,
    FY,
  );
  assert.equal(a.totalBalance.cases, 21, 'borrows a case rather than going negative on bottles');
  assert.equal(a.totalBalance.bottles, 15);
  assert.equal(a.ytdWarehouseToL1.cases, 24);
  assert.equal(a.ytdWarehouseToL1.bottles, 17);
}

// ── internal transfer moves stock, never creates or destroys it ────────────
{
  const a = computeAnalytics(
    [
      mv({ facility_to_id: 'wh1', cases: 50 }),
      mv({ direction: 'internal_transfer', facility_from_id: 'wh1', facility_to_id: 'wh2', cases: 20 }),
    ],
    PROD,
    FAC,
    FY,
  );
  assert.equal(a.totalBalance.cases, 50, 'company-wide total unchanged by an internal transfer');
  const p = a.byProduct[0];
  const wh1 = p.byWarehouse.find((w) => w.facilityId === 'wh1')!;
  const wh2 = p.byWarehouse.find((w) => w.facilityId === 'wh2')!;
  assert.equal(wh1.qty.cases, 30, 'source warehouse debited');
  assert.equal(wh2.qty.cases, 20, 'destination warehouse credited');
  // an internal transfer is neither an inbound nor an outbound YTD figure
  assert.equal(a.ytdFactoryToWarehouse.cases, 50);
  assert.equal(a.ytdWarehouseToL1.cases, 0);
}

// ── FY boundary: movements before the FY start are excluded from YTD but
//    still counted in the running balance (balance is all-time by design) ───
{
  const a = computeAnalytics(
    [
      mv({ facility_to_id: 'wh1', cases: 10, movement_date: '2026-03-31' }), // previous FY
      mv({ facility_to_id: 'wh1', cases: 5, movement_date: '2026-04-01' }), // this FY
    ],
    PROD,
    FAC,
    FY,
  );
  assert.equal(a.ytdFactoryToWarehouse.cases, 5, 'YTD counts only this FY');
  assert.equal(a.totalBalance.cases, 15, 'balance carries stock forward across FYs');
}

// ── an internal transfer touching a non-warehouse does not move balance ────
// direction says nothing about which end is a warehouse, so an unknown
// facility on an internal transfer is genuinely unattributable.
{
  const a = computeAnalytics(
    [
      mv({ facility_to_id: 'wh1', cases: 40 }),
      mv({ direction: 'internal_transfer', facility_from_id: 'wh1', facility_to_id: 'unknown', cases: 9 }),
    ],
    PROD,
    FAC,
    FY,
  );
  assert.equal(a.totalBalance.cases, 31, 'debited from wh1; the unknown end credits nothing');
}

// ── null-facility ledger rows still count (the live 2026-08 bug) ───────────
// Permits approved before company_facilities had any rows wrote movements with
// null facility ids. Direction is the source of truth: those 50 cases entered a
// warehouse and must appear in the balance, not vanish.
{
  const a = computeAnalytics([mv({ cases: 50 })], PROD, [], FY);
  assert.equal(a.ytdFactoryToWarehouse.cases, 50, 'inbound YTD unchanged');
  assert.equal(a.totalBalance.cases, 50, 'null-facility inbound counts toward balance');
  const w = a.byProduct[0].byWarehouse[0];
  assert.equal(w.facilityId, '__unattributed__');
  assert.match(w.facilityName, /Unattributed/, 'labelled so a manager knows it needs attributing');
}

// ── an unattributed OUTBOUND is debited too (never overstate stock) ────────
{
  const a = computeAnalytics(
    [mv({ cases: 50 }), mv({ direction: 'warehouse_to_l1', cases: 9 })],
    PROD,
    [],
    FY,
  );
  assert.equal(a.totalBalance.cases, 41, 'unattributed dispatch reduces stock on hand');
  assert.equal(a.ytdWarehouseToL1.cases, 9);
}

// ── once facilities exist, attributed rows bucket by facility as before ────
{
  const a = computeAnalytics(
    [mv({ facility_to_id: 'wh1', cases: 30 }), mv({ cases: 20 })],
    PROD,
    FAC,
    FY,
  );
  assert.equal(a.totalBalance.cases, 50, 'attributed + unattributed sum to the company total');
  const names = a.byProduct[0].byWarehouse.map((w) => w.facilityId).sort();
  assert.deepEqual(names, ['__unattributed__', 'wh1'], 'kept in separate buckets, not merged');
}

// ── empty ledger ──────────────────────────────────────────────────────────
{
  const a = computeAnalytics([], PROD, FAC, FY);
  assert.equal(a.movementCount, 0);
  assert.equal(a.totalBalance.cases, 0);
  assert.deepEqual(a.byProduct, []);
}

// ── display ───────────────────────────────────────────────────────────────
assert.equal(fmtQty({ cases: 21, bottles: 15 }), '21 cases + 15 bottles');
assert.equal(fmtQty({ cases: 1, bottles: 0 }), '1 case');
assert.equal(fmtQty({ cases: 0, bottles: 0 }), '0 cases');

console.log('useInventoryAnalytics.test.ts: all assertions passed');
