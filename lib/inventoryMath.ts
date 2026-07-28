/**
 * Pure inventory-ledger arithmetic. No network, no React — so it is directly
 * testable (hooks/useInventoryAnalytics.test.ts) and lives alongside the app's
 * other domain logic (reportSemantics, orders).
 *
 * Current balance is always a sum over the append-only `inventory_movements`
 * history, never a stored counter.
 */

export interface Qty {
  cases: number;
  bottles: number; // loose bottles left over after whole cases
}
export interface WarehouseBalance {
  facilityId: string;
  facilityName: string;
  qty: Qty;
}
export interface ProductBalance {
  productId: string;
  productName: string;
  qty: Qty;
  byWarehouse: WarehouseBalance[];
}
export interface InventoryAnalytics {
  fyLabel: string;
  fyStartYmd: string;
  ytdFactoryToWarehouse: Qty;
  ytdWarehouseToL1: Qty;
  totalBalance: Qty;
  byProduct: ProductBalance[];
  movementCount: number;
}

export interface MovementRow {
  product_id: string;
  direction: 'factory_to_warehouse' | 'warehouse_to_l1' | 'internal_transfer';
  facility_from_id: string | null;
  facility_to_id: string | null;
  cases: number;
  remainder_bottles: number | string;
  movement_date: string;
}

/**
 * All arithmetic is done in WHOLE BOTTLES and only converted back to cases for
 * display. Subtracting "cases + loose bottles" pairs directly produces nonsense
 * (8 loose − 17 loose = −9), so everything normalises through units-per-case.
 */
const toBottles = (cases: number, remainder: number, perCase: number) =>
  cases * (perCase > 0 ? perCase : 0) + remainder;

const toQty = (bottles: number, perCase: number): Qty => {
  if (perCase <= 0) return { cases: 0, bottles };
  const sign = bottles < 0 ? -1 : 1;
  const abs = Math.abs(bottles);
  return { cases: sign * Math.floor(abs / perCase), bottles: sign * (abs % perCase) };
};

const addQty = (a: Qty, b: Qty): Qty => ({ cases: a.cases + b.cases, bottles: a.bottles + b.bottles });

export function computeAnalytics(
  rows: MovementRow[],
  products: { id: string; name: string; qty_per_carton: number }[],
  facilities: { id: string; name: string; facility_type: string }[],
  fyStartYmd: string,
): Omit<InventoryAnalytics, 'fyLabel'> {
  const perCaseOf = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const p of products ?? []) {
    perCaseOf.set(p.id, Number(p.qty_per_carton) || 0);
    nameOf.set(p.id, p.name);
  }
  const facilityName = new Map<string, string>();
  const isWarehouse = new Set<string>();
  for (const f of facilities ?? []) {
    facilityName.set(f.id, f.name);
    if (f.facility_type === 'warehouse') isWarehouse.add(f.id);
  }

  // YTD accumulated per product (in bottles) then folded, so a mixed catalog
  // with different units-per-case is never mis-scaled.
  const ytdF2WByProduct = new Map<string, number>();
  const ytdW2L1ByProduct = new Map<string, number>();
  // productId -> facilityId -> bottles (all-time)
  const balance = new Map<string, Map<string, number>>();

  const bump = (product: string, facility: string, delta: number) => {
    if (!balance.has(product)) balance.set(product, new Map());
    const inner = balance.get(product)!;
    inner.set(facility, (inner.get(facility) ?? 0) + delta);
  };

  for (const r of rows) {
    const perCase = perCaseOf.get(r.product_id) ?? 0;
    const bottles = toBottles(Number(r.cases) || 0, Number(r.remainder_bottles) || 0, perCase);

    if (r.movement_date >= fyStartYmd) {
      if (r.direction === 'factory_to_warehouse')
        ytdF2WByProduct.set(r.product_id, (ytdF2WByProduct.get(r.product_id) ?? 0) + bottles);
      if (r.direction === 'warehouse_to_l1')
        ytdW2L1ByProduct.set(r.product_id, (ytdW2L1ByProduct.get(r.product_id) ?? 0) + bottles);
    }

    // Into a warehouse
    if (
      r.facility_to_id &&
      isWarehouse.has(r.facility_to_id) &&
      (r.direction === 'factory_to_warehouse' || r.direction === 'internal_transfer')
    ) {
      bump(r.product_id, r.facility_to_id, bottles);
    }
    // Out of a warehouse
    if (
      r.facility_from_id &&
      isWarehouse.has(r.facility_from_id) &&
      (r.direction === 'warehouse_to_l1' || r.direction === 'internal_transfer')
    ) {
      bump(r.product_id, r.facility_from_id, -bottles);
    }
  }

  const foldQty = (byProduct: Map<string, number>): Qty => {
    let out: Qty = { cases: 0, bottles: 0 };
    for (const [pid, bottles] of byProduct) out = addQty(out, toQty(bottles, perCaseOf.get(pid) ?? 0));
    return out;
  };

  const byProduct: ProductBalance[] = [];
  let totalBalance: Qty = { cases: 0, bottles: 0 };
  for (const [productId, perFacility] of balance) {
    const perCase = perCaseOf.get(productId) ?? 0;
    let productBottles = 0;
    const byWarehouse: WarehouseBalance[] = [];
    for (const [facilityId, bottles] of perFacility) {
      productBottles += bottles;
      byWarehouse.push({
        facilityId,
        facilityName: facilityName.get(facilityId) ?? 'Unknown facility',
        qty: toQty(bottles, perCase),
      });
    }
    byWarehouse.sort((a, b) => a.facilityName.localeCompare(b.facilityName));
    const qty = toQty(productBottles, perCase);
    totalBalance = addQty(totalBalance, qty);
    byProduct.push({ productId, productName: nameOf.get(productId) ?? 'Unknown product', qty, byWarehouse });
  }
  byProduct.sort((a, b) => b.qty.cases - a.qty.cases);

  return {
    fyStartYmd,
    ytdFactoryToWarehouse: foldQty(ytdF2WByProduct),
    ytdWarehouseToL1: foldQty(ytdW2L1ByProduct),
    totalBalance,
    byProduct,
    movementCount: rows.length,
  };
}

/** "21 cases + 15 bottles" / "1 case" / "0 cases" */
export function fmtQty(q: Qty): string {
  if (q.cases === 0 && q.bottles === 0) return '0 cases';
  const parts: string[] = [];
  if (q.cases !== 0) parts.push(`${q.cases} case${Math.abs(q.cases) === 1 ? '' : 's'}`);
  if (q.bottles !== 0) parts.push(`${q.bottles} bottle${Math.abs(q.bottles) === 1 ? '' : 's'}`);
  return parts.join(' + ');
}
