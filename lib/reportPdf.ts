import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { casesSold } from './reportSemantics';
import {
  toDateStr,
  monthStart,
  nextMonthStart,
  monthName,
} from './reportExport';

import { buildMonth, reportHtml, type MonthModel, type PdfVisit } from './reportPdfHtml';

/**
 * In-app formatted PDF export (per rep), via expo-print (WebView → PDF).
 *
 * This file only FETCHES, prints and shares. The month model and the HTML —
 * KPI page, daily-activity charts with legends, day-by-day table with weekly
 * subtotals, grouped visit log — live in lib/reportPdfHtml.ts, which is pure
 * and has a runnable check (lib/reportPdfHtml.test.ts).
 *
 * Cases always come from casesSold() — the month total, byDay and byVisit —
 * never a second implementation and never the raw store_visits.cases_sold.
 * A failed query throws: a PDF of silent zeros is worse than no PDF.
 */

async function monthData(repId: string, monthDate: Date, now: Date): Promise<MonthModel> {
  const start = monthStart(monthDate);
  const startStr = toDateStr(start);
  const endStr = toDateStr(nextMonthStart(monthDate));

  const [attRes, visitsRes, reportsRes, cases] = await Promise.all([
    supabase
      .from('attendance')
      .select('check_in_time, check_out_time, auto_closed, total_market_time_minutes, total_distance_km, odo_start, odo_end')
      .eq('user_id', repId)
      .gte('check_in_time', `${startStr}T00:00:00`)
      .lt('check_in_time', `${endStr}T00:00:00`)
      .order('check_in_time', { ascending: true }),
    supabase
      .from('store_visits')
      .select('id, store_id, check_in_time, check_out_time, duration_minutes, auto_closed, notes, stores(name)')
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
    casesSold(startStr, endStr, { userId: repId }),
  ]);
  if (attRes.error) throw attRes.error;
  if (visitsRes.error) throw visitsRes.error;
  if (reportsRes.error) throw reportsRes.error;

  const visits: PdfVisit[] = ((visitsRes.data as any[]) ?? []).map((v) => ({
    id: v.id,
    store_id: v.store_id,
    storeName: v.stores?.name || 'Store',
    check_in_time: v.check_in_time,
    check_out_time: v.check_out_time,
    duration_minutes: v.duration_minutes,
    auto_closed: v.auto_closed,
    notes: v.notes,
    cases: cases.byVisit[v.id] ?? 0,
  }));

  return buildMonth({
    month: start,
    days: (attRes.data as any[]) ?? [],
    visits,
    dayReports: (reportsRes.data as any[]) ?? [],
    casesByDay: cases.byDay,
    casesTotal: cases.total,
    now,
  });
}

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
 * Build + share the formatted PDF for one rep across the given months (a
 * summary page then detail pages per month). Throws on failure — caller shows the alert.
 */
export async function exportRepPdf(
  repId: string,
  repName: string,
  months: Date[]
): Promise<void> {
  const now = new Date();
  const sorted = [...months].sort((a, b) => a.getTime() - b.getTime());
  const datas = await Promise.all(sorted.map((m) => monthData(repId, m, now)));
  const html = reportHtml(repName, datas, now);

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
