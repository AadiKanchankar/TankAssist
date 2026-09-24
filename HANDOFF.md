# HANDOFF.md

Session-state snapshot for the next Claude Code session. **Temporal** — records what is live, pending, and out of scope as of the date below. Durable architecture facts live in `CLAUDE.md`; plain-language status for the user is `PROJECT_STATUS.md`.

- **Snapshot date:** 2026-09-24 (builds/OTAs reconciled against `eas build:list` / `eas update:list`, data against the live DB via MCP — not against the previous copy of this file)
- **Supabase project:** `ldgunrxceogfrohjrlxz` (live MCP access; verify before assuming)
- **Repo:** `github.com/AadiKanchankar/TankAssist`. ⚠️ **Until 2026-09-23 `master` was 17 commits stale** (stuck at `9964b90`, the 1.1.0 build) while all work since 19 Aug lived on `feat/timeinstore-challan-review-push`. Both were fast-forwarded to `7d2085a` that day. **Before trusting any branch, check it against the newest EAS build's commit** — a stale branch plus a stale HANDOFF is how a whole session once got built on the wrong base.
- **Type state:** `npx tsc --noEmit` clean. `*.test.ts` files pass (`npx tsx <file>`). `expo-doctor` **18/18** after `npx expo install --fix` cleared patch drift on `expo`, `expo-file-system`, `expo-location`, `expo-sharing`, `expo-updates`.
- ⚠️ **`supabase-schema.sql` is STALE** (last regenerated 2026-08-19). Missing, verified 2026-09-23: `flag_resolutions`, `rep_warnings`, `store_visits.checkout_latitude/longitude/checkout_distance_meters`, `store_visits.closed_on_next_checkin`, the one-open-visit constraint, and `attendance.route`. **Query live via MCP; regenerate the file before relying on it.**

---

## What is actually live right now

### 2026-09-24 — perf emergency + auto-close/check-in/location batch (two OTAs, runtime 1.3.0)

**Perf — OTA `bb691221` (commit `5850cce`).** Measured from live edge logs first:
- Rep dashboard = **5 serial hops × ~650 ms ≈ 2.9 s** per load on Jio (the DB answers in ~5 ms; ~170 ms/hop is Mumbai→**Seoul** distance). Sales-manager and management dashboards had the same shape. All three now one `Promise.all` wave. Re-measured over the real network: 5 sequential reads **3783 ms → 1748 ms** (median of 5, from this machine; phones use HTTP/2 and should do better).
- **220 downloads of 21 photos in 24 h, avg 758 KB (~163 MB)** — re-signing minted new URLs every load. Signed URLs are now reused. *Verify in edge logs:* per-photo `GET /storage/v1/object/sign/...` counts should collapse.
- Session storage memory cache; 20 s read timeout (writes never); duplicate INITIAL_SESSION profile fetch removed; `casesSold` halves parallel; management pipeline uses row-free counts.
- The manager tester was on a **US VPN** (1.5–3.7 s/hop) — the network, not the app.

**Auto-close diagnosis:** the sweep ran every night (all `succeeded`) and its cutoff catches a 5 PM check-in. The real cause (Bhagwan, **23-09**, not 22-09): he logged in again ~17:00 and punch-in let him start a **second** day while the morning one was open; punch-out closed the new row (17:01–19:13) and the real day (10:08, Magpai 10:40) was left to the sweep with null figures.

**Migration `auto_close_three_cases_and_checkin_gates` (owner-approved, validated in a rolled-back transaction first):** sweep closes EVERY open row and computes the three cases via `auto_close_figures()` (straight-line distance; case 2 ends at the last *observed* moment, owner decision); `attendance_one_open_per_user`; `trg_store_visit_requires_checkin`. Cron unchanged (`select public.auto_close_stale()` @ `0 17 * * *`).

**Backfill (owner-approved, targeted by id, 2 rows):** `25ad2061…` 21-09 → 260 min, 18.03 km (straight-line route stored). `703423a2…` 23-09 morning → **406 min, distance left NULL** on purpose: that day's afternoon punch-out route (19.14 km, `directions`) already covers every store, so adding 10.75 km would double-count TA. Verified: 0 other auto-closed rows changed, 0 odometer values touched.

**Client — OTA `c0dd15ab` (commit `e7d36c0`):** punch-in refuses while a day is open; Stores/Report tabs greyed until check-in; odometer **photo required**, reading skippable (owner deferred to me); store check-in shows a fresh fix + accuracy + distance with Refresh before the visit is written; add-store has the blue dot + locate-me; stale fixes are said out loud; auto-closed figures labelled "estimated (auto-closed)".

