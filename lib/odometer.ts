/**
 * Odometer readings for Travel Allowance.
 *
 * Daily TA distance = odo_end - odo_start, taken from two rep-attested
 * readings (punch-in and punch-out). OCR only pre-fills the number; the rep
 * confirms or corrects it, so a reading is human-attested, never blindly
 * machine-trusted.
 *
 * Pure — no React, no network, no OCR engine — see lib/odometer.test.ts.
 */

// ── Reading plausibility ──────────────────────────────────────────────────

/**
 * Real bike/car odometers are 5-7 digits. Shorter usually means OCR grabbed
 * the trip meter or a speed readout; longer means it merged two numbers.
 */
export const MIN_ODO_DIGITS = 4;
export const MAX_ODO_DIGITS = 7;

/** Nobody adds more than this to an odometer in one working day. */
export const MAX_DAILY_KM = 1000;

export type RejectReason =
  | 'not-a-number'
  | 'too-few-digits'
  | 'too-many-digits'
  | 'below-start'
  | 'implausible-daily';

export interface ReadingCheck {
  ok: boolean;
  reason?: RejectReason;
  message?: string;
}

/**
 * Pull a candidate odometer number out of raw OCR text.
 *
 * A dashboard shows the odometer, a trip meter and often a speed at once, so
 * the text can hold several numbers. Rules, in order:
 *  - digits only (an odometer has no decimal point; a trip meter usually does,
 *    which is exactly how we tell them apart)
 *  - drop anything with a decimal separator attached
 *  - prefer the LONGEST run of digits, then the largest — the odometer is the
 *    highest-magnitude number on the cluster.
 *
 * ponytail: this is a heuristic over a guided/framed crop, not display
 * detection. If real motorcycle dashboards defeat it, the phase-2 upgrade is a
 * TRODO/YOLO model that locates the odometer region before OCR runs — the
 * engine is already behind an interface so that swap touches one module.
 */
const SPLIT_LINES = new RegExp('[\r\n]+');

export function extractOdometerCandidate(rawText: string): number | null {
  if (!rawText) return null;

  // Work line by line: digits that belong to one display sit on one line, and
  // this stops a dial number above being merged with the odometer below.
  const candidates: string[] = [];

  for (const line of rawText.split(SPLIT_LINES)) {
    // 1. Thousands separators are NOT decimals. "89,314" is one number, but the
    //    old blanket "reject anything with . or ," discarded it entirely — a
    //    real cause of "cloud read no digits" on a perfectly clear display.
    const cleaned = line.replace(/(\d)[,](\d{3})(?!\d)/g, '$1$2');

    const tokens = cleaned.split(/[^0-9.,]+/).filter(Boolean);
    const singles: string[] = [];

    for (const raw of tokens) {
      // Trailing punctuation is noise, not a decimal point.
      const t = raw.replace(/[.,]+$/, '');
      // ANY separator still sitting between digits at this point is either the
      // trip meter (67.8) or two dial markings Vision merged ("200.120") — and
      // the merged case is the dangerous one, because it is the right LENGTH
      // to look like an odometer and can outrank the real reading. Thousands
      // commas were already normalised away above, so nothing legitimate is
      // lost by rejecting the whole token here.
      if (/\d[.,]\d/.test(t)) {
        singles.length = 0; // a decimal breaks any digit run around it
        continue;
      }
      const digits = t.replace(/\D/g, '');
      if (!digits) continue;

      if (digits.length >= MIN_ODO_DIGITS && digits.length <= MAX_ODO_DIGITS) {
        candidates.push(digits);
        singles.length = 0;
        continue;
      }

      // 2. Segmented LCDs are read digit-by-digit when the gaps are wide, so
      //    "89314" arrives as "8 9 3 1 4". Rebuild a run of SINGLE digits.
      //    Deliberately single digits only, and at least MIN_ODO_DIGITS of
      //    them: merging looser fragments would happily turn the dial numbers
      //    "80 100" into a plausible-looking 80100, which is far worse than
      //    failing and letting the rep type it.
      if (digits.length === 1) {
        singles.push(digits);
        if (singles.length >= MIN_ODO_DIGITS && singles.length <= MAX_ODO_DIGITS) {
          candidates.push(singles.join(''));
        }
      } else {
        singles.length = 0;
      }
    }
  }

  if (!candidates.length) return null;
  // Longest run wins, then largest — a 6-digit odometer beats a 4-digit
  // fragment of the same cluster.
  candidates.sort((a, b) => b.length - a.length || Number(b) - Number(a));
  const n = Number(candidates[0]);
  return Number.isFinite(n) ? n : null;
}


/**
 * Is this reading usable? `startOfDay` is the punch-in reading when validating
 * the punch-out one.
 *
 * The "never below the start" rule is the important one: odometers do not run
 * backwards, so a lower end reading is either a misread or an attempt to
 * shrink the day. It is ALSO enforced by a DB check constraint — this is the
 * friendly version, not the guarantee.
 */
export function checkReading(value: number | null, startOfDay?: number | null): ReadingCheck {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return { ok: false, reason: 'not-a-number', message: 'Enter the odometer number.' };
  }
  const digits = String(Math.trunc(value)).length;
  if (digits < MIN_ODO_DIGITS) {
    return {
      ok: false,
      reason: 'too-few-digits',
      message: `That looks too short for an odometer — did it read the trip meter? Check and re-enter.`,
    };
  }
  if (digits > MAX_ODO_DIGITS) {
    return {
      ok: false,
      reason: 'too-many-digits',
      message: 'That looks too long for an odometer. Check and re-enter.',
    };
  }
  if (startOfDay != null) {
    if (value < startOfDay) {
      return {
        ok: false,
        reason: 'below-start',
        message: `Lower than this morning's reading (${startOfDay}). Odometers don't go backwards — check the number.`,
      };
    }
    if (value - startOfDay > MAX_DAILY_KM) {
      return {
        ok: false,
        reason: 'implausible-daily',
        message: `That would be over ${MAX_DAILY_KM} km today. Check the number.`,
      };
    }
  }
  return { ok: true };
}

