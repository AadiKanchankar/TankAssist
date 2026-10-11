/**
 * Personal progress — the derivation behind the (subtle, self-competitive)
 * gamification layer. Re-exported from reportSemantics so the app and any
 * report read ONE definition.
 *
 * ── DERIVED, NEVER STORED ──────────────────────────────────────────────────
 * There is no points / score / streak table and there must never be one. Every
 * figure here is computed from rows that already exist (attendance, visits,
 * stock snapshots, journey plans, spot sales), so it is always consistent with
 * the work actually recorded and recomputes correctly if a visit is voided. If
 * this ever needs caching, cache a DERIVED value — never author one.
 *
 * ── WHAT IS MEASURED, AND WHY ──────────────────────────────────────────────
 * Only behaviour that is both wanted and hard to fake: visiting the planned
 * stores AND handling their stock. A planned store is DONE when it was visited
 * that day and its stock was counted — or honestly skipped with a recorded
 * reason (store_visits.stock_skip_reason). Punishing an honest skip would push
 * reps to invent counts, which poisons sell-through (CLAUDE.md "Compulsory
 * stock"); repeated skipping is already a manager flag.
 *
 * Spot sales count as achievement ONLY when corroborated by stock depletion
 * (lib/sellThrough corroboratedSpotIds). The raw logged count is plain activity
 * — never a score. See CLAUDE.md "Gamification" for the excluded mechanics.
 *
 * Pure (no react-native imports) so lib/progress.test.ts runs under tsx.
 */

export interface ProgressVisit {
  id: string;
  store_id: string | null;
  check_in_time: string | null;
  check_out_time?: string | null;
  stock_skip_reason?: string | null;
}
export interface ProgressPlan {
  plan_date: string;
  status: 'submitted' | 'approved' | 'rejected';
  store_ids: string[];
}
export interface ProgressSpot {
  id: string;
  created_at: string;
}
export interface ProgressInput {
  /** Local day keys (YYYY-MM-DD) with a punch-in. */
  workedDays: Set<string>;
  visits: ProgressVisit[];
  /** Visits that wrote at least one stock snapshot. */
  countedVisitIds: Set<string>;
  plans: ProgressPlan[];
  /** The person's own live (not undone) spot sales. */
  spots: ProgressSpot[];
  corroboratedSpotIds: Set<string>;
  /** Overrides DECLARED_HOLIDAYS (tests). */
  holidays?: ReadonlySet<string>;
}

/**
 * Company-declared holidays (YYYY-MM-DD): never count against a streak, like
 * Sundays. EMPTY until the owner declares them — dates are the company's
 * decision, not something to guess. A worked-and-completed holiday still counts.
 * ponytail: a constant, shipped by OTA. Upgrade to a `holidays` table if the
 * owner wants to declare them from the app.
 */
export const DECLARED_HOLIDAYS: ReadonlySet<string> = new Set<string>([]);

/** Missed working days forgiven per Monday–Sunday week. */
export const MISSES_FORGIVEN_PER_WEEK = 1;
/** How far back the streak looks; also bounds the data a caller must fetch. */
export const STREAK_LOOKBACK_DAYS = 365;

export const VISIT_MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000];
export const CONVERSION_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

