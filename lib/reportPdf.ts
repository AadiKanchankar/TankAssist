import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { casesSold, ORDERS_CUTOVER_DATE } from './reportSemantics';
import {
  toDateStr,
  monthStart,
  nextMonthStart,
  monthName,
  addDays,
} from './reportExport';

/**
 * In-app formatted PDF export (per rep), via expo-print (WebView → PDF).
 *
 * Ported from the approved `sample-reports/generate.js` prototype: header
 * block, four stat tiles, cases-per-day bar + market-time area + visits-by-store
 * donut (all inline SVG — WebView renders SVG natively), a visit table and daily
 * notes. ONE month per page, identical layout regardless of month count.
 *
 * All "Cases Sold" figures use the Phase-7 cutover semantics (orders on/after
 * cutover, legacy visit cases_sold before) — never a second implementation.
 *
 * WebView-renderer note (vs the headless-Chromium prototype): fixed A4 page
 * HEIGHT + overflow:hidden was relaxed to `min-height` so a data-heavy month
 * (many visits) flows to a second sheet instead of clipping rows; each month
 * still starts on a fresh page via `page-break-after`. Fonts fall back to the
 * device system font (Inter isn't bundled). No other CSS needed adjusting.
 */

// ── design tokens (approved slate chrome + validated series hues) ──
const C = {
  ink: '#0f172a', sub: '#475569', muted: '#64748b', faint: '#94a3b8',
  border: '#e2e8f0', grid: '#eef2f5', axis: '#cbd5e1', surface: '#ffffff',
  s1: '#2a78d6', s2: '#1baf7a', s3: '#eda100',
};
// Store colour follows visit-rank order (stable within a report).
const STORE_PALETTE = [C.s1, C.s2, C.s3, '#8b5cf6', '#e5484d', '#0891b2'];

const CASE_STEPS = [1, 2, 5, 10, 20, 50, 100];
const MIN_STEPS = [15, 30, 60, 120, 240, 480];

const esc = (s: any) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const hmm = (min: number | null) =>
  min == null ? '—' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
const istTime = (iso: string) =>
  `${String(new Date(iso).getHours()).padStart(2, '0')}:${String(
    new Date(iso).getMinutes()
  ).padStart(2, '0')}`;
