# TankAssist — report data bug, plan fixes, and report drill-downs

**§1 leads: the "0 cases / 0 distance / 0 market time" cluster is almost certainly ONE root cause,
not three separate bugs — diagnose before building anything.** The rest (§2–§6) are fixes and new
report UI that mostly sit on data you already have.

Standing rules: verify live via MCP, `graphify query` before grep, `tsc` clean per item, complete
files, schema changes are STOP-POINTs, no service-role key, reuse over new code (ponytail),
Impeccable pass on every UI change, flag caveats up front. Confirm current build/OTA state before
starting; state at the end which parts are OTA vs build-gated.

---

## 1. DIAGNOSE FIRST — headline totals vs. per-visit rows disagree (and time/distance are 0)
Live evidence from the manager-side rep report (Bhagwan Singh, 21-09-2026):
- Header: **Cases sold 300 · Stores visited 6**
- Every individual visit row below: **"0 cases"**
- **Market time 0h 0m** and **Distance 0.0 km**

That pattern — totals populated, detail rows empty, time+distance both exactly zero — points at data
sources that have diverged, not three unrelated bugs. **Investigate these specific hypotheses before
writing any fix; report the root cause first:**

1. **The cases hybrid / cutover.** `casesSold`/`repCasesSold` switch between legacy visit
   `cases_sold` and order-derived cases at `ORDERS_CUTOVER_DATE` (`lib/reportSemantics.ts`) — which
   was left as a **placeholder date and may never have been set to the real go-live date**. If the
   header total and the per-visit rows read different sides of that hybrid, you get exactly this
   (300 total, 0 per visit). Check the live value, what each figure actually queries, and whether
   the per-visit "0 cases" is reading the legacy column while the header reads orders (or vice
   versa). `graphify` the report hooks rather than grepping.
2. **Auto-closed visits explain the zeros.** `auto_close_stale` (22:30 IST sweep) deliberately
   closes visits **without** writing `total_market_time_minutes` or `total_distance_km` — because it
   never observed a real checkout. If these visits were auto-closed (the rep never manually checked
   out), 0h 0m and 0.0 km are **correct behaviour, not a broken Maps call**. Check `auto_closed` on
   these rows before concluding the Directions API regressed.
3. **Only if 1 and 2 don't explain it:** check whether the punch-out Google Directions route
   calculation (check-in → store A → B → C → punch-out) is actually running and storing
   `total_distance_km`, including the Haversine fallback.

**Report the finding before fixing.** The fix differs completely: a wrong cutover date is a config
change; auto-closed nulls are expected behaviour that should be *labelled* in the report ("not
recorded — visit auto-closed") rather than shown as a misleading 0; a genuinely broken Directions
call is a third thing. Do not paper over any of these with a default-to-zero.

**If the zeros are legitimate (auto-closed), fix the presentation:** the report must distinguish
**"0" (measured, genuinely zero)** from **"not recorded"** (never observed). Showing an unobserved
value as 0.0 km is the misleading bit.

## 2. Rep dashboard — plan shows "Store" instead of real store names
"Today's plan / Awaiting approval" lists the planned stores as literal **"Store"** placeholders with
no names. The plan holds `store_id`s; the screen isn't resolving them to names. Fix the lookup/join
so planned stores show their actual names (and keep it cheap — the names are already fetched for the
store list; reuse rather than N+1 queries).

## 3. Plan my day — restore the 100km nearby scoping (owner decision: nearby default + All toggle)
The store list currently shows **all stores** ("All stores — search to narrow"), including other
states. The nearby scoping we built isn't applying — find out whether it's unwired, defaulting
wrong, or falling back because the rep isn't checked in.
- **Default = nearby ~100km** (by GPS if checked in, else the rep's assigned area — the existing
  rule), with an explicit **"All stores" toggle** the rep can flip.
- Search still reaches **any** store regardless of scope (already true — keep it).
- Label the current mode honestly so a short list never looks like a bug ("Nearby stores · tap All
  to see everything").

## 4. Rep report — add odometer distance as a visible figure
Add **odometer-derived distance** to the rep's own report (and the manager-side rep report) alongside
the existing GPS/Directions distance, so both methods are visible side by side. Daily = `odo_end −
odo_start`; weekly/monthly = sum of daily. Where a day has no odometer reading, show **"not
recorded"**, never 0. This is the figure that makes TA auditable, so label the two distances clearly
(e.g. "Route (GPS)" vs "Odometer") — never merge them into one ambiguous number.

## 5. Visit photos — tap to expand
In the manager/management-side rep report, visit photos are shown as thumbnails. Make them
**tappable to expand** to a full-screen viewer (pinch/zoom if cheap, at minimum a large view with
dismiss). No affordance hint needed — tapping an image is a natural gesture. Apply wherever visit
photos render in the report. Impeccable pass.

## 6. Report drill-downs — make the four stat tiles tappable (build in this order)
The four report stat tiles become tappable, each opening its own detail page. (Market time stays
non-tappable — it's self-explanatory.) **Build in the order below**; the odometer one is the highest
value because it's what makes TA claims verifiable.

1. **Odometer distance →** per-day list (date-sorted for weekly/monthly) showing that day's
   **check-in and check-out odometer readings WITH their photos**, so a manager can eyeball the
   number against the actual dial image and see what matches and what doesn't. This is the
   verification surface for travel allowance.
2. **Cases sold →** which stores bought what, **ranked by quantity (highest first)**, so a headline
   like "300 cases" is justifiable store-by-store. This is also the cross-check for §1 — if the
   header says 300 and this page sums to 0, the §1 root cause is confirmed in the UI.
3. **Distance →** the route breakdown from the stored Directions result: check-in point → Store A →
   Store B → … → check-out, with per-leg distances and a total. Use the data already computed at
   punch-out; don't re-call the Maps API per view (cost + latency). If a day has no stored route
   (auto-closed), say so rather than showing an empty page.
4. **Stores visited →** the visits for that period with their relevant detail and photos (reusing
   §5's tap-to-expand).

Keeping this detail behind drill-downs (rather than dumping it into the main report) also keeps the
report export from ballooning — noted as intentional.

## 7. Ship
After §1–§6 tsc-clean: update `CLAUDE.md`/`HANDOFF.md` (the §1 root cause + what was actually wrong,
odometer distance in reports, the drill-downs, plan scoping restored, `ORDERS_CUTOVER_DATE` state if
it was the culprit). Commit + push. `expo-doctor` if anything dependency-touching. **State clearly
which parts are OTA vs need a build** (this looks JS-only → OTA, flag if not).

On-device test: manager rep-report shows consistent cases (header matches drill-down), distance and
market time either real or honestly labelled "not recorded" → odometer distance visible with its
drill-down showing readings + photos → plan shows real store names → plan list defaults to nearby
with a working All toggle → visit photos expand on tap.

## Order of work
1. **§1 diagnose — report the root cause before any fix.** (Owner decision: diagnosis first.)
2. §1 fix (config / presentation / Directions — whichever the diagnosis says).
3. §2 plan store names, §3 nearby scoping (both likely small regressions).
4. §4 odometer distance figure.
5. §6 drill-downs in the stated order (odometer → cases → distance → stores), §5 photo expand.
6. §7 docs → ship.

Report after the §1 diagnosis (before fixing), and again before shipping.