// ── dates (device-local, same convention as planDateFor) ────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayOf = (iso: string): string => dayKey(new Date(iso));
const parseDay = (k: string) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const addDays = (k: string, n: number) => {
  const d = parseDay(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
/** Monday of the day's week. */
export const weekKey = (k: string): string => {
  const d = parseDay(k);
  return addDays(k, -((d.getDay() + 6) % 7));
};
const isRestDay = (k: string, holidays: ReadonlySet<string> = DECLARED_HOLIDAYS) =>
  parseDay(k).getDay() === 0 || holidays.has(k);

// ── the day ─────────────────────────────────────────────────────────────────
export interface DayProgress {
  day: string;
  /** A non-rejected plan exists for the day (a rejected one awaits a resend). */
  hasPlan: boolean;
  planned: number;
  /** Planned stores visited (any visit that day). */
  visited: number;
  /** Planned stores whose stock was counted. */
  counted: number;
  /** Planned stores visited, not counted, but skipped with a reason. */
  skipped: number;
  /** Planned stores visited AND stock handled (counted or skipped). */
  done: number;
  remaining: number;
  complete: boolean;
  /** Distinct stores visited that day, planned or not, and how many of them counted. */
  storesVisited: number;
  storesCounted: number;
}

export function dayProgress(day: string, input: ProgressInput): DayProgress {
  const plan = input.plans.find((p) => p.plan_date === day && p.status !== 'rejected');
  const dayVisits = input.visits.filter((v) => v.check_in_time && dayOf(v.check_in_time) === day && v.store_id);
  const visited = new Set<string>();
  const counted = new Set<string>();
  const skipped = new Set<string>();
  for (const v of dayVisits) {
    visited.add(v.store_id!);
    if (input.countedVisitIds.has(v.id)) counted.add(v.store_id!);
    else if (v.stock_skip_reason) skipped.add(v.store_id!);
  }
  for (const s of counted) skipped.delete(s);
  const planned = [...new Set(plan?.store_ids ?? [])];
  const vis = planned.filter((s) => visited.has(s)).length;
  const cnt = planned.filter((s) => counted.has(s)).length;
  const skp = planned.filter((s) => skipped.has(s)).length;
  const done = cnt + skp;
  return {
    day,
    hasPlan: !!plan,
    planned: planned.length,
    visited: vis,
    counted: cnt,
    skipped: skp,
    done,
    remaining: planned.length - done,
    complete: planned.length > 0 && done === planned.length,
    storesVisited: visited.size,
    storesCounted: counted.size,
  };
}

/** "2 more stores to finish today's plan" — forward-framed, only when close. */
export function nudgeFor(p: DayProgress): string | null {
  if (!p.hasPlan || p.complete || p.done === 0 || p.remaining > 2) return null;
  return p.remaining === 1 ? '1 more store to finish today’s plan.' : `${p.remaining} more stores to finish today’s plan.`;
}

// ── streak ──────────────────────────────────────────────────────────────────
export type DayOutcome = 'complete' | 'pending' | 'rest' | 'miss';

export function dayOutcome(day: string, today: string, input: ProgressInput): DayOutcome {
  const complete = dayProgress(day, input).complete;
  if (complete) return 'complete';
  if (day === today) return 'pending'; // the day isn't over: never counts against
  if (isRestDay(day, input.holidays)) return 'rest';
  return 'miss';
}

/**
 * Consecutive working days with the plan completed and stock handled, counted
 * back from today. Sundays and DECLARED_HOLIDAYS are neutral; one missed day
 * per Monday–Sunday week is forgiven (neutral, not counted); a second miss in
 * the same week ends the streak. Today counts once complete and never breaks it.
 *
 * Forgiveness is the point: a streak that punishes a sick day sends sick people
 * into the field. Nothing here ever warns that a streak is "about to end".
 */
export function streak(today: string, input: ProgressInput): number {
  let n = 0;
  const forgiven: Record<string, number> = {};
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const day = addDays(today, -i);
    const o = dayOutcome(day, today, input);
    if (o === 'complete') n++;
    else if (o === 'miss') {
      const w = weekKey(day);
      forgiven[w] = (forgiven[w] ?? 0) + 1;
      if (forgiven[w] > MISSES_FORGIVEN_PER_WEEK) break;
    }
  }
  return n;
}

// ── personal bests (own history only) ───────────────────────────────────────
export interface Best {
  current: number;
  /** Best of the PREVIOUS periods; 0 = no history yet. */
  best: number;
  /** Which period the best was (YYYY-MM or the week's Monday). */
  bestPeriod: string | null;
}
export interface PersonalBests {
  /** Store visits this month (every visit, as in "Total stores visited"). */
  monthVisits: Best;
  /** Distinct stores this Monday–Sunday week. */
  weekUniqueStores: Best;
  /** Spot sales corroborated by stock depletion this month. */
  monthConversions: Best;
  /** Raw spot sales logged this month — activity, never achievement. */
  loggedThisMonth: number;
  daysLeftInMonth: number;
  lifetimeVisits: number;
  lifetimeConversions: number;
}

function bestOf(counts: Record<string, number>, current: string): Best {
  let best = 0;
  let bestPeriod: string | null = null;
  for (const [k, v] of Object.entries(counts)) {
    if (k < current && v > best) {
      best = v;
      bestPeriod = k;
    }
  }
  return { current: counts[current] ?? 0, best, bestPeriod };
}

export function personalBests(today: string, input: ProgressInput): PersonalBests {
  const month = today.slice(0, 7);
  const week = weekKey(today);
  const visitsByMonth: Record<string, number> = {};
  const storesByWeek: Record<string, Set<string>> = {};
  for (const v of input.visits) {
    if (!v.check_in_time) continue;
    const d = dayOf(v.check_in_time);
    visitsByMonth[d.slice(0, 7)] = (visitsByMonth[d.slice(0, 7)] ?? 0) + 1;
    if (v.store_id) (storesByWeek[weekKey(d)] ??= new Set()).add(v.store_id);
  }
  const weekCounts: Record<string, number> = {};
  for (const [w, s] of Object.entries(storesByWeek)) weekCounts[w] = s.size;

  const convByMonth: Record<string, number> = {};
  let logged = 0;
  let lifetimeConversions = 0;
  for (const s of input.spots) {
    const m = dayOf(s.created_at).slice(0, 7);
    if (m === month) logged++;
    if (input.corroboratedSpotIds.has(s.id)) {
      convByMonth[m] = (convByMonth[m] ?? 0) + 1;
      lifetimeConversions++;
    }
  }
  const t = parseDay(today);
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return {
    monthVisits: bestOf(visitsByMonth, month),
    weekUniqueStores: bestOf(weekCounts, week),
    monthConversions: bestOf(convByMonth, month),
    loggedThisMonth: logged,
    daysLeftInMonth: lastDay - t.getDate(),
    lifetimeVisits: input.visits.length,
    lifetimeConversions,
  };
}

/** "Your best month was 84 store visits. You're at 71 with 9 days left." — or null. */
export function bestLine(b: PersonalBests): string | null {
  const m = b.monthVisits;
  if (m.best === 0) return null;
  if (m.current > m.best) return `New best month: ${m.current} store visits (previous best ${m.best}).`;
  const left = b.daysLeftInMonth;
  return `Your best month was ${m.best} store visits. You’re at ${m.current}${
    left > 0 ? ` with ${left} day${left === 1 ? '' : 's'} left` : ''
  }.`;
}

/** The highest milestone at or below `total`, or 0. */
export function milestoneAt(total: number, steps: number[]): number {
  let m = 0;
  for (const s of steps) if (total >= s) m = s;
  return m;
}

// ── management: the month's pattern, per person ─────────────────────────────
export type PatternDay = 'complete' | 'partial' | 'off' | 'future';
export interface MonthPattern {
  days: { day: string; state: PatternDay }[];
  workedDays: number;
  completeDays: number;
  /** Visits in the month whose stock was counted / handled (counted or skipped). */
  visits: number;
  countedVisits: number;
  handledVisits: number;
}

/** One person's month, for management's coaching view. Not a ranking. */
export function monthPattern(month: string, today: string, input: ProgressInput): MonthPattern {
  const first = `${month}-01`;
  const d0 = parseDay(first);
  const last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  const days: MonthPattern['days'] = [];
  let worked = 0;
  let complete = 0;
  for (let i = 0; i < last; i++) {
    const day = addDays(first, i);
    if (day > today) {
      days.push({ day, state: 'future' });
      continue;
    }
    const p = dayProgress(day, input);
    const didWork = input.workedDays.has(day) || p.storesVisited > 0;
    if (didWork) worked++;
    if (p.complete) complete++;
    days.push({ day, state: p.complete ? 'complete' : didWork ? 'partial' : 'off' });
  }
  const mv = input.visits.filter((v) => v.check_in_time && dayOf(v.check_in_time).startsWith(month));
  const counted = mv.filter((v) => input.countedVisitIds.has(v.id)).length;
  const handled = mv.filter((v) => input.countedVisitIds.has(v.id) || v.stock_skip_reason).length;
  return { days, workedDays: worked, completeDays: complete, visits: mv.length, countedVisits: counted, handledVisits: handled };
}