**On-device pass for these two OTAs:**
1. Cold-start the rep dashboard on mobile data — should settle in roughly one round trip after the profile. Open a manager rep report twice; the second time photos should appear instantly (cached URLs).
2. Before punching in: Stores + Report tabs greyed, tap explains; challan disabled; Plan my day still works.
3. Punch in without an odometer photo → blocked; with photo but "Save photo without a reading" → allowed.
4. Try a second punch-in the same day (log out/in) → "You're already checked in".
5. Store check-in: the confirm screen shows accuracy + metres from the store; walk 50 m to the next shop → Refresh changes the position.
6. Add store: locate-me button re-centres the pin; blue dot visible.
7. Leave a day open overnight → next morning it reads market to the last store and "estimated (auto-closed)", odometer "not recorded".

**Known edge:** a rep who punches in *after* 22:30 has a day the sweep only closes the next night, and the one-open-day index then blocks the next morning's punch-in until 22:30. Rare; if it bites, close that row by hand or move the sweep's cutoff.

### 2026-09-23 — report data bug, plan fixes, report drill-downs — SHIPPED as OTA `4017d12b` (runtime 1.3.0, commit `6c44578`)

**§1 root cause (diagnosed live before any fix) — TWO causes, neither the cutover date nor Directions.** Rep report for Bhagwan Singh, 21-09: header *300 cases*, every visit row *0 cases*, *0h 0m*, *0.0 km*.
- **Cases:** the header used `repCasesSold()` (orders: 150+100 at Firewater L1, 50 at SCOATCHTAP office). The visit rows printed `store_visits.cases_sold` **raw** — the legacy counter the stepper stopped writing at the cutover, so it was 0 on every visit for every rep since July. `casesSold` now returns `byVisit` (+ `byStoreProduct`) and the rows read that. The CSV/PDF exports already did this correctly (`ordersByVisit`).
- **Time + distance:** he checked out of all 6 stores himself but **never punched out**; `auto_close_stale` closed the attendance day at 22:30 with the figures NULL (by design), and the screen summed NULL as 0. **6 of the last 10 attendance days were auto-closed**, so "not recorded" is the common case. Directions is fine: every punched-out day in 6 weeks has a stored distance.
- **`ORDERS_CUTOVER_DATE` is still the `2026-07-18` placeholder but is empirically harmless**: last legacy `cases_sold > 0` visit 11 Jul, first order 21 Jul, zero rows on the wrong side. Not changed.

**Built:** `lib/reportFigures.ts` (measured / pending / not-recorded, never a default 0; tested) · `hooks/useRepReport.ts` (one query the report AND its drill-downs share, so a drill-down always sums to its tile) · odometer distance tile beside "Route (GPS)" on both the manager and rep reports · `ReportDrilldown` screen (odometer readings + dial photos with the GPS mismatch flag, cases ranked by store with product lines, route stops, visits) · `PhotoViewer`/`PhotoStrip` tap-to-expand · plan store names embedded in the plan query · Plan-my-day nearby default from the **phone's own position** + an explicit All toggle.
- **§2/§3 had one data cause:** reps plan stores that are NOT assigned to them (live: 100% of planned stores), and plan BEFORE punching in. So names resolved from assignments always fell back to "Store", and the scoping rule (punch-in GPS, else assigned area) had no input for anyone → "All stores".
- **Route legs are now stored — STOP-POINT approved and applied** (migration `attendance_route_legs`): nullable `attendance.route jsonb` (`{v, source, points[], legs_km[]}`) + `attendance_route_is_object` check. Punch-out used to sum the Directions legs and discard them, and kept the punch-out position only with an end odometer; it now stores the whole route. Table-level grants + the existing "update own" policy cover it — **verified by impersonation**: rep writes own row (1), another user's (0), manager reads the legs back, a non-object is refused (23514). **Days punched out before this OTA have `route = NULL`** and show straight-line legs, labelled; days after show road legs. Auto-closed days never have one.
- **Monthly on screen no longer reads `monthly_ta_summary`** — that view `COALESCE`s NULL distance/time to 0 inside SQL. The view is untouched (the exports still use it).
- Not done: pinch-zoom (needs `react-native-gesture-handler` = native = build). CSV/PDF still print 0 for not-recorded days (exports untouched this batch).

### 2026-09-03b — odometer "unavailable" was EXTRACTION, not availability

Diagnosed before changing anything: **all 18 live Edge Function calls returned HTTP 200 in 0.5-1.9 s.** No key/billing/quota problem, no cold start, no timeout, and the client was reaching the function — so the brief's premise (the Vision call is not landing) was wrong. `"cloud read no digits"` was literally true; the bug was the digit extractor.

Fixed in BOTH copies (`lib/odometer.ts` and the Edge Function, now **v5**). A first attempt over-relaxed the decimal rule and regressed `123456` → `200120` from merged dial markings — caught by re-running the test images, tightened, re-verified. Now 2/4 exact with both remaining misses being **Vision's own digit errors** (`235911`, `44395`), not extraction.

⚠️ **Deliberately NOT built: the warm-up ping.** The latency data shows no cold-start problem, so it would burn Vision quota for no measured benefit. One retry was added for genuine field signal drops — insurance, not a fix for anything observed.

