# TankAssist — push fix, per-product dashboards, checkout flow, cloud OCR, review-queue redesign

Priority order matters: **§0 (push notifications broken) is a diagnosis-first bug and comes before
any new building.** Then the four feature items. Standing rules: verify schema live via MCP,
`graphify query` before grep, `tsc` clean per item, complete files, schema changes are STOP-POINTs,
no service-role key, reuse over new code (ponytail), Impeccable pass on every UI change, flag
caveats up front. This batch adds cloud OCR (Edge Function) + more push work — confirm what's on the
current installed build vs. pending, so we know what's OTA vs. needs the build.

---

## 0. Push notifications still don't fire — DIAGNOSE before building anything else

All Firebase/Vault/pg_net setup is done on the owner's side and notifications still don't arrive.
**Do not add more push code until you've traced where the chain breaks and reported it.** The chain
fails silently at each link; walk it in order and report the actual failure point:

1. Is `pg_net` enabled and is the trigger actually **firing** on plan-submit insert? (check it's
   attached and not erroring — inspect trigger + any exception).
2. What does **`net._http_response`** log for the FCM call — 200, or 401/403 (bad credential /
   wrong IAM), or 404 (wrong endpoint/project)? This is the single most useful signal; read it.
3. Is the **Vault secret** name/format the trigger reads *exactly* what the owner stored? A
   name/case/format (raw JSON vs base64) mismatch is the most common silent failure — verify
   verbatim, don't assume.
4. Does the service account have the right **FCM send permission** (v1 API), and is the project ID
   the trigger uses correct?
5. Is a **device push token** actually registered for the test user, and is it valid? If the
   installed build predates `expo-notifications`, the token never registered — which means push
   can't work until the new build lands regardless of server setup. State clearly if this is the
   case (it may be the whole answer).
6. Is notification **permission granted** on the test device?

Report which link is broken with the evidence (the `net._http_response` row especially). Fix the
identified cause. If the root cause is "needs the native build to register tokens," say so plainly
so we stop chasing server config — the build then becomes the fix.

---

## 1. Per-product management dashboards

Today the app implicitly assumes one product; make the management dashboard **product-scoped**.
- A product selector; the top-right label (currently "Tank 90") shows the **selected product's
  name** and switches the whole dashboard's data to that product.
- Every dashboard metric re-scopes to the selected product: inventory (factory→wh, wh→L1, balance),
  cases trend, top stores, etc. **Verify per-metric that the data can actually be split by product**
  — orders/stock are per-product, but confirm the `casesSold` hybrid and the excise/challan
  inventory ledger can filter by product. If a specific metric can't be product-split yet, that tile
  must say so honestly rather than show a whole-company number mislabelled as one product's.
- **Skeleton on switch:** show the dashboard skeleton (reuse the existing skeletons) while the newly
  selected product's data loads — no spinner, no stale numbers flashing as the wrong product's.
- **Quick-switch interaction (the Instagram-style idea):** a fast switcher — long-press the product
  label (or a bottom-sheet on tap) to change product without deep navigation. Keep it simple and
  discoverable; `ponytail:` don't over-engineer the gesture — a tap-to-open switcher is the floor,
  long-press is a nice-to-have.

## 2. Rep checkout flow — check-in-first, guarded checkout, one-store-at-a-time

Principle: **check-in and required info are reported immediately on entering the store**; posters/
marketing/other tasks come after. Restructure so the required capture happens up front, and checkout
is a deliberate, location-verified exit.

- **2a — order of work:** the stepper/flow makes check-in + required info (the mandatory capture)
  come first; optional work (poster placement, marketing) after. Don't add friction — just sequence.
- **2b — "are you still in the store?" interstitial:** before the final checkout, a page asking
  "Are you still in the store?" with a checkbox. If checked (still there), the checkout button
  returns them to the dashboard with all info already filled, and the visit stays open for a
  deliberate later checkout. This lets a rep finish data entry without being forced to checkout while
  still working.
- **2c — persistent checkout card on the dashboard:** while a visit is open, the dashboard shows a
  small, low-height bar/card (matching the design system) under the work-hours/stores-travelled
  area, showing the open store name + a **red "Check out" button** for that store.
