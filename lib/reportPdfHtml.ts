/**
 * Field-report PDF: the month MODEL and its HTML. Pure — no React Native, no
 * Supabase — so lib/reportPdfHtml.test.ts can run it under tsx and render a
 * preview with headless Chrome. lib/reportPdf.ts fetches, prints, shares.
 *
 * Layout (owner-approved 2026-10-01, ported from the Reports-T90 references):
 *   page 1  — readable in ~10 s: six KPI tiles, one headline sentence, daily
 *             activity (two charts, each with its own legend + axis titles),
 *             where the cases came from, repeat visits, what stands out.
 *   then    — day-by-day table with weekly subtotals + notes explaining every
 *             gap, then the per-visit log grouped by day.
 * Per-visit detail lives only in the log, so page 1 stays the same size
 * however many visits a month holds. Charts sit side by side for a short
 * range and stack full-width for a long one, so a 30-day month keeps legible
 * bars and labels (the simulated-month reference's problem).
 *
 * Honest-data rules carried over: a figure that was not recorded is "—" and is
 * excluded from totals and averages — never 0 (lib/reportFigures). An
 * auto-closed day's figures are marked estimated. Route (GPS) and odometer are
 * never merged, and the notes say why they differ.
 */
import { dayFigure, odometerKm, toNum } from './reportFigures';
import { MISMATCH_FLOOR_KM, MISMATCH_PERCENT } from './odometer';

// ── input ──────────────────────────────────────────────────────────────────

export interface PdfDay {
  check_in_time: string;
  check_out_time: string | null;
  auto_closed: boolean | null;
  total_market_time_minutes: number | null;
  total_distance_km: number | string | null;
  odo_start: number | string | null;
  odo_end: number | string | null;
}

export interface PdfVisit {
  id: string;
  store_id: string | null;
  storeName: string;
  check_in_time: string;
  check_out_time: string | null;
  duration_minutes: number | null;
  auto_closed: boolean | null;
  notes: string | null;
  /** Through the cutover hybrid (casesSold().byVisit) — never the raw column. */
  cases: number;
}

export interface PdfDayReport {
  report_date: string;
  notes: string | null;
  challenges: string | null;
}

export interface PdfMonthInput {
  /** Any date inside the month (local). */
  month: Date;
  days: PdfDay[];
  visits: PdfVisit[];
  dayReports: PdfDayReport[];
  /** casesSold().byDay / .total for the month. */
  casesByDay: Record<string, number>;
  casesTotal: number;
  /** "Today" — bounds a month still in progress. */
  now: Date;
}