**Check-in page had no ScrollView at all**, so the odometer section below the fold was unreachable. Now scrollable.

### 2026-09-03 batch — add-store, queue triage, odometer crop, push PROVEN

- **§6 PUSH IS WORKING — and was never broken.** Live test: inserting a plan for a rep assigned to a token-holding manager produced `net._http_response` **200 `{"status":"ok"}`** from Expo (a real delivery ticket, not `DeviceNotRegistered`). The root cause of "push never fired" was that **all 5 plans were submitted by Aadi**, and the trigger excludes the submitter — at each submission no *other* active manager held a token. Pranoy's token predates his promotion to `management`; Aadi's registered 2 Sep. The build did fix it, but by making tokens register, not by fixing any bug. **Remaining acceptance: a real notification on a real closed phone.**
- **§3 odometer.** The crop was broken twice: decorative for two builds, then a padding fix multiplied the frame past 1.0 and clamped (zero horizontal crop) before downscaling 70%. Fixed; OCR is now non-blocking with the crop shown to the rep. Tenths-wheel guard added (`resolveOdometerReading`). ⚠️ **Accuracy is NOT solved** — 2/4 on the test images either way, and alignment is now the dominant variable.
- **§2 queue triage.** `flag_resolutions` + `rep_warnings`, 8/8 impersonation. Buttons not swipe (gesture-handler absent).
- **§1 add-store button** on the rep store list. **§4 version** reads `expo-constants` + shows the running bundle id.
- ⚠️ **`E:\TANK90\Odometer-Reading` holds ~180 real rep odometer photos** — the calibration set for a future YOLO/OpenCV region detector in front of the same `readOdometer()` interface. Not started.

### 2026-08-19 batch — time-in-store, challans, review queue, push (BUILT in 1.2.0)
All DB work is **applied to live** and impersonation-tested. Shipped in the 1.2.0 builds (19 + 25 Aug); push proven working 2026-09-03.

- **§1 time-in-store** — derived `no_work_recorded` flag only. The artifact-**span** design was rejected against live data (spans 0.00–0.54 min vs tap gaps up to 14 min) because the stepper flushes every artifact at check-out; see CLAUDE.md. 10 of 24 rep-closed visits would flag all-time, **1** inside the 7-day queue window.
- **§2 challans** — `challans` + `challan_items` + `challan-photos` bucket, 9/9 RLS checks passed. **No manager-facing screen yet.** Auto-OCR deliberately out of scope. No `updated_at`, so corrections leave no audit trail.
- **§3 review queue** — cross-manager leakage fixed (was 27 visits + 19 attendance rows leaked to a sales_manager owning 1 rep), 7 indexes, virtualized 3-section rebuild, 7-day plan freshness, and the approve fix. **Root cause of "broken approve" was NOT the silent-RLS-noop class** — it was `manages_rep` requiring `role='rep'`, which permanently stranded 3 plans authored via the tester role-switch.
- **§3.5 push** — `push_tokens` + `register_push_token` + `notify_plan_submitted` trigger via `pg_net` → Expo. 8/8 RLS checks passed. **Pre-build end-to-end test passed:** Expo returned HTTP 200 and parsed our payload, rejecting the deliberately fake token with `DeviceNotRegistered`. That validates trigger → Expo; it does **NOT** validate the FCM credential, which is only exercised once a real device token exists.

⚠️ **VERIFY ON LOAD — review-queue redesign is unvalidated at scale.** The 2026-08-25 redesign (newest-first, 3-day window, by-type/by-rep toggle, collapsible sections) is `tsc`-clean and logically sound, but live data at the time held **0 actionable plans, 2 visits in the flag window, 0 odometer days** across 5 reps. The by-rep grouping and collapse behaviour exist for the 20-rep case and have **never been seen under that load**. Treat "fast and scannable at 20 reps" as an open claim to check on a real device with real volume, not as done.

⚠️ **Never put the service-account key in the repo, the database, or Supabase Vault.** Vault holds zero secrets and the trigger reads none, by design.

### Builds and OTAs (from `eas build:list` / `eas update:list`, 2026-09-23)
| Build | Runtime | Commit | Notes |
|---|---|---|---|
| OTA `c0dd15ab` | 1.3.0 | `e7d36c0` | 2026-09-24. Check-in gate, one open day, fresh GPS, odometer photo required. |
| OTA `bb691221` | 1.3.0 | `5850cce` | 2026-09-24. Perf: parallel dashboards, stable photo URLs, session cache, read timeouts. |
| `e0051cb2` | 1.3.0 | `7d2085a` | 2026-09-19. Display name **TankAssist** + brand icon (native resources, hence a build). Same keystore → in-place upgrade. **Newest.** |
| `5ce7d335` | 1.3.0 | `f7696e3` | 2026-09-01. Cloud odometer OCR, dependency drift cleared. |
| `b519bfe3` / `6b19271e` | 1.2.0 | `3ae92d8` / `c57850c` | 25 / 19 Aug. `expo-notifications`/`expo-device` → runtime bump. |
| `865de176` / `9759e0f6` | 1.1.0 | `9964b90` / `c65f922` | 8 / 6 Aug. ML Kit → runtime bump. Superseded. |

