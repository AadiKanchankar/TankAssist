/**
 * Progress / gamification derivation checks. Pins the rules that would be easy
 * to break while "improving" the feature: the bar measures stock handled, not
 * visits; nudges are forward-framed; a streak survives one miss a week and
 * every Sunday; raw spot sales never count as achievement.
 *
 * Run: npx --yes tsx lib/progress.test.ts
 */
process.env.TZ = 'Asia/Kolkata';
import assert from 'node:assert/strict';
import {
  dayProgress,
  nudgeFor,
  streak,
  dayOutcome,
  personalBests,
  bestLine,
  milestoneAt,
  monthPattern,
  weekKey,
  VISIT_MILESTONES,
  type ProgressInput,
  type ProgressPlan,
  type ProgressVisit,
} from './progress.ts';

let vid = 0;
const visit = (day: string, store: string, o: Partial<ProgressVisit> = {}): ProgressVisit => ({
  id: `v${++vid}`,
  store_id: store,
  check_in_time: `${day}T10:00:00+05:30`,
  ...o,
});
const input = (o: Partial<ProgressInput> = {}): ProgressInput => ({
  workedDays: new Set(),
  visits: [],
  countedVisitIds: new Set(),
  plans: [],
  spots: [],
  corroboratedSpotIds: new Set(),
  ...o,
});
const plan = (day: string, stores: string[], status: ProgressPlan['status'] = 'approved'): ProgressPlan => ({
  plan_date: day,
  status,
  store_ids: stores,
});

// A full day: visit + count every planned store.
const fullDay = (day: string, stores = ['a', 'b']) => {
  const vs = stores.map((s) => visit(day, s));
  return { plan: plan(day, stores), visits: vs, counted: vs.map((v) => v.id) };
};
const build = (days: ReturnType<typeof fullDay>[], extra: Partial<ProgressInput> = {}) =>
  input({
    plans: days.map((d) => d.plan),
    visits: days.flatMap((d) => d.visits),
    countedVisitIds: new Set(days.flatMap((d) => d.counted)),
    workedDays: new Set(days.map((d) => d.plan.plan_date)),
    ...extra,
  });

// ── the bar measures stock handled, not visits ─────────────────────────────
{
  const D = '2026-10-21';
  const vs = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => visit(D, s));
  const inp = input({
    plans: [plan(D, ['a', 'b', 'c', 'd', 'e', 'f'])],
    visits: vs,
    // all six visited; four counted; one skipped with a reason; one rushed
    countedVisitIds: new Set(vs.slice(0, 4).map((v) => v.id)),
  });
  vs[4].stock_skip_reason = 'shop_busy';
  const p = dayProgress(D, inp);
  assert.equal(p.visited, 6);
  assert.equal(p.counted, 4);
  assert.equal(p.skipped, 1);
  assert.equal(p.done, 5);
  assert.equal(p.complete, false, 'visiting everything without counting is not a full bar');
  assert.equal(nudgeFor(p), '1 more store to finish today’s plan.');
  assert.ok(!/lose|streak|hurry|left|before/i.test(nudgeFor(p)!), 'forward-framed only');

  // Off-plan visits don't fill the plan; a rejected plan is no plan.
  const off = dayProgress(D, input({ plans: [plan(D, ['x'])], visits: [visit(D, 'y')], countedVisitIds: new Set() }));
  assert.equal(off.visited, 0);
  assert.equal(off.storesVisited, 1);
  assert.equal(dayProgress(D, input({ plans: [plan(D, ['a'], 'rejected')] })).hasPlan, false);
  // A submitted (not yet approved) plan still counts — approval is optimistic.
  assert.equal(dayProgress(D, input({ plans: [plan(D, ['a'], 'submitted')] })).hasPlan, true);
  // No nudge far from done, or before starting.
  assert.equal(nudgeFor(dayProgress(D, input({ plans: [plan(D, ['a', 'b', 'c', 'd'])] }))), null);
}

