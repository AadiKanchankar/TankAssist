/**
 * Movement classification: which of our facilities a permit moves stock between.
 *
 * Pulled out of index.ts because the rules are subtle enough to be worth
 * testing directly (see classify.test.ts) — in particular the difference
 * between "this licence isn't ours" and "this licence is ours but isn't
 * currently valid", which decide opposite things.
 */

export type MovementDirection =
  | 'factory_to_warehouse'
  | 'warehouse_to_l1'
  | 'internal_transfer'
  | 'unclassified';

export interface FacilityRow {
  id: string;
  license_no: string;
  facility_type: 'factory' | 'warehouse';
  is_active: boolean | null;
  valid_from: string | null;
  valid_until: string | null;
}

/** A licence is usable for auto-matching only while it is active and in date. */
export function isUsable(f: FacilityRow, today: string): boolean {
  return (
    f.is_active !== false &&
    (!f.valid_until || f.valid_until >= today) &&
    (!f.valid_from || f.valid_from <= today)
  );
}

export interface Classification {
  facilityFromId: string | null;
  facilityToId: string | null;
  direction: MovementDirection;
}

/**
 * `allFacs` must be every registry row matching the permit's licence numbers,
 * INCLUDING expired/inactive ones — they are what tells us a party is ours even
 * when its licence can't be used to auto-match.
 */
export function classifyMovement(
  srcNo: string | null,
  dstNo: string | null,
  allFacs: FacilityRow[],
  today: string,
): Classification {
  const usable = allFacs.filter((f) => isUsable(f, today));
  const from = usable.find((f) => f.license_no === srcNo) ?? null;
  const to = usable.find((f) => f.license_no === dstNo) ?? null;

  // §3 precedence — most specific first. Anything not matched here stays
  // 'unclassified' for a human to resolve; we never guess a direction.
  let direction: MovementDirection = 'unclassified';
  if (from?.facility_type === 'factory' && to?.facility_type === 'warehouse') {
    direction = 'factory_to_warehouse';
  } else if (from && to) {
    direction = 'internal_transfer'; // both ours, e.g. warehouse -> warehouse
  } else if (
    from?.facility_type === 'warehouse' &&
    !to &&
    dstNo &&
    // "Not ours" must mean absent from the registry entirely. A facility of ours
    // whose licence is merely expired/inactive was filtered out of `usable`, and
    // must NOT be mistaken for an external L1 — that would book an internal
    // transfer as an outbound sale. Leave it for a human instead.
    !allFacs.some((f) => f.license_no === dstNo)
  ) {
    direction = 'warehouse_to_l1'; // ours -> a party outside the registry
  }

  return { facilityFromId: from?.id ?? null, facilityToId: to?.id ?? null, direction };
}
