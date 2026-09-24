/**
 * The measured-vs-not-recorded rule. Fixtures mirror live rows from the
 * 21-09-2026 report that printed "0.0 km / 0h 0m" for a day of six visits.
 *
 * Run: npx --yes tsx lib/reportFigures.test.ts
 */
import assert from 'node:assert/strict';
import { periodFigure, coverageNote, dayFigure, legsKm, odometerKm, displayFigure, routeFor } from './reportFigures.ts';

const punchedOut = {
  check_out_time: '2026-09-19T12:18:52Z',
  auto_closed: false,
  total_market_time_minutes: 56,
  total_distance_km: 0.92,
  odo_start: '123456', // numeric arrives as a string
  odo_end: null,
};
const autoClosed = {
  check_out_time: '2026-09-21T17:00:00Z',
  auto_closed: true,
  total_market_time_minutes: null,
  total_distance_km: null,
  odo_start: null,
  odo_end: null,
};
const open = { ...autoClosed, check_out_time: null, auto_closed: false, odo_start: '33780' };
const measuredZero = { ...punchedOut, total_distance_km: 0, total_market_time_minutes: 0, odo_start: '1000', odo_end: '1000' };

// ── the 21-09 bug: an auto-closed day is NOT RECORDED, never 0 ─────────────
{
  const route = periodFigure([autoClosed], 'route');
  assert.equal(route.value, null, 'no recorded day → null, not 0');
  assert.deepEqual([route.recorded, route.pending, route.missing], [0, 0, 1]);
  assert.equal(coverageNote(route), 'Not recorded');
  assert.equal(coverageNote(periodFigure([autoClosed], 'market')), 'Not recorded');
}

// ── a genuinely measured 0 stays 0 and needs no caption ───────────────────
{
  for (const kind of ['route', 'market', 'odometer'] as const) {
    const f = periodFigure([measuredZero], kind);
    assert.equal(f.value, 0, `${kind}: measured zero is 0`);
    assert.equal(coverageNote(f), null, `${kind}: fully covered → no note`);
  }
}

// ── a week mixing both sums only what was measured, and says so ───────────
{
  const route = periodFigure([punchedOut, autoClosed, autoClosed], 'route');
  assert.equal(route.value, 0.92);
  assert.equal(coverageNote(route), '2 days not recorded');
}

// ── an open day is pending, not missing ───────────────────────────────────
{
  assert.equal(dayFigure(open, 'route').state, 'pending');
  assert.equal(coverageNote(periodFigure([open], 'route')), 'Calculated at punch-out');
  assert.equal(coverageNote(periodFigure([punchedOut, open], 'market')), 'punch-out pending');
  // ...but an open odometer day with no morning reading can never complete.
  assert.equal(dayFigure({ ...open, odo_start: null }, 'odometer').state, 'missing');
  assert.equal(dayFigure(open, 'odometer').state, 'pending');
}

// ── odometer: string readings, and a half-read day is not recorded ────────
{
  assert.equal(odometerKm({ odo_start: '33780', odo_end: '33842' }), 62);
  assert.equal(odometerKm({ odo_start: '123456', odo_end: null }), null);
  const f = periodFigure([punchedOut, { ...punchedOut, odo_start: '33780', odo_end: '33842' }], 'odometer');
  assert.equal(f.value, 62);
  assert.equal(coverageNote(f), '1 day not recorded');
}

// ── an auto-closed day the sweep computed is RECORDED, but labelled estimated ──
{
  const computed = { ...autoClosed, total_distance_km: 18.03, total_market_time_minutes: 260 };
  const route = periodFigure([computed], 'route');
  assert.equal(route.value, 18.03);
  assert.equal(route.estimated, 1);
  assert.equal(coverageNote(route), '1 day estimated (auto-closed)');
  // A measured-zero no-visit day from the sweep is still an estimate of a day, and says so.
  assert.equal(coverageNote(periodFigure([{ ...autoClosed, total_distance_km: 0, total_market_time_minutes: 0 }], 'market')), '1 day estimated (auto-closed)');
  // A punched-out day is never "estimated".
  assert.equal(periodFigure([punchedOut], 'route').estimated, 0);
  // Mixed with a missing day, both are said.
  assert.equal(coverageNote(periodFigure([computed, autoClosed], 'route')), '1 day estimated (auto-closed) · 1 day not recorded');
}