- **2d — location-guarded checkout (flag-don't-block):** when checkout is tapped, check proximity
  between current location and the store's known/check-in location. If **>100m**: tell the user the
  checkout will be **flagged**, then still allow it (flag into the existing exception queue). If
  **≤100m**: direct checkout; the dashboard checkout card highlights **green**, then fades out
  entirely. `ponytail:` this 100m check and the time-in-store work-artifact-span flag are two
  separate signals into the same queue — make sure one visit isn't double-penalized/double-counted;
  they should read as distinct reasons.
- **2e — one open visit at a time (hard rule, honest edge handling):** a rep **cannot** check into a
  second store while a visit is open — you can't be in two shops at once. But don't strand an honest
  rep who forgot to check out of shop A before reaching shop B: block the second check-in and show
  "You're still checked in at [Shop A] — check out there first?" with a one-tap route to close A.
  The rule holds; the honest forgot-to-checkout case has a way forward. Do NOT try to special-case
  side-by-side shops with GPS (can't distinguish them reliably) — the one-open-visit rule covers it.

## 3. Odometer OCR — move to cloud, keep on-device as offline fallback

On-device ML Kit isn't accurate enough on real dashboards (the phase-2 wall we anticipated). Owner
decision: **cloud vision now, on-device as offline fallback.**
- **Primary = cloud vision OCR via an Edge Function.** Send only the **cropped odometer image** to a
  cloud vision API (GCP Cloud Vision or AWS Textract — recommend one and say why; both read
  7-segment digits far better than ML Kit, ~₹0.10–0.15/image, twice/day/rep = negligible cost).
  Supabase stays the DB; the Edge Function forwards the crop and returns the reading. Owner will
  supply the cloud API credential — store it server-side (Edge Function env / Vault), **never in the
  app**. Tell the owner exactly which credential + where.
- **Reuse the existing swappable `readOdometer()` interface** — this is the exact engine swap it was
  built for. Cloud becomes the primary implementation.
- **On-device ML Kit = offline fallback:** if there's no connectivity (or the cloud call fails),
  fall back to the on-device read so a rep in a dead-signal spot still gets *a* reading, clearly
  marked lower-confidence. Keep the guided-crop capture either way.
- Keep the not-below-start + plausible-length validation and the odometer-vs-GPS mismatch flag
  (generous, tunable). Human can always correct the number — OCR assists, never blindly trusted.
- **Report the accuracy expectation honestly** after wiring cloud: if it's now reliable, good; if
  still marginal on real dashboards, say so rather than declaring it fixed.

## 4. Review queue — full UX redesign (both grouping views, newest-first, ≤3 days)

Current queue is bad UX: too much scrolling, oldest-on-top, chaotic at 20 reps. Redesign properly
using real UX principles (chunking, Common Region, Von Restorff, Hick's) — not a reskin.
- **Newest-first stack** — recent items on top (current oldest-on-top is backwards).
- **≤3 days only** in the actionable queue (tightened from 7) — a plan older than 3 days is
  pointless to approve; keep older ones in history, out of the actionable list.
- **Two grouping views with a toggle (owner decision):** group **by rep** (collapsible per-rep
  sections) OR **by flag type** (Odometer / Location / Day plans) — a toggle switches between them.
  Both must be scannable: a manager with 20 reps triages a handful of flagged items without endless
  scroll. Collapse/expand, and a **summary header** (counts per group / total needing action) so the
  eye lands on what needs attention first (Von Restorff for the urgent, chunking for the groups).
- **Performance:** virtualize/paginate; scope queries to the actionable window; `graphify` the queue
  hooks first. Carry forward the earlier fixes (per-user read state via `notification_reads`,
  `.select()` on mutations so approvals can't silently no-op, idempotent "approved by [name]" +
  hidden button, designated-manager-or-all routing).
- Impeccable pass on the whole rebuilt screen; this is the flagship of this batch UX-wise.

## 5. Ship
After §0–§4 are `tsc`-clean and STOP-POINTs confirmed (any product-scope schema, cloud-OCR Edge
Function + credential, review-queue changes):
- Update `CLAUDE.md` + `HANDOFF.md`: push root-cause + fix, per-product dashboards, checkout flow +
  one-open-visit rule, cloud OCR engine (+ offline fallback), review-queue redesign.
- Commit + push. `expo-doctor` preflight. Cut **one** EAS build if any native change is present
  (push token registration needs the build if it wasn't already installed); otherwise OTA the
  JS-only parts. State clearly which parts are OTA vs build-gated.
- On-device test: **push arrives with app closed** (the §0 fix, verified for real) → per-product
  switch + skeleton → checkout flow incl. >100m flag and one-open-visit block → cloud odometer read
  accuracy on a real dashboard → review queue both views, newest-first, ≤3 days, fast at scale.

## Order of work
1. §0 push diagnosis — report the broken link before touching anything else.
2. §4 review queue redesign (highest daily-pain UX win) — report for eyeball before push.
3. §2 checkout flow (STOP-POINT if visit/schema changes).
4. §1 per-product dashboards (verify per-metric product split).
5. §3 cloud OCR (Edge Function + credential; STOP-POINT).
6. §5 docs → expo-doctor → build/OTA split.

Report after §0 diagnosis, at each schema STOP-POINT, after the review-queue rebuild, and before
cutting the build.
