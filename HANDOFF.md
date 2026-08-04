# HANDOFF.md

Session-state snapshot for the next Claude Code session. **Temporal** — records what is live, pending, and out of scope as of the date below. Durable architecture facts live in `CLAUDE.md`; plain-language status for the user is `PROJECT_STATUS.md`.

- **Snapshot date:** 2026-08-04 (reconciled against the live DB via MCP, EAS, and git — not against the previous copy of this file)
- **Supabase project:** `ldgunrxceogfrohjrlxz` (live MCP access; verify before assuming)
- **Repo:** `master`, pushed to `github.com/AadiKanchankar/TankAssist`. HEAD = the PJP + stock-category batch below.
- **Type state:** `npx tsc --noEmit` clean. All 5 `*.test.ts` files pass (`npx tsx <file>`).
- **`supabase-schema.sql` is CURRENT** — regenerated from live 2026-08-04 after this batch, and `graphify update .` re-run, so the graph resolves `public.journey_plans`, `public.journey_plan_stores` and `public.manages_rep()`. Verified against live: 4/4 + 3/3 policies, 6/6 bucket columns, 2/2 realtime tables.

---

## What is actually live right now

### Installed build
The newest **FINISHED** Android build is at commit **`ef195f8`** (2026-07-28), profile `preview`, channel `preview`, `runtimeVersion 1.0.0`. It contains all native modules currently in use, so **everything since then has shipped over-the-air** and no build is outstanding.

Build history worth remembering: `048bd05` **ERRORED** (the redesign — missing `babel-preset-expo`, invalid `newArchEnabled`, duplicate `react`), fixed in `49584bf`, which built clean.

### Shipped OTA on top of that build (branch `preview`, runtime `1.0.0`)
Newest first — all JS-only:
1. `40ba5978…` — Excise fixes: permit URLs, duplicate guard, multi-line allocation, expiry-aware facility matching (**= HEAD `e8264e6`**)
2. `0b902736…` — Excise parser calibrated to the real Haryana L-32
3. `4bd6f59c…` — Excise permits: schema + facilities admin screen
4. `4eef8f50…` — Tester role-switch + ops updates (OOS, product wizard, dashboard date, cases trend, live location)

### Edge Function
`parse-excise-permit` is deployed at **version 4**, `verify_jwt: true`, files `index.ts` + `parsers.ts` + `classify.ts`. It runs on the caller's JWT — **no service-role key exists anywhere in this project.**

### Migrations applied (live, in order)
`…phase1_roles_softban_lockdown` · `phase3_products` · `phase4_orders_stock` · `add_users_is_tester` · `create_switch_tester_role` · `products_ops_columns_and_oos` · `create_location_requests` · `excise_company_facilities` · `excise_permits_table` · `excise_allocations_and_ledger` · `excise_approve_reject_rpcs` · `excise_permits_storage_bucket` · `guard_facility_license_change` · `excise_dup_guard_validity_multiline` · `approve_excise_permit_multiline_guards` · **`stock_snapshot_categories`** · **`journey_plans_and_mock_location_flag`** · **`journey_plans_realtime`**.

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

---

## Manual dashboard actions (user, in Supabase)
1. **SMS OTP expiry** (Authentication → Providers → Phone) must exceed the employee→manager relay window — **300–600 s**.
2. Confirm the **live Twilio provider** and **remove any Test OTP numbers** before go-live.
3. Shorten access-token (JWT) expiry to **10–15 min** (bounds one-login eviction + deactivation lag).
4. Confirm Auth rate limits at defaults.

## Orders go-live checklist (coordinated cutover)
- **Same-day build install for ALL reps** (a staggered rollout splits one rep's day across legacy `cases_sold` and orders).
- **Set `ORDERS_CUTOVER_DATE`** (`lib/reportSemantics.ts`) to that install date — currently a **`2026-07-18` placeholder**. Days `>= cutover` count order cases (excl. cancelled); days `<` count legacy visit `cases_sold`; never both.

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

## Next actionable step
Fill the two data blockers (facility rows; `unit_of_measure` on *Tank 90 z*), then walk the excise happy path on device — that is the only part of the pipeline never exercised end-to-end with real data. Adding the facility rows also unblocks the inventory-movement backfill noted above.

Then walk PJP end-to-end on hardware (items 11–14). Only the mock-location flag strictly needs a second device with a mock-location app; everything else is exercisable on one phone plus a manager login.
