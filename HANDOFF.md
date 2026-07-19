# HANDOFF.md

Session-state snapshot for the next Claude Code session. **Temporal** — records what is live, pending, and out of scope as of the date below. Durable architecture facts live in `CLAUDE.md`; plain-language status for the user is `PROJECT_STATUS.md`.

- **Snapshot date:** 2026-07-18
- **Supabase project:** `ldgunrxceogfrohjrlxz` (live MCP access; verify before assuming)
- **Repo branch:** `master` (single `Initial commit`; all work is uncommitted working-tree changes)
- **Type state:** `npx tsc --noEmit` clean.

---

## The "Orders / Inventory / Roles / Voice" effort — Phases 0–11 (complete, verified)

Turned TankAssist from a visit tracker into an ordering + inventory system. All app phases are `tsc --noEmit` clean. DB changes were applied via MCP migrations and verified live with role impersonation.

### Database migrations (live + verified)
1. **`phase1_roles_softban_lockdown`** — roles reduced to `('rep','sales_manager','management')` (`state_head` deleted; 0 rows existed); `users.is_active` added; `get_my_role()` returns NULL when inactive; 10 manager-array policies rewritten; `users` INSERT/UPDATE made management-only; `phone_registered()` RPC added (anon, boolean); `get_sales_managers()` made active-only + anon EXECUTE revoked. **Verified:** deactivated rep reads nothing + self-read survives + writes denied; SM keeps reads, `users` write denied; management writes allowed; anon `phone_registered` works / `get_sales_managers` denied.
2. **`phase3_products`** — `products` table; RLS all-auth read, management insert/update, **no delete**; grants. **Verified matrix:** rep read ✓ / insert ✗ / update 0-rows; SM insert ✗; management insert+update ✓; deactivated read ✗; delete 42501 (no grant).
3. **`phase4_orders_stock`** — `orders`, `order_items`, `order_status_history`, `store_stock_snapshots`; 4 indexes; RLS (orders no direct UPDATE; history read-only; snapshots append-only); the `update_order_status(...)` SECURITY DEFINER RPC. **Verified full matrix:** SM sequential advance ✓ / skip ✗; rep advance ✗; rep cancel own+reason ✓ / other's ✗ / no-reason ✗; rep deliver from any state WITH open visit ✓ / WITHOUT ✗; SM override in_transit+reason ✓ / from placed ✗ / no-reason ✗; direct UPDATE orders (rep & management) 42501; order_items into another's order ✗; item/snapshot negative & all-zero CHECK ✗; deactivated read ✗.

`supabase-schema.sql` was **regenerated from live via MCP (Phase 11)** — tables/columns/constraints/indexes/functions/view/RLS/grants — and is now a trustworthy reference (header says "regenerate via MCP; do not hand-edit"). The reformatted view was syntax-validated in a throwaway schema.

