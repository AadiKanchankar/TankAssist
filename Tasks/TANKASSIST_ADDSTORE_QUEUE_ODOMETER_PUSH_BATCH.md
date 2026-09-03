# TankAssist — add-store, review-queue triage, odometer fixes, version, finish push

Six items. §3 (odometer) leads on impact — the crop bug is the likely root of the accuracy misery.
§6 (push) is **finish + prove the parked work**, not a rebuild. Standing rules: verify live via MCP,
`graphify query` before grep, `tsc` clean per item, complete files, schema changes are STOP-POINTs,
no service-role key, reuse over new code (ponytail), Impeccable pass on every UI change, flag caveats
up front. Confirm what's on the current installed build vs. pending before starting — this batch has
native work (push) so it rides a **new EAS build**.

---

## 1. Dedicated "Add store" button on the rep store page
The add-store flow already exists (the shared `AddStoreModal`, extracted so it can't bypass dedup).
It's currently only reachable via the search-empty state. Add a **dedicated "Add store" entry point**
on the rep's store list/page, matching the management/sales-manager placement. Reuse `AddStoreModal`
as-is — same dedup guard, same GPS-at-creation. No schema. Impeccable pass.

## 2. Review queue — make flags actionable (triage, not a dead-end)
The queue surfaces flags but gives the manager no next step — a UX dead-end and why it clutters.
Add **per-item resolution** (owner decision: dismiss + warn-rep + optional note):
- **Swipe-left → Dismiss** ("looked, it's fine / handled offline"). Removes it from the actionable
  queue. Offer an **optional note** on dismiss (why it was fine — "covering a colleague's route"),
  so dismissals keep an audit trail instead of erasing the signal.
- **Swipe-right → Warn rep.** Creates a warning the rep sees. **Surfaces IN-APP** (a manager-message
  banner on the rep dashboard via the existing Realtime channel / a messages item) — **NOT a push
  notification** for the warning itself this round; keep it simple and in-app.
- Familiar gesture set (Amazon/Gmail); both actions declutter the queue as a bonus. Keep buttons as
  a non-swipe fallback for accessibility (swipe alone isn't discoverable/accessible).
- **Schema STOP-POINT:** flag-resolution needs to persist — a `flag_resolutions` (or per-visit
  resolution) record: which flag/visit, resolved_by, action (dismissed/warned), note, at. And a
  rep-warnings table for the in-app warning. Propose SQL; RLS: manager resolves flags for their own
  reps (reuse `manages_rep`), rep reads only warnings addressed to them. Impersonation-test.
- Derived flags currently recompute every load — a dismissed flag must **stay** dismissed (store the
  resolution keyed to the visit+flag-kind so the derived flag is suppressed once resolved).
- Impeccable pass on the swipe UX + the rep-facing warning banner.

## 3. Odometer OCR — fix the crop (root cause), decouple the lag, handle the tenths digit
Multiple separate bugs; fix in this order.

### 3a. THE CROP BUG (root cause — do first)
Supabase shows the **full dashboard photo, not the cropped odometer** reaching OCR. The whole design
depended on sending Vision only the tight guided-frame crop; sending the whole dash means Vision
reads speed numbers/brand text and returns no clean odometer number (matches the live "cloud read no
digits"). **Verify what's actually uploaded/sent to the Vision Edge Function, and ensure the guided-
frame crop is applied before the OCR call.** `graphify` the capture → crop → upload → Edge Function
path. This one fix likely removes most misses — confirm against the test images (§3e) before moving on.

### 3b. Non-blocking flow with the result shown (owner's refined design)
The rep must never wait on OCR, but must **see the OCR result and correct it**. Flow:
- Snap photo → go **immediately** to the correction screen (no frozen wait).
- Correction screen shows **the cropped odometer image** + an editable reading field. The field shows
  a subtle "reading…" state and **populates the moment OCR returns** (usually 1–2s). If OCR fails or
  is slow, the field stays empty and the rep types the number **while reading it off the crop on
  screen** (not squinting at the dial).
- The cropped image on this screen doubles as a **visible crop-check**: if the crop missed the
  odometer window, the rep sees it immediately and retakes — surfacing the 3a bug to the user too.
- Never show a dead "OCR unavailable" screen — OCR is non-blocking, so its failure is just an empty
  field with the crop present, not a blocker.

### 3c. Latency / lag
Decouple capture from OCR (per 3b) so the rep proceeds instantly. **Do NOT over-engineer** — at
twice-a-day-per-rep volume, round-robin/load-balancing is premature; the real fix is async + non-
blocking, and confirming the Edge Function isn't doing redundant work (e.g. re-uploading, or being
called on the uncropped full image). `ponytail:` async decouple, not a distributed-systems rework.

### 3d. The tenths-digit / last-drum trap (the hard reading bug)
Mechanical odometers often have the **last digit on a distinct-coloured drum = the 0.1km (tenths)
wheel** (white/black background, sometimes mid-roll). Including it makes the reading **10× wrong**
(e.g. `33780` read as `337807`). But sometimes that last wheel is a real 1km digit, not tenths —
so it's colour/position dependent, not a fixed rule.
- Post-process the Vision output: detect the visually-distinct trailing drum and treat it as tenths
  (drop it from the integer km reading) when it's the odometer's tenths wheel.
- **Backstop with the previous-reading sanity check:** a reading wildly out of range vs. the rep's
  last known odometer (e.g. 33k → 337k) is impossible — reject/flag it and prefer the plausible
  interpretation. This is the reliable guard even when the drum-colour heuristic is uncertain.
- Keep plausible-length (5–7 digits) and not-below-start validation.
- Tune against the real test images (§3e).

### 3e. Test set
The owner is providing **real odometer photos** (mechanical drums with tenths wheels, mid-roll
digits, LCD/ODO displays, worn dials, glare). Use them as the calibration/regression set — report
per-image what the crop captured, what Vision returned, and the final post-processed reading. Add a
pure-function test for the tenths-drop + sanity-check logic.

### 3f. Honest expectation (state in code + report, don't over-promise)
Worn mechanical dials with a **half-rolled digit** (physically ambiguous — the drum is literally
between two numbers) will occasionally misread; that's physics, not a fixable bug. Goal: **right most
of the time, crop always visible, rep corrects the rest in one tap, and never 10× wrong** (the
tenths trap handled). Don't declare 100%.

## 4. App version not reflecting in Profile
Profile shows a stale version. Find where it reads the version — if hardcoded, switch to reading the
real app version (`expo-constants` / `expo-application`) so it can't drift again. Confirm it shows
the current version post-build.

## 5. (folded in) confirm no regressions
The 2b "still in store?" checkout gate + the persistent dashboard checkout card + one-open-visit
rule from the prior batch — confirm still intact after this batch's changes; don't let the review-
queue or store-page work disturb them.

## 6. Finish push notifications (they were parked — diagnose + complete, do NOT rebuild)
Push was **built but never delivered a notification**; the most likely reason (never confirmed) is
the **installed build predated `expo-notifications`, so no device token ever registered** — i.e. it
may already be nearly done and just needs the new build to exercise it. Close it out:
- **First, inspect the parked state live** (don't assume): is `pg_net` enabled, the
  `notify_plan_submitted` trigger attached, the `push_tokens` table + `register_push_token` present,
  `expo-notifications`/`expo-device` installed, register-on-login/cleanup-on-logout wired? Report
  what exists vs. what's missing.
- **Trace the delivery chain and report the broken link** using `net._http_response` (200 vs
  401/403/404 from Expo/FCM), whether the trigger fires, whether a device token actually registers.
- **Most likely fix = the new build itself** (native module lands → token registers → real end-to-end
  works). If it's a credential/config issue instead (Vault/EAS FCM key, wrong project), fix that.
- **Prove it end-to-end on-device, app closed:** submit a plan → the designated manager (or all
  managers + management for an orphan rep, per existing routing) gets a **phone notification with the
  app closed**, deep-linking to the review queue. This is the acceptance criterion — not "trigger
  returned 200," but a real notification on a real closed app.
- Reconcile the version-bump state (`app.json` `runtimeVersion`/`version`) so OTA can't land push JS
  on a binary lacking the native module.

## 7. Ship
After §1–§6 tsc-clean + STOP-POINTs confirmed (queue resolution schema, any odometer change): update
`CLAUDE.md` + `HANDOFF.md` (add-store entry, queue triage + resolution schema, odometer crop/async/
tenths fixes, version fix, **push un-parked + delivered**), regenerate `supabase-schema.sql` from
live, commit + push, `expo-doctor` preflight, cut **one** EAS build (native: push). Report the link.
On-device test order: **push arrives app-closed** (the §6 close-out) → odometer: crop correct, result
shows on correction screen with cropped image, tenths not 10×-wrong, no lag/"unavailable" → review
queue swipe dismiss/warn + rep sees in-app warning → add-store button → profile shows current version.

## Order of work
1. §3a crop bug (root cause) — verify + fix, check against test images. Report.
2. §3b–3d odometer flow, tenths logic, lag. Report with per-image results.
3. §2 review-queue triage (schema STOP-POINT → swipe UX → rep warning).
4. §1 add-store button, §4 version fix (quick wins).
5. §6 push — inspect parked state, diagnose, complete; report the broken link before assuming the build fixes it.
6. §7 docs → expo-doctor → one build.

Report after §3a (crop), at each schema STOP-POINT, after the §6 diagnosis, and before cutting the build.