const ddmmyyyy = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(
    d.getMonth() + 1
  ).padStart(2, '0')}-${d.getFullYear()}`;
};

// ── data shape ──
interface VisitRowP {
  date: string;
  store: string;
  in: string;
  out: string | null;
  duration: number | null;
  cases: number;
  notes: string | null;
}
interface MonthData {
  name: string;
  days: number;
  partial: boolean;
  lastDataDay: number;
  marketMin: number;
  distanceKm: number;
  cases: number;
  daysPresent: number;
  storesCovered: number;
  casesByDay: number[];
  minutesByDay: (number | null)[];
  byStore: Record<string, { visits: number; cases: number }>;
  visits: VisitRowP[];
  reports: { report_date: string; notes: string | null; challenges: string | null }[];
}

async function monthData(repId: string, monthDate: Date): Promise<MonthData> {
  const start = monthStart(monthDate);
  const end = nextMonthStart(monthDate);
  const startStr = toDateStr(start);
  const endStr = toDateStr(end);
  const daysN = addDays(end, -1).getDate();
  const now = new Date();
  const isCurrent =
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth();

  const [attRes, visitsRes, reportsRes, ordersRes, cases] = await Promise.all([
    supabase
      .from('attendance')
      .select('check_in_time, total_market_time_minutes, total_distance_km')
      .eq('user_id', repId)
      .gte('check_in_time', `${startStr}T00:00:00`)
      .lt('check_in_time', `${endStr}T00:00:00`),
    supabase
      .from('store_visits')
      .select(
        'id, store_id, check_in_time, check_out_time, duration_minutes, cases_sold, notes, stores(name)'
      )
      .eq('user_id', repId)
      .gte('check_in_time', `${startStr}T00:00:00`)
      .lt('check_in_time', `${endStr}T00:00:00`)
      .order('check_in_time', { ascending: true }),
    supabase
      .from('daily_reports')
      .select('report_date, notes, challenges')
      .eq('user_id', repId)
      .gte('report_date', startStr)
      .lt('report_date', endStr)
      .order('report_date', { ascending: true }),
    supabase
      .from('orders')
      .select('visit_id, order_items(cases)')
      .eq('placed_by', repId)
      .neq('status', 'cancelled')
      .gte('created_at', `${startStr}T00:00:00`)
      .lt('created_at', `${endStr}T00:00:00`),
    casesSold(startStr, endStr, { userId: repId }),
  ]);

  const att = (attRes.data as any[]) || [];
  const visits = (visitsRes.data as any[]) || [];
  const reports = (reportsRes.data as any[]) || [];
  const orders = (ordersRes.data as any[]) || [];

  const casesByDay = Array(daysN).fill(0) as number[];
  for (const [ymd, n] of Object.entries(cases.byDay)) {
    const day = Number(ymd.slice(8, 10));
    if (day >= 1 && day <= daysN) casesByDay[day - 1] = n;
  }

  const minutesByDay = Array(daysN).fill(null) as (number | null)[];
  for (const a of att) {
    if (a.total_market_time_minutes != null) {
      const d = new Date(a.check_in_time).getDate();
      minutesByDay[d - 1] = (minutesByDay[d - 1] || 0) + a.total_market_time_minutes;
    }
  }

  // Per-visit cases (cutover hybrid): legacy visit cases before cutover, else
  // the cases of orders linked to that visit.
  const ordersByVisit: Record<string, number> = {};
  for (const o of orders) {
    if (!o.visit_id) continue;
    const c = (o.order_items || []).reduce(
      (s: number, it: any) => s + (it.cases || 0),
      0
    );
    ordersByVisit[o.visit_id] = (ordersByVisit[o.visit_id] || 0) + c;
  }

  const byStore: Record<string, { visits: number; cases: number }> = {};
  const visitRows: VisitRowP[] = visits.map((v) => {
    const day = toDateStr(new Date(v.check_in_time));
    const vc =
      day < ORDERS_CUTOVER_DATE ? v.cases_sold || 0 : ordersByVisit[v.id] || 0;
    const name = v.stores?.name || 'Store';
    if (!byStore[name]) byStore[name] = { visits: 0, cases: 0 };
    byStore[name].visits += 1;
    byStore[name].cases += vc;
    return {
      date: v.check_in_time,
      store: name,
      in: v.check_in_time,
      out: v.check_out_time,
      duration: v.duration_minutes,
      cases: vc,
      notes: v.notes,
    };
  });

  return {
    name: monthName(start),
    days: daysN,
    partial: isCurrent,
    lastDataDay: isCurrent ? now.getDate() : daysN,
    marketMin: att.reduce((s, a) => s + (a.total_market_time_minutes || 0), 0),
    distanceKm: att.reduce((s, a) => s + (a.total_distance_km || 0), 0),
    cases: cases.total,
    daysPresent: new Set(att.map((a) => toDateStr(new Date(a.check_in_time)))).size,
    storesCovered: new Set(visits.map((v) => v.store_id)).size,
    casesByDay,
    minutesByDay,
    byStore,
    visits: visitRows,
    reports,
  };
}

// ── SVG chart builders (ported verbatim from the prototype) ──
function ticksFor(maxVal: number, steps: number[]) {
  const step =
    steps.find((s) => Math.ceil(Math.max(maxVal, 1) / s) <= 4) ||
    steps[steps.length - 1];
  const top = step * Math.max(1, Math.ceil(Math.max(maxVal, 1) / step));
  const t: number[] = [];
  for (let v = 0; v <= top; v += step) t.push(v);
  return { top, ticks: t };
}
const roundedTopBar = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`;
};
function axisAndGrid(o: any) {
  const { W, H, L, R, T, B, ticks, top, xLabels } = o;
  const plotW = W - L - R,
    plotH = H - T - B;
  const y = (v: number) => T + plotH - (v / top) * plotH;
  let s = '';
  for (const t of ticks) {
    if (t > 0)
      s += `<line x1="${L}" y1="${y(t)}" x2="${W - R}" y2="${y(t)}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${L - 6}" y="${y(t) + 3}" text-anchor="end" font-size="9" fill="${C.faint}">${t}</text>`;
  }
  s += `<line x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${T + plotH}" stroke="${C.axis}" stroke-width="1"/>`;
  for (const { frac, label } of xLabels)
    s += `<text x="${L + frac * plotW}" y="${H - 6}" text-anchor="middle" font-size="9" fill="${C.faint}">${label}</text>`;
  return { s, y, plotW, plotH };
}
const dayXLabels = (days: number) => {
  let marks = [1, 5, 10, 15, 20, 25, 30].filter((d) => d <= days);
  if (!marks.includes(days)) {
    marks = marks.filter((d) => days - d >= 3);
    marks.push(days);
  }
  return marks.map((d) => ({ frac: (d - 0.5) / days, label: String(d) }));
};
function barChartSVG(o: any) {
  const { W, H, values, tickSteps, emptyText, color = C.s1, xLabels } = o;
  const L = 30, R = 6, T = 14, B = 18;
  const { top, ticks } = ticksFor(Math.max(...values), tickSteps);
  const g = axisAndGrid({
    W, H, L, R, T, B, ticks, top,
    xLabels: xLabels || dayXLabels(values.length),
  });
  let bars = '';
  const band = g.plotW / values.length;
  const bw = Math.min(24, band * 0.68);
  values.forEach((v: number, i: number) => {
    if (v <= 0) return;
    const x = L + i * band + (band - bw) / 2;
    const h = (v / top) * g.plotH;
    bars += `<path d="${roundedTopBar(x, T + g.plotH - h, bw, h)}" fill="${color}"/>`;
    bars += `<text x="${x + bw / 2}" y="${T + g.plotH - h - 4}" text-anchor="middle" font-size="9.5" fill="${C.sub}">${v}</text>`;
  });
  const empty = values.every((v: number) => v <= 0)
    ? `<text x="${L + g.plotW / 2}" y="${T + g.plotH / 2}" text-anchor="middle" font-size="11" fill="${C.faint}">${emptyText}</text>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${g.s}${bars}${empty}</svg>`;
}
function areaChartSVG(o: any) {
  const { W, H, values, tickSteps, unit } = o;
  const L = 34, R = 6, T = 14, B = 18;
  const pts = values
    .map((v: number | null, i: number) => ({ v, i }))
    .filter((p: any) => p.v != null);
  const { top, ticks } = ticksFor(Math.max(0, ...pts.map((p: any) => p.v)), tickSteps);
  const g = axisAndGrid({ W, H, L, R, T, B, ticks, top, xLabels: dayXLabels(values.length) });
  const band = g.plotW / values.length;
  const X = (i: number) => L + i * band + band / 2;
  const Y = (v: number) => T + g.plotH - (v / top) * g.plotH;
  let s = '';
  if (pts.length >= 2) {
    const line = pts.map((p: any, k: number) => `${k ? 'L' : 'M'}${X(p.i)},${Y(p.v)}`).join(' ');
    s += `<path d="${line} L${X(pts[pts.length - 1].i)},${T + g.plotH} L${X(pts[0].i)},${T + g.plotH} Z" fill="${C.s1}" opacity="0.1"/>`;
    s += `<path d="${line}" fill="none" stroke="${C.s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  for (const p of pts) {
    s += `<circle cx="${X(p.i)}" cy="${Y(p.v)}" r="4.5" fill="${C.s1}" stroke="${C.surface}" stroke-width="2"/>`;
    s += `<text x="${X(p.i)}" y="${Y(p.v) - 8}" text-anchor="middle" font-size="9.5" fill="${C.sub}">${p.v}${unit}</text>`;
  }
  if (!pts.length)
    s += `<text x="${L + g.plotW / 2}" y="${T + g.plotH / 2}" text-anchor="middle" font-size="11" fill="${C.faint}">No completed market days</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${g.s}${s}</svg>`;
}
function donutSVG(o: any) {
  const { size, slices, centerLabel, centerSub } = o;
  const cx = size / 2, cy = size / 2, rO = size / 2 - 4, rI = rO - Math.max(16, size * 0.16);
  const total = slices.reduce((s: number, x: any) => s + x.value, 0);
  let body = '';
  if (slices.length === 1) {
    body = `<circle cx="${cx}" cy="${cy}" r="${rO}" fill="${slices[0].color}"/><circle cx="${cx}" cy="${cy}" r="${rI}" fill="${C.surface}"/>`;
  } else {
    let a = -Math.PI / 2;
    for (const sl of slices) {
      const a2 = a + (sl.value / total) * Math.PI * 2;
      const P = (r: number, ang: number) => `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
      const large = a2 - a > Math.PI ? 1 : 0;
      body += `<path d="M${P(rO, a)} A${rO},${rO} 0 ${large} 1 ${P(rO, a2)} L${P(rI, a2)} A${rI},${rI} 0 ${large} 0 ${P(rI, a)} Z" fill="${sl.color}" stroke="${C.surface}" stroke-width="2"/>`;
      a = a2;
    }
  }
  body += `<text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="${size * 0.2}" font-weight="600" fill="${C.ink}">${centerLabel}</text>`;
  body += `<text x="${cx}" y="${cy + size * 0.11}" text-anchor="middle" font-size="9.5" fill="${C.muted}">${centerSub}</text>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
const donutSlices = (byStore: Record<string, { visits: number; cases: number }>) =>
  Object.entries(byStore)
    .sort((a, b) => b[1].visits - a[1].visits)
    .map(([name, s], i) => ({
      label: name,
      value: s.visits,
      color: STORE_PALETTE[i % STORE_PALETTE.length],
    }));
const legendHTML = (slices: any[]) => {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return slices
    .map(
      (s) => `<div class="lg"><span class="sw" style="background:${s.color}"></span>
        <span class="lg-name">${esc(s.label)}</span>
        <span class="lg-val">${s.value} visit${s.value === 1 ? '' : 's'} · ${Math.round((s.value / total) * 100)}%</span></div>`
    )
    .join('');
};
const statTile = (label: string, value: string, sub: string) =>
  `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-sub">${sub}</div></div>`;