// ── what a tile shows ─────────────────────────────────────────────────────
{
  const km = (n: number) => `${n.toFixed(1)} km`;
  assert.deepEqual(displayFigure([], 'route', km), { value: '—', note: 'No punch-in' });
  assert.deepEqual(displayFigure([autoClosed], 'route', km), { value: '—', note: 'Not recorded' });
  assert.deepEqual(displayFigure([measuredZero], 'route', km), { value: '0.0 km', note: null });
}

// ── legs: straight-line where both ends are known, null otherwise ─────────
{
  const legs = legsKm([
    { kind: 'punch_in', label: 'Punch-in', at: null, lat: 18.5204, lng: 73.8567 },
    { kind: 'store', label: 'A', at: null, lat: 19.076, lng: 72.8777 },
    { kind: 'punch_out', label: 'Punch-out', at: null, lat: null, lng: null },
  ]);
  assert.equal(legs.length, 2);
  assert.ok(legs[0]! > 110 && legs[0]! < 130, `Pune→Mumbai ~120km, got ${legs[0]}`);
  assert.equal(legs[1], null, 'unknown punch-out position → no leg, not 0');
  assert.deepEqual(legsKm([]), []);
}

// ── routeFor: stored road legs win; older days rebuild, labelled straight-line ──
{
  const day = {
    check_in_time: '2026-09-24T04:00:00Z',
    check_out_time: '2026-09-24T12:00:00Z',
    auto_closed: false,
    latitude: 28.4,
    longitude: 77.0,
    odo_end_lat: null,
    odo_end_lng: null,
    route: null as any,
  };
  const visits = [
    { id: 'b', storeName: 'B', check_in_time: '2026-09-24T07:00:00Z', latitude: 28.46, longitude: 77.05 },
    { id: 'a', storeName: 'A', check_in_time: '2026-09-24T05:00:00Z', latitude: 28.45, longitude: 77.02 },
    { id: 'x', storeName: 'X', check_in_time: '2026-09-24T09:00:00Z', latitude: null, longitude: null },
  ];
  const stored = {
    v: 1,
    source: 'directions',
    points: [
      { kind: 'punch_in', lat: 28.4, lng: 77.0 },
      { kind: 'store', lat: 28.45, lng: 77.02, visit_id: 'a' },
      { kind: 'store', lat: 28.46, lng: 77.05, visit_id: 'b' },
      { kind: 'punch_out', lat: 28.5, lng: 77.1 },
    ],
    legs_km: [6.2, 3.1, 9.9],
  };

  const r = routeFor({ ...day, route: stored }, visits);
  assert.equal(r.source, 'directions');
  assert.deepEqual(r.legs, [6.2, 3.1, 9.9], 'stored road legs are used verbatim');
  assert.deepEqual(r.stops.map((s) => s.label), ['Punch-in', 'A', 'B', 'Punch-out']);
  assert.equal(r.stops[3].at, day.check_out_time);
  assert.equal(r.unplaced, 1, 'X had no position, so it is not on the stored route — and that is counted');

  // A malformed stored route is never trusted: it is rebuilt, and says straight-line.
  const bad = routeFor({ ...day, route: { ...stored, legs_km: [1] } }, visits);
  assert.equal(bad.source, 'straight_line');
  assert.deepEqual(bad.stops.map((s) => s.label), ['Punch-in', 'A', 'B', 'X', 'Punch-out'], 'rebuilt in time order');
  assert.equal(bad.legs[bad.legs.length - 1], null, 'pre-route punch-out position is unknown → no leg, not 0');

  // Auto-closed: never punched out, so no punch-out stop at all.
  assert.ok(!routeFor({ ...day, auto_closed: true }, visits).stops.some((s) => s.kind === 'punch_out'));
  // Visits on a day with no punch-in still list.
  assert.deepEqual(routeFor(null, visits).stops.map((s) => s.label), ['A', 'B', 'X']);
}

console.log('reportFigures.test.ts: all assertions passed');