Newest OTA on `preview` (runtime 1.3.0): **`4017d12b`** = `6c44578`, the 2026-09-23 report batch (JS-only). Before it: *"Odometer extraction fix…"* = `31dc279`. Reaches every install on a 1.3.0 build (`5ce7d335`, `e0051cb2`); anything older needs the newest APK.

Build history worth remembering: `048bd05` **ERRORED** (the redesign — missing `babel-preset-expo`, invalid `newArchEnabled`, duplicate `react`), fixed in `49584bf`, which built clean.

### Edge Function
`parse-excise-permit` is deployed at **version 4**, `verify_jwt: true`, files `index.ts` + `parsers.ts` + `classify.ts`. It runs on the caller's JWT — **no service-role key exists anywhere in this project.**

### Migrations applied (live, in order)
`…phase1_roles_softban_lockdown` · `phase3_products` · `phase4_orders_stock` · `add_users_is_tester` · `create_switch_tester_role` · `products_ops_columns_and_oos` · `create_location_requests` · `excise_company_facilities` · `excise_permits_table` · `excise_allocations_and_ledger` · `excise_approve_reject_rpcs` · `excise_permits_storage_bucket` · `guard_facility_license_change` · `excise_dup_guard_validity_multiline` · `approve_excise_permit_multiline_guards` · `stock_snapshot_categories` · `journey_plans_and_mock_location_flag` · `journey_plans_realtime` · **`attendance_odometer_readings`** · **`odometer_photos_bucket`** · **`order_item_server_side_pricing`** · **`stock_shelf_bucket_merge`** · **`auto_close_stale_visits`** · **`auto_close_stale_per_visit_day`** · … (19 Aug – 3 Sep: see `list_migrations`) … · **`attendance_route_legs`** (2026-09-23).

### 2026-08-08 batch — price hiding, shelf merge, auto-checkout (same build)

Folded into the SAME build as the odometer work — no separate build was cut.

1. **Price hidden from reps.** The rep product fetch no longer selects price columns, all price/value/total UI is gone from the order step, and the rep now sends **quantities only**. `trg_snapshot_order_item_price` fills price from the catalog and OVERWRITES the client. Verified live: a line claiming ₹1 stored ₹15000. *Limit:* all app users share the `authenticated` Postgres role and column privileges are per-role, so prices cannot be column-revoked for reps alone without putting management's read behind a definer view — not done, flagged.
2. **Floor + Display merged into Shelf.** New `shelf_cases`/`shelf_bottles`; merge is **forward only** — pre-merge rows keep floor/display and are summed on read by `shelfFigure()`, which returns `legacy: true` so Store Detail can say "Shelf figure combines the older separate floor and display counts". Nothing rewritten.
3. **Auto-checkout 22:30 IST** via pg_cron job `auto-close-stale`. ⚠️ **`cron.timezone` here is `GMT`**, so the expression is `'0 17 * * *'` (17:00 UTC = 22:30 IST) — `'30 22 * * *'` would fire at 04:00 IST and close legitimately-open evening visits. Each row closes at 22:30 IST **of its own check-in day**, so the backfill and the nightly run are one code path.

**Backfill result (run 2026-08-07):** 3 store_visits + 10 attendance days auto-closed; open sets went 3 → **0** and 10 → **0**. Closed at their own days' 22:30 IST (31 Jul, 4 Aug, 6 Aug), `duration_minutes` NULL, no invented positions.

