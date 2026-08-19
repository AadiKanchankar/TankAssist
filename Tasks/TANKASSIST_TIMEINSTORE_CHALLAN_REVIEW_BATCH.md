# TankAssist — time-in-store, challan capture, review-queue rebuild + push

Three items. #1 is mostly a backend derivation over data you already collect. #2 is a capture +
manual-entry rail (auto-OCR deferred). #3 rebuilds the review queue and adds real push
notifications (new native module → this batch rides a **new EAS build**, not OTA).

Standing rules: verify schema live via MCP, `graphify query` before grep, `tsc` clean per item,
complete files, schema changes are STOP-POINTs, no service-role key, reuse over new code
(ponytail), Impeccable pass on every UI change, flag caveats up front. Confirm whether the last
build (crash fix + ML Kit + floor/display merge + auto-checkout) actually shipped before starting.

---

## 1. Time-in-store — derive it, don't add taps

**Do NOT add or change the check-in/check-out taps or the shelf photo — they already exist and
work.** The only new work here is a derived field + a flag over timestamps already stored.

- **Derive "time in store" as the work-artifact span:** for a visit, take the timestamps already
  written on the work the rep does during it — the live shelf/stock photo, order submit, feedback
  note, stock update — and compute `span = last_artifact_ts − first_artifact_ts`. Store it on the
  visit (a derived column or computed on read — pick based on what the dashboards/reports need;
  report the choice). This is the duration we trust, because a rep at home can't produce a live
  shelf photo of that specific shop — which is also why it survives clustered-shops markets
  (it never asks "which coordinate," only "did the work happen here").
- **The two taps stay as the visit's outer bookends** (start/end record), but duration comes from
  the artifact span, not the tap gap.
- **GPS = coarse area sanity-check only.** Use the single GPS reading already captured at
  check-in/out to sanity-check the rep was in the right area. Do **NOT** add background/continuous
  GPS or geofence polling — decided against (battery, permission friction, drift, and it can't
  distinguish adjacent shops anyway). One reading per tap, which already exists; reading device GPS
  is free (no API cost).
- **Flag to the manager on gross implausibility only** (reuse the existing exception queue): e.g. a
  work-span under a small threshold (rep tapped both ends but did ~no timestamped work), or the
  coarse GPS in the wrong area. Generous + tunable threshold — honest reps who work fast must not
  be accused; this is flag-don't-block like everything else.
- **One hardening check (verify, only fix if needed):** confirm the artifact timestamps are
  **server-side** (DB `now()` / server-set), not client-device time — otherwise a rep could change
  their phone clock to inflate the span. If any are client-stamped, switch those to server time.
  If they're already server-stamped (likely, like the ledger/orders), #1 is pure derivation.
- No new rep-facing screens or taps. This is: one derived field + one flag type + a timestamp-
  source check.

## 2. Delivery-challan capture + manual entry (auto-OCR deferred)