function monthPage(m: MonthData, pageNo: number, totalPages: number): string {
  const slices = donutSlices(m.byStore);
  const visitRows = m.visits
    .map(
      (v) => `<tr>
      <td>${ddmmyyyy(v.date)}</td>
      <td>${esc(v.store)}</td>
      <td>${istTime(v.in)}</td>
      <td>${v.out ? istTime(v.out) : '—'}</td>
      <td class="num">${v.duration ?? '—'} min</td>
      <td class="num">${v.cases ?? 0}</td>
      <td class="note">${esc(v.notes || '—')}</td></tr>`
    )
    .join('');
  const reportRows = m.reports
    .map(
      (r) => `<div class="rep-note"><b>${ddmmyyyy(r.report_date + 'T00:00:00')}</b> — Notes: ${esc(r.notes || '—')} · Challenges: ${esc(r.challenges || '—')}</div>`
    )
    .join('');
  return `
<section class="page">
  <header class="hd">
    <div>
      <div class="kicker">TANKASSIST · MONTHLY FIELD REPORT</div>
      <h1>${m.name}${m.partial ? ` <span class="partial">(partial — through day ${m.lastDataDay})</span>` : ''}</h1>
    </div>
    <div class="meta">Generated ${ddmmyyyy(new Date().toISOString())}<br/>All times device-local</div>
  </header>

  <div class="tiles">
    ${statTile('Market time', hmm(m.marketMin), `across ${m.daysPresent} day${m.daysPresent === 1 ? '' : 's'} present`)}
    ${statTile('Distance', `${m.distanceKm.toFixed(2)} km`, 'road-network daily totals')}
    ${statTile('Cases sold', String(m.cases), `${m.visits.length} store visit${m.visits.length === 1 ? '' : 's'}`)}
    ${statTile('Stores covered', String(m.storesCovered), 'distinct stores visited')}
  </div>

  <div class="card">
    <div class="c-title">Cases sold per day</div>
    ${barChartSVG({ W: 660, H: 150, values: m.casesByDay, tickSteps: CASE_STEPS, emptyText: 'No cases sold this month' })}
  </div>

  <div class="row">
    <div class="card grow">
      <div class="c-title">Market time per day <span class="c-sub">minutes</span></div>
      ${areaChartSVG({ W: 380, H: 160, values: m.minutesByDay, tickSteps: MIN_STEPS, unit: 'm' })}
    </div>
    <div class="card">
      <div class="c-title">Visits by store</div>
      ${
        slices.length
          ? `<div class="donut-row">${donutSVG({ size: 130, slices, centerLabel: String(m.visits.length), centerSub: 'visits' })}<div class="legend">${legendHTML(slices)}</div></div>`
          : `<div class="empty">No store visits</div>`
      }
    </div>
  </div>

  <div class="card">
    <div class="c-title">Visit detail</div>
    <table>
      <thead><tr><th>Date</th><th>Store</th><th>In</th><th>Out</th><th class="num">Duration</th><th class="num">Cases</th><th>Note</th></tr></thead>
      <tbody>${visitRows || `<tr><td colspan="7" class="empty">No visits recorded</td></tr>`}</tbody>
    </table>
  </div>

  ${reportRows ? `<div class="card"><div class="c-title">Daily report notes</div>${reportRows}</div>` : ''}

  <footer class="ft">TankAssist field report · Page ${pageNo} of ${totalPages}</footer>
</section>`;
}

