/**
 * ── FINANCIAL YEAR ──────────────────────────────────────────────────────────
 * The single source of truth for the FY boundary, in the same spirit as
 * ORDERS_CUTOVER_DATE: declared once here and imported, never hardcoded into a
 * query. Indian FY runs 1 April – 31 March.
 *
 * Change this ONE constant if the business ever reports on a different FY.
 */
export const FINANCIAL_YEAR_START_MONTH = 4; // April, 1-indexed

/** Local YYYY-MM-DD (matches how movement_date is stored). */
function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First day of the financial year containing `d`. */
export function financialYearStart(d: Date = new Date()): Date {
  const inNewFy = d.getMonth() + 1 >= FINANCIAL_YEAR_START_MONTH;
  const year = inNewFy ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(year, FINANCIAL_YEAR_START_MONTH - 1, 1);
}

/** FY start as YYYY-MM-DD, for filtering movement_date. */
export function financialYearStartYmd(d: Date = new Date()): string {
  return toYmd(financialYearStart(d));
}

/** Display label, e.g. "FY 2026–27". */
export function financialYearLabel(d: Date = new Date()): string {
  const start = financialYearStart(d).getFullYear();
  const end = String((start + 1) % 100).padStart(2, '0');
  return `FY ${start}–${end}`;
}