// ── formatting ─────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** 65h 43m · 0h 37m — always both parts, so a column of them aligns. */
export const hm = (min: number | null) => (min == null ? '—' : `${Math.floor(min / 60)}h ${pad(Math.round(min % 60))}m`);
const int = (n: number) => n.toLocaleString('en-IN');
const km = (n: number | null) => (n == null ? '—' : n.toFixed(1));
const dayLabel = (d: Date) => `${pad(d.getDate())} ${MON[d.getMonth()]}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// ── model ──────────────────────────────────────────────────────────────────

export type DayState = 'recorded' | 'pending' | 'missing' | 'none';

export interface DayRow {
  date: Date;
  key: string;
  visits: PdfVisit[];
  hasAttendance: boolean;
  firstIn: string | null;
  lastOut: string | null;
  inStoreMin: number;
  marketMin: number | null;
  /** Market-time state; route follows the same punch-out rule. */
  market: DayState;
  estimated: boolean;
  routeKm: number | null;
  odoKm: number | null;
  cases: number;
}

export interface StoreAgg {
  name: string;
  visits: number;
  cases: number;
  sellingVisits: PdfVisit[];
}

export interface MonthModel {
  title: string; // September 2026
  monthIndex: number;
  /** Day rows from the first to the last day of the shown range. */
  range: DayRow[];
  fieldDays: DayRow[];
  offDays: Date[];
  visits: PdfVisit[];
  stores: StoreAgg[];
  /** Distinct store rows in the DB, before name tidying. */
  storeIdsCount: number;
  mergedNames: { shown: string; variants: string[] }[];
  /** Raw store name → the tidied name shown everywhere in the report. */
  shownName: (raw: string) => string;
  casesTotal: number;
  market: { min: number | null; days: number; missing: number; pending: number; estimated: number };
  routeKm: number | null;
  routeDays: number;
  odoKm: number | null;
  odoDays: number;
  inStoreOnMarketDays: number;
  dayReports: PdfDayReport[];
}

const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const isShouting = (s: string) => s.length > 3 && s === s.toUpperCase() && /[A-Z]/.test(s);

export function buildMonth(input: PdfMonthInput): MonthModel {
  const y = input.month.getFullYear();
  const m = input.month.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const inProgress = input.now.getFullYear() === y && input.now.getMonth() === m;

  const visitsByDay = new Map<string, PdfVisit[]>();
  const visits = [...input.visits].sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
  for (const v of visits) {
    const k = ymd(new Date(v.check_in_time));
    visitsByDay.set(k, [...(visitsByDay.get(k) ?? []), v]);
  }
  const attByDay = new Map<string, PdfDay[]>();
  for (const a of input.days) {
    const k = ymd(new Date(a.check_in_time));
    attByDay.set(k, [...(attByDay.get(k) ?? []), a]);
  }

  const all: DayRow[] = [];
  for (let d = 1; d <= dim; d++) {
    const date = new Date(y, m, d);
    const key = ymd(date);
    const vs = visitsByDay.get(key) ?? [];
    const att = attByDay.get(key) ?? [];
    // A day can hold more than one attendance row (before the one-open-day
    // index). Sum what was recorded; the day is "recorded" only if every row is.
    const sum = (kind: 'market' | 'route') => {
      let value: number | null = null;
      let state: DayState = att.length ? 'recorded' : 'none';
      for (const a of att) {
        const f = dayFigure({ ...a, total_distance_km: toNum(a.total_distance_km) }, kind);
        if (f.value != null) value = (value ?? 0) + f.value;
        if (f.state === 'pending') state = 'pending';
        else if (f.state === 'missing' && state !== 'pending') state = 'missing';
      }
      return { value: state === 'recorded' ? value : null, state };
    };
    const mk = sum('market');
    const rt = sum('route');
    const odo = att.length && att.every((a) => odometerKm(a) != null)
      ? att.reduce((s, a) => s + (odometerKm(a) ?? 0), 0)
      : null;
    const outs = vs.map((v) => v.check_out_time).filter((t): t is string => !!t).sort();
    all.push({
      date,
      key,
      visits: vs,
      hasAttendance: att.length > 0,
      firstIn: vs[0]?.check_in_time ?? null,
      lastOut: outs[outs.length - 1] ?? null,
      inStoreMin: vs.reduce((s, v) => s + (v.duration_minutes ?? 0), 0),
      marketMin: mk.value,
      market: mk.state,
      estimated: mk.state === 'recorded' && att.some((a) => !!a.auto_closed),
      routeKm: rt.value,
      odoKm: odo,
      cases: input.casesByDay[key] ?? 0,
    });
  }

  const fieldDays = all.filter((r) => r.hasAttendance || r.visits.length);
  // Charts run from the first field day to month end (or today, mid-month).
  const first = fieldDays[0]?.date.getDate() ?? 1;
  const end = Math.max(inProgress ? input.now.getDate() : dim, fieldDays[fieldDays.length - 1]?.date.getDate() ?? 1);
  const range = all.slice(first - 1, Math.max(first, end));
  const offDays = range.filter((r) => !r.hasAttendance && !r.visits.length && r.date.getDay() !== 0).map((r) => r.date);

  // Stores, grouped by tidied name: "Sector 19" and "SECTOR 19" are one shop
  // entered twice. ponytail: name match, not a merge in the DB — two genuinely
  // different shops with the same name would fold together here; the note on
  // page 2 says when it happened.
  const groups = new Map<string, { variants: Map<string, number>; visits: PdfVisit[] }>();
  for (const v of visits) {
    const k = nameKey(v.storeName);
    const g = groups.get(k) ?? { variants: new Map<string, number>(), visits: [] as PdfVisit[] };
    g.variants.set(v.storeName.trim(), (g.variants.get(v.storeName.trim()) ?? 0) + 1);
    g.visits.push(v);
    groups.set(k, g);
  }
  const mergedNames: MonthModel['mergedNames'] = [];
  const shownByKey = new Map<string, string>();
  const stores: StoreAgg[] = [...groups.values()].map((g) => {
    const variants = [...g.variants.entries()].sort((a, b) => b[1] - a[1]);
    const shown = (variants.find(([n]) => !isShouting(n)) ?? variants[0])[0].replace(/\s+/g, ' ');
    if (variants.length > 1) mergedNames.push({ shown, variants: variants.map(([n]) => n) });
    shownByKey.set(nameKey(shown), shown);
    return {
      name: shown,
      visits: g.visits.length,
      cases: g.visits.reduce((s, v) => s + v.cases, 0),
      sellingVisits: g.visits.filter((v) => v.cases > 0),
    };
  });

  const recorded = fieldDays.filter((r) => r.market === 'recorded');
  const routeDays = fieldDays.filter((r) => r.routeKm != null);
  const odoDays = fieldDays.filter((r) => r.odoKm != null);
  return {
    title: `${MONTHS[m]} ${y}`,
    monthIndex: m,
    range,
    fieldDays,
    offDays,
    visits,
    stores,
    storeIdsCount: new Set(visits.map((v) => v.store_id ?? v.storeName)).size,
    mergedNames,
    shownName: (raw: string) => shownByKey.get(nameKey(raw)) ?? raw.trim(),
    casesTotal: input.casesTotal,
    market: {
      min: recorded.length ? recorded.reduce((s, r) => s + (r.marketMin ?? 0), 0) : null,
      days: recorded.length,
      missing: fieldDays.filter((r) => r.market === 'missing').length,
      pending: fieldDays.filter((r) => r.market === 'pending').length,
      estimated: recorded.filter((r) => r.estimated).length,
    },
    routeKm: routeDays.length ? routeDays.reduce((s, r) => s + (r.routeKm ?? 0), 0) : null,
    routeDays: routeDays.length,
    odoKm: odoDays.length ? odoDays.reduce((s, r) => s + (r.odoKm ?? 0), 0) : null,
    odoDays: odoDays.length,
    inStoreOnMarketDays: recorded.reduce((s, r) => s + r.inStoreMin, 0),
    dayReports: input.dayReports,
  };
}

// ── charts (inline SVG; the WebView renders it natively) ───────────────────

const C = {
  ink: '#0f172a', sub: '#475569', muted: '#64748b', faint: '#94a3b8',
  border: '#e2e8f0', grid: '#eef2f5', axis: '#cbd5e1', surface: '#ffffff',
  // Market stack: one-hue ordinal ramp, validated (dataviz validator, --ordinal).
  inStore: '#7cb3f5', travel: '#1e3a8a',
  // Visits: categorical pair, validated (CVD ΔE 27).
  sales: '#15803d', noSales: '#1d4ed8',
  salesTint: '#e8f6ec', accent: '#dbe6ff',
};

function ticksFor(maxVal: number, steps: number[]) {
  const max = Math.max(maxVal, 1);
  const step = steps.find((s) => Math.ceil(max / s) <= 4) ?? steps[steps.length - 1];
  const top = step * Math.ceil(max / step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

const topRounded = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(3, w / 2, h);
  return `M${x},${y + h} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`;
};

interface Frame {
  W: number; H: number; L: number; R: number; T: number; B: number;
  n: number; top: number; ticks: number[]; yTitle: string; xTitle: string; days: DayRow[];
}

function frame(f: Frame) {
  const plotW = f.W - f.L - f.R;
  const plotH = f.H - f.T - f.B;
  const band = plotW / f.n;
  const y = (v: number) => f.T + plotH - (v / f.top) * plotH;
  let s = '';
  for (const t of f.ticks) {
    if (t > 0) s += `<line x1="${f.L}" y1="${y(t)}" x2="${f.W - f.R}" y2="${y(t)}" stroke="${C.grid}"/>`;
    s += `<text x="${f.L - 5}" y="${y(t) + 3}" text-anchor="end" font-size="9" fill="${C.muted}">${t}</text>`;
  }
  s += `<line x1="${f.L}" y1="${f.T + plotH}" x2="${f.W - f.R}" y2="${f.T + plotH}" stroke="${C.axis}"/>`;
  const every = band >= 13 ? 1 : 2;
  f.days.forEach((d, i) => {
    if (i % every) return;
    const sunday = d.date.getDay() === 0;
    s += `<text x="${f.L + i * band + band / 2}" y="${f.T + plotH + 11}" text-anchor="middle" font-size="9" fill="${sunday ? C.faint : C.sub}">${d.date.getDate()}</text>`;
  });
  s += `<text x="${f.L + plotW / 2}" y="${f.H - 3}" text-anchor="middle" font-size="8.5" fill="${C.muted}">${esc(f.xTitle)}</text>`;
  s += `<text transform="translate(9 ${f.T + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="8.5" fill="${C.muted}">${esc(f.yTitle)}</text>`;
  return { s, y, plotW, plotH, band, L: f.L };
}

