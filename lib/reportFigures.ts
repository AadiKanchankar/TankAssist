/**
 * Report figures that are MEASURED, NOT RECORDED, or NOT KNOWN YET.
 *
 * A day's route distance and market time are written only at punch-out, and
 * odometer distance needs both readings. A day closed by the 22:30 auto-close
 * sweep has none of them — and summing that NULL as 0 is exactly how the
 * manager report came to print "0.0 km / 0h 0m" for a rep who visited six
 * stores (21-09-2026: the rep checked out of every store but never punched
 * out). So every period figure carries how many days it actually covers, and a
 * period with no recorded day is null, never 0. A genuinely measured 0 stays 0.
 *
 * Pure — see lib/reportFigures.test.ts.
 */
import { dailyDistance } from './odometer';
import { haversineKm } from './haversine';

export interface AttendanceFigures {
  check_out_time: string | null;
  auto_closed: boolean | null;
  total_market_time_minutes: number | null;
  total_distance_km: number | null;
  // `numeric` columns come back from PostgREST as strings.
  odo_start: number | string | null;
  odo_end: number | string | null;
}

export type FigureKind = 'route' | 'market' | 'odometer';

/** recorded = has a value · pending = day still open · missing = closed without one. */
export type DayState = 'recorded' | 'pending' | 'missing';

export interface PeriodFigure {
  /** Sum over recorded days; null when no day in the period was recorded. */
  value: number | null;
  recorded: number;
  pending: number;
  missing: number;
}

export const toNum = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** km with at most one decimal — odometer readings are usually whole km. */
export const fmtKmShort = (km: number) => `${Number.isInteger(km) ? km : km.toFixed(1)} km`;

/** Odometer km for one day, or null when either reading is absent. */
export function odometerKm(d: Pick<AttendanceFigures, 'odo_start' | 'odo_end'>): number | null {
  return dailyDistance(toNum(d.odo_start), toNum(d.odo_end));
}

export function dayFigure(d: AttendanceFigures, kind: FigureKind): { state: DayState; value: number | null } {
  const value =
    kind === 'route'
      ? toNum(d.total_distance_km)
      : kind === 'market'
      ? toNum(d.total_market_time_minutes)
      : odometerKm(d);
  if (value != null) return { state: 'recorded', value };
  // Still open: all three arrive at punch-out — except an odometer day with no
  // morning reading, which can never produce a distance however it ends.
  if (!d.check_out_time && !(kind === 'odometer' && toNum(d.odo_start) == null)) {
    return { state: 'pending', value: null };
  }
  return { state: 'missing', value: null };
}

export function periodFigure(days: AttendanceFigures[], kind: FigureKind): PeriodFigure {
  const f: PeriodFigure = { value: null, recorded: 0, pending: 0, missing: 0 };
  for (const d of days) {
    const { state, value } = dayFigure(d, kind);
    f[state] += 1;
    if (value != null) f.value = (f.value ?? 0) + value;
  }
  return f;
}

/** Caption under a period figure; null when the figure covers every day. */
export function coverageNote(f: PeriodFigure): string | null {
  const { recorded, pending, missing } = f;
  if (!pending && !missing) return null;
  if (!recorded) return missing ? 'Not recorded' : 'Calculated at punch-out';
  const parts: string[] = [];
  if (missing) parts.push(`${missing} ${missing === 1 ? 'day' : 'days'} not recorded`);
  if (pending) parts.push('punch-out pending');
  return parts.join(' · ');
}

/** What a tile shows: a measured value, or "—" plus why. Never a default 0. */
export function displayFigure(
  days: AttendanceFigures[],
  kind: FigureKind,
  fmt: (n: number) => string,
): { value: string; note: string | null } {
  if (!days.length) return { value: '—', note: 'No punch-in' };
  const f = periodFigure(days, kind);
  return { value: f.value == null ? '—' : fmt(f.value), note: coverageNote(f) };
}

// ── Route reconstruction (§6.3) ───────────────────────────────────────────

