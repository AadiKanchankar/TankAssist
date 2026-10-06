// TZ=Asia/Kolkata npx tsx lib/reportPdfHtml.test.ts
// PREVIEW_DIR=/some/dir also writes full.html + partial.html for headless Chrome:
//   google-chrome --headless --no-pdf-header-footer --print-to-pdf=full.pdf full.html
import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMonth, reportHtml, standouts, type PdfDay, type PdfVisit } from './reportPdfHtml';

// Seeded so the preview is stable run to run.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const STORES = ['Gopi colony', 'Magpai', 'Sector 19', 'SECTOR 19', 'Firewater L1', 'NHPC Chowk', 'Sector 12', 'Sarai fatak', 'Kubota', 'BPTP', 'Sector 21 B', 'Pyali chowk', 'Dabua mandi', 'Charmwood Village', 'Sector 15', 'Bata more', 'Ashoka enclave', 'Surajkund'];

function month(fromDay: number, toDay: number) {
  const days: PdfDay[] = [];
  const visits: PdfVisit[] = [];
  const casesByDay: Record<string, number> = {};
  let id = 0;
  for (let d = fromDay; d <= toDay; d++) {
    const date = new Date(2026, 8, d);
    if (date.getDay() === 0 || d === 22) continue; // Sundays + one day off
    const start = new Date(2026, 8, d, 10, 30 + Math.floor(rnd() * 90));
    const n = d === 19 ? 1 : 6 + Math.floor(rnd() * 8);
    let t = start.getTime() + 20 * 60_000;
    let sold = 0;
    for (let i = 0; i < n; i++) {
      const dur = Math.floor(rnd() * (rnd() < 0.6 ? 5 : 40));
      const cin = new Date(t);
      const lastOpen = d === 9 && i === n - 1; // 09 Sep: never checked out
      const cases = rnd() < 0.08 ? [10, 25, 40, 50, 250][Math.floor(rnd() * 5)] : 0;
      visits.push({
        id: `v${++id}`,
        store_id: `s${STORES.indexOf(STORES[Math.floor(rnd() * STORES.length)])}`,
        storeName: STORES[Math.floor(rnd() * STORES.length)],
        check_in_time: cin.toISOString(),
        check_out_time: lastOpen ? null : new Date(t + dur * 60_000).toISOString(),
        duration_minutes: lastOpen ? null : dur,
        auto_closed: false,
        notes: i === 0 && d === 21 ? 'A grade shop' : null,
        cases,
      });
      sold += cases;
      t += (dur + 15 + Math.floor(rnd() * 40)) * 60_000;
    }
    if (sold) casesByDay[`2026-09-${String(d).padStart(2, '0')}`] = sold;
    const market = Math.round((t - start.getTime()) / 60_000);
    const missing = d === 9;
    const auto = d === 16;
    days.push({
      check_in_time: start.toISOString(),
      check_out_time: missing ? new Date(2026, 8, d, 22, 30).toISOString() : new Date(t).toISOString(),
      auto_closed: auto,
      total_market_time_minutes: missing ? null : market,
      total_distance_km: missing ? null : (25 + rnd() * 30).toFixed(2),
      odo_start: missing || auto ? null : 25000 + d * 80,
      odo_end: missing || auto ? null : 25000 + d * 80 + 50 + Math.floor(rnd() * 40),
    });
  }
  // Make sure the name-merge path is exercised.
  visits[1].storeName = 'Sector 19';
  visits[2].storeName = 'SECTOR 19';
  const casesTotal = Object.values(casesByDay).reduce((s, n) => s + n, 0);
  return buildMonth({
    month: new Date(2026, 8, 1),
    days,
    visits,
    dayReports: [{ report_date: '2026-09-21', notes: 'Good response in Sector 19', challenges: null }],
    casesByDay,
    casesTotal,
    now: new Date(2026, 9, 1),
  });
}

const full = month(1, 30);
const partial = month(19, 30);

// Not recorded is never 0: 09 Sep has visits but no market time.
const d9 = full.fieldDays.find((r) => r.date.getDate() === 9)!;
assert.equal(d9.market, 'missing');
assert.equal(d9.marketMin, null);
assert.equal(d9.routeKm, null);
assert.equal(full.market.missing, 1);
assert.equal(full.market.days, full.fieldDays.length - 1);
assert.ok(full.fieldDays.find((r) => r.date.getDate() === 16)!.estimated);

// Totals = sum of recorded days only.
const recordedMin = full.fieldDays.reduce((s, r) => s + (r.marketMin ?? 0), 0);
assert.equal(full.market.min, recordedMin);

// "Sector 19" / "SECTOR 19" are one store, and the note says so.
assert.equal(full.stores.filter((s) => s.name.toLowerCase() === 'sector 19').length, 1);
assert.equal(full.stores.find((s) => s.name.toLowerCase() === 'sector 19')!.name, 'Sector 19');
assert.ok(full.mergedNames.length >= 1);

// Range: full month runs 1–30; the partial one starts at the first field day.
assert.equal(full.range.length, 30);
assert.equal(partial.range[0].date.getDate(), 19);

const generated = new Date(2026, 9, 1, 9, 0);
const html = reportHtml('Bhagwan Singh', [full], generated);
const html2 = reportHtml('Bhagwan Singh', [partial], generated);

