/**
 * Delivery-challan helpers — pure, so the brand-seeding rule and the quantity
 * arithmetic stay testable without a database (lib/challan.test.ts).
 *
 * ponytail: AUTO-OCR IS DELIBERATELY OUT OF SCOPE this round. Many challans are
 * handwritten in mixed English/Hindi/Devanagari on carbon paper, which no free
 * offline recogniser reads reliably — so the manual rail IS the product for
 * now, and the priority is simply to start collecting structured data.
 *
 * The seam for a later printed-challan extractor is the shape of ChallanLine
 * plus the header fields on `challans`: a parser reusing the permit text-layer
 * pipeline (supabase/functions/parse-excise-permit, which already extracts a
 * PDF text layer with no OCR) would populate exactly these fields and hand them
 * to the same confirm-and-correct form the rep already uses. Nothing here
 * assumes the values were typed rather than parsed. Upgrade path: run the
 * parser on the PRINTED subset only, and leave handwritten challans manual.
 */

/** Bottle size classes as printed on a challan's quantity table (beer trade). */
export const SIZE_CLASSES = ['qts', 'pints', 'nips'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/** Column header the rep sees, matching the challan's own wording. */
export const SIZE_LABEL: Record<SizeClass, string> = {
  qts: 'Qts',
  pints: 'Pints',
  nips: 'Nips',
};

export interface ChallanLine {
  product_id: string;
  qty_qts: number;
  qty_pints: number;
  qty_nips: number;
}

/**
 * Our own product line, which the form floats to the top so the rep's common
 * case is the first thing they touch.
 *
 * Matched on name OR brand because the live catalog carries both spellings
 * ("Tank 90 select" under brand AVPL, "Tank 90 z" under brand Tank90). A
 * pattern rather than a hard-coded id list, so adding a product to the catalog
 * needs no code change.
 *
 * ponytail: a heuristic on free text, not a real ownership flag. It only
 * decides SORT ORDER — every active product stays selectable, so a miss costs
 * a scroll, never a blocked entry. Upgrade path if the catalog grows past this:
 * an `is_own_brand boolean` on products, which is then the single source.
 */
export const OWN_BRAND = /\bt(?:ank)?[\s-]*(?:900|90|x)\b/i;

export function isOwnBrand(name: string, brand?: string | null): boolean {
  return OWN_BRAND.test(name) || (!!brand && OWN_BRAND.test(brand));
}

export function sortOwnBrandFirst<T extends { name: string; brand?: string | null }>(
  products: T[],
): T[] {
  return [...products].sort(
    (a, b) =>
      Number(!isOwnBrand(a.name, a.brand)) - Number(!isOwnBrand(b.name, b.brand)) ||
      a.name.localeCompare(b.name),
  );
}

/** A quantity cell: digits only, never negative, blank reads as zero. */
export function toQty(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function lineBottles(l: Omit<ChallanLine, 'product_id'>): number {
  return l.qty_qts + l.qty_pints + l.qty_nips;
}

/**
 * The lines the rep actually filled in.
 *
 * An all-zero line is refused outright by the DB (challan_items_nonempty), so
 * it must never be sent — the rep opening a product row and moving on is not
 * data, exactly like a "touched" stock product left blank at check-out.
 */
export function filledLines(lines: ChallanLine[]): ChallanLine[] {
  return lines.filter((l) => lineBottles(l) > 0);
}

/**
 * Totals across a challan, per size class plus a bottle grand total.
 *
 * Deliberately NOT converted to cases. qty_per_carton is per PRODUCT, but the
 * three columns are three different bottle SIZES, so dividing a mixed total by
 * one carton size would invent a number. Cases can be derived downstream where
 * the size class and the product's own size are known to agree.
 */
export function challanTotals(lines: ChallanLine[]) {
  return lines.reduce(
    (acc, l) => ({
      qts: acc.qts + l.qty_qts,
      pints: acc.pints + l.qty_pints,
      nips: acc.nips + l.qty_nips,
      bottles: acc.bottles + lineBottles(l),
    }),
    { qts: 0, pints: 0, nips: 0, bottles: 0 },
  );
}

/** Local date as YYYY-MM-DD — the form's default and its upper bound. */
export function todayStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Validates the date the rep typed. Returns a message to show, or null.
 *
 * Components are compared back individually rather than round-tripping through
 * toISOString(), which would shift the day across timezones and reject valid
 * dates for a rep in IST.
 */
export function challanDateError(s: string, today: string = todayStr()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Use the format YYYY-MM-DD.';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return 'That date does not exist.';
  }
  // A challan records a delivery that has already happened.
  if (s > today) return 'A challan cannot be dated in the future.';
  return null;
}
