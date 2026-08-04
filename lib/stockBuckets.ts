/**
 * Store stock split into three buckets (floor / display / godown).
 *
 * Pure — no React, no network — so the arithmetic is directly testable
 * (lib/stockBuckets.test.ts), the same discipline as inventoryMath and
 * reportSemantics.
 *
 * ABSENT IS NOT ZERO. A bucket the rep left entirely blank is `null` in the
 * database, meaning "no godown / not counted"; an explicit 0 means "counted
 * and empty". Many stores have no godown at all, and forcing a 0 there would
 * be a lie that later reads as real data.
 *
 * `store_stock_snapshots.cases`/`bottles` remain the authoritative TOTAL and
 * are what every pre-existing reader uses; the buckets are the breakdown.
 */

export const STOCK_BUCKETS = ['floor', 'display', 'godown'] as const;
export type StockBucket = (typeof STOCK_BUCKETS)[number];

export const BUCKET_LABEL: Record<StockBucket, string> = {
  floor: 'Floor stock',
  display: 'Display stock',
  godown: 'Godown stock',
};

export const BUCKET_HINT: Record<StockBucket, string> = {
  floor: 'In the store, not on the shelves',
  display: 'On the shelves and display',
  godown: 'Leave blank if this store has no godown',
};

/** Raw text straight off the inputs — kept as strings so "" stays meaningful. */
export interface BucketEntry {
  cases: string;
  bottles: string;
}
export type BucketEntries = Record<StockBucket, BucketEntry>;

export const emptyBuckets = (): BucketEntries => ({
  floor: { cases: '', bottles: '' },
  display: { cases: '', bottles: '' },
  godown: { cases: '', bottles: '' },
});

const toInt = (v: string | undefined) => {
  const n = parseInt((v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const isBlank = (e: BucketEntry | undefined) =>
  !e || ((e.cases ?? '').trim() === '' && (e.bottles ?? '').trim() === '');

/**
 * Whole bottles held in one bucket, or null when the rep recorded nothing.
 * Arithmetic runs in whole bottles for the same reason inventoryMath does it:
 * adding "cases + loose bottles" pairs directly drifts once loose bottles
 * exceed a case.
 */
export function bucketBottles(e: BucketEntry | undefined, perCase: number): number | null {
  if (isBlank(e)) return null;
  const per = perCase > 0 ? perCase : 0;
  return toInt(e!.cases) * per + toInt(e!.bottles);
}

export interface BucketTotals {
  cases: number;
  bottles: number;
  /** false when every bucket was left blank — nothing to record for this product. */
  anyRecorded: boolean;
}

/** Total across the recorded buckets, normalised so loose bottles < one case. */
export function bucketTotals(b: BucketEntries, perCase: number): BucketTotals {
  let total = 0;
  let anyRecorded = false;
  for (const k of STOCK_BUCKETS) {
    const v = bucketBottles(b?.[k], perCase);
    if (v === null) continue;
    anyRecorded = true;
    total += v;
  }
  // perCase <= 0 means the product has no usable units-per-case, so there is
  // no honest way to roll bottles up into cases — report them all as loose.
  if (perCase <= 0) return { cases: 0, bottles: total, anyRecorded };
  return { cases: Math.floor(total / perCase), bottles: total % perCase, anyRecorded };
}

/** Columns for one `store_stock_snapshots` row. Blank buckets stay null. */
export function snapshotPayload(b: BucketEntries, perCase: number) {
  const per = perCase > 0 ? perCase : 0;
  const col = (k: StockBucket) => {
    if (isBlank(b?.[k])) return { cases: null, bottles: null };
    return { cases: toInt(b[k].cases), bottles: toInt(b[k].bottles) };
  };
  const floor = col('floor');
  const display = col('display');
  const godown = col('godown');
  const totals = bucketTotals(b, per);
  return {
    cases: totals.cases,
    bottles: totals.bottles,
    floor_cases: floor.cases,
    floor_bottles: floor.bottles,
    display_cases: display.cases,
    display_bottles: display.bottles,
    godown_cases: godown.cases,
    godown_bottles: godown.bottles,
  };
}

/** A snapshot row as read back from the DB. Legacy rows have null buckets. */
export interface SnapshotRow {
  cases: number;
  bottles: number;
  floor_cases: number | null;
  floor_bottles: number | null;
  display_cases: number | null;
  display_bottles: number | null;
  godown_cases: number | null;
  godown_bottles: number | null;
}

/**
 * "2 cs / 5 btl" per recorded bucket. Empty array for a legacy row whose split
 * was never captured — callers show the total plus "breakdown not recorded"
 * rather than inventing a split we do not have.
 */
export function bucketBreakdown(row: SnapshotRow): { label: string; cases: number; bottles: number }[] {
  const out: { label: string; cases: number; bottles: number }[] = [];
  for (const k of STOCK_BUCKETS) {
    const c = row[`${k}_cases` as keyof SnapshotRow] as number | null;
    const b = row[`${k}_bottles` as keyof SnapshotRow] as number | null;
    if (c === null && b === null) continue;
    out.push({ label: BUCKET_LABEL[k], cases: c ?? 0, bottles: b ?? 0 });
  }
  return out;
}