Goal: **start collecting structured challan data now** (the owner's stated priority), without
betting on OCR that won't read handwritten mixed-script carbon copies. Rep-side feature.

Reality (confirmed): the printed L-34 excise forms are readable, but many challans are handwritten
in mixed English/Hindi/Devanagari on carbon paper — not reliably auto-extractable with free/offline
OCR. So build the manual rail now; auto-read the *printed* subset is a later phase.

- **Capture:** rep photographs the challan (live camera; store to a locked bucket, manager/mgmt +
  owner readable, same evidence pattern as excise permits — never public).
- **Manual entry form, product-seeded and fast** (reps aren't power users — minimize friction):
  - Pre-seed the **Tank 90 product line** as the primary target. The business only cares about its
    own product on these challans, so make "Tank 90 / T-90 / Tank 900" the easy path: the rep
    confirms the product and enters Qts / Pints / Nips against it. Other brands optional/ignorable.
  - Capture date and store — pre-fill store from the rep's current visit/context and date from
    today; both editable. Don't force OCR for these.
  - Every field editable/correctable (owner requirement) — this is manual entry, so correction is
    the whole point.
- **Data model:** a `challans` record (photo path, store, date, rep, uploaded_at) + line items
  (product, qty_cases/pints/nips). Schema STOP-POINT — propose SQL, confirm, verify, impersonation-
  test (rep writes own, manager/mgmt read).
- **`ponytail:` explicitly scope OUT auto-OCR this round.** Structure the record so a future
  printed-challan auto-extract (reusing the permit text-layer pipeline) can populate the same
  fields the manual form does — but do not build extraction now. Leave the note at the seam.
- If during build any part of "manual capture is enough to start collecting data" looks wrong,
  stop and flag rather than silently reaching for OCR.

## 3. Review queue — rebuild + real push notifications

The review queue (sales_manager + management) is slow, cluttered, sectionless, and has a broken
approve path. Rebuild it and add real phone notifications.

### 3.1 Security / correctness pass (scoped, not "all of OWASP")
Audit **this screen's** data paths specifically, not the whole app abstractly:
- RLS coverage on every query the review queue runs — a sales_manager sees only their own reps'
  items; management sees all; no cross-manager leakage.
- No over-broad selects pulling columns the client doesn't need (esp. anything price/PII-shaped).
- The approve/reject mutations must return affected rows (`.select()`) so an RLS-filtered no-op
  can't report false success — the exact silent-failure class fixed before on plan approval.
Report concretely what was checked and found.

### 3.2 Performance + clustered/sectionless UI
- Fix the slowness (likely unbounded/unindexed queries or rendering the full list — virtualize,
  paginate, and query-scope to the relevant window). `graphify` the review-queue data hooks first.
- **Section the queue into three clear groups: Odometer flags · Location/visit flags · Day plans.**
  Distinct, labelled sections so a manager parses it at a glance (Common Region / Von Restorff /
  chunking — the same principles used elsewhere). Impeccable pass on the rebuilt layout.

### 3.3 Day-plan freshness
- Only surface day plans **from today / still actionable** in the approval queue — drop plans older
  than 7 days from the actionable queue (a week-old plan approval is meaningless). Confirm the
  cutoff with real data; keep old plans viewable in history, just not in the "needs approval" list.

### 3.4 Approve-plan fixes (reuse existing resolution logic)
- **Broken approve → fix root cause** (same class as prior silent-RLS-noop / null-manager crashes;
  `.select()` + honest error + null-safe render).
- **Idempotency:** if a plan is already approved, show "approved by [name]" and **hide/disable** the
  approve button — never offer approve twice (same guard as the duplicate-permit fix).
- **Routing:** a rep's plan goes to their **designated sales_manager only**; if the rep has **no**
  designated manager, it goes to **all** sales_managers + management. This is the exact resolution
  rule already built for orphaned reps elsewhere — reuse it, don't reinvent.

### 3.5 Real push notifications (new native module → new build)
- Add `expo-notifications` + **FCM** (Firebase Cloud Messaging) so a manager gets a **phone
  notification-bar alert with the app closed** — Realtime only works with the app open, which is
  why this needs the new capability. This is a new native module: **new EAS build, not OTA**, plus
  one-time FCM project setup (free).
- Trigger a push to the correct recipient(s) (per 3.4 routing) when a plan is submitted for
  approval; keep the existing in-app Realtime update too (push wakes them, Realtime updates the
  open screen).
- Store device push tokens (a `push_tokens`/device table, RLS: user manages own) — schema
  STOP-POINT. Handle permission-denied gracefully (rep/manager who declines notifications still
  gets in-app Realtime). Confirm token registration on login and cleanup on logout.
- `ponytail:` keep the notification payload minimal (who/what/deep-link target) — no sensitive data
  in the notification body.

## 4. Ship
Only after §1–§3 are `tsc`-clean and the STOP-POINTs (challan schema, push-token schema, any
time-in-store column) are confirmed:
- Update `CLAUDE.md` + `HANDOFF.md`: time-in-store derivation + flag, the challan capture/manual
  rail (+ deferred auto-OCR seam), the review-queue rebuild, FCM/push + token table.
- Commit + push to GitHub.
- `expo-doctor` preflight (last builds hit dependency drift).
- Cut **one** EAS build carrying `expo-notifications`/FCM + everything else.
- On-device test order: push notification arrives with app closed to the right manager → review
  queue is fast + sectioned + approve works and is idempotent + routes correctly → challan
  capture + manual entry saves → a visit's time-in-store derives sensibly and a too-short one flags.

## Order of work
1. Confirm last build shipped. §1 time-in-store (verify server timestamps first; derive + flag).
2. §2 challan capture + manual entry (schema STOP-POINT).
3. §3.1–3.4 review queue (security → perf/sections → freshness → approve fixes).
4. §3.5 push (schema STOP-POINT for tokens; FCM setup).
5. §4 docs → expo-doctor → one build.

Report after §1, at each schema STOP-POINT, after the review-queue rebuild (so it can be eyeballed
pre-push), and before cutting the build.
