import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';
import { useRepDashboard } from './useRepDashboard';
import { startDutyTracking, stopDutyTracking } from '../lib/dutyLocation';

/**
 * The one check-in gate for field work — reps (RepTabs) and sales managers
 * (their My day tab) both use it, so the two can never disagree about when a
 * field user may start working.
 *
 * Reads the same cached query the dashboard shows — no extra request. Nothing
 * is locked while the first load is still in flight: a wrongful lockout is
 * worse than a moment of access. `locked` stays false after punch-out, so the
 * report (submitted after punching out) stays open.
 *
 * ponytail: this is UX, NOT security — the database refuses a store visit
 * without an open day (trg_store_visit_requires_checkin).
 */
export function useCheckInGate() {
  const profile = useAuthStore((s) => s.profile);
  const { data: dash } = useRepDashboard(profile?.id);
  const locked = dash !== undefined && !dash.attendance?.check_in_time;
  /** undefined while loading; true between punch-in and punch-out. */
  const onDuty =
    dash === undefined ? undefined : !!dash.attendance?.check_in_time && !dash.attendance.check_out_time;

  const explain = (what = 'your stores and report') =>
    Alert.alert('Check in first', `Start your day from the dashboard to open ${what}.`);

  /** Run `fn` only when checked in; otherwise say why not. */
  const guard = (fn: () => void, what?: string) => () => (locked ? explain(what) : fn());

  return { locked, onDuty, explain, guard };
}

/**
 * On-duty background GPS follows the open day. Punch-out refetches the
 * dashboard query, so it stops here; unmount (logout, role switch) stops it
 * too. The server also refuses positions once the day is closed — see
 * lib/dutyLocation.
 */
export function useDutyTracking(onDuty: boolean | undefined) {
  useEffect(() => {
    if (onDuty === true) startDutyTracking();
    else if (onDuty === false) stopDutyTracking();
  }, [onDuty]);
  useEffect(() => () => { stopDutyTracking(); }, []);
}