/** Kilometres for the day, or null when either reading is missing. */
export function dailyDistance(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const d = end - start;
  return d >= 0 ? d : null;
}

// ── GPS cross-check ───────────────────────────────────────────────────────

/**
 * Tolerance for odometer-vs-GPS. DELIBERATELY GENEROUS and tunable in one
 * place.
 *
 * The GPS figure is the store-to-store route; the odometer counts every
 * kilometre the rep actually rode, including the legitimate detours a real day
 * contains — petrol, lunch, a xerox shop, a wrong turn, parking circles. Some
 * overshoot is NORMAL and must never be treated as dishonesty.
 *
 * The flag exists to catch the gross case (rode 5 km, claims 80), not honest
 * slack. Raise these if managers see noise; the whole point is that a flag
 * costs a rep a conversation, so a false one is expensive.
 */
export const MISMATCH_PERCENT = 0.6; // 60% over the GPS route is still fine
export const MISMATCH_FLOOR_KM = 25; // and never flag under this much absolute gap

export interface MismatchResult {
  flagged: boolean;
  odoKm: number | null;
  gpsKm: number | null;
  excessKm: number | null;
  reason?: string;
}

/**
 * Compare the day's odometer distance against the recorded GPS route
 * (attendance.total_distance_km, already computed at punch-out).
 *
 * Only an OVER-claim is flagged. An odometer reading well BELOW the GPS route
 * cannot inflate Travel Allowance, so it is not an anti-cheat signal — it just
 * means a reading was fumbled, and pestering a manager about it would be noise.
 */
export function mismatchFlag(
  odoStart: number | null,
  odoEnd: number | null,
  gpsKm: number | null,
): MismatchResult {
  const odoKm = dailyDistance(odoStart, odoEnd);
  if (odoKm == null || gpsKm == null || !Number.isFinite(gpsKm)) {
    return { flagged: false, odoKm, gpsKm: gpsKm ?? null, excessKm: null };
  }
  const excessKm = odoKm - gpsKm;
  const tolerance = Math.max(MISMATCH_FLOOR_KM, gpsKm * MISMATCH_PERCENT);
  if (excessKm <= tolerance) return { flagged: false, odoKm, gpsKm, excessKm };
  return {
    flagged: true,
    odoKm,
    gpsKm,
    excessKm,
    reason:
      `Odometer shows ${Math.round(odoKm)} km today but the tracked route was ` +
      `${Math.round(gpsKm)} km — ${Math.round(excessKm)} km more than the ` +
      `journey recorded. Worth asking about the extra travel.`,
  };
}

// ── The tenths-drum trap (§3d) ────────────────────────────────────────────

/**
 * A day's driving never multiplies the odometer. Beyond this ratio the reading
 * is not "a big day", it is a misread — almost always the tenths wheel.
 *
 * This only decides WHEN to suspect the tenths wheel. Whether the corrected
 * number is believable is judged by MAX_DAILY_KM, the distance bound this file
 * already uses — a ratio is the wrong tool for that, as it happily accepted a
 * 66,000 km "day" when the odometer was large.
 */
export const TENTHS_JUMP_FACTOR = 5;

export interface ResolvedReading {
  value: number | null;
  /** True when the trailing tenths digit was dropped. */
  adjusted: boolean;
  /** Shown to the rep when something was changed or looks wrong. */
  reason?: string;
}

/**
 * Drop the tenths wheel when a mechanical odometer's last drum was read as a
 * whole kilometre.
 *
 * Many mechanical odometers put the 0.1 km wheel on a distinct-coloured drum.
 * Including it makes the reading exactly 10x too big — 33780 becomes 337807 —
 * which would wreck travel allowance. The drum's colour is not reliably
 * recoverable from OCR text, so the DECIDING signal here is the rep's previous
 * reading: an odometer that appears to have multiplied is not a big day out.
 *
 * ⚠️ Needs `previous` to work. With no prior reading (a rep's very first
 * capture, or the morning reading of the day) there is nothing to compare
 * against and the raw value is returned unchanged — an honest limit, not a
 * silent guess. The visible crop on the correction screen is the backstop
 * there: the rep can see what the number should be.
 */
export function resolveOdometerReading(
  raw: number | null,
  previous: number | null,
): ResolvedReading {
  if (raw == null || !Number.isFinite(raw)) return { value: null, adjusted: false };
  if (previous == null || previous <= 0) return { value: raw, adjusted: false };
  if (raw < previous * TENTHS_JUMP_FACTOR) return { value: raw, adjusted: false };

  const dropped = Math.floor(raw / 10);
  // Only drop when doing so lands somewhere an odometer could actually be:
  // at or above the last reading, and within a day's driving of it.
  if (dropped >= previous && dropped - previous <= MAX_DAILY_KM) {
    return {
      value: dropped,
      adjusted: true,
      reason: 'Last digit looked like the tenths wheel, so it was dropped. Check it.',
    };
  }
  // Dropping does not help either — leave the number alone but say it is odd,
  // rather than silently inventing a plausible-looking one.
  return {
    value: raw,
    adjusted: false,
    reason: 'This is far higher than your last reading. Check it before saving.',
  };
}
