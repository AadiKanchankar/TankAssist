/**
 * The ONLY sanctioned way to turn a caught error into text a user reads.
 *
 * Why: raw Postgres text reached the screen — "new row violates row-level
 * security policy for table "location_requests"" — which hands anyone probing
 * the app our table names and tells them exactly which policy stopped them.
 * Every Alert / inline error / error state goes through userMessage(); nothing
 * renders `error.message` directly. lib/userError.test.ts greps the UI for
 * that pattern so it can't quietly come back.
 *
 * What the user gets:
 *  - a SPECIFIC safe sentence when one exists (permission denied, already
 *    saved, offline, OTP expired…), or
 *  - a generic sentence plus a reference code, e.g. "Something went wrong
 *    (TA-3F9C). Try again, or tell your manager if it keeps happening."
 *
 * The detail never goes on screen. It is logged (logcat / Metro) under the same
 * reference, and every DB failure is also in the Supabase API + Postgres logs
 * server-side; the ref is a hash of (code, message), so the same failure always
 * gets the same code and a dev can match a rep's "TA-3F9C" to a log line with
 * errorRef(). ponytail: no client_errors table yet — add one (insert-own, no
 * read for reps) if on-device JS failures ever need server-side capture.
 *
 * Text WE authored is passed through: a plain `new Error('…')` thrown by our
 * own code, and P0001 (RAISE EXCEPTION in our SQL functions — every one was
 * audited 2026-10-01 and none names a table). A leak pattern backstops both.
 */

type AnyErr = {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
  details?: string;
  hint?: string;
  __isAuthError?: boolean;
  __isStorageError?: boolean;
} | null | undefined;

/** Text that must never reach a user, whoever authored it. */
const LEAKY =
  /row[- ]level security|violates|relation "|column "|constraint "|policy|schema|syntax error|permission denied for|duplicate key|null value in|foreign key|PGRST|JWT|postgres|sqlstate|public\./i;

const NETWORK = /network request failed|failed to fetch|aborterror|aborted|timed? ?out|load failed/i;

const OFFLINE = 'No connection — check your internet and try again.';
const NO_PERMISSION = 'You don’t have permission to do this.';

/** FNV-1a → 4 hex chars. Stable per (code, message), so reports group. */
export function errorRef(err: unknown): string {
  const e = (err ?? {}) as AnyErr & object;
  const s = `${e?.code ?? ''}|${e?.message ?? String(err)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `TA-${((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

function generic(err: unknown): string {
  const ref = errorRef(err);
  // Detail stays in the log, keyed by the same ref the user sees.
  console.warn(`[${ref}]`, err);
  return `Something went wrong (${ref}). Try again, or tell your manager if it keeps happening.`;
}

function safeAuthored(msg: string | undefined): msg is string {
  return !!msg && msg.length < 300 && !LEAKY.test(msg);
}

const AUTH: Record<string, string> = {
  otp_expired: 'That code is wrong or has expired. Request a new one.',
  invalid_credentials: 'That code is wrong or has expired. Request a new one.',
  over_sms_send_rate_limit: 'Too many attempts. Wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  sms_send_failed: 'Couldn’t send the SMS. Check the number and try again.',
  otp_disabled: 'No account found for this number. Contact your management team.',
  signup_disabled: 'No account found for this number. Contact your management team.',
  user_not_found: 'No account found for this number. Contact your management team.',
  phone_exists: 'This number already has an account.',
  validation_failed: 'Check the phone number and try again.',
  session_expired: 'Your session expired. Close and reopen the app.',
  refresh_token_not_found: 'Your session expired. Close and reopen the app.',
};

const SQLSTATE: Record<string, string> = {
  '42501': NO_PERMISSION,
  '23505': 'This has already been saved.',
  '23514': 'One of the values isn’t allowed. Check what you entered and try again.',
  '23502': 'Something required is missing. Check what you entered and try again.',
  '22P02': 'One of the values isn’t in the right format. Check what you entered.',
  '22003': 'One of the numbers is too large. Check what you entered.',
  '23503': 'Something this refers to no longer exists. Refresh and try again.',
  PGRST301: 'Your session expired. Close and reopen the app.',
  PGRST303: 'Your session expired. Close and reopen the app.',
};

/** A sentence safe to show anyone. Never contains DB text. */
export function userMessage(err: unknown): string {
  if (err == null) return generic(err);
  // A bare string is library text (e.g. a storage message), never ours.
  if (typeof err === 'string') return NETWORK.test(err) ? OFFLINE : generic(err);
  const e = err as NonNullable<AnyErr>;
  const msg = typeof e.message === 'string' ? e.message : undefined;
  const code = typeof e.code === 'string' ? e.code : undefined;

  if (msg && NETWORK.test(msg)) return OFFLINE;
  if (e.name === 'FunctionsFetchError' || e.name === 'AuthRetryableFetchError') return OFFLINE;

  if (e.__isAuthError) {
    if (e.status === 429) return AUTH.over_request_rate_limit;
    return (code && AUTH[code]) || generic(err);
  }

  if (e.__isStorageError) {
    const status = Number((e as any).status ?? (e as any).statusCode);
    if (status === 403 || (msg && /row[- ]level security|unauthori[sz]ed/i.test(msg))) return NO_PERMISSION;
    if (status === 413 || (msg && /exceed|too large/i.test(msg))) return 'That file is too large.';
    return generic(err);
  }

  if (code) {
    if (code === 'P0001') return safeAuthored(msg) ? msg : generic(err);
    if (SQLSTATE[code]) return SQLSTATE[code];
    if (/LOCATION/i.test(code)) return 'Couldn’t get your location. Make sure location is on, then try again.';
    return generic(err);
  }

  // Our own `throw new Error('…')`. Runtime errors (TypeError etc.) and library
  // errors carry another name, and are not ours to show.
  if (e.name === 'Error' && !('details' in e) && safeAuthored(msg)) return msg;
  return generic(err);
}

/** The error's SQLSTATE / API code, for callers that branch on a known case. */
export function errorCode(err: unknown): string | undefined {
  const c = (err as AnyErr)?.code;
  return typeof c === 'string' ? c : undefined;
}
