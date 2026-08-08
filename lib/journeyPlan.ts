/**
 * Permanent Journey Plan (PJP) — shared types, the local-date rule, and the
 * anti-cheat flag derivation.
 *
 * Pure — no React, no network — so the flag logic is testable
 * (lib/journeyPlan.test.ts) without a database.
 *
 * GOVERNING PRINCIPLE (owner decision): frictionless for the honest, visible
 * for the dishonest. FLAG + REASON, NEVER BLOCK. Nothing here prevents a rep
 * from acting; everything surfaces to the manager for review.
 *
 * Exactly ONE flag is stored (`store_visits.is_mock_location`, a device fact at
 * capture time that cannot be recovered later). Every other flag is derived
 * from data that already exists, which also means a determined client that
 * skips a client-side check still gets flagged.
 */

export type PlanStatus = 'submitted' | 'approved' | 'rejected';

export interface JourneyPlan {
  id: string;
  rep_id: string;
  plan_date: string; // yyyy-mm-dd, LOCAL date — see planDateFor()
  status: PlanStatus;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  store_ids: string[];
}

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Needs changes',
};

/**
 * The plan a visit belongs to is keyed by (rep, LOCAL calendar date) — the
 * `unique (rep_id, plan_date)` constraint makes that a natural key, so no FK
 * on store_visits is needed.
 *
 * ponytail: local-date resolution, not a true working-day window. A visit
 * logged after local midnight resolves to the NEXT day's plan and can look
 * off-plan. That false positive is why DATE_BOUNDARY_HINT exists and why the
 * off-plan reason is worded as a question, not an accusation. Upgrade path if
 * reps genuinely work past midnight: give journey_plans an explicit
 * shift_start/shift_end and resolve visits into that window instead.
 */
