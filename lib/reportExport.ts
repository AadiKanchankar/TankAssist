import { supabase } from './supabase';
import { getSignedUrls } from './storage';
import { casesSold, ORDERS_CUTOVER_DATE } from './reportSemantics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * Monthly detail CSV export (manager-facing, per rep).
 *
 * One file, three sections (Daily Summary / Visit Detail / Store Frequency)
 * plus a header block. Photo + selfie links are signed for 90 days —
 * deliberately longer than the 1-hour in-app default, so the CSV stays
 * usable as an offline audit artifact. Links are bearer URLs: anyone
 * holding the file can open them until expiry.
 */

const NINETY_DAYS_SECONDS = 7776000; // 90 * 24 * 3600

// ---------------------------------------------------------------------------
// Date helpers (all local device time — IST in the field)
// ---------------------------------------------------------------------------

/** YYYY-MM-DD from local date parts (NOT toISOString, which shifts to UTC). */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** DD-MM-YYYY for display and CSV cells. */
export function fmtDDMMYYYY(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${m}-${d.getFullYear()}`;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function nextMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** 'YYYY-MM' — matches monthly_ta_summary.month_label. */
export function monthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 'July 2026' */
export function monthName(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Minutes → 'Xh Ym' ('' for null). */
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

/**
 * Kilometres to exactly 2 decimals — rounds away floating-point noise
 * (e.g. 4.999999999 → "5.00"). '' for null.
 */
export function fmtKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return '';
  return (Math.round(km * 100) / 100).toFixed(2);
}

/** ISO timestamp → local 'HH:MM' ('' for null). */
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// CSV primitives
// ---------------------------------------------------------------------------

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

/** Blank line + rule + title + rule, as a clear visual section divider. */
function pushSection(lines: string[], title: string): void {
  const rule = '='.repeat(50);
  lines.push('');
  lines.push(csvRow([rule]));
  lines.push(csvRow([title]));
  lines.push(csvRow([rule]));
}

// ---------------------------------------------------------------------------
// Row shapes (only the columns we select)
// ---------------------------------------------------------------------------

interface AttendanceRow {
  check_in_time: string | null;
  check_out_time: string | null;
  total_market_time_minutes: number | null;
  total_distance_km: number | null;
  selfie_url: string | null;
}

interface VisitRow {
  id: string;
  store_id: string | null;
  check_in_time: string;
  check_out_time: string | null;
  duration_minutes: number | null;
  cases_sold: number | null;
  notes: string | null;
  photo_url: string | null;
  stores: { name: string } | null;
}

interface DailyReportRow {
  report_date: string; // YYYY-MM-DD
  notes: string | null;
  challenges: string | null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Builds and shares the monthly detail CSV for one rep. The month is the
 * calendar month containing `anyDateInMonth`. Throws on failure — caller
 * shows the alert.
 */
export async function exportMonthlyReport(
  repId: string,
  repName: string,
  anyDateInMonth: Date
): Promise<void> {
  const start = monthStart(anyDateInMonth);
  const end = nextMonthStart(anyDateInMonth);
  const startStr = toDateStr(start);
  const endStr = toDateStr(end);

  // ---- Fetch everything for the month (parallel; all manager-read RLS) ----
  const [attRes, visitsRes, reportsRes, summaryRes] = await Promise.all([
    supabase
      .from('attendance')
      .select(
        'check_in_time, check_out_time, total_market_time_minutes, total_distance_km, selfie_url'
      )
      .eq('user_id', repId)
      .gte('check_in_time', `${startStr}T00:00:00`)
      .lt('check_in_time', `${endStr}T00:00:00`)
      .order('check_in_time', { ascending: true }),
    supabase
      .from('store_visits')
      .select(
        'id, store_id, check_in_time, check_out_time, duration_minutes, cases_sold, notes, photo_url, stores(name)'
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
      .lt('report_date', endStr),
    supabase
      .from('monthly_ta_summary')
      .select('*')
      .eq('user_id', repId)
      .eq('month_label', monthLabel(start))
      .maybeSingle(),
  ]);

  if (attRes.error) throw attRes.error;
  if (visitsRes.error) throw visitsRes.error;
  if (reportsRes.error) throw reportsRes.error;
  // summary view row is optional — missing month just means zeros

  const attendance = (attRes.data || []) as AttendanceRow[];
  const visits = (visitsRes.data || []) as unknown as VisitRow[];
  const dailyReports = (reportsRes.data || []) as DailyReportRow[];
  const summary = summaryRes.data as {
    days_present: number;
    total_market_time_minutes: number;
    total_distance_km: number;
    stores_visited: number;
    total_cases_sold: number;
  } | null;

  // ---- Photos for all visits, grouped ----
  const visitIds = visits.map((v) => v.id);
  const photosByVisit: Record<string, string[]> = {};
  if (visitIds.length > 0) {
    const { data: photoRows, error: photoErr } = await supabase
      .from('store_visit_photos')
      .select('visit_id, storage_path, position')
      .in('visit_id', visitIds)
      .order('position', { ascending: true });
    if (photoErr) throw photoErr;
    for (const row of (photoRows as any[]) || []) {
      if (!photosByVisit[row.visit_id]) photosByVisit[row.visit_id] = [];
      photosByVisit[row.visit_id].push(row.storage_path);
    }
  }

  // Legacy fallback: visits with no photo rows but an old single photo_url.
  for (const v of visits) {
    if (!photosByVisit[v.id] && v.photo_url) {
      photosByVisit[v.id] = [v.photo_url];
    }
  }

  // ---- Sign all storage paths in one batch (90-day expiry) ----
  const allPaths = new Set<string>();
  for (const a of attendance) if (a.selfie_url) allPaths.add(a.selfie_url);
  for (const paths of Object.values(photosByVisit))
    for (const p of paths) allPaths.add(p);
  const signedByPath = await getSignedUrls(
    Array.from(allPaths),
    NINETY_DAYS_SECONDS
  );

  // ---- Bucket rows by local calendar day ----
  const attByDay: Record<string, AttendanceRow[]> = {};
  for (const a of attendance) {
    if (!a.check_in_time) continue;
    const key = toDateStr(new Date(a.check_in_time));
    (attByDay[key] = attByDay[key] || []).push(a);
  }
  const visitsByDay: Record<string, VisitRow[]> = {};
  for (const v of visits) {
    const key = toDateStr(new Date(v.check_in_time));
    (visitsByDay[key] = visitsByDay[key] || []).push(v);
  }
  const reportByDate: Record<string, DailyReportRow> = {};
  for (const r of dailyReports) reportByDate[r.report_date] = r;

  // Cases Sold uses the cutover semantics (orders on/after cutover, legacy
  // visit cases_sold before) — per day (Daily Summary), per store (Store
  // Frequency), and header total — all from the one hybrid.
  const cases = await casesSold(startStr, endStr, { userId: repId });
  const casesByDay = cases.byDay;
  const totalCasesSold = cases.total;

  // Per-visit cases (cutover hybrid) for the Visit Detail section: legacy visit
  // cases before the cutover, else the cases of orders linked to that visit.
  const { data: orderRows } = await supabase
    .from('orders')
    .select('visit_id, order_items(cases)')
    .eq('placed_by', repId)
    .neq('status', 'cancelled')
    .gte('created_at', `${startStr}T00:00:00`)
    .lt('created_at', `${endStr}T00:00:00`);
  const ordersByVisit: Record<string, number> = {};
  for (const o of (orderRows as any[]) || []) {
    if (!o.visit_id) continue;
    const c = (o.order_items || []).reduce(
      (s: number, it: any) => s + (it.cases || 0),
      0
    );
    ordersByVisit[o.visit_id] = (ordersByVisit[o.visit_id] || 0) + c;
  }
  const visitCases = (v: VisitRow): number =>
    toDateStr(new Date(v.check_in_time)) < ORDERS_CUTOVER_DATE
      ? v.cases_sold || 0
      : ordersByVisit[v.id] || 0;

  // ---- Header block ----
  const uniqueStores = new Set(
    visits.map((v) => v.store_id).filter((s): s is string => !!s)
  );
  const now = new Date();
  const lines: string[] = [];
  lines.push(csvRow(['TankAssist — Monthly Detail Report']));
  lines.push(csvRow(['Rep', repName]));
  lines.push(csvRow(['Month', monthName(start)]));
  lines.push(
    csvRow(['Generated', `${fmtDDMMYYYY(now)} ${fmtTime(now.toISOString())}`])
  );
  lines.push(csvRow(['Total Working Days', summary?.days_present ?? 0]));
  lines.push(
    csvRow([
      'Total Market Time',
      fmtMinutes(summary?.total_market_time_minutes ?? 0),
    ])
  );
  lines.push(
    csvRow(['Total Distance (km)', fmtKm(summary?.total_distance_km ?? 0)])
  );
  lines.push(csvRow(['Total Cases Sold', totalCasesSold]));
  lines.push(csvRow(['Unique Stores Visited', uniqueStores.size]));

  // ---- Section 1: Daily Summary (every calendar day of the month) ----
  pushSection(lines, 'DAILY SUMMARY');
  lines.push(
    csvRow([
      'Date',
      'Day',
      'Check-in Time',
      'Check-out Time',
      'Total Market Time',
      'Total Distance (km)',
      'Cases Sold',
      'Stores Visited',
      'Selfie Link',
      'Daily Notes',
      'Daily Challenges',
    ])
  );
  const daysInMonth = addDays(end, -1).getDate();
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const day = new Date(start.getFullYear(), start.getMonth(), dayNum);
    const key = toDateStr(day);
    const att = attByDay[key] || [];
    const dayVisits = visitsByDay[key] || [];
    const report = reportByDate[key];

    const checkIn = att.length > 0 ? att[0].check_in_time : null;
    const lastOut = att
      .map((a) => a.check_out_time)
      .filter((t): t is string => !!t)
      .pop();
    const marketTime = att.reduce(
      (sum, a) => sum + (a.total_market_time_minutes || 0),
      0
    );
    const distance = att.reduce(
      (sum, a) => sum + (a.total_distance_km || 0),
      0
    );
    const dayCases = casesByDay[key] || 0; // cutover semantics (orders/legacy)
    const visited = dayVisits.filter((v) => v.check_out_time).length;
    const selfiePath = att.find((a) => a.selfie_url)?.selfie_url;
    const anyActivity = att.length > 0 || dayVisits.length > 0 || dayCases > 0;

    lines.push(
      csvRow([
        fmtDDMMYYYY(day),
        day.toLocaleDateString('en-US', { weekday: 'long' }),
        fmtTime(checkIn),
        fmtTime(lastOut ?? null),
        att.length > 0 ? fmtMinutes(marketTime) : '',
        att.length > 0 ? fmtKm(distance) : '',
        anyActivity ? dayCases : '',
        dayVisits.length > 0 ? visited : '',
        selfiePath ? signedByPath[selfiePath] || '' : '',
        report?.notes || '',
        report?.challenges || '',
      ])
    );
  }

  // ---- Section 2: Visit Detail (one row per visit) ----
  pushSection(lines, 'VISIT DETAIL');
  lines.push(
    csvRow([
      'Date',
      'Store Name',
      'Check-in Time',
      'Check-out Time',
      'Time Spent',
      'Cases Sold',
      'Visit Notes',
      'Photo Count',
      'Photo Links',
    ])
  );
  for (const v of visits) {
    const paths = photosByVisit[v.id] || [];
    const links = paths
      .map((p) => signedByPath[p])
      .filter((u): u is string => !!u);
    lines.push(
      csvRow([
        fmtDDMMYYYY(new Date(v.check_in_time)),
        v.stores?.name || 'Store',
        fmtTime(v.check_in_time),
        fmtTime(v.check_out_time),
        fmtMinutes(v.duration_minutes),
        visitCases(v),
        v.notes || '',
        links.length,
        links.join(' | '),
      ])
    );
  }

  // ---- Section 3: Store Frequency (one row per distinct store) ----
  pushSection(lines, 'STORE FREQUENCY');
  lines.push(
    csvRow([
      'Store Name',
      'Visits This Month',
      'Total Cases This Month',
      'First Visit Date',
      'Last Visit Date',
    ])
  );
  const byStore: Record<
    string,
    { name: string; count: number; cases: number; first: string; last: string }
  > = {};
  for (const v of visits) {
    const sid = v.store_id || 'unknown';
    if (!byStore[sid]) {
      byStore[sid] = {
        name: v.stores?.name || 'Store',
        count: 0,
        cases: 0,
        first: v.check_in_time,
        last: v.check_in_time,
      };
    }
    const s = byStore[sid];
    s.count += 1;
    if (v.check_in_time < s.first) s.first = v.check_in_time;
    if (v.check_in_time > s.last) s.last = v.check_in_time;
  }
  // Per-store cases follow the cutover hybrid (by store_id), not visit cases.
  for (const sid of Object.keys(byStore)) byStore[sid].cases = cases.byStore[sid] || 0;
  const storeRows = Object.values(byStore).sort((a, b) => b.count - a.count);
  for (const s of storeRows) {
    lines.push(
      csvRow([
        s.name,
        s.count,
        s.cases,
        fmtDDMMYYYY(new Date(s.first)),
        fmtDDMMYYYY(new Date(s.last)),
      ])
    );
  }

  // ---- Write file + hand to the native share sheet ----
  // BOM so Excel detects UTF-8; CRLF row endings for Windows Excel.
  const csv = '﻿' + lines.join('\r\n') + '\r\n';

  // Filename: "{Rep Name} Report - {Month Name} {Year}.csv"
  // (e.g. "Varadddd Kulkarni Report - July 2026.csv"). The on-disk name is
  // what the share sheet offers, so build it exactly — only stripping
  // characters that are illegal in a filename.
  const cleanRep =
    repName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Rep';
  const fileName = `${cleanRep} Report - ${monthName(start)}.csv`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, csv);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: `${cleanRep} Report - ${monthName(start)}`,
  });
}
