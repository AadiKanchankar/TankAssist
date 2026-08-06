/**
 * Encrypted, deliberately tiny form draft for an in-progress store visit.
 *
 * WHY ENCRYPTED: a draft holds store identity plus stock quantities — trade
 * data that must not sit in plaintext on a device that gets lost or resold.
 * It reuses the existing chunked SecureStore adapter (Android Keystore / iOS
 * Keychain), NOT AsyncStorage.
 *
 * WHAT THIS IS NOT: the resume backbone. That is server-side — an open
 * `store_visits` row with no check_out_time, under RLS, which survives an app
 * kill AND a device swap. This draft only restores what the rep had *typed*
 * but not yet committed. If it is missing or corrupt, resume still works; the
 * rep just re-enters the numbers. Treat it as a convenience, never as truth.
 *
 * ponytail: photo binaries are deliberately NOT cached. Photos already upload
 * to the locked bucket as they are taken, so on resume we re-reference the
 * uploaded rows; caching megabytes of base64 in the Keystore would be slow,
 * far past SecureStore's per-key budget, and would put images at rest on the
 * device for no gain. Out of scope for security and size, not overlooked.
 *
 * This module stays PURE (no react-native imports) so the size rules are
 * runnable under tsx — same split as inventoryMath vs useInventoryAnalytics.
 * The Keystore I/O lives in visitDraftStore.ts.
 */

export const DRAFT_PREFIX = 'visit_draft.';

/** Cap so a runaway note can't turn a convenience into dozens of Keystore writes. */
export const MAX_NOTES_CHARS = 1200;
export const MAX_DRAFT_CHARS = 6000;

export interface VisitDraft {
  /** Index into the stepper's STEP_ORDER, so resume lands where they left off. */
  step: number;
  /** productId -> bucket -> { cases, bottles }, all as typed strings. */
  stock: Record<string, Record<string, { cases: string; bottles: string }>>;
  /** Products the rep actually touched — drives what gets recorded. */
  touched: string[];
  notes: string;
  orderNotes: string;
  savedAt: string;
}

export const emptyDraft = (): VisitDraft => ({
  step: 0,
  stock: {},
  touched: [],
  notes: '',
  orderNotes: '',
  savedAt: '',
});

/**
 * Trim a draft to something worth storing encrypted. Pure, so the size rules
 * are testable without touching the Keystore.
 *
 * Drops, in order of least value: over-long notes are truncated; if it is
 * still too big the notes go entirely, because the numbers are what is
 * genuinely tedious to re-enter and they must survive.
 */
export function pruneDraft(d: VisitDraft): VisitDraft {
  const out: VisitDraft = {
    ...d,
    notes: (d.notes ?? '').slice(0, MAX_NOTES_CHARS),
    orderNotes: (d.orderNotes ?? '').slice(0, MAX_NOTES_CHARS),
  };
  if (JSON.stringify(out).length <= MAX_DRAFT_CHARS) return out;
  const stripped: VisitDraft = { ...out, notes: '', orderNotes: '' };
  return stripped;
}

/** True when there is anything worth restoring — avoids pointless writes. */
export function draftHasContent(d: VisitDraft): boolean {
  if (d.step > 0) return true;
  if (d.touched.length > 0) return true;
  if ((d.notes ?? '').trim()) return true;
  if ((d.orderNotes ?? '').trim()) return true;
  return false;
}

/**
 * Parse a stored draft defensively. A shape change between app versions, or a
 * partial write, must never take down the stepper — it just means re-typing.
 */
export function parseDraft(raw: string | null): VisitDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VisitDraft;
    if (typeof parsed?.step !== 'number' || typeof parsed?.stock !== 'object') return null;
    if (parsed.stock === null || Array.isArray(parsed.stock)) return null;
    return {
      ...emptyDraft(),
      ...parsed,
      touched: Array.isArray(parsed.touched) ? parsed.touched : [],
    };
  } catch {
    return null;
  }
}