// ── streak with forgiveness ────────────────────────────────────────────────
{
  // Week of Mon 2026-10-12 … Sat 2026-10-17, Sun 18 rest; Mon 19 …
  assert.equal(weekKey('2026-10-18'), '2026-10-12');
  assert.equal(weekKey('2026-10-19'), '2026-10-19');

  const days = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-19', '2026-10-20'];
  // 12th (Mon) has no data → a miss; Sunday 18 rest; today (21st) not finished.
  const inp = build(days.map((d) => fullDay(d)));
  assert.equal(dayOutcome('2026-10-21', '2026-10-21', inp), 'pending');
  assert.equal(dayOutcome('2026-10-18', '2026-10-21', inp), 'rest');
  // 7 complete days; Monday 12 is the week's forgiven miss, so it continues
  // back into the week of 5 Oct, where two empty days end it.
  assert.equal(streak('2026-10-21', inp), 7);

  // One miss inside a week is survived…
  const oneMiss = build(days.filter((d) => d !== '2026-10-15').map((d) => fullDay(d)));
  assert.equal(streak('2026-10-21', oneMiss), 6);
  // …a second miss in the same week ends it (only the days after it count).
  const twoMiss = build(days.filter((d) => d !== '2026-10-15' && d !== '2026-10-16').map((d) => fullDay(d)));
  assert.equal(streak('2026-10-21', twoMiss), 3);

  // A declared holiday is neutral like a Sunday.
  const hol = build(days.filter((d) => d !== '2026-10-15' && d !== '2026-10-16').map((d) => fullDay(d)), {
    holidays: new Set(['2026-10-16']),
  });
  assert.equal(streak('2026-10-21', hol), 5);

  // Today completing counts; today unfinished never breaks.
  assert.equal(streak('2026-10-21', build([...days, '2026-10-21'].map((d) => fullDay(d)))), 8);
}

// ── personal bests: own history, corroborated conversions only ─────────────
{
  const vs = [
    ...Array.from({ length: 10 }, (_, i) => visit('2026-09-1' + (i % 9), `s${i}`)),
    ...Array.from({ length: 6 }, (_, i) => visit('2026-10-0' + (i + 1), `t${i}`)),
  ];
  const inp = input({
    visits: vs,
    spots: [
      { id: 'p1', created_at: '2026-09-05T10:00:00+05:30' },
      { id: 'p2', created_at: '2026-10-05T10:00:00+05:30' },
      { id: 'p3', created_at: '2026-10-06T10:00:00+05:30' },
    ],
    corroboratedSpotIds: new Set(['p1', 'p2']),
  });
  const b = personalBests('2026-10-21', inp);
  assert.deepEqual(b.monthVisits, { current: 6, best: 10, bestPeriod: '2026-09' });
  assert.equal(b.daysLeftInMonth, 10);
  assert.equal(b.loggedThisMonth, 2, 'raw count is activity');
  assert.equal(b.monthConversions.current, 1, 'only the corroborated one is achievement');
  assert.equal(b.lifetimeConversions, 2);
  assert.equal(bestLine(b), 'Your best month was 10 store visits. You’re at 6 with 10 days left.');
  // No history → no comparison line at all (nothing to beat yet).
  assert.equal(bestLine(personalBests('2026-10-21', input({ visits: vs.slice(10) }))), null);
}

// ── milestones ─────────────────────────────────────────────────────────────
assert.equal(milestoneAt(99, VISIT_MILESTONES), 50);
assert.equal(milestoneAt(100, VISIT_MILESTONES), 100);
assert.equal(milestoneAt(10, VISIT_MILESTONES), 0);

// ── management month pattern ───────────────────────────────────────────────
{
  const inp = build([fullDay('2026-10-01'), fullDay('2026-10-02')]);
  inp.visits.push(visit('2026-10-03', 'z'));
  inp.workedDays.add('2026-10-03');
  const m = monthPattern('2026-10', '2026-10-05', inp);
  assert.equal(m.days.length, 31);
  assert.deepEqual(m.days.slice(0, 6).map((d) => d.state), ['complete', 'complete', 'partial', 'off', 'off', 'future']);
  assert.equal(m.workedDays, 3);
  assert.equal(m.completeDays, 2);
  assert.equal(m.visits, 5);
  assert.equal(m.countedVisits, 4);
}

console.log('progress.test.ts: all assertions passed');
