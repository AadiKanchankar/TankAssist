/**
 * Team figures with the manager's own share broken out (owner decision,
 * 2026-10-09): team totals INCLUDE a sales manager's own field activity, and
 * every team figure also says how much of it was the manager's. A combined
 * number with no way to see what came from the manager is never shown.
 *
 * Pure — no React, no network — so it runs under `npx tsx` (see
 * lib/teamFigures.test.ts); lib/reportSemantics.ts re-exports it, so callers
 * take every report figure from one module.
 */

export interface TeamFigure {
  /** Everyone in scope, the manager(s) included. */
  total: number;
  /** The part of `total` that came from the manager(s). Always ⊆ total. */
  managerOwn: number;
}

/** Sum `value` over rows, splitting out the rows the manager produced. */
export function teamFigure<T>(
  rows: readonly T[],
  value: (r: T) => number,
  isManagerOwn: (r: T) => boolean,
): TeamFigure {
  let total = 0;
  let managerOwn = 0;
  for (const r of rows) {
    const v = value(r) || 0;
    total += v;
    if (isManagerOwn(r)) managerOwn += v;
  }
  return { total, managerOwn };
}

/**
 * Distinct keys (e.g. stores) across the team, and how many of them the
 * manager touched. Not additive: a store a rep AND the manager both visited is
 * one store in `total` and also counts in `managerOwn` — "of which you
 * visited", not "you alone".
 */
export function teamDistinct<T>(
  rows: readonly T[],
  key: (r: T) => string | null | undefined,
  isManagerOwn: (r: T) => boolean,
): TeamFigure {
  const all = new Set<string>();
  const mine = new Set<string>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    all.add(k);
    if (isManagerOwn(r)) mine.add(k);
  }
  return { total: all.size, managerOwn: mine.size };
}

/** Field roles as stamped on rows (`actor_role`), never the user's current role. */
export type ActorRole = 'rep' | 'sales_manager' | 'management';

/** Split by stamped actor role: the "manager" share is the sales managers'. */
export function fromByActor(byActor: Partial<Record<ActorRole, number>>): TeamFigure {
  const total = Object.values(byActor).reduce((s, n) => s + (n || 0), 0);
  return { total, managerOwn: byActor.sales_manager || 0 };
}

/**
 * The line under a team figure. Shown even at 0 — the point is that the split
 * is always visible, so a 0 is information ("none of this is yours"), not noise.
 */
export function managerShareNote(
  f: TeamFigure,
  viewer: 'self' | 'management',
  /** A headcount ("checked in") reads as people, not as things done by them. */
  people = false,
): string {
  const n = f.managerOwn;
  if (viewer === 'self') return people ? (n ? 'incl. you' : 'not incl. you') : `incl. ${n} by you`;
  return people ? `incl. ${n} sales manager${n === 1 ? '' : 's'}` : `incl. ${n} by sales managers`;
}
