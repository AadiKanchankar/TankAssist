import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getSignedUrls } from '../lib/storage';
import { casesSold, CasesResult } from '../lib/reportSemantics';
import type { AttendanceFigures, StoredRoute } from '../lib/reportFigures';

export interface ReportDay extends AttendanceFigures {
  id: string;
  check_in_time: string;
  latitude: number | null;
  longitude: number | null;
  odo_start_photo_path: string | null;
  odo_end_photo_path: string | null;
  odo_start_at: string | null;
  odo_end_at: string | null;
  odo_end_lat: number | null;
  odo_end_lng: number | null;
  /** Written at punch-out from 2026-09-23; null before that and on auto-closed days. */
  route: StoredRoute | null;
}

export interface ReportVisit {
  id: string;
  store_id: string;
  storeName: string;
  check_in_time: string;
  check_out_time: string | null;
  duration_minutes: number | null;
  auto_closed: boolean | null;
  distance_from_store_meters: number | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  /** Through the cutover hybrid — never the raw legacy column. */
  cases: number;
  photoUrls: string[];
}

export interface DayReport {
  report_date: string;
  notes: string | null;
  challenges: string | null;
}

export interface RepReport {
  days: ReportDay[];
  visits: ReportVisit[];
  dayReports: DayReport[];
  cases: CasesResult;
}

const DAY_COLS =
  'id, check_in_time, check_out_time, auto_closed, total_market_time_minutes, total_distance_km, latitude, longitude, ' +
  'odo_start, odo_end, odo_start_photo_path, odo_end_photo_path, odo_start_at, odo_end_at, odo_end_lat, odo_end_lng, route';
const VISIT_COLS =
  'id, store_id, check_in_time, check_out_time, duration_minutes, auto_closed, distance_from_store_meters, ' +
  'latitude, longitude, notes, photo_url, stores(name)';

/**
 * One rep's activity over [start, endExclusive) (yyyy-mm-dd).
 *
 * The manager report AND every drill-down read this one query. Same key, same
 * cached object — so a drill-down cannot disagree with the tile that opened it,
 * which is the whole point of "header says 300, drill-down sums to 300".
 */
export function useRepReport(repId: string | undefined, start: string, endExclusive: string) {
  return useQuery({
    queryKey: ['rep-report', repId, start, endExclusive],
    enabled: !!repId,
    refetchOnMount: false,
    queryFn: async (): Promise<RepReport> => {
      const from = `${start}T00:00:00`;
      const to = `${endExclusive}T00:00:00`;
      const [visitRes, dayRes, reportRes, cases] = await Promise.all([
        supabase
          .from('store_visits')
          .select(VISIT_COLS)
          .eq('user_id', repId!)
          .gte('check_in_time', from)
          .lt('check_in_time', to)
          .order('check_in_time', { ascending: true }),
        supabase
          .from('attendance')
          .select(DAY_COLS)
          .eq('user_id', repId!)
          .gte('check_in_time', from)
          .lt('check_in_time', to)
          .order('check_in_time', { ascending: true }),
        supabase
          .from('daily_reports')
          .select('report_date, notes, challenges')
          .eq('user_id', repId!)
          .gte('report_date', start)
          .lt('report_date', endExclusive)
          .order('report_date', { ascending: false }),
        casesSold(start, endExclusive, { userId: repId }),
      ]);
      if (visitRes.error) throw visitRes.error;
      if (dayRes.error) throw dayRes.error;
      if (reportRes.error) throw reportRes.error;

      const vRows = (visitRes.data as any[]) ?? [];
      const pathsByVisit: Record<string, string[]> = {};
      if (vRows.length) {
        const { data: photoRows } = await supabase
          .from('store_visit_photos')
          .select('visit_id, storage_path, position')
          .in('visit_id', vRows.map((v) => v.id))
          .order('position', { ascending: true });
        for (const row of (photoRows as any[]) ?? []) {
          (pathsByVisit[row.visit_id] = pathsByVisit[row.visit_id] ?? []).push(row.storage_path);
        }
      }
      // Pre-gallery visits kept their single photo on the visit row.
      for (const v of vRows) if (!pathsByVisit[v.id] && v.photo_url) pathsByVisit[v.id] = [v.photo_url];
      const signed = await getSignedUrls(Object.values(pathsByVisit).flat());

      return {
        days: (dayRes.data as unknown as ReportDay[]) ?? [],
        dayReports: (reportRes.data as DayReport[]) ?? [],
        cases,
        visits: vRows.map((v) => ({
          id: v.id,
          store_id: v.store_id,
          storeName: v.stores?.name || 'Store',
          check_in_time: v.check_in_time,
          check_out_time: v.check_out_time,
          duration_minutes: v.duration_minutes,
          auto_closed: v.auto_closed,
          distance_from_store_meters: v.distance_from_store_meters,
          latitude: v.latitude,
          longitude: v.longitude,
          notes: v.notes,
          cases: cases.byVisit[v.id] ?? 0,
          photoUrls: (pathsByVisit[v.id] ?? []).map((p) => signed[p]).filter((u): u is string => !!u),
        })),
      };
    },
  });
}