⚠️ **THE APP CRASH IS STILL NOT ROOT-CAUSED.** Two theories were raised and BOTH are disproven:
- *Duplicate Realtime topic* — `RealtimeClient.channel()` dedupes and returns the existing channel, so it never throws. Real defect (unmount kills the sibling's subscription) but not a crash.
- *useProducts throwing under Suspense* — `suspense` appears nowhere in the codebase and the QueryClient sets no suspense option; React Query v5 surfaces errors via `isError` and never throws to a boundary. This mechanism does not exist here.

Supabase api/realtime logs were empty for the window, so there is no server-side trace. `components/ErrorBoundary.tsx` now wraps the navigation tree: a render error shows a readable, selectable stack instead of unmounting to nothing. **That is a net, not a fix** — the next occurrence is diagnosable in one message. The outstanding input needed is the actual repro: at launch or on a specific screen/tap, and in which role.

### 2026-08-06 batch — rep bug fixes + odometer OCR (ONE new EAS build)

**This batch is build-gated, not OTA.** ML Kit is a new native module, and `app.json` `version` moved **1.0.0 → 1.1.0** so `runtimeVersion` changes with it — otherwise a later `eas update` could push ML Kit-dependent JS onto the old `ef195f8` binary and white-screen it at import.

Root causes differed from what the task file guessed on all three reported bugs:
1. **Plan-review "crash"** — NOT the null manager, and (established 2026-08-08) **not actually a crash**. `usePlanSubmissions` hardcoded the Realtime topic and mounts in two places at once (Team stays mounted under the pushed queue), but `RealtimeClient.channel()` dedupes, so the second subscribe never throws — the real defect is that the queue's unmount `removeChannel`s the shared instance and silently kills Team's subscription. Fixed with `journey-plans-${useId()}`. Two further real bugs found alongside: plan approval **silently no-opped** when RLS matched 0 rows (now `.select()` + honest error), and a rep with no `assigned_manager_id` is invisible to every SM (now stated on the card).
2. **Check-in from store search did nothing** — NOT a nav-param regression. The dashboard `ScrollView` lacked `keyboardShouldPersistTaps`, so the keyboard-dismiss gesture ate the tap. Pre-existing, unrelated to the plan work. Same fix applied to the dev component gallery.
3. **Store Detail chips collided** — `breakdownChip` styled a `Text` with background+padding; RN draws that box from the line box, so `Type.caption`'s lineHeight overflowed and wrapped chips overlapped. Now a `View` wrapper + inner `Text` (the pattern `products.tsx:603` already used).

Also: voice language fallback (3-state diagnosis), resume-abandoned-visit (server row + encrypted draft), plan scoping/virtualization, and the shared `AddStoreModal` — extracted from the dashboard so adding a store **from a plan** cannot bypass the dedup check.

⚠️ **Data-loss incident, 2026-08-06.** While impersonation-testing the new odometer columns I deleted a test attendance row with the predicate `user_id = <rep> AND check_out_time IS NULL`. That rep (`8af7df7f…` Hardikk Kkkiij) **also had a pre-existing open attendance row**, which the predicate caught — one real row destroyed. It had never been punched out, so it carried no `total_distance_km`/`total_market_time_minutes` and contributed nothing to TA figures or `monthly_ta_summary`; nothing references `attendance` by FK, so the loss is contained to that row. Recoverable from Supabase Dashboard → Database → Backups if wanted. **Lesson applied: cleanup deletes must target the captured inserted id, never a broad predicate.** Every other cleanup this session used a distinctive sentinel (`plan_date='2098-01-01'`, `floor_cases is not null`).

### 2026-08-04 batch — PJP, stock categories, terminology, warehouse balance
1. **Warehouse balance read 0 with 50 cases in — fixed.** Confirmed live: the single ledger row has **both facility ids null** (approved before `company_facilities` had rows) and the facility registry is still empty, so the old balance test scored it zero twice over. `computeAnalytics` now treats **direction as the source of truth**; unattributed rows bucket under `UNATTRIBUTED_FACILITY`. No UI change needed — the dashboard already renders `facilityName`.
2. **Stock categories** — `store_stock_snapshots` gained `floor_*`/`display_*`/`godown_*`. `cases`/`bottles` stay the authoritative TOTAL, so every existing reader was untouched. Legacy rows keep a total with null buckets and render "Breakdown not recorded" — **the old value was NOT mapped to `display`**, because we don't know the split and guessing into an append-only table is worse than admitting ignorance.
3. **"Free" → "scheme"** — UI-only, 3 strings. Columns deliberately unrenamed (see CLAUDE.md).
4. **PJP + anti-cheat** — `journey_plans`, `journey_plan_stores`, `manages_rep()`, `store_visits.is_mock_location`, `app/(rep)/journey-plan.tsx`, `app/(admin)/exceptions.tsx`, `hooks/useJourneyPlans.ts`, `lib/journeyPlan.ts`.

**Impersonation matrix run 2026-08-04, 17/17 as expected.** The two that matter: a rep updating their own plan to `status='approved'` → **DENIED 42501**, and a rep writing the manager-review fields → **DENIED 42501**. Both are hard `WITH CHECK` raises, not silent no-ops. Approved plans are frozen (0 rows) for reps *and* managers; `delete` on `journey_plans` fails at the grant layer. Test data cleaned up and the temporarily-elevated tester role restored to `rep` — verified.

---

## ⚠️ MUST REMOVE BEFORE PRODUCTION

**Tester role-switch** — a standing self-elevation path to `management`. `users.is_tester` + `public.switch_tester_role(text)`; UI in `app/(shared)/profile.tsx` + `components/TesterBadge.tsx`. Verified live: gated on `is_tester AND is_active`, self-only, role-only, never touches `is_active`, validates against the three real roles.

Currently flagged (verified live, with their **current** roles — these change as they test):

| id | name | phone | role now |
|---|---|---|---|
| `6afd4118-8a62-40c3-8451-cf1c6f6181f2` | Aadi Kanchankar | +918080234657 | `rep` |
| `8f8a2a7a-3870-487a-bd0f-024674b82c19` | Pranoy Bhattacharyya | +916291313585 | `management` |

**Undo the mechanism (one migration):**
```sql
drop function if exists public.switch_tester_role(text);
alter table public.users drop column if exists is_tester;
```
Also remove the app-side switcher (`profile.tsx`) and `TesterBadge` in the same change, or the UI will call a function that no longer exists.

**Undo the test data** — real rows these accounts created while testing. ⚠️ Removes ALL data attributed to them; review first. Run in the SQL editor / as service role (RLS-free), in this FK-safe order. Note this list is now **incomplete** for the newer tables — also consider `location_requests` (`requested_by`/`rep_id`) and, if a tester uploaded permits, `excise_permits` (`uploaded_by`) → `permit_product_allocations` → `inventory_movements` (`source_permit_id`), **in that child-first order**, plus the corresponding objects in the `excise-permits` bucket.
```sql
delete from public.store_visit_photos    where user_id     in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
delete from public.store_stock_snapshots where recorded_by in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
delete from public.order_status_history  where order_id in (select id from public.orders where placed_by in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19'));
delete from public.order_items           where order_id in (select id from public.orders where placed_by in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19'));
delete from public.orders                where placed_by  in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
delete from public.store_visits          where user_id     in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
delete from public.attendance            where user_id     in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
delete from public.daily_reports         where user_id     in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
delete from public.store_assignments     where user_id     in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
-- products created while testing as management (archive-only in-app; delete here only if unreferenced by order_items):
-- delete from public.products where created_by in ('6afd4118-8a62-40c3-8451-cf1c6f6181f2','8f8a2a7a-3870-487a-bd0f-024674b82c19');
```

---

## Standing data blockers

Both are **owner-supplied data**, not code. The pipeline was deliberately built to work without them — nothing is blocked from being built, but the excise feature cannot produce a correct ledger entry until they are filled.

**1. Facility licence numbers — `company_facilities` has 0 rows.**
Consequence: `classifyMovement` can never match a licence, so **every permit lands `movement_direction = 'unclassified'`**, and `approve_excise_permit` refuses to approve an unclassified permit. So today no permit can reach the ledger without a human setting the direction by hand. Fix = add the real factory/warehouse rows in `app/(admin)/facilities.tsx`. Remember the licence-lock trigger: get the number right, because it locks once a permit references it.

**2. Product `unit_size` + `unit_of_measure` — partially filled.** Live state:

| product | unit (legacy text) | unit_size | unit_of_measure | qty_per_carton | usable for BL math? |
|---|---|---|---|---|---|
| Tank 90 select | 330 ml | 330 | `ml` | 24 | ✅ |
| Tank 90 z | Bottle | 330 | **null** | 24 | ❌ — no UOM, bottles can't be computed |
| Tank x | 500 ml | 500 | `ml` | 20 | ✅ (currently `is_out_of_stock = true`) |

Consequence: an allocation against **Tank 90 z** comes back with `computed_* = null` and `needs_review = true`, and approval is refused until a human enters the case count. Fix = set `unit_of_measure` in the Products wizard (step 2).

**Also note: there are 3 active products, so Edge-Function auto-allocation is DORMANT BY DESIGN.** It only fires when there is **exactly one** active product; with several, a BL total could genuinely map to more than one SKU and only a human can say which, so every permit goes to manual allocation. **This is correct behaviour, not a bug — do not "fix" it by spreading a total across products.** The branch in `index.ts` carries a comment saying so at the call site.

---

## Known defects / loose ends

- **Rejected duplicates leave an orphan file — WON'T FIX, by decision (owner-approved 2026-08-04).** The client uploads before the Edge Function runs, so a duplicate that gets turned away leaves a file in `excise-permits` with no permit row pointing at it. The obvious fix (a DELETE storage policy so the function can tidy up) was **rejected**: permit originals are audit evidence, and every other evidence path in this design is already immutable (`inventory_movements` has no write policy, `order_status_history` is read-only, products are archive-only, the licence-lock trigger refuses to rewrite a referenced licence). Putting a delete path on the evidence store to reclaim a few kilobytes on a rare path is a bad trade. A narrower policy scoped to unreferenced objects (`not exists (select 1 from excise_permits where original_file_path = name)`) was also considered and rejected — correlated subquery on every delete, a retained failure path, and a small race where a file uploaded just before its permit row is inserted is momentarily deletable. **The Edge Function no longer attempts the delete** (v5); the bucket keeps SELECT + INSERT only. Orphans are still clearable by a human from the Supabase dashboard under service-role, which keeps deletion of evidence a deliberate out-of-band act.
- **Pre-existing duplicate permits in live data.** `PN263160173328` has **1 approved + 2 pending** copies. The new guard prevents more but does not clean these up — reject the two pending ones from the review queue.
- **Multi-row permits are unverified against a real document.** The parser emits N lines and the approve RPC + UI balance each line, but the only real sample (`PN263160173328`) is single-row; multi-row is covered by a synthetic fixture only. Check the first real multi-row permit carefully.
- **Item 6 (OCR) was explicitly not built.** Image/scanned permits land as `permit_number='UNREAD'` for manual entry. Edge runtime can't host OCR; any future attempt means an external service = **new-secret STOP POINT**.
- **`ORDERS_CUTOVER_DATE`** (`lib/reportSemantics.ts`) — still the open go-live decision below.
- **Mock-location flag is ANDROID ONLY.** `expo-location` fills `mocked` from `Location.isFromMockProvider()` in its native Android module; iOS has no equivalent, so every iOS visit records `is_mock_location = false` and a spoofed iOS device would not be flagged. Fine today (the fleet is Android APKs), but if iOS ever ships, the exception queue silently under-reports. Verified OTA-safe for the current fleet: `expo-location` is `~56.0.22` in **both** the installed `ef195f8` build and the working tree, and that version's native code populates the field — the flag genuinely fires without a rebuild.
- **Unattributed ledger row needs a backfill once facilities exist.** The balance now reads a correct 50 cases labelled "Unattributed (no facility on permit)". After the real warehouse row is added to `company_facilities`, attribute it — **not run, deliberate**:
  ```sql
  update public.inventory_movements
     set facility_to_id = '<warehouse-uuid>'
   where direction = 'factory_to_warehouse' and facility_to_id is null;
  ```
- **PJP plan-date resolution is local-date, not a shift window.** A visit logged after local midnight resolves to the neighbouring day's plan and can read as off-plan. Handled by wording (the flag is `soft` and says "may belong to the neighbouring day's plan… Worth confirming") rather than silently mis-accusing an honest rep. Upgrade path if reps genuinely work past midnight: explicit `shift_start`/`shift_end` on `journey_plans`.

---

## Pending on-device tests

Everything below is installed and OTA-current on the `ef195f8` build; none of it has been walked on hardware by me.
1. **OTP enrollment** end-to-end → log in on another device → deactivate → confirm lockout at next refresh; orphan path ("Retry Save"); manager's session stays put.
2. **Two-device one-login** eviction (rep) + SecureStore session migration.
3. **Check-in stepper** — camera/GPS, prior-order deliver/cancel, stock prefill + touched recording + required stock photo, order placement, checkout writes.
4. **Orders lifecycle** — placed→…→delivered-override(reason); cancel(reason); timeline; delivered photos; pipeline deep-links.
5. **Voice** — permission + no-audio notice; EN/HI/MR persists; partials editable; two fields don't cross-transcribe.
6. **CSV and PDF** — filenames exact; cases match the hybrid; visit-heavy month paginates without clipping.
7. **Out-of-stock** — an OOS product is blocked in the picker **and** the `trg_reject_oos_order_item` trigger rejects a stale client.
8. **Live location** — manager asks → checked-in rep answers; 18 s timeout falls back to last known; a checked-out rep never responds; a sales_manager cannot request a rep who isn't theirs.
9. **Excise** — upload PDF → parse → review → allocate → approve → ledger row; duplicate upload routes to the existing permit; "View original document" opens (this was the `lib/storage.ts` bucket bug).
10. **Tester switch** — flip rep/sales_manager/management, land on the right dashboard, badge persists, full write rights in each role.
11. **Stock buckets** — floor/display/godown captured; a blank godown stays blank on the next visit's prefill (must NOT come back as 0); total rolls loose bottles into cases; StoreDetail shows chips, and the 6 legacy rows show "Breakdown not recorded".
12. **PJP** — rep submits a plan → manager sees it live (Realtime, no pull) → approve / send-back-with-reason → rep edits and resubmits; an approved plan is locked in the rep UI.
13. **Anti-cheat queue** — check in >300 m from a store, then off-plan, and confirm both appear in Team → Review queue with readable reasons. **Mock location needs a real mock-location app on an Android device to exercise** — it is the one flag that cannot be verified from the simulator or by inspection.
14. **Store de-dup** — try to add a store ~30 m from an existing one, and separately with a transposed name ("Sruaj" vs "Suraj"); confirm both offer the existing store and that "No — this is a new store" still creates one.

### On-device pass for the 1.1.0 build — run these in ONE session, in order
**0. CRASH FIRST, before anything else.** (a) Walk the exact path that crashed on the previous build and confirm it no longer does — tsc-clean never proves a crash gone. (b) Prove the ErrorBoundary actually catches and renders rather than white-screening: turn off the network, open the order step, and confirm you get the readable error screen with a stack, not a blank app. Only then move on to OCR.

1. **PJP end-to-end** — submit a plan → manager sees it live (Realtime, no pull) → approve / send-back-with-reason → rep edits and resubmits. **Open the review queue from Team while Team is still mounted** — that is the exact path that used to crash.
2. **Mock location** — needs a SECOND Android device with a mock-location app. The only item that cannot be checked any other way.
3. **Resume visit** — check in, type stock + notes, kill the app, reopen: banner appears, resume restores the typed numbers and step. Check out, confirm the banner clears.
4. **§1 / §3** — tap a searched store on the dashboard (must open the stepper), and view Store Detail stock on "Tank 90 z" (chips on their own row, no bleed).
5. **Voice** — switch to HI/MR on a phone without the pack; confirm the actionable banner, the Download button on Android 13+, and that typing still works.
6. **Plan scoping** — checked-in vs not; confirm the scope label, that search reaches an out-of-area store, and that the empty state's "Add a new store" goes through the dedup prompt.
7. **Odometer** — capture at punch-in and punch-out; confirm OCR pre-fill on a real dashboard (the guided frame is unproven on a real motorcycle), that a below-start reading is refused, and that skipping still lets you punch out. Then check the TA section of the review queue.

---

## Manual dashboard actions (user, in Supabase)
1. **SMS OTP expiry** (Authentication → Providers → Phone) must exceed the employee→manager relay window — **300–600 s**.
2. Confirm the **live Twilio provider** and **remove any Test OTP numbers** before go-live.
3. Shorten access-token (JWT) expiry to **10–15 min** (bounds one-login eviction + deactivation lag).
4. Confirm Auth rate limits at defaults.

## Orders go-live checklist (coordinated cutover)
- **Same-day build install for ALL reps** (a staggered rollout splits one rep's day across legacy `cases_sold` and orders).
- **`ORDERS_CUTOVER_DATE`** (`lib/reportSemantics.ts`) is still the **`2026-07-18` placeholder** — verified harmless 2026-09-23 (last legacy `cases_sold > 0` = 11 Jul, first order = 21 Jul; any date 12–21 Jul gives identical figures). Only revisit if legacy rows are ever back-filled. Days `>= cutover` count order cases (excl. cancelled); days `<` count legacy visit `cases_sold`; never both.

## Deferred / out of scope (do not start without a go-ahead)
- **Instant-kill deactivation via a service-role Edge Function** — deliberately not built; keeps the anon-key-only architecture. Soft-ban + short JWT TTL is the mechanism. New-secret STOP POINT.
- **`get_user_names(ids[])` RPC** — would let reps see teammate names on "last recorded by". Not built.
- **Geo-fence enforcement** — no schema/logic. Contract if taken up: flag + reason, never block; no network in the fence check; reuse `distance_from_store_meters`; start at audit → schema STOP POINT.
- **Offline queue + Python batch-sync backend** — not started.
- **Redis / any non-Supabase infra** — explicitly ruled out; staying Supabase-anon-key-only.

## Hard guardrails (carry forward)
1. Verify live via MCP before writing code that assumes DB structure — every time.
2. Every schema change is a STOP-POINT SQL block: confirm → apply → verify live → impersonation-test → then app code. **After any CREATE TABLE/VIEW: `GRANT` to `authenticated` explicitly and verify by role impersonation** — MCP-created objects get zero API-role grants, and the failure looks like a bare permission error rather than a clean RLS denial (42501).
3. Every new secret is a STOP POINT. No service-role key in the app.
4. Complete files only; `npx tsc --noEmit` after each change.
5. STOP and report after each numbered phase; do not self-continue.

## Data hygiene — RESOLVED 2026-08-07
The previously-flagged stuck-open rows were closed by the approved `auto_close_stale()` path: **3 store_visits + 10 attendance days**, each at 22:30 IST of its own day. Open sets are now 0 and 0, and the nightly cron prevents recurrence. They are marked `auto_closed` and appear as soft flags in the exception queue.

## Next actionable step
**On-device pass for the 2026-09-23 OTA** (manager login + a rep login): (1) Team → Bhagwan Singh → Report, 21-09: header **300** = Cases drill-down total (250 Firewater L1 + 50 SCOATCHTAP), visit rows 250/50/0; Route, Odometer and Market time read **"—  Not recorded"**, not 0. (2) Odometer drill-down on a day with readings: numbers beside dial photos, tap → full screen, swipe start↔end. (3) Route drill-down on 21-09 says auto-closed, not an empty page; **punch out once after installing the OTA** and that day's route shows legs "by road". (4) Visit photos expand on tap; Android back closes. (5) Rep dashboard plan shows real store names. (6) Plan my day **before punching in** defaults to *Nearby* (location granted), All toggle works, search still reaches everything.

Fill the two data blockers (facility rows; `unit_of_measure` on *Tank 90 z*), then walk the excise happy path on device — that is the only part of the pipeline never exercised end-to-end with real data. Adding the facility rows also unblocks the inventory-movement backfill noted above.

Then walk PJP end-to-end on hardware (items 11–14). Only the mock-location flag strictly needs a second device with a mock-location app; everything else is exercisable on one phone plus a manager login.
