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

/**
 * TWO buckets since 2026-08-07. Floor and Display turned out to be the same
 * thing in the field, so they merged into `shelf`.
 *
 * MERGE FORWARD: `store_stock_snapshots` is append-only, so pre-merge rows keep
 * their floor and display values and are summed on READ (see shelfFigure).
 * Nothing is rewritten to fit the newer model.
 */
export const STOCK_BUCKETS = ['shelf', 'godown'] as const;
export type StockBucket = (typeof STOCK_BUCKETS)[number];

/** Buckets that existed before the merge. Read-only; never written again. */
export const LEGACY_BUCKETS = ['floor', 'display'] as const;

export const BUCKET_LABEL: Record<StockBucket, string> = {
  shelf: 'Shelf stock',
  godown: 'Godown stock',
};

export const BUCKET_HINT: Record<StockBucket, string> = {
  shelf: 'Everything in the store — on the shelves and in back stock',
  godown: 'Leave blank if this store has no godown',
};

/** Raw text straight off the inputs — kept as strings so "" stays meaningful. */
export interface BucketEntry {
  cases: string;
  bottles: string;
}
export type BucketEntries = Record<StockBucket, BucketEntry>;

export const emptyBuckets = (): BucketEntries => ({
  shelf: { cases: '', bottles: '' },
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
  const shelf = col('shelf');
  const godown = col('godown');
  const totals = bucketTotals(b, per);
  // The floor and display columns are deliberately absent: they are read-only
  // columns now, and writing them again would resurrect a distinction the
  // field told us does not exist.
  return {
    cases: totals.cases,
    bottles: totals.bottles,
    shelf_cases: shelf.cases,
    shelf_bottles: shelf.bottles,
    godown_cases: godown.cases,
    godown_bottles: godown.bottles,
  };
}

/** A snapshot row as read back from the DB. Pre-split rows have null buckets. */
export interface SnapshotRow {
  cases: number;
  bottles: number;
  shelf_cases: number | null;
  shelf_bottles: number | null;
  /** Pre-merge (before 2026-08-07). Summed into shelf on read, never written. */
  floor_cases: number | null;
  floor_bottles: number | null;
  display_cases: number | null;
  display_bottles: number | null;
  godown_cases: number | null;
  godown_bottles: number | null;
}

/** Columns to request; every reader needs the legacy pair to resolve shelf. */
export const SNAPSHOT_COLUMNS =
  'cases, bottles, shelf_cases, shelf_bottles, floor_cases, floor_bottles, display_cases, display_bottles, godown_cases, godown_bottles';

/**
 * Shelf figure for a row, resolving the floor+display merge.
 *
 * Returns `{ value, legacy }` — `legacy` true when the number came from summing
 * the old floor and display columns. Callers MUST surface that: the figure is a
 * sum of two separate readings taken at capture time, not a single shelf count
 * that was ever recorded as such. Same honesty rule as the unattributed ledger
 * rows: present what the data actually is, never imply more precision.
 *
 * Null-vs-zero survives the merge — if both legacy buckets are null the shelf is
 * null ("not recorded"), not 0.
 */
export function shelfFigure(
  row: SnapshotRow,
  field: 'cases' | 'bottles',
): { value: number | null; legacy: boolean } {
  const modern = row[`shelf_${field}` as keyof SnapshotRow] as number | null;
  if (modern !== null && modern !== undefined) return { value: modern, legacy: false };
  const f = row[`floor_${field}` as keyof SnapshotRow] as number | null;
  const d = row[`display_${field}` as keyof SnapshotRow] as number | null;
  if ((f === null || f === undefined) && (d === null || d === undefined)) {
    return { value: null, legacy: false };
  }
  return { value: (f ?? 0) + (d ?? 0), legacy: true };
}

/**
 * "2 cs / 5 btl" per recorded bucket. Empty array for a legacy row whose split
 * was never captured — callers show the total plus "breakdown not recorded"
 * rather than inventing a split we do not have.
 */
export function bucketBreakdown(
  row: SnapshotRow,
): { label: string; cases: number; bottles: number; legacy: boolean }[] {
  const out: { label: string; cases: number; bottles: number; legacy: boolean }[] = [];

  // Shelf resolves the merge; `legacy` marks a figure summed from the old
  // floor+display pair so the UI can say so rather than passing it off as a
  // single shelf reading that was never actually taken.
  const sc = shelfFigure(row, 'cases');
  const sb = shelfFigure(row, 'bottles');
  if (sc.value !== null || sb.value !== null) {
    out.push({
      label: BUCKET_LABEL.shelf,
      cases: sc.value ?? 0,
      bottles: sb.value ?? 0,
      legacy: sc.legacy || sb.legacy,
    });
  }

  const gc = row.godown_cases;
  const gb = row.godown_bottles;
  if (gc !== null || gb !== null) {
    out.push({ label: BUCKET_LABEL.godown, cases: gc ?? 0, bottles: gb ?? 0, legacy: false });
  }
  return out;
}
