'use strict';
/**
 * TankAssist report-format PROTOTYPE (dev-only, runs on this machine — never ships in the app).
 *
 * Reads data.json (snapshot of live Supabase data for one rep, Jun 1 – Jul 13 2026) and produces:
 *   - report.html                                        (the PDF's source, kept for inspection)
 *   - charts/*.html + charts/*.png                       (chart pages → PNGs for the XLSX)
 *   - "Varadddd Kulkarni Report - June-July 2026.pdf"    (headless Edge, HTML → PDF)
 *   - "Varadddd Kulkarni Report - June-July 2026.xlsx"   (exceljs; charts embedded as PNG images —
 *      no maintained free Node lib writes native xlsx charts)
 *
 * Rendering: headless Microsoft Edge (already on Windows) — same Chromium HTML+inline-SVG
 * technique expo-print would use on-device if this ever becomes a real feature.
 * Run: node generate.js   (after `npm install` in this folder)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');

const DIR = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'data.json'), 'utf8'));

// ---------- time helpers (all display in IST) ----------
const IST = 'Asia/Kolkata';
const istYmd = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(iso)); // YYYY-MM-DD
const istTime = (iso) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const istWeekday = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: IST, weekday: 'short' }).format(new Date(iso));
const dayOf = (iso) => Number(istYmd(iso).slice(8));
const ddmmyyyy = (ymd) => ymd.split('-').reverse().join('-');
const hmm = (min) => (min == null ? '—' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

// ---------- design tokens (shadcn-style slate chrome + validated series hues) ----------
const C = {
  ink: '#0f172a', sub: '#475569', muted: '#64748b', faint: '#94a3b8',
  border: '#e2e8f0', grid: '#eef2f5', axis: '#cbd5e1', surface: '#ffffff',
  s1: '#2a78d6', s2: '#1baf7a', s3: '#eda100',
};
// Color follows the entity (fixed across both months), never the per-month rank.
const STORE_COLORS = { 'Deccan brews cafe': C.s1, 'Suraj wines': C.s2, 'Abhijit wines': C.s3 };

const MONTHS = [
  { key: '2026-06', name: 'June 2026', days: 30, lastDataDay: 30, partial: false },
  { key: '2026-07', name: 'July 2026', days: 31, lastDataDay: 13, partial: true },
];

// ---------- aggregates ----------
function monthData(m) {
  const att = data.attendance.filter((a) => istYmd(a.check_in_time).startsWith(m.key));
  const visits = data.visits.filter((v) => istYmd(v.check_in_time).startsWith(m.key));
  const reports = data.dailyReports.filter((r) => r.report_date.startsWith(m.key));

  const casesByDay = Array(m.days).fill(0);
  const minutesByDay = Array(m.days).fill(null); // null = no completed attendance that day
  for (const v of visits) casesByDay[dayOf(v.check_in_time) - 1] += v.cases_sold || 0;
  for (const a of att) {
    if (a.total_market_time_minutes != null) {
      const d = dayOf(a.check_in_time) - 1;
      minutesByDay[d] = (minutesByDay[d] || 0) + a.total_market_time_minutes;
    }
  }
  const byStore = {};
  for (const v of visits) {
    byStore[v.store_name] = byStore[v.store_name] || { visits: 0, cases: 0 };
    byStore[v.store_name].visits += 1;
    byStore[v.store_name].cases += v.cases_sold || 0;
  }
  return {
    ...m, att, visits, reports, casesByDay, minutesByDay, byStore,
    marketMin: att.reduce((s, a) => s + (a.total_market_time_minutes || 0), 0),
    distanceKm: att.reduce((s, a) => s + (a.total_distance_km || 0), 0),
    cases: visits.reduce((s, v) => s + (v.cases_sold || 0), 0),
    daysPresent: new Set(att.map((a) => istYmd(a.check_in_time))).size,
    storesCovered: Object.keys(byStore).length,
  };
}
const months = MONTHS.map(monthData);

// ---------- tiny SVG chart builders ----------
function ticksFor(maxVal, steps) {
  const step = steps.find((s) => Math.ceil(Math.max(maxVal, 1) / s) <= 4) || steps[steps.length - 1];
  const top = step * Math.max(1, Math.ceil(Math.max(maxVal, 1) / step));
  const t = [];
  for (let v = 0; v <= top; v += step) t.push(v);
  return { top, ticks: t };
}
const roundedTopBar = (x, y, w, h) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`;
};

function axisAndGrid({ W, H, L, R, T, B, ticks, top, xLabels }) {
  const plotW = W - L - R, plotH = H - T - B;
  const y = (v) => T + plotH - (v / top) * plotH;
  let s = '';
  for (const t of ticks) {
    if (t > 0) s += `<line x1="${L}" y1="${y(t)}" x2="${W - R}" y2="${y(t)}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${L - 6}" y="${y(t) + 3}" text-anchor="end" font-size="9" fill="${C.faint}">${t}</text>`;
  }
  s += `<line x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${T + plotH}" stroke="${C.axis}" stroke-width="1"/>`;
  for (const { frac, label } of xLabels)
    s += `<text x="${L + frac * plotW}" y="${H - 6}" text-anchor="middle" font-size="9" fill="${C.faint}">${label}</text>`;
  return { s, y, plotW, plotH };
}
const dayXLabels = (days) => {
  let marks = [1, 5, 10, 15, 20, 25, 30].filter((d) => d <= days);
  if (!marks.includes(days)) {
    marks = marks.filter((d) => days - d >= 3); // drop a mark that would collide with the final-day label
    marks.push(days);
  }
  return marks.map((d) => ({ frac: (d - 0.5) / days, label: String(d) }));
};

function barChartSVG({ W, H, values, tickSteps, emptyText, color = C.s1, xLabels }) {
  const L = 30, R = 6, T = 14, B = 18;
  const { top, ticks } = ticksFor(Math.max(...values), tickSteps);
  const g = axisAndGrid({ W, H, L, R, T, B, ticks, top, xLabels: xLabels || dayXLabels(values.length) });
  let bars = '';
  const band = g.plotW / values.length;
  const bw = Math.min(24, band * 0.68);
  values.forEach((v, i) => {
    if (v <= 0) return;
    const x = L + i * band + (band - bw) / 2;
    const h = (v / top) * g.plotH;
    bars += `<path d="${roundedTopBar(x, T + g.plotH - h, bw, h)}" fill="${color}"/>`;
    bars += `<text x="${x + bw / 2}" y="${T + g.plotH - h - 4}" text-anchor="middle" font-size="9.5" fill="${C.sub}">${v}</text>`;
  });
  const empty = values.every((v) => v <= 0)
    ? `<text x="${L + g.plotW / 2}" y="${T + g.plotH / 2}" text-anchor="middle" font-size="11" fill="${C.faint}">${emptyText}</text>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${g.s}${bars}${empty}</svg>`;
}

function areaChartSVG({ W, H, values, tickSteps, unit }) {
  const L = 34, R = 6, T = 14, B = 18;
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null);
  const { top, ticks } = ticksFor(Math.max(0, ...pts.map((p) => p.v)), tickSteps);
  const g = axisAndGrid({ W, H, L, R, T, B, ticks, top, xLabels: dayXLabels(values.length) });
  const band = g.plotW / values.length;
  const X = (i) => L + i * band + band / 2;
  const Y = (v) => T + g.plotH - (v / top) * g.plotH;
  let s = '';
  if (pts.length >= 2) {
    const line = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i)},${Y(p.v)}`).join(' ');
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

function donutSVG({ size, slices, centerLabel, centerSub }) {
  const cx = size / 2, cy = size / 2, rO = size / 2 - 4, rI = rO - Math.max(16, size * 0.16);
  const total = slices.reduce((s, x) => s + x.value, 0);
  let body = '';
  if (slices.length === 1) {
    body = `<circle cx="${cx}" cy="${cy}" r="${rO}" fill="${slices[0].color}"/><circle cx="${cx}" cy="${cy}" r="${rI}" fill="${C.surface}"/>`;
  } else {
    let a = -Math.PI / 2;
    for (const sl of slices) {
      const a2 = a + (sl.value / total) * Math.PI * 2;
      const P = (r, ang) => `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
      const large = a2 - a > Math.PI ? 1 : 0;
      body += `<path d="M${P(rO, a)} A${rO},${rO} 0 ${large} 1 ${P(rO, a2)} L${P(rI, a2)} A${rI},${rI} 0 ${large} 0 ${P(rI, a)} Z" fill="${sl.color}" stroke="${C.surface}" stroke-width="2"/>`;
      a = a2;
    }
  }
  body += `<text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="${size * 0.2}" font-weight="600" fill="${C.ink}">${centerLabel}</text>`;
  body += `<text x="${cx}" y="${cy + size * 0.11}" text-anchor="middle" font-size="9.5" fill="${C.muted}">${centerSub}</text>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

const donutSlices = (byStore) =>
  Object.entries(byStore)
    .sort((a, b) => b[1].visits - a[1].visits)
    .map(([name, s]) => ({ label: name, value: s.visits, color: STORE_COLORS[name] || C.s3 }));

const legendHTML = (slices) => {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return slices
    .map(
      (s) => `<div class="lg"><span class="sw" style="background:${s.color}"></span>
        <span class="lg-name">${esc(s.label)}</span>
        <span class="lg-val">${s.value} visit${s.value === 1 ? '' : 's'} · ${Math.round((s.value / total) * 100)}%</span></div>`
    )
    .join('');
};

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- PDF page HTML ----------
const CASE_STEPS = [1, 2, 5, 10, 20, 50, 100];
const MIN_STEPS = [15, 30, 60, 120, 240, 480];

function statTile(label, value, sub) {
  return `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-sub">${sub}</div></div>`;
}

function monthPage(m, pageNo) {
  const slices = donutSlices(m.byStore);
  const visitRows = m.visits
    .map(
      (v) => `<tr>
      <td>${ddmmyyyy(istYmd(v.check_in_time))}</td>
      <td>${esc(v.store_name)}</td>
      <td>${istTime(v.check_in_time)}</td>
      <td>${v.check_out_time ? istTime(v.check_out_time) : '—'}</td>
      <td class="num">${v.duration_minutes ?? '—'} min</td>
      <td class="num">${v.cases_sold ?? 0}</td>
      <td class="note">${esc(v.notes || '—')}</td></tr>`
    )
    .join('');
  const reportRows = m.reports
    .map(
      (r) => `<div class="rep-note"><b>${ddmmyyyy(r.report_date)}</b> — Notes: ${esc(r.notes || '—')} · Challenges: ${esc(r.challenges || '—')}</div>`
    )
    .join('');
  return `
<section class="page">
  <header class="hd">
    <div>
      <div class="kicker">TANKASSIST · MONTHLY FIELD REPORT</div>
      <h1>${m.name}${m.partial ? ' <span class="partial">(partial — data through 13 July)</span>' : ''}</h1>
      <div class="who">${esc(data.rep.name)} · Field Sales Rep</div>
    </div>
    <div class="meta">Generated 13 Jul 2026<br/>All times IST</div>
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

  <footer class="ft">Format prototype — data snapshot 13 Jul 2026 · Page ${pageNo} of ${months.length}</footer>
</section>`;
}

const REPORT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif; color: ${C.ink};
       -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
@page { size: A4; margin: 0; }
.page { width: 210mm; height: 296mm; padding: 11mm 12mm; page-break-after: always; overflow: hidden;
        display: flex; flex-direction: column; gap: 10px; }
.page:last-of-type { page-break-after: auto; }
.hd { display: flex; justify-content: space-between; align-items: flex-start; }
.kicker { font-size: 10px; letter-spacing: 1.5px; color: ${C.muted}; font-weight: 600; }
h1 { font-size: 24px; font-weight: 700; margin-top: 2px; }
.partial { font-size: 12px; font-weight: 500; color: ${C.muted}; }
.who { font-size: 12px; color: ${C.sub}; margin-top: 2px; }
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

// ---------- standalone chart pages for the XLSX PNGs ----------
function chartPage(titleText, subText, inner, w) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}
  body { padding: 14px 18px; width: ${w}px; }
  </style></head><body>
  <div class="c-title" style="font-size:15px">${titleText}</div>
  <div class="c-sub" style="margin-bottom:10px">${subText}</div>
  ${inner}</body></html>`;
}

// ---------- render helpers (headless Edge) ----------
function browserExe() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const exe = candidates.find((p) => fs.existsSync(p));
  assert(exe, 'No Edge/Chrome found for headless rendering');
  return exe;
}
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
function render(args) {
  const profile = path.join(os.tmpdir(), 'tankassist-report-render');
  execFileSync(browserExe(), ['--headless', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, ...args], {
    stdio: 'ignore',
    timeout: 60000,
  });
}

// ---------- XLSX ----------
const OLIVE = 'FF6D7431', CREAM = 'FFF6F4EA', WHITE = 'FFFFFFFF';
function styleHeaderRow(ws, cols) {
  const row = ws.getRow(1);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OLIVE } };
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.alignment = { vertical: 'middle' };
  }
  row.height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}
function bandRows(ws, cols) {
  for (let r = 2; r <= ws.rowCount; r++) {
    if (r % 2 === 0) continue;
    for (let c = 1; c <= cols; c++)
      ws.getRow(r).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } };
  }
}
const utcDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

async function buildXlsx(pngs, outPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TankAssist (format prototype)';

  // --- Summary ---
  const s = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  s.columns = [{ width: 22 }, { width: 14 }, { width: 4 }, { width: 22 }, { width: 14 }, { width: 10 }];
  s.mergeCells('A1:F1');
  s.getCell('A1').value = 'TankAssist — Field Report';
  s.getCell('A1').font = { bold: true, size: 16 };
  s.getCell('A2').value = `Rep: ${data.rep.name}`;
  s.getCell('A3').value = 'Period: 1 June – 13 July 2026 (July partial) · All times IST';
  s.getCell('A4').value = 'Generated: 13 July 2026 · Format prototype built from live data';
  for (const r of [2, 3, 4]) s.getCell(`A${r}`).font = { color: { argb: 'FF64748B' }, size: 10 };

  const block = (col, m) => {
    const hdr = s.getCell(6, col);
    s.mergeCells(6, col, 6, col + 1);
    hdr.value = m.name.toUpperCase() + (m.partial ? ' (THROUGH 13 JUL)' : '');
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OLIVE } };
    hdr.font = { bold: true, color: { argb: WHITE } };
    const rows = [
      ['Days present', m.daysPresent],
      ['Market time (min)', m.marketMin],
      ['Distance (km)', Number(m.distanceKm.toFixed(2))],
      ['Store visits (completed)', m.visits.length],
      ['Stores covered (distinct)', m.storesCovered],
      ['Cases sold', m.cases],
    ];
    rows.forEach(([label, val], i) => {
      s.getCell(7 + i, col).value = label;
      s.getCell(7 + i, col).font = { color: { argb: 'FF475569' }, size: 10.5 };
      const vc = s.getCell(7 + i, col + 1);
      vc.value = val;
      vc.font = { bold: true, size: 10.5 };
      if (label.startsWith('Distance')) vc.numFmt = '0.00';
    });
  };
  block(1, months[0]);
  block(4, months[1]);

  s.getCell('A14').value =
    'Note: the app view monthly_ta_summary reports "stores_visited" as completed visits, not distinct stores — both are shown above.';
  s.getCell('A14').font = { italic: true, size: 9, color: { argb: 'FF94A3B8' } };

  let rowCursor = 16;
  for (const png of pngs) {
    const id = wb.addImage({ filename: png.file, extension: 'png' });
    s.addImage(id, { tl: { col: 0, row: rowCursor }, ext: { width: png.w, height: png.h } });
    rowCursor += Math.ceil(png.h / 15) + 2;
  }

  // --- Daily Summary ---
  const d = wb.addWorksheet('Daily Summary');
  d.columns = [
    { header: 'Date', width: 12 }, { header: 'Day', width: 6 },
    { header: 'Punch In', width: 10 }, { header: 'Punch Out', width: 10 },
    { header: 'Market Time (min)', width: 17 }, { header: 'Distance (km)', width: 14 },
    { header: 'Store Visits', width: 12 }, { header: 'Cases Sold', width: 11 },
  ];
  for (const m of months) {
    for (let day = 1; day <= m.lastDataDay; day++) {
      const ymd = `${m.key}-${String(day).padStart(2, '0')}`;
      const att = m.att.filter((a) => istYmd(a.check_in_time) === ymd);
      const visits = m.visits.filter((v) => istYmd(v.check_in_time) === ymd);
      const row = d.addRow([
        utcDate(ymd),
        istWeekday(`${ymd}T12:00:00Z`),
        att.length ? istTime(att[0].check_in_time) : '',
        att.length && att[0].check_out_time ? istTime(att[0].check_out_time) : '',
        att.length ? att[0].total_market_time_minutes ?? '' : '',
        att.length && att[0].total_distance_km != null ? att[0].total_distance_km : '',
        att.length || visits.length ? visits.length : '',
        att.length || visits.length ? visits.reduce((x, v) => x + (v.cases_sold || 0), 0) : '',
      ]);
      row.getCell(1).numFmt = 'dd-mm-yyyy';
      row.getCell(6).numFmt = '0.00';
    }
  }
  styleHeaderRow(d, 8);
  bandRows(d, 8);

  // --- Visit Detail ---
  const v = wb.addWorksheet('Visit Detail');
  v.columns = [
    { header: 'Date', width: 12 }, { header: 'Store', width: 20 },
    { header: 'Check In', width: 10 }, { header: 'Check Out', width: 10 },
    { header: 'Duration (min)', width: 14 }, { header: 'Cases Sold', width: 11 },
    { header: 'Dist. from Store (m)', width: 18 }, { header: 'Notes', width: 30 },
  ];
  for (const visit of data.visits) {
    const row = v.addRow([
      utcDate(istYmd(visit.check_in_time)),
      visit.store_name,
      istTime(visit.check_in_time),
      visit.check_out_time ? istTime(visit.check_out_time) : '',
      visit.duration_minutes ?? '',
      visit.cases_sold ?? 0,
      visit.distance_from_store_meters ?? '',
      visit.notes || '',
    ]);
    row.getCell(1).numFmt = 'dd-mm-yyyy';
  }
  styleHeaderRow(v, 8);
  bandRows(v, 8);

  // --- Store Frequency ---
  const f = wb.addWorksheet('Store Frequency');
  f.columns = [
    { header: 'Store', width: 22 }, { header: 'Visits', width: 8 },
    { header: 'Cases Sold', width: 11 }, { header: 'First Visit', width: 12 }, { header: 'Last Visit', width: 12 },
  ];
  const freq = {};
  for (const visit of data.visits) {
    const e = (freq[visit.store_name] = freq[visit.store_name] || { visits: 0, cases: 0, first: visit.check_in_time, last: visit.check_in_time });
    e.visits += 1;
    e.cases += visit.cases_sold || 0;
    if (visit.check_in_time < e.first) e.first = visit.check_in_time;
    if (visit.check_in_time > e.last) e.last = visit.check_in_time;
  }
  for (const [name, e] of Object.entries(freq).sort((a, b) => b[1].visits - a[1].visits)) {
    const row = f.addRow([name, e.visits, e.cases, utcDate(istYmd(e.first)), utcDate(istYmd(e.last))]);
    row.getCell(4).numFmt = 'dd-mm-yyyy';
    row.getCell(5).numFmt = 'dd-mm-yyyy';
  }
  styleHeaderRow(f, 5);
  bandRows(f, 5);

  await wb.xlsx.writeFile(outPath);
}

// ---------- main ----------
async function main() {
  // sanity checks on the aggregates (fails loudly if the data wiring breaks)
  assert.strictEqual(months[0].cases, 2, 'June cases');
  assert.strictEqual(months[1].cases, 0, 'July cases');
  assert.strictEqual(months[0].storesCovered, 1, 'June distinct stores');
  assert.strictEqual(months[1].storesCovered, 2, 'July distinct stores');
  assert.strictEqual(data.visits.length, 4, 'total visits');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.rep.name)} — Field Report</title>
<style>${REPORT_CSS}</style></head><body>${months.map((m, i) => monthPage(m, i + 1)).join('')}</body></html>`;
  const htmlPath = path.join(DIR, 'report.html');
  fs.writeFileSync(htmlPath, html);

  const pdfPath = path.join(DIR, 'Varadddd Kulkarni Report - June-July 2026.pdf');
  render([`--print-to-pdf=${pdfPath}`, '--no-pdf-header-footer', fileUrl(htmlPath)]);

  // chart PNGs for the XLSX (native xlsx charts aren't writable by any maintained free Node lib)
  const chartsDir = path.join(DIR, 'charts');
  fs.mkdirSync(chartsDir, { recursive: true });
  const allDays = [...months[0].casesByDay, ...months[1].casesByDay.slice(0, months[1].lastDataDay)];
  const rangeLabels = [
    { frac: 0.5 / allDays.length, label: '1 Jun' },
    { frac: 14.5 / allDays.length, label: '15 Jun' },
    { frac: 30.5 / allDays.length, label: '1 Jul' },
    { frac: 42.5 / allDays.length, label: '13 Jul' },
  ];
  const overallSlices = donutSlices(
    data.visits.reduce((acc, v) => {
      (acc[v.store_name] = acc[v.store_name] || { visits: 0 }).visits += 1;
      return acc;
    }, {})
  );
  const charts = [
    {
      name: 'bar', w: 720, h: 300,
      html: chartPage('Cases sold per day', '1 June – 13 July 2026',
        barChartSVG({ W: 680, H: 210, values: allDays, tickSteps: CASE_STEPS, emptyText: 'No cases sold', xLabels: rangeLabels }), 720),
    },
    {
      name: 'donut', w: 480, h: 240,
      html: chartPage('Visit distribution by store', 'All completed visits, 1 June – 13 July 2026',
        `<div class="donut-row">${donutSVG({ size: 140, slices: overallSlices, centerLabel: String(data.visits.length), centerSub: 'visits' })}<div class="legend">${legendHTML(overallSlices)}</div></div>`, 480),
    },
  ];
  const pngs = [];
  for (const ch of charts) {
    const hp = path.join(chartsDir, `${ch.name}.html`);
    const pp = path.join(chartsDir, `${ch.name}.png`);
    fs.writeFileSync(hp, ch.html);
    render([`--screenshot=${pp}`, `--window-size=${ch.w},${ch.h}`, '--force-device-scale-factor=2', '--hide-scrollbars', fileUrl(hp)]);
    pngs.push({ file: pp, w: ch.w, h: ch.h });
  }

  const xlsxPath = path.join(DIR, 'Varadddd Kulkarni Report - June-July 2026.xlsx');
  await buildXlsx(pngs, xlsxPath);

  for (const p of [pdfPath, xlsxPath, ...pngs.map((x) => x.file)])
    assert(fs.existsSync(p) && fs.statSync(p).size > 1000, `output missing or empty: ${p}`);
  console.log('OK\n' + pdfPath + '\n' + xlsxPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