### App phases (all type-clean)
- **P1 app** — Register screen deleted; login pre-OTP `phone_registered` gate (eager check on full-number entry) + `shouldCreateUser:false`; `deactivated` flow + alert; three-role types.
- **P2 + OTP-enrollment addendum** — Reps→**Team** with role-grouped accordion + header-font bump (both accordions); **Add User (management-only) via ephemeral-client OTP enrollment** (relay employee's code → INSERT profile under mgmt session; orphan "Retry Save"); Deactivate/Reactivate in member detail (mgmt only, not self, sales-manager dependent-rep count). `enrollClient` in `lib/supabase.ts`.
- **P3 app** — Products tab (management-only), list with collapsed Archived section, add/edit, archive/unarchive.
- **P5** — `store-visit.tsx` rebuilt as the 6-step check-in stepper (prev-order deliver/cancel/skip · stock touched-tracking · shop photos · required-when-stock stock photo · optional order placement · feedback); `cases_sold` input removed; new storage uploaders.
- **P6** — Orders tab (both managers) + shared `OrderDetail` with status-history timeline, delivered photos, and matrix-gated actions (`lib/orders.ts`).
- **P7** — Store Detail Current Stock + Total Cases Ordered + recent orders; report-semantics cutover (`lib/reportSemantics.ts`) applied to rep report + CSV headline.
- **P8** — Management KPI dashboard (`DashboardRouter`); every cases figure via `casesSold`.
- **P9** — Voice notes (`components/VoiceInput.tsx`, `expo-speech-recognition`) wired into 4 notes fields; app.json plugin + `expo-updates` config; **native → needs the build**.
- **P10** — In-app **PDF** (`lib/reportPdf.ts`, `expo-print`) porting the prototype, per-month pages; CSV/PDF choice; CSV Visit Detail + Store Frequency reconciled to the cutover hybrid; **native → needs the build**.

---

## The ONE fresh EAS build (do this)

`npx eas build -p android --profile preview --non-interactive`. It batches all native additions installed this effort:
- **`expo-speech-recognition@^56.0.1`** (voice), **`expo-print@~56.0.4`** (PDF), **`expo-updates@~56.0.22`** (OTA) — versions aligned to SDK 56 via `expo install`.
After it installs, OTA is live for future JS-only changes: **`eas update --channel preview`**. Config already in `app.json` (`updates.url`, `runtimeVersion: appVersion`, speech plugin) and `eas.json` (channels).

## Pending on-device tests (need the new build)
1. **OTP enrollment** end-to-end with a real test number → log that user in on another device → deactivate → confirm lockout at next refresh. Test orphan path (kill the profile INSERT once; Retry Save). Manager's own session stays put throughout.
2. **Two-device one-login** eviction (rep) + SecureStore session migration on update.
3. **Check-in stepper** on hardware — camera/GPS, prior-order deliver (±photos)/cancel (placer vs note), stock prefill + touched recording + required stock photo, order placement + value, checkout writes.
4. **Orders lifecycle** — manager walks placed→in_process→dispatched→in_transit→delivered-override(reason); cancel(reason); timeline names/times; delivered photos render; pipeline deep-links pre-filter.
5. **Voice** — permission + one-time no-audio notice; EN/HI/MR (persists); live partials append + editable; nothing stored; on-device vs fallback honest; two notes fields don't cross-transcribe.
6. **CSV and PDF** share correctly; filenames exact; cases figures match the hybrid; PDF charts/table/per-month pages render; visit-heavy month paginates without clipping.
7. **Management dashboard** renders; sales-manager still sees the legacy dashboard.

## Orders go-live checklist (coordinated cutover)
- **Same-day build install for ALL reps** (staggered rollout splits a rep's data across legacy `cases_sold` and orders on the same day).
- **Set `ORDERS_CUTOVER_DATE`** (`lib/reportSemantics.ts`) to that install date (currently a `2026-07-18` placeholder). Days `>= cutover` count order cases (excl. cancelled); days `<` count legacy visit `cases_sold`; never both.
- **Phase 10 is complete** (CSV/PDF reconciled), so the interim-misleading-CSV risk is cleared — but still ship the cutover date correctly.

## Manual dashboard actions (user, in Supabase)
1. **SMS OTP expiry** (Authentication → Providers → Phone) must exceed the employee→manager relay window — recommend **300–600 s** (raise from the 60 s default if that's what it is).
2. Confirm the **live Twilio provider** (not the test provider) and **remove any Test OTP numbers** on the same page before go-live.
3. Shorten access-token (JWT) expiry to **10–15 min** (bounds one-login + deactivation eviction).
4. Confirm Auth rate limits at defaults.

## Deferred optional items (parked, not forgotten)
- **Instant-kill deactivation via a service-role Edge Function** — deliberately not built (keeps the anon-key-only architecture); soft-ban + short JWT TTL is the current mechanism. New-secret STOP POINT if ever taken up.
- **`get_user_names(ids[])` RPC** — would let reps see teammate names on "last recorded by" / stock recorder (RLS currently limits reps to their own name). Small SECURITY DEFINER RPC; not built.

## Open decision
- **`ORDERS_CUTOVER_DATE`** value — set to the actual go-live install date at build time.

## Explicitly out of scope (carried forward — do not start without a go-ahead)
- **Geo-fence enforcement** — no schema/logic. Contract: flag + reason, never block; no network in the fence check; reuse `distance_from_store_meters`; start at audit → schema STOP POINT.
- **Offline queue + Python batch-sync backend** — not started, not scaffolded.

## Hard guardrails (carry forward)
1. Verify live via MCP before writing code that assumes DB structure — every time.
2. Every schema change is a STOP-POINT SQL block; confirm → apply → verify live → impersonation-test → then write app code. **After any CREATE TABLE/VIEW: grant to `authenticated` explicitly and verify by role impersonation** (MCP objects get zero API-role grants).
3. Every new secret is a STOP POINT (no service-role key in the app).
4. Complete files only; `npx tsc --noEmit` after each change.
5. STOP and report after each numbered phase; do not self-continue.

## Last known working state
- Working tree **type-clean**; all three migrations verified live (policies, grants, impersonation allow/deny).
- All work **uncommitted** on `master` (no commits requested).
- **Next actionable step:** run the one EAS build → 7-point device checklist → 4 manual dashboard actions → set `ORDERS_CUTOVER_DATE` → coordinated same-day install → `eas update --channel preview` for subsequent JS changes.