export function planDateFor(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local hours after which a visit is close enough to midnight to be ambiguous. */
const LATE_HOUR = 22;
const EARLY_HOUR = 4;

/** True when a timestamp sits near the local date boundary. */
export function nearDateBoundary(iso: string): boolean {
  const h = new Date(iso).getHours();
  return h >= LATE_HOUR || h < EARLY_HOUR;
}

// ── Flags ─────────────────────────────────────────────────────────────────

export type FlagKind =
  | 'mock_location'
  | 'far_from_store'
  | 'impossible_movement'
  | 'off_plan'
  | 'plan_not_approved'
  | 'auto_closed';

export interface VisitFlag {
  kind: FlagKind;
  /** Shown to the manager. Neutral wording — this is a prompt to look, not a verdict. */
  reason: string;
  /** true when the flag has a known benign explanation the manager should weigh first. */
  soft?: boolean;
}

/** Beyond this from the store's recorded coordinates, a check-in is worth a look. */
export const FAR_FROM_STORE_METERS = 300;
/** Sustained speed above this between two visits is not plausible on the ground. */
export const IMPLAUSIBLE_KMH = 120;
/** Two stores closer than this are probably the same shop entered twice. */
export const DUPLICATE_STORE_METERS = 100;

export interface VisitForFlags {
  id: string;
  store_id: string | null;
  check_in_time: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_from_store_meters: number | null;
  is_mock_location: boolean | null;
  /** Closed by the 22:30 IST sweep rather than by the rep. */
  auto_closed?: boolean | null;
}

/**
 * Flags for one visit. `plan` is that rep's plan for the visit's local date
 * (null = no plan submitted at all).
 *
 * `prevVisit` is the same rep's immediately preceding visit, used for the
 * movement check; pass null for the first visit of the day.
 */
export function flagsForVisit(
  visit: VisitForFlags,
  plan: JourneyPlan | null,
  prevVisit: VisitForFlags | null,
  distanceKm: (aLat: number, aLng: number, bLat: number, bLng: number) => number,
): VisitFlag[] {
  const flags: VisitFlag[] = [];

  // 1. Mock location — the only STORED flag. null means an older build never
  //    reported, which is not evidence of anything.
  if (visit.is_mock_location === true) {
    flags.push({
      kind: 'mock_location',
      reason: 'Device reported a mock location provider during check-in.',
    });
  }

  // 2. Never checked out — the nightly sweep closed it. Soft: the usual cause
  //    is a flat battery or a killed app, not dishonesty. It is surfaced so the
  //    manager knows the visit's end time is a system default, not observed.
  if (visit.auto_closed === true) {
    flags.push({
      kind: 'auto_closed',
      reason:
        'Not checked out — closed automatically at 22:30. The end time and duration are not real observations.',
      soft: true,
    });
  }

  // 3. Distance from the store's own coordinates. Skipped when unknown.
  if (
    visit.distance_from_store_meters !== null &&
    visit.distance_from_store_meters > FAR_FROM_STORE_METERS
  ) {
    flags.push({
      kind: 'far_from_store',
      reason: `Checked in ${Math.round(visit.distance_from_store_meters)} m from the store's saved location.`,
    });
  }

  // 3. Physically implausible movement between consecutive visits.
  if (
    prevVisit &&
    prevVisit.latitude !== null && prevVisit.longitude !== null &&
    visit.latitude !== null && visit.longitude !== null &&
    prevVisit.check_in_time && visit.check_in_time
  ) {
    const hours =
      (Date.parse(visit.check_in_time) - Date.parse(prevVisit.check_in_time)) / 3_600_000;
    if (hours > 0) {
      const km = distanceKm(prevVisit.latitude, prevVisit.longitude, visit.latitude, visit.longitude);
      const kmh = km / hours;
      // Sub-minute gaps make the speed meaningless; require a real interval.
      if (hours >= 1 / 60 && kmh > IMPLAUSIBLE_KMH) {
        flags.push({
          kind: 'impossible_movement',
          reason: `${Math.round(km)} km from the previous check-in in ${Math.round(hours * 60)} min (~${Math.round(kmh)} km/h).`,
        });
      }
    }
  }

  // 4. Plan status. An APPROVED plan clears this — deliberately read live, so
  //    a manager approving at noon retroactively clears the morning's visits.
  if (!plan) {
    flags.push({ kind: 'plan_not_approved', reason: 'No journey plan was submitted for this day.' });
  } else if (plan.status === 'submitted') {
    flags.push({
      kind: 'plan_not_approved',
      reason: 'Visit made while the day’s plan was still awaiting your approval.',
      soft: true,
    });
  } else if (plan.status === 'rejected') {
    flags.push({
      kind: 'plan_not_approved',
      reason: 'Visit made under a plan that was sent back for changes.',
    });
  }

  // 5. Off-plan store. Only meaningful once a plan exists.
  if (plan && visit.store_id && !plan.store_ids.includes(visit.store_id)) {
    const ambiguous = visit.check_in_time ? nearDateBoundary(visit.check_in_time) : false;
    flags.push({
      kind: 'off_plan',
      reason: ambiguous
        ? // The honest-rep false positive this whole design exists to avoid: a
          // late-night or early-morning visit resolves to the neighbouring day's
          // plan, so it reads as off-plan when it may simply be off-by-one.
          'Store is not on this day’s plan — but the visit is close to midnight, so it may belong to the neighbouring day’s plan. Worth confirming before treating it as off-plan.'
        : 'Store is not on the approved plan for this day.',
      soft: ambiguous,
    });
  }

  return flags;
}

/** Highest-severity first, soft (explainable) flags last. */
export function sortFlags(flags: VisitFlag[]): VisitFlag[] {
  const rank: Record<FlagKind, number> = {
    mock_location: 0,
    impossible_movement: 1,
    far_from_store: 2,
    off_plan: 3,
    plan_not_approved: 4,
    auto_closed: 5,
  };
  return [...flags].sort(
    (a, b) => Number(a.soft ?? false) - Number(b.soft ?? false) || rank[a.kind] - rank[b.kind],
  );
}

// ── Store de-duplication (rep-side, at store creation) ────────────────────

export interface NearbyCandidate {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Optimal string alignment (Damerau-Levenshtein) distance.
 *
 * Here rather than pg_trgm because the extension is not installed and the
 * rep's store list is already loaded — adding a database extension to compare
 * a handful of shop names would be the expensive way round. The
 * manager-visible flag is the real backstop anyway; this check only steers an
 * honest rep to the right existing store.
 *
 * Adjacent transposition counts as ONE edit, not two. That matters: the
 * motivating real case ("Sruaj" for "Suraj") is a finger-swap, the single most
 * common typing error, and plain Levenshtein scores it 2 — far enough to slip
 * past tolerance and let the duplicate through.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      let v = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost);
      if (i > 0 && j > 0 && a[i] === b[j - 1] && a[i - 1] === b[j]) {
        v = Math.min(v, prev2[j - 1] + 1); // swapped pair = one typo
      }
      cur[j + 1] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "Sruaj wines" ~ "Suraj wines". Tolerance scales with name length. */
export function nameLooksSame(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tolerance = Math.max(1, Math.floor(Math.min(x.length, y.length) / 5));
  return editDistance(x, y) <= tolerance;
}

export interface DuplicateMatch {
  store: NearbyCandidate;
  meters: number | null;
  why: 'nearby' | 'name' | 'both';
}

/**
 * Existing stores that the one being created may duplicate — by proximity,
 * by fuzzy name, or both. Creating a genuinely new store stays possible; this
 * only makes the duplicate the deliberate choice rather than the silent default.
 */
export function findDuplicateCandidates(
  name: string,
  lat: number | null,
  lng: number | null,
  existing: NearbyCandidate[],
  distanceKm: (aLat: number, aLng: number, bLat: number, bLng: number) => number,
): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const s of existing) {
    let meters: number | null = null;
    if (lat !== null && lng !== null && s.latitude !== null && s.longitude !== null) {
      meters = distanceKm(lat, lng, s.latitude, s.longitude) * 1000;
    }
    const near = meters !== null && meters <= DUPLICATE_STORE_METERS;
    const sameName = nameLooksSame(name, s.name);
    if (!near && !sameName) continue;
    out.push({ store: s, meters, why: near && sameName ? 'both' : near ? 'nearby' : 'name' });
  }
  // Strongest signal first: both, then distance, then name-only.
  const rank = { both: 0, nearby: 1, name: 2 } as const;
  return out.sort(
    (a, b) => rank[a.why] - rank[b.why] || (a.meters ?? Infinity) - (b.meters ?? Infinity),
  );
}