export interface Stop {
  kind: 'punch_in' | 'store' | 'punch_out';
  label: string;
  at: string | null;
  lat: number | null;
  lng: number | null;
}

/** Straight-line km between consecutive points; null for a leg with an unknown end. */
export function legsKm(stops: { lat: number | null; lng: number | null }[]): (number | null)[] {
  return stops.slice(1).map((s, i) => {
    const p = stops[i];
    return p.lat != null && p.lng != null && s.lat != null && s.lng != null
      ? haversineKm(p.lat, p.lng, s.lat, s.lng)
      : null;
  });
}

export interface RoutePoint {
  kind: Stop['kind'];
  lat: number;
  lng: number;
  visit_id?: string;
}

/** `attendance.route`, written at punch-out (from 2026-09-23). legs_km[i] = points[i] -> points[i+1]. */
export interface StoredRoute {
  v: 1;
  source: 'directions' | 'straight_line';
  points: RoutePoint[];
  legs_km: number[];
}

export interface RouteDay {
  check_in_time: string;
  check_out_time: string | null;
  auto_closed: boolean | null;
  latitude: number | null;
  longitude: number | null;
  odo_end_lat: number | null;
  odo_end_lng: number | null;
  route: StoredRoute | null;
}

export interface RouteVisit {
  id: string;
  storeName: string;
  check_in_time: string;
  latitude: number | null;
  longitude: number | null;
}

export interface DayRoute {
  stops: Stop[];
  legs: (number | null)[];
  /** 'directions' = road legs as Google measured them; else straight-line. */
  source: StoredRoute['source'];
  /** Visits that day with no recorded position, so not on the route. */
  unplaced: number;
}

const isStored = (r: any): r is StoredRoute =>
  !!r &&
  r.v === 1 &&
  Array.isArray(r.points) &&
  Array.isArray(r.legs_km) &&
  r.points.length > 0 &&
  r.legs_km.length === r.points.length - 1;

/**
 * A day's stops and legs. Prefers the route STORED at punch-out (real road
 * legs, and the punch-out position). Days before that, and malformed rows,
 * are rebuilt from the recorded positions with straight-line legs — and
 * `source` says which, so the screen never passes a straight line off as road.
 */
export function routeFor(day: RouteDay | null, visits: RouteVisit[]): DayRoute {
  const ordered = [...visits].sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
  const located = ordered.filter((v) => v.latitude != null && v.longitude != null).length;

  if (day && isStored(day.route)) {
    const byId = new Map(ordered.map((v) => [v.id, v]));
    const stops: Stop[] = day.route.points.map((pt) => {
      const v = pt.visit_id ? byId.get(pt.visit_id) : undefined;
      return {
        kind: pt.kind,
        label: pt.kind === 'punch_in' ? 'Punch-in' : pt.kind === 'punch_out' ? 'Punch-out' : v?.storeName ?? 'Store',
        at: pt.kind === 'punch_in' ? day.check_in_time : pt.kind === 'punch_out' ? day.check_out_time : v?.check_in_time ?? null,
        lat: pt.lat,
        lng: pt.lng,
      };
    });
    return { stops, legs: day.route.legs_km, source: day.route.source, unplaced: ordered.length - located };
  }

  const stops: Stop[] = [];
  if (day) stops.push({ kind: 'punch_in', label: 'Punch-in', at: day.check_in_time, lat: day.latitude, lng: day.longitude });
  for (const v of ordered) {
    stops.push({ kind: 'store', label: v.storeName, at: v.check_in_time, lat: v.latitude, lng: v.longitude });
  }
  // An auto-closed day never punched out, so there is no punch-out stop.
  // Before stored routes, its position survived only with an end odometer.
  if (day?.check_out_time && !day.auto_closed) {
    stops.push({ kind: 'punch_out', label: 'Punch-out', at: day.check_out_time, lat: day.odo_end_lat, lng: day.odo_end_lng });
  }
  return { stops, legs: legsKm(stops), source: 'straight_line', unplaced: 0 };
}