export function marketChartSVG(days: DayRow[], W: number, H: number, month: string): string {
  const hours = (min: number) => min / 60;
  const max = Math.max(1, ...days.map((d) => hours(Math.max(d.marketMin ?? 0, d.inStoreMin))));
  const { top, ticks } = ticksFor(max, [1, 2, 3, 4, 6]);
  const f = frame({ W, H, L: 30, R: 4, T: 14, B: 28, n: days.length, top, ticks, yTitle: 'Hours', xTitle: `Day of ${month}`, days });
  const bw = Math.min(22, f.band * 0.66);
  const base = f.y(0);
  const labels = f.band >= 12;
  let s = '';
  days.forEach((d, i) => {
    if (!d.hasAttendance && !d.visits.length) return;
    const x = f.L + i * f.band + (f.band - bw) / 2;
    const inH = base - f.y(hours(d.inStoreMin));
    const cx = x + bw / 2;
    if (d.marketMin != null) {
      const totH = Math.max(inH, base - f.y(hours(d.marketMin)));
      const travelH = totH - inH;
      // 2px surface gap between the two segments; the top one is rounded.
      if (travelH > 2.5) {
        if (inH > 0.5) s += `<rect x="${x}" y="${base - inH}" width="${bw}" height="${inH}" fill="${C.inStore}"/>`;
        s += `<path d="${topRounded(x, base - totH, bw, travelH - (inH > 0.5 ? 2 : 0))}" fill="${C.travel}"/>`;
      } else if (inH > 0.5) {
        s += `<path d="${topRounded(x, base - inH, bw, inH)}" fill="${C.inStore}"/>`;
      }
      if (labels) {
        const v = `${d.estimated ? '~' : ''}${hours(d.marketMin).toFixed(1)}`;
        s += `<text x="${cx}" y="${base - totH - 4}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${C.ink}">${v}</text>`;
      }
    } else {
      // Not recorded (no punch-out) or still open: show what IS known — time
      // inside stores — under a dashed placeholder, never a guessed bar.
      const boxH = Math.max(inH + 8, 16);
      if (inH > 0.5) s += `<rect x="${x}" y="${base - inH}" width="${bw}" height="${inH}" fill="${C.inStore}"/>`;
      s += `<rect x="${x + 0.5}" y="${base - boxH}" width="${bw - 1}" height="${boxH}" fill="none" stroke="${C.muted}" stroke-dasharray="2 2"/>`;
      if (labels) s += `<text x="${cx}" y="${base - boxH - 4}" text-anchor="middle" font-size="9" fill="${C.muted}">${d.market === 'pending' ? 'open' : 'n/a'}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${f.s}${s}</svg>`;
}

export function visitsChartSVG(days: DayRow[], W: number, H: number, month: string): string {
  const max = Math.max(1, ...days.map((d) => d.visits.length));
  const { top, ticks } = ticksFor(max, [1, 2, 5, 10, 20]);
  const f = frame({ W, H, L: 30, R: 4, T: 14, B: 28, n: days.length, top, ticks, yTitle: 'Visits', xTitle: `Day of ${month}`, days });
  const bw = Math.min(22, f.band * 0.66);
  const base = f.y(0);
  let s = '';
  days.forEach((d, i) => {
    const n = d.visits.length;
    if (!n) return;
    const x = f.L + i * f.band + (f.band - bw) / 2;
    const h = base - f.y(n);
    s += `<path d="${topRounded(x, base - h, bw, h)}" fill="${d.cases > 0 ? C.sales : C.noSales}"/>`;
    if (f.band >= 12) s += `<text x="${x + bw / 2}" y="${base - h - 4}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${C.ink}">${n}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${f.s}${s}</svg>`;
}

// ── page 1 pieces ──────────────────────────────────────────────────────────

const tile = (label: string, value: string, sub: string, cls = '') =>
  `<div class="tile ${cls}"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-sub">${sub}</div></div>`;

function fieldDaysSub(md: MonthModel): string {
  const f = md.fieldDays;
  if (!f.length) return 'no field days';
  const span = `${f[0].date.getDate()} – ${dayLabel(f[f.length - 1].date)}`;
  const off = md.offDays;
  if (!off.length) return span;
  return off.length <= 5
    ? `${span} · off ${off.map((d) => d.getDate()).join(', ')}`
    : `${span} · ${off.length} working days off`;
}

export function headline(md: MonthModel): string {
  const selling = md.visits.filter((v) => v.cases > 0);
  if (!md.visits.length) return 'No store visits recorded this month.';
  if (md.casesTotal <= 0) {
    return `No cases sold — ${plural(md.visits.length, 'visit')} across ${plural(md.stores.length, 'store')}.`;
  }
  const at = (v: PdfVisit) => `${esc(md.shownName(v.storeName))} (${int(v.cases)})`;
  if (selling.length && selling.length <= 2) {
    const days = new Set(selling.map((v) => ymd(new Date(v.check_in_time))));
    const on = days.size === 1 ? ` on ${dayLabel(new Date(selling[0].check_in_time))}` : '';
    const all = selling.reduce((s, v) => s + v.cases, 0) === md.casesTotal ? 'All ' : '';
    return `${all}${int(md.casesTotal)} cases came from ${plural(selling.length, 'visit')}${on}: ${selling.map(at).join(' and ')}.`;
  }
  const best = [...md.fieldDays].sort((a, b) => b.cases - a.cases)[0];
  const topStore = [...md.stores].sort((a, b) => b.cases - a.cases)[0];
  const sellDays = md.fieldDays.filter((d) => d.cases > 0).length;
  return `${int(md.casesTotal)} cases from ${plural(selling.length, 'selling visit')} on ${plural(sellDays, 'day')} · best day ${WD[best.date.getDay()]} ${dayLabel(best.date)} (${int(best.cases)}) · top store ${esc(topStore.name)} (${int(topStore.cases)}).`;
}

function casesCard(md: MonthModel): string {
  const selling = md.stores.filter((s) => s.cases > 0).sort((a, b) => b.cases - a.cases);
  const top = selling.slice(0, 4);
  const max = Math.max(1, ...top.map((s) => s.cases));
  const rows = top
    .map((s) => {
      const sub =
        s.sellingVisits.length === 1
          ? `${WD[new Date(s.sellingVisits[0].check_in_time).getDay()]} ${dayLabel(new Date(s.sellingVisits[0].check_in_time))} · ${hhmm(s.sellingVisits[0].check_in_time)}`
          : `${s.sellingVisits.length} selling visits`;
      return `<div class="cs-row"><div class="cs-name">${esc(s.name)}<div class="cs-sub">${sub}</div></div>
        <div class="cs-bar"><span style="width:${Math.max(3, (s.cases / max) * 100)}%"></span></div>
        <div class="cs-val">${int(s.cases)}</div></div>`;
    })
    .join('');
  const rest = selling.slice(4);
  const more = rest.length
    ? `<div class="more">+ ${plural(rest.length, 'more store')} · ${int(rest.reduce((s, r) => s + r.cases, 0))} cases</div>`
    : '';
  return `<div class="card"><div class="c-title">Where the ${int(md.casesTotal)} cases came from</div>
    <div class="c-sub">Cases sold by store${selling.length > 4 ? ` · top 4 of ${selling.length}` : ''}</div>
    ${rows || '<div class="empty">No cases sold in this period.</div>'}${more}</div>`;
}

function repeatCard(md: MonthModel): string {
  const rep = md.stores.filter((s) => s.visits > 1).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  const rows = rep
    .slice(0, 5)
    .map(
      (s) => `<div class="rp-row"><span>${esc(s.name)}</span><span class="dots" aria-label="${s.visits} visits">${
        s.visits <= 8 ? '●'.repeat(s.visits) : `●●●●●●●● ×${s.visits}`
      }</span></div>`,
    )
    .join('');
  const more = rep.length > 5 ? `<div class="more">+ ${plural(rep.length - 5, 'more store')} visited more than once</div>` : '';
  return `<div class="card"><div class="c-title">Repeat visits</div>
    <div class="c-sub">Stores visited more than once · ● = one visit</div>
    ${rows || '<div class="empty">Every store was visited once.</div>'}${more}</div>`;
}

export function standouts(md: MonthModel): string[] {
  const out: string[] = [];
  const rec = md.fieldDays.filter((d) => d.market === 'recorded' && d.marketMin);
  if (rec.length && md.market.min) {
    const longest = [...rec].sort((a, b) => (b.marketMin ?? 0) - (a.marketMin ?? 0))[0];
    out.push(
      `<b>Market days.</b> Avg ${hm(Math.round(md.market.min / rec.length))} tracked per day; the longest was ${hm(longest.marketMin)} on ${WD[longest.date.getDay()]} ${dayLabel(longest.date)}, with ${pct(longest.inStoreMin, longest.marketMin!)}% of it inside stores.`,
    );
    out.push(
      `<b>~${pct(md.inStoreOnMarketDays, md.market.min)}% of market time is spent inside stores</b> (${hm(md.inStoreOnMarketDays)} of ${hm(md.market.min)}); the rest is travel and time between stores.`,
    );
  }
  const done = md.visits.filter((v) => v.check_out_time && v.duration_minutes != null && !v.auto_closed);
  if (done.length) {
    const mins = done.map((v) => v.duration_minutes!).sort((a, b) => a - b);
    const short = mins.filter((x) => x <= 5).length;
    const median = mins[Math.floor((mins.length - 1) / 2)];
    out.push(
      short * 2 >= done.length
        ? `<b>Most visits are short.</b> ${short} of ${done.length} completed visits (${pct(short, done.length)}%) lasted 5 minutes or less; median visit ${median} min.`
        : `<b>Visit length.</b> Median completed visit ${median} min; ${short} of ${done.length} lasted 5 minutes or less.`,
    );
  }
  const gaps = md.fieldDays.filter((d) => d.market === 'missing');
  if (gaps.length) {
    out.push(
      `<b>Data gaps.</b> No punch-out on ${gaps.map((d) => dayLabel(d.date)).join(', ')} — market time and distance for ${gaps.length === 1 ? 'that day are' : 'those days are'} not recorded and left out of totals.`,
    );
  } else if (md.visits.length) {
    const sell = md.visits.filter((v) => v.cases > 0).length;
    const noSaleDays = md.fieldDays.filter((d) => d.visits.length && d.cases <= 0).length;
    out.push(
      sell
        ? `<b>${sell} of ${md.visits.length} visits sold</b> (${pct(sell, md.visits.length)}%); ${plural(noSaleDays, 'field day')} had no sales.`
        : `<b>No orders</b> were placed during ${plural(md.visits.length, 'visit')}.`,
    );
  }
  return out.slice(0, 4);
}

const LEGEND_MARKET = `<div class="legend">
  <span><i style="background:${C.inStore}"></i>Inside stores</span>
  <span><i style="background:${C.travel}"></i>Travel &amp; between stores</span>
  <span><i class="dash"></i>No punch-out (n/a)</span>
</div>
<div class="legend-note">Full bar = market time, punch-in to punch-out; number on top = hours. ~ = estimated by the 22:30 auto-close. No bar = no field day.</div>`;

const LEGEND_VISITS = `<div class="legend">
  <span><i style="background:${C.sales}"></i>Day with sales</span>
  <span><i style="background:${C.noSales}"></i>Day without sales</span>
</div>
<div class="legend-note">Number on top = store visits that day.</div>`;

function activity(md: MonthModel): string {
  const month = MON[md.monthIndex];
  const wide = md.range.length > 16;
  // Content width ~ 186 mm ≈ 700 px; a card's inner width is ~28 px less.
  const W = wide ? 672 : 318;
  const H = wide ? 120 : 170;
  const market = `<div class="card"><div class="c-title">Market time per day</div>${LEGEND_MARKET}${marketChartSVG(md.range, W, H, month)}</div>`;
  const visits = `<div class="card"><div class="c-title">Store visits per day</div>${LEGEND_VISITS}${visitsChartSVG(md.range, W, H, month)}</div>`;
  return wide ? `${market}${visits}` : `<div class="two">${market}${visits}</div>`;
}

function summaryPage(md: MonthModel, repName: string, generated: Date): string {
  const nVisits = md.visits.length;
  const nField = md.fieldDays.length;
  const selling = md.visits.filter((v) => v.cases > 0).length;
  const marketNote =
    md.market.min == null
      ? md.market.pending ? 'calculated at punch-out' : 'not recorded'
      : [
          `avg ${hm(Math.round(md.market.min / md.market.days))} per tracked day`,
          md.market.missing ? `${md.market.missing} not recorded` : '',
          md.market.estimated ? `${md.market.estimated} estimated` : '',
        ].filter(Boolean).join(' · ');
  const distSub =
    md.odoKm != null
      ? `Odometer ${int(Math.round(md.odoKm))} km${md.odoDays < md.routeDays ? ` (${plural(md.odoDays, 'day')})` : ''} · reads higher, see notes`
      : md.routeKm != null
      ? `${km(md.routeKm / Math.max(1, md.routeDays))} km per recorded day`
      : 'calculated at punch-out';
  const stands = standouts(md)
    .map((s) => `<li>${s}</li>`)
    .join('');
  return `
<section class="summary">
  <header class="hd">
    <div>
      <div class="kicker">TANKASSIST · MONTHLY FIELD REPORT</div>
      <h1>${esc(repName)}</h1>
      <div class="period">${md.title}${nField ? ` · field days ${fieldDaysSub(md).split(' · ')[0]}` : ''}</div>
    </div>
    <div class="meta">Generated ${dayLabel(generated)} ${generated.getFullYear()}<br/>All times device-local</div>
  </header>
  <div class="tiles">
    ${tile('Cases sold', int(md.casesTotal), md.casesTotal ? `from ${selling} of ${plural(nVisits, 'visit')}` : 'no orders this month', 'good')}
    ${tile('Store visits', String(nVisits), nField ? `${(nVisits / nField).toFixed(1)} per field day` : '—')}
    ${tile('Stores covered', String(md.stores.length), `unique · ${plural(nVisits - md.stores.length, 'repeat visit')}`)}
    ${tile('Market time', md.market.min == null ? '—' : hm(md.market.min).replace(/ (\d+m)$/, ' <small>$1</small>'), marketNote)}
    ${tile('Route (GPS)', md.routeKm == null ? '—' : `${km(md.routeKm)} <small>km</small>`, distSub)}
    ${tile('Field days', String(nField), fieldDaysSub(md))}
  </div>
  <div class="banner">▲ ${headline(md)}</div>
  <div class="section">DAILY ACTIVITY</div>
  ${activity(md)}
  <div class="two">${casesCard(md)}${repeatCard(md)}</div>
  ${stands ? `<div class="section">WHAT STANDS OUT</div><ul class="stands">${stands}</ul>` : ''}
</section>`;
}

// ── detail pages ───────────────────────────────────────────────────────────

const tag = (d: DayRow) => {
  if (d.market === 'pending') return '<span class="pill warn">Open</span>';
  if (d.market === 'missing') return '<span class="pill warn">No punch-out</span>';
  if (!d.hasAttendance && d.visits.length) return '<span class="pill warn">No punch-in</span>';
  if (d.estimated) return '<span class="pill">Auto-closed</span>';
  if (d.cases > 0) return '<span class="pill good">Sales</span>';
  return '';
};

interface Sub { visits: number; inStore: number; market: number | null; marketIn: number; route: number | null; odo: number | null; cases: number }

function subtotal(rows: DayRow[]): Sub {
  const add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
  return rows.reduce<Sub>(
    (s, r) => ({
      visits: s.visits + r.visits.length,
      inStore: s.inStore + r.inStoreMin,
      market: add(s.market, r.marketMin),
      marketIn: s.marketIn + (r.marketMin != null ? r.inStoreMin : 0),
      route: add(s.route, r.routeKm),
      odo: add(s.odo, r.odoKm),
      cases: s.cases + r.cases,
    }),
    { visits: 0, inStore: 0, market: null, marketIn: 0, route: null, odo: null, cases: 0 },
  );
}

const subCells = (s: Sub) => {
  const p = s.market != null ? pct(s.marketIn, s.market) : null;
  return `<td class="n">${s.visits}</td><td></td><td></td><td class="n">${hm(s.inStore)}</td><td class="n">${hm(s.market)}</td>
    <td class="n">${p == null ? '—' : `${p}%`}</td><td class="n">${km(s.route)}</td><td class="n">${s.odo == null ? '—' : int(Math.round(s.odo))}</td><td class="n">${s.cases ? int(s.cases) : '–'}</td><td></td>`;
};

function dayTable(md: MonthModel): string {
  const rows = md.fieldDays;
  // Mon–Sun weeks; subtotals only when the month spans more than one.
  const weeks: DayRow[][] = [];
  for (const r of rows) {
    const last = weeks[weeks.length - 1];
    if (!last || r.date.getDay() === 1 || r.date.getTime() - last[last.length - 1].date.getTime() > 6 * 86_400_000) weeks.push([r]);
    else last.push(r);
  }
  const showWeeks = weeks.length > 1;
  let body = '';
  weeks.forEach((w) => {
    for (const d of w) {
      const p = d.marketMin != null ? pct(d.inStoreMin, d.marketMin) : null;
      body += `<tr class="${d.cases > 0 ? 'sale' : ''}"><td>${dayLabel(d.date)}</td><td>${WD[d.date.getDay()]}</td><td class="n">${d.visits.length}</td>
        <td class="n">${d.firstIn ? hhmm(d.firstIn) : '—'}</td><td class="n">${d.lastOut ? hhmm(d.lastOut) : '—'}</td>
        <td class="n">${hm(d.inStoreMin)}</td><td class="n">${d.estimated ? '~' : ''}${hm(d.marketMin)}</td><td class="n">${p == null ? '—' : `${p}%`}</td>
        <td class="n">${km(d.routeKm)}</td><td class="n">${d.odoKm == null ? '—' : int(Math.round(d.odoKm))}</td>
        <td class="n">${d.cases ? int(d.cases) : '–'}</td><td>${tag(d)}</td></tr>`;
    }
    // A one-day week's subtotal would just repeat the row above it.
    if (showWeeks && w.length > 1) {
      const a = w[0].date, b = w[w.length - 1].date;
      body += `<tr class="week"><td colspan="2">Week · ${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]}</td>${subCells(subtotal(w))}</tr>`;
    }
  });
  body += `<tr class="total"><td colspan="2">${showWeeks ? 'Month total' : 'Total'}</td>${subCells(subtotal(rows))}</tr>`;
  return `<table class="days"><thead><tr><th>Date</th><th>Day</th><th class="n">Visits</th><th class="n">First in</th><th class="n">Last out</th>
    <th class="n">In stores</th><th class="n">Market time</th><th class="n">In-store %</th><th class="n">Route km</th><th class="n">Odo km</th><th class="n">Cases</th><th></th></tr></thead>
    <tbody>${rows.length ? body : '<tr><td colspan="12" class="empty">No field days this month.</td></tr>'}</tbody></table>`;
}

function notes(md: MonthModel): string {
  const n: string[] = [
    '<b>In stores</b> = sum of visit durations. <b>Market time</b> = punch-in to punch-out, tracked by the app. <b>In-store %</b> uses only days whose market time was recorded.',
    `<b>Route (GPS)</b> is the road distance (Google Directions) through punch-in → each store check-in, in visiting order → punch-out. <b>Odometer</b> is the vehicle's end reading minus its start reading. They measure different things and are never merged: the route only joins the points where the rep checked in, so riding between them — wrong turns, fuel, lunch, parking — is invisible to it. <b>The odometer normally reads higher</b>; a day is flagged for review only when it exceeds the route by more than ${Math.round(MISMATCH_PERCENT * 100)}% and ${MISMATCH_FLOOR_KM} km.`,
  ];
  for (const d of md.fieldDays) {
    const lastVisit = d.visits[d.visits.length - 1];
    if (d.market === 'missing') {
      n.push(`${dayLabel(d.date)}: no punch-out${lastVisit && !lastVisit.check_out_time ? ` (last check-in ${esc(md.shownName(lastVisit.storeName))}, ${hhmm(lastVisit.check_in_time)}, has no check-out)` : ''}, so market time and distance were not recorded and are excluded from totals and averages.`);
    } else if (d.market === 'pending') {
      n.push(`${dayLabel(d.date)}: the day is still open; its market time and distance are calculated at punch-out.`);
    } else if (d.estimated) {
      n.push(`${dayLabel(d.date)}: closed by the 22:30 auto-close, so market time runs to the last store and the distance is straight-line — estimates, not a measured punch-out.`);
    }
    if (!d.hasAttendance && d.visits.length) n.push(`${dayLabel(d.date)}: store visits with no punch-in for the day.`);
  }
  if (md.mergedNames.length) {
    const ex = md.mergedNames[0];
    n.push(
      `Store names grouped ignoring capitalisation and spacing (e.g. ${ex.variants.map((v) => `“${esc(v)}”`).join(' / ')} are one store), so Stores covered is ${md.stores.length}${md.storeIdsCount !== md.stores.length ? `; the app counts ${md.storeIdsCount}` : ''}.`,
    );
  }
  return `<div class="notes">${n.map((x) => `<p>${x}</p>`).join('')}</div>`;
}

function visitLog(md: MonthModel): string {
  let i = 0;
  let body = '';
  for (const d of md.fieldDays) {
    if (!d.visits.length) continue;
    const cases = d.visits.reduce((s, v) => s + v.cases, 0);
    body += `<tr class="dayhd"><td colspan="4">${WEEKDAY[d.date.getDay()]} ${dayLabel(d.date)}</td><td colspan="3" class="r">${plural(d.visits.length, 'visit')} · ${d.inStoreMin} min in stores${cases ? ` · ${int(cases)} cases` : ''}</td></tr>`;
    for (const v of d.visits) {
      i += 1;
      const mins = v.duration_minutes;
      const out = v.check_out_time ? hhmm(v.check_out_time) : '—';
      const why = !v.check_out_time ? 'no check-out' : v.auto_closed ? 'auto-closed' : '';
      const note = [v.notes?.trim(), why].filter(Boolean).join(' · ');
      body += `<tr class="${v.cases > 0 ? 'sale' : ''}"><td class="n">${i}</td><td>${esc(md.shownName(v.storeName))}</td><td class="n">${hhmm(v.check_in_time)} – ${out}</td>
        <td><span class="mbar" style="width:${mins ? Math.min(60, mins) : 0}px"></span>${mins ?? '—'}</td>
        <td class="n">${v.cases ? int(v.cases) : '–'}</td><td colspan="2" class="note">${esc(note)}</td></tr>`;
    }
  }
  if (!body) return '';
  return `<div class="section">VISIT LOG</div><table class="log"><colgroup><col style="width:5%"/><col style="width:31%"/><col style="width:15%"/><col style="width:17%"/><col style="width:8%"/><col span="2"/></colgroup><thead><tr><th class="n">#</th><th>Store</th><th class="n">In – out</th><th>Minutes</th><th class="n">Cases</th><th colspan="2">Note</th></tr></thead><tbody>${body}</tbody></table>`;
}

function repNotes(md: MonthModel): string {
  const rows = md.dayReports
    .filter((r) => r.notes?.trim() || r.challenges?.trim())
    .sort((a, b) => a.report_date.localeCompare(b.report_date))
    .map((r) => {
      const d = new Date(`${r.report_date}T00:00:00`);
      return `<p><b>${dayLabel(d)}</b> — ${r.notes?.trim() ? `Notes: ${esc(r.notes.trim())}` : ''}${r.notes?.trim() && r.challenges?.trim() ? ' · ' : ''}${r.challenges?.trim() ? `Challenges: ${esc(r.challenges.trim())}` : ''}</p>`;
    })
    .join('');
  return rows ? `<div class="section">REP’S DAILY NOTES</div><div class="notes">${rows}</div>` : '';
}

function detailPages(md: MonthModel, repName: string): string {
  return `
<section class="detail">
  <div class="dh"><h2>Day by day</h2><span>${esc(repName)} · ${md.title}</span></div>
  ${dayTable(md)}
  ${notes(md)}
  ${visitLog(md)}
  ${repNotes(md)}
</section>`;
}

// ── document ───────────────────────────────────────────────────────────────

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Inter, "Segoe UI", Roboto, system-ui, -apple-system, sans-serif; color: ${C.ink};
  -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; font-size: 10.5px; }
@page { size: A4; margin: 11mm 12mm 13mm; }
section.summary { page-break-after: always; display: flex; flex-direction: column; gap: 7px; }
section.detail { page-break-after: always; }
section.detail:last-child { page-break-after: auto; }
.hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.5px solid ${C.ink}; padding-bottom: 8px; }
.kicker { font-size: 9px; letter-spacing: 1.6px; color: ${C.muted}; font-weight: 600; }
h1 { font-size: 26px; font-weight: 750; letter-spacing: -.3px; margin-top: 2px; }
.period { font-size: 12px; color: ${C.sub}; margin-top: 1px; }
.meta { font-size: 9.5px; color: ${C.muted}; text-align: right; line-height: 1.5; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.tile { background: #f4f6f9; border-radius: 8px; padding: 8px 12px; }
.tile.good { background: ${C.salesTint}; }
.tile.good .t-value { color: ${C.sales}; }
.t-label { font-size: 8.5px; letter-spacing: 1px; text-transform: uppercase; color: ${C.muted}; font-weight: 650; }
.t-value { font-size: 25px; font-weight: 750; margin-top: 2px; letter-spacing: -.3px; }
.t-value small { font-size: 15px; font-weight: 650; }
.t-sub { font-size: 9.5px; color: ${C.sub}; margin-top: 1px; }
.banner { background: ${C.accent}; border-left: 3px solid ${C.noSales}; border-radius: 6px; padding: 8px 12px; font-size: 11.5px; font-weight: 650; }
.section { font-size: 9px; letter-spacing: 1.6px; color: ${C.muted}; font-weight: 650; margin-top: 3px; }
.two { display: flex; gap: 9px; }
.two > .card { flex: 1; min-width: 0; }
.card { border: 1px solid ${C.border}; border-radius: 9px; padding: 8px 12px; break-inside: avoid; }
.c-title { font-size: 11.5px; font-weight: 700; }
.c-sub { font-size: 9px; color: ${C.muted}; margin: 1px 0 5px; }
.legend { display: flex; flex-wrap: wrap; gap: 3px 12px; margin: 4px 0 1px; font-size: 9.5px; color: ${C.ink}; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.legend i.dash { border: 1px dashed ${C.muted}; background: none; }
.legend-note { font-size: 9px; color: ${C.muted}; margin-bottom: 2px; }
.cs-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px solid ${C.grid}; }
.cs-name { width: 38%; font-weight: 600; font-size: 10.5px; }
.cs-sub { font-size: 8.5px; color: ${C.muted}; font-weight: 400; }
.cs-bar { flex: 1; height: 7px; background: #eef1f5; border-radius: 4px; overflow: hidden; }
.cs-bar span { display: block; height: 100%; background: ${C.sales}; border-radius: 4px; }
.cs-val { width: 44px; text-align: right; font-weight: 750; font-size: 12px; color: ${C.sales}; }
.rp-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid ${C.grid}; font-size: 10.5px; }
.dots { color: ${C.noSales}; letter-spacing: 1px; font-size: 9px; }
.more { font-size: 9px; color: ${C.muted}; margin-top: 4px; }
.empty { font-size: 10px; color: ${C.muted}; padding: 8px 0; }
ul.stands { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; }
ul.stands li { font-size: 10.5px; line-height: 1.45; padding-left: 12px; position: relative; color: ${C.sub}; }
ul.stands li::before { content: ''; position: absolute; left: 0; top: 5px; width: 6px; height: 6px; border-radius: 3px; background: ${C.noSales}; }
ul.stands b { color: ${C.ink}; }
.dh { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1.5px solid ${C.ink}; padding-bottom: 5px; margin-bottom: 4px; }
.dh h2 { font-size: 17px; font-weight: 750; }
.dh span { font-size: 9.5px; color: ${C.muted}; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { font-size: 8px; text-transform: uppercase; letter-spacing: .6px; color: ${C.muted}; text-align: left; font-weight: 650; padding: 5px 4px; border-bottom: 1px solid ${C.border}; }
td { font-size: 9.5px; padding: 4px 4px; border-bottom: 1px solid ${C.grid}; color: ${C.ink}; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
tr.sale td { background: ${C.salesTint}; color: #14532d; }
tr.week td { background: #f1f4f8; font-weight: 700; }
tr.total td { background: ${C.ink}; color: #fff; font-weight: 750; }
.pill { display: inline-block; font-size: 8px; padding: 1px 6px; border-radius: 8px; border: 1px solid ${C.axis}; color: ${C.sub}; background: #fff; white-space: nowrap; }
.pill.good { border-color: ${C.sales}; color: ${C.sales}; }
.pill.warn { border-color: #d6a400; background: #fff6d6; color: #6b4e00; }
.notes { margin: 6px 0 4px; }
.notes p { font-size: 9px; color: ${C.sub}; line-height: 1.45; margin-bottom: 2px; }
.notes b { color: ${C.ink}; }
table.log { margin-top: 4px; table-layout: fixed; }
tr.dayhd { break-after: avoid; }
tr.dayhd td { background: #13294b; color: #fff; font-weight: 700; font-size: 9.5px; padding: 5px 6px; }
tr.dayhd td.r { text-align: right; font-weight: 500; }
.mbar { display: inline-block; height: 8px; background: #c7dcf8; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.note { color: ${C.sub}; max-width: 190px; }
.detail .section { margin: 10px 0 2px; }
svg { display: block; }
svg text { font-family: inherit; }
`;

/** The whole document: per month, a summary page then its detail pages. */
export function reportHtml(repName: string, months: MonthModel[], generated: Date): string {
  const period = months.length === 1 ? months[0].title : `${months[0].title} – ${months[months.length - 1].title}`;
  // @page margin boxes: Chromium 131+ (current Android System WebView) prints
  // the footer; an older WebView simply omits it.
  const box = `font-family: Inter, "Segoe UI", Roboto, system-ui, sans-serif; font-size: 8px; color: ${C.faint};`;
  const footer = `@page { @bottom-left { content: "${esc(repName).replace(/"/g, '')} · Field report · ${period}"; ${box} }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} } }`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(repName)} — Field report</title>
<style>${CSS}${footer}</style></head><body>${months
    .map((m) => summaryPage(m, repName, generated) + detailPages(m, repName))
    .join('')}</body></html>`;
}