// Every colour on the charts is explained in a visible legend, with axis titles.
for (const h of [html, html2]) {
  for (const s of ['Inside stores', 'Travel &amp; between stores', 'No punch-out (n/a)', 'Day with sales', 'Day without sales', '>Hours<', '>Visits<', 'Day of Sep']) {
    assert.ok(h.includes(s), `legend/axis missing: ${s}`);
  }
  assert.ok(h.includes('Route (GPS)') && h.includes('Odometer'), 'both distances labelled');
  assert.ok(h.includes('normally reads higher'), 'distance gap explained');
  // Odometer is its own main box on page 1, ahead of the route.
  assert.ok(h.includes('tile main') && h.indexOf('Odometer · travel allowance') < h.indexOf('>Route (GPS)<'), 'odometer main tile first');
}
// A field day without readings says so — never 0, never a bare dash.
assert.ok(html.includes('<span class="nr">not recorded</span>'), 'missing odometer reads "not recorded"');
assert.ok(/<span class="rd">25,\d{3}→25,\d{3}<\/span>/.test(html), 'start→end readings shown per day');
// Long month stacks charts full width; short range sits side by side.
assert.ok(html.includes('width="672"') && !html2.includes('width="672"'));
// Weekly subtotals for the long month only.
assert.ok(html.includes('Week · 1–5 Sep') && html.includes('Month total'));
assert.ok(!html2.includes('Week · 19–19'), 'no one-day week subtotal');
// No raw "0h 00m" market time for the missing day.
assert.ok(html.includes('No punch-out'));
assert.ok(standouts(full).some((s) => s.includes('Data gaps')));

// Auto-closed days: the note says exactly what the sweep produced (code review 2026-10-01).
{
  const at = (d: number, h: number) => new Date(2026, 8, d, h).toISOString();
  const v = (d: number, h: number): PdfVisit => ({ id: `x${d}${h}`, store_id: 's', storeName: 'Magpai', check_in_time: at(d, h),
    check_out_time: at(d, h + 1), duration_minutes: 60, auto_closed: false, notes: null, cases: 0 });
  const day = (d: number, h: number, auto: boolean, market: number | null, km: string | null): PdfDay => ({
    check_in_time: at(d, h), check_out_time: at(d, 22), auto_closed: auto, total_market_time_minutes: market,
    total_distance_km: km, odo_start: null, odo_end: null });
  const m = buildMonth({
    month: new Date(2026, 8, 1),
    days: [
      day(1, 10, true, 200, null),                              // visits, no distance
      day(2, 10, true, 0, '0'),                                 // case 3: no store
      day(3, 9, true, 300, '10'), day(3, 14, false, 120, '20'), // two punch-ins, one swept
    ],
    visits: [v(1, 11), v(3, 10)],
    dayReports: [], casesByDay: {}, casesTotal: 0, now: new Date(2026, 9, 1),
  });
  const h = reportHtml('T', [m], new Date(2026, 9, 1));
  const [d1, d2, d3] = m.fieldDays;
  assert.ok(d1.estimated && !d1.estimatedRoute && d1.routeKm == null);
  assert.ok(h.includes('01 Sep: closed by the 22:30 auto-close. Market time runs to the last store visited') && h.includes('and no distance was recorded.'));
  assert.ok(d2.autoClosed && !d2.estimated && !d2.estimatedRoute, 'case 3 is measured zeros, not an estimate');
  assert.ok(h.includes('02 Sep: closed by the 22:30 auto-close with no store visited'));
  assert.ok(!h.includes('02 Sep: closed by the 22:30 auto-close. Market time'));
  assert.ok(d3.estimatedRoute && d3.routeKm === 30);
  assert.ok(h.includes('03 Sep: one of its 2 punch-ins was closed') && h.includes('(the punched-out part is road distance)'));
  assert.ok(h.includes('>~30.0<'), 'estimated route km carries ~');
  assert.ok(h.includes('add a straight-line distance instead'));
}

// A recorded 0-minute day counts in the average (ultrareview 2026-10-02).
{
  const at = (d: number, h: number) => new Date(2026, 8, d, h).toISOString();
  const m = buildMonth({
    month: new Date(2026, 8, 1),
    days: [
      { check_in_time: at(1, 10), check_out_time: at(1, 22), auto_closed: true, total_market_time_minutes: 0, total_distance_km: '0', odo_start: null, odo_end: null },
      { check_in_time: at(2, 10), check_out_time: at(2, 17), auto_closed: false, total_market_time_minutes: 400, total_distance_km: '20', odo_start: null, odo_end: null },
    ],
    visits: [{ id: 'a', store_id: 's', storeName: 'S', check_in_time: at(2, 11), check_out_time: at(2, 12), duration_minutes: 60, auto_closed: false, notes: null, cases: 0 }],
    dayReports: [], casesByDay: {}, casesTotal: 0, now: new Date(2026, 9, 1),
  });
  assert.ok(standouts(m)[0].includes('Avg 3h 20m'), standouts(m)[0]);
  const h = reportHtml('A & "B" </style>', [m], new Date(2026, 9, 1));
  assert.ok(h.includes('content: "A & B /style · Field report'), 'footer name is CSS-safe, not HTML-escaped');
}

if (process.env.PREVIEW_DIR) {
  writeFileSync(join(process.env.PREVIEW_DIR, 'full.html'), html);
  writeFileSync(join(process.env.PREVIEW_DIR, 'partial.html'), html2);
}
console.log('reportPdfHtml: ok');