const REPORT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif; color: ${C.ink};
       -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
@page { size: A4; margin: 0; }
.page { width: 210mm; min-height: 296mm; padding: 11mm 12mm; page-break-after: always;
        display: flex; flex-direction: column; gap: 10px; }
.page:last-of-type { page-break-after: auto; }
.hd { display: flex; justify-content: space-between; align-items: flex-start; }
.kicker { font-size: 10px; letter-spacing: 1.5px; color: ${C.muted}; font-weight: 600; }
h1 { font-size: 24px; font-weight: 700; margin-top: 2px; }
.partial { font-size: 12px; font-weight: 500; color: ${C.muted}; }
.meta { font-size: 10.5px; color: ${C.muted}; text-align: right; line-height: 1.5; }
.tiles { display: flex; gap: 10px; }
.tile { flex: 1; background: #fff; border: 1px solid ${C.border}; border-radius: 10px; padding: 12px 14px;
        box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.t-label { font-size: 10px; letter-spacing: .8px; text-transform: uppercase; color: ${C.muted}; font-weight: 600; }
.t-value { font-size: 24px; font-weight: 650; margin-top: 4px; }
.t-sub { font-size: 10.5px; color: ${C.muted}; margin-top: 2px; }
.card { background: #fff; border: 1px solid ${C.border}; border-radius: 10px; padding: 12px 14px;
        box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.c-title { font-size: 12.5px; font-weight: 600; margin-bottom: 8px; }
.c-sub { font-size: 10.5px; font-weight: 400; color: ${C.muted}; }
.row { display: flex; gap: 10px; }
.row .grow { flex: 1.35; }
.row .card:last-child { flex: 1; }
.donut-row { display: flex; align-items: center; gap: 14px; }
.legend { display: flex; flex-direction: column; gap: 8px; }
.lg { display: flex; align-items: center; gap: 7px; font-size: 11px; }
.sw { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.lg-name { font-weight: 600; color: ${C.ink}; }
.lg-val { color: ${C.muted}; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 9.5px; text-transform: uppercase; letter-spacing: .7px; color: ${C.muted}; text-align: left;
     padding: 4px 8px 6px 0; border-bottom: 1px solid ${C.border}; }
td { font-size: 11px; padding: 6px 8px 6px 0; border-bottom: 1px solid ${C.grid}; color: ${C.sub}; }
td:first-child, td:nth-child(2) { color: ${C.ink}; }
.num { text-align: right; padding-right: 16px; }
th.num { text-align: right; }
.note { max-width: 150px; }
.rep-note { font-size: 11px; color: ${C.sub}; padding: 3px 0; }
.empty { font-size: 11px; color: ${C.faint}; padding: 10px 0; }
.ft { margin-top: auto; font-size: 9.5px; color: ${C.faint}; text-align: center; }
svg text { font-family: inherit; }
`;

function pdfFileName(repName: string, months: Date[]): string {
  const clean =
    repName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Rep';
  if (months.length <= 1) return `${clean} Report - ${monthName(months[0])}.pdf`;
  const sorted = [...months].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0], last = sorted[sorted.length - 1];
  const fm = first.toLocaleDateString('en-US', { month: 'long' });
  const lm = last.toLocaleDateString('en-US', { month: 'long' });
  const range =
    first.getFullYear() === last.getFullYear()
      ? `${fm}–${lm} ${last.getFullYear()}`
      : `${fm} ${first.getFullYear()}–${lm} ${last.getFullYear()}`;
  return `${clean} Report - ${range}.pdf`;
}

/**
 * Build + share the formatted PDF for one rep across the given months (one page
 * each). Throws on failure — caller shows the alert.
 */
export async function exportRepPdf(
  repId: string,
  repName: string,
  months: Date[]
): Promise<void> {
  const datas = await Promise.all(months.map((m) => monthData(repId, m)));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(
    repName
  )} — Field Report</title><style>${REPORT_CSS}</style></head><body>${datas
    .map((m, i) => monthPage(m, i + 1, datas.length))
    .join('')}</body></html>`;

  const { uri } = await Print.printToFileAsync({ html });

  // printToFileAsync names the file with a random id; copy to a nicely-named
  // file so the share sheet offers the correct filename.
  const fileName = pdfFileName(repName, months);
  const dest = `${FileSystem.cacheDirectory}${fileName}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: dest });
  } catch {
    // If the copy fails, fall back to sharing the original temp file.
    if (!(await Sharing.isAvailableAsync()))
      throw new Error('Sharing is not available on this device.');
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    return;
  }

  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(dest, {
    mimeType: 'application/pdf',
    dialogTitle: fileName.replace(/\.pdf$/, ''),
  });
}
