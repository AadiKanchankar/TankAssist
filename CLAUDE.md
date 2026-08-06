# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TankAssist is a React Native (Expo, SDK 56) mobile app for Tank No. 90, an alcobev distributor. It began as a field-attendance + store-visit tracker and is now an **ordering + inventory** system. Field sales reps track attendance (selfie punch-in with GPS), do store visits via a guided check-in stepper (record stock, capture photos, place orders), and submit daily reports. Sales managers and management process those orders through a status pipeline, manage the product catalog and team, and get real-time dashboards. There is no custom backend — the app talks directly to Supabase via the JS client, protected by RLS.

## Commands

```bash
npm start              # Expo dev server
npm run android        # Android emulator
npm run ios            # iOS emulator
npx tsc --noEmit       # TypeScript type-check (the primary correctness gate; no test suite / lint)
```

Native-module changes (`react-native-maps`, `expo-camera`, `expo-location`, `expo-secure-store`, `expo-sharing`, **`expo-speech-recognition`**, **`expo-print`**, **`expo-updates`**) require a fresh EAS build — they don't hot-reload into an installed APK or run in Expo Go.

## Roles (exactly three)

`rep`, `sales_manager`, `management`. `state_head` was deleted. The role `CHECK` and every RLS policy/function use only these three. Manager-level policies use `get_my_role() = ANY (ARRAY['sales_manager','management'])`; catalog/user writes are `management`-only.

**⚠️ Tester role-switch (temporary — must be removed before production).** `users.is_tester boolean not null default false` + `public.switch_tester_role(new_role text)` (SECURITY DEFINER, `search_path=''`). The RPC is **self-only** (`auth.uid()`), requires `is_tester AND is_active`, validates against the same three roles, and **never touches `is_active`** — it only rewrites the caller's own `role`. There is **no 4th role**; a switched tester is indistinguishable from a real user of that role and gets **full, unrestricted** rights (that is the point — no read-only test mode). Whitelisting is data, not code: flip `is_tester` on a row. Currently two ids (see HANDOFF for the ids and the removal SQL). UI: a role switcher in `app/(shared)/profile.tsx` (lands on the new role's dashboard) plus a persistent `components/TesterBadge.tsx`. This is a standing self-elevation path to `management` — **HANDOFF carries the drop migration; run it before go-live.**

**Soft-ban:** `users.is_active boolean not null default true`. `get_my_role()` returns `role` only when `is_active` — otherwise **NULL**, so every role-keyed policy fails automatically for a deactivated user, and self-scoped write policies additionally require `get_my_role() IS NOT NULL`. A self-read policy survives so the app can show "Your account has been deactivated" and sign out. With the anon-key-only architecture, deactivation takes effect at the target's next token refresh / app-foreground (bounded by the access-token TTL) — not instant. `App.tsx` surfaces it via a `deactivated` flag (distinct from `kickedOut`).

## Authentication & account creation

- **Login is phone-OTP only.** `useAuthStore.sendOtp` calls `signInWithOtp({ phone, options: { shouldCreateUser: false } })`. The login screen also **pre-checks `phone_registered(phone)`** (anon SECURITY DEFINER RPC, boolean only) as soon as a full number is entered — unregistered/inactive numbers get "No account found. Contact your management team." and no SMS is sent. Self-registration and the Register screen are **removed**.
- **Only Management creates accounts**, via **management-verified OTP enrollment** (Team → Add User): on an **ephemeral no-persistence client** (`enrollClient` in `lib/supabase.ts`) it calls `signInWithOtp({ phone, shouldCreateUser: true })` → the SMS goes to the **new employee's** phone → management enters the relayed code → `enrollClient.verifyOtp` → the ephemeral session is discarded immediately → the `users` profile row is INSERTed via the **main** client under the management session (RLS `Users: management insert` allows inserting a row for a different id). Orphan recovery: if the profile INSERT fails after verify, "Retry Save" re-runs it; re-running Add User with the same phone completes cleanly. No service-role key exists; the ephemeral client keeps the manager's session untouched.
- **One-login enforcement (reps only):** after a rep's OTP verify, `verifyOtp` calls `supabase.auth.signOut({ scope: 'others' })`, revoking other sessions server-side. Managers may use multiple devices. A module-level `intentionalLogout` flag distinguishes tap-logout from server revocation (which sets `kickedOut`).

## Navigation (App.tsx)

Root calls `useAuthStore().initialize()` and renders one of three trees reactively from auth state:
- No session / no profile → `AuthStack` (Login → VerifyOtp).
- `profile.role === 'rep'` → `RepTabs` (Dashboard · MyStores · Report · Profile).
- Any other role → `AdminTabs`. Tabs are role-gated inside `AdminTabs`:
  - **Sales Manager:** Dashboard · **Team** · Stores · **Orders** · Profile.
  - **Management:** Dashboard · **Team** · Stores · **Products** · **Orders** · Profile.
  - `Products` is management-only; `Orders` shows for both; the **Dashboard** tab renders `DashboardRouter` → the **management KPI dashboard** for management, the legacy attendance/coverage dashboard for sales managers.

Stacks: **Team** (`RepsList` → `RepDetail`, member detail hosts Assign-Stores/Report for reps + management-only Deactivate/Reactivate; also hosts **`Exceptions`**, the review queue). **Stores** (`StoresList` → `StoreDetail` → `StoreForm`, plus `OrderDetail` so the recent-orders list links in). **Orders** (`OrdersList` → `OrderDetail`). `StoreVisit` and **`JourneyPlan`** are pushed from the rep Dashboard stack. `OrderDetail` and `StoreDetail` live in `app/(shared)/` and derive actions from role.

**Excise screens are management-only** and reached from the management surface, not their own tabs: `app/(admin)/permits.tsx` (upload + review queue) and `app/(admin)/facilities.tsx` (factory/warehouse registry).

App.tsx also owns: the `AppState` token-refresh pause/resume + proactive `refreshSession()` on foreground, the "logged in on another device" alert (`kickedOut`), and the "account deactivated" alert (`deactivated`).

## State Management

Single Zustand store (`store/useAuthStore.ts`): `session`, `user`, `profile` (role is the three-role union + `is_active` + `is_tester`), `loading`, `initialized`, `kickedOut`, `deactivated`.

Server state is **`@tanstack/react-query`** (`lib/queryClient.ts`), added in the UI redesign — the "no global data cache" era is over. The house pattern is `refetchOnMount: false` **+** an explicit `useFocusEffect(refetch)`, so a screen doesn't refetch on every remount but does refresh when the user actually returns to it. Per-domain hooks live in `hooks/` (`useOrders`, `useStores`, `useProducts`, `useTeam`, `usePermits`, `useFacilities`, `useCasesTrend`, `useInventoryAnalytics`, **`useJourneyPlans`**, the three dashboards). Local `useState` still owns per-screen form/UI state.

## Supabase Usage

Client initialized once in `lib/supabase.ts` (hardcoded URL + anon key). Session persisted **encrypted** via the chunked `expo-secure-store` adapter (`lib/secureStorage.ts`; Android Keystore / iOS Keychain; one-time lazy migration from old AsyncStorage). A second **`enrollClient`** (no persistence, no listener) exists solely for management OTP enrollment. All DB access is direct PostgREST through RLS, plus **one Edge Function** (`parse-excise-permit`) and **one Realtime subscription** (`location_requests`).

**Three private buckets.** `visit-photos` holds selfies and store/stock/delivered photos (policies are bucket-scoped to any authenticated user, no role gate); **`excise-permits`** holds permit documents (management-only, mime + 10 MB capped); **`odometer-photos`** holds TA odometer evidence (rep-insert, **manager/management-read only**, mime + 5 MB capped). `lib/storage.ts` exposes `getSignedUrl`/`getSignedUrls` (default 1 h; CSV export uses 90 days) and **`signedUrlResult(path, seconds, bucket)`**, which separates "the object is gone" from a transient failure — `getSignedUrl` defaults to `visit-photos`, so **any permit path must pass `PERMITS_BUCKET` and any odometer path `ODOMETER_BUCKET` explicitly**. `uploadToPath` takes the bucket as a parameter defaulting to `visit-photos`; locked-bucket callers pass it at the call site so the bucket is visible, never assumed.

**Odometer photos are NOT in `visit-photos`, deliberately.** That bucket is readable by any authenticated user, and anti-cheat evidence every rep can read defeats its own purpose.

## Database (live)

`supabase-schema.sql` is **regenerated from the live DB via MCP** (Phase 11) and is a trustworthy reference — **do not hand-edit**; make changes as migrations then regenerate.

Tables: `users` (+`assigned_manager_id`, `is_active`, `is_tester`), `stores` (+`license_number`, `created_by_user_id`, `state`, `owner_name`; `contact_person` shown as "Store Manager Name"), `store_assignments`, `attendance` (+`address`), `store_visits` (+`latitude`/`longitude`/`address`/`distance_from_store_meters`/**`is_mock_location`**; `cases_sold` is now **legacy** — see report semantics), `daily_reports`, `store_visit_photos`, **`products`**, **`orders`**, **`order_items`**, **`order_status_history`**, **`store_stock_snapshots`**, **`location_requests`**, **`company_facilities`**, **`excise_permits`**, **`permit_product_allocations`**, **`inventory_movements`**, **`journey_plans`**, **`journey_plan_stores`**. View: `monthly_ta_summary` (`security_invoker=on`).

SECURITY DEFINER functions (all `search_path=''`): `get_my_role`, `get_sales_managers`, `phone_registered`, `update_order_status`, `switch_tester_role`, `approve_excise_permit`, `reject_excise_permit`, **`manages_rep`**, plus two trigger functions — `reject_out_of_stock_order_item` (BEFORE INSERT on `order_items`) and `guard_facility_license_change` (BEFORE UPDATE on `company_facilities`).

**`manages_rep(p_rep uuid)`** is the manager→rep ownership test — the same relationship `location_requests` enforces inline — factored out so the six PJP policies don't paste it. EXECUTE is granted to **`authenticated` only**: there is no service-role key in this project, so granting one would contradict the anon-key-only invariant. Prefer it over re-writing the `EXISTS (… assigned_manager_id …)` sub-select in any new policy.

### Orders & the status machine
5 stages + cancelled: `placed → in_process → dispatched → in_transit → delivered`, plus `cancelled` (terminal, from any non-terminal state). **Strictly sequential; no skipping, no reversing.** Ownership: rep sets `placed` (at order creation) and `delivered` (verified at store); sales_manager & management set `in_process`/`dispatched`/`in_transit`. Cancel: rep (own orders only) + SM/management, reason mandatory.

**All status changes go through the `update_order_status(order_id, new_status, reason, delivered_photo_paths)` SECURITY DEFINER RPC** — the only legal mutator. Direct `UPDATE` on `orders` is denied to **everyone incl. management** (no UPDATE policy **and** no UPDATE grant); the RPC bypasses RLS as the table owner. It enforces the role matrix + strict sequential check atomically (`FOR UPDATE` lock) and writes an `order_status_history` row per transition. Hardened like `get_my_role` (`search_path=''`, anon EXECUTE revoked).
- **Delivered-override (approved Option B):** SM/management may mark `delivered` **only from `in_transit`, with a mandatory reason** (recorded in history). Reps mark `delivered` from **any** non-terminal state but require an **open (not checked-out) `store_visit` by that rep at the order's store** (whoever is physically checked in verifies delivery — not necessarily the placer).
- **History/audit:** order creation is represented by the order row itself (`placed_by`, `created_at`) — **no** creation history row; the RPC logs every transition after. Order detail renders "Placed by … " as the first timeline entry, then history rows.

### Products (catalog / product master)
`products` — `name`, `unit` (free text, legacy display), `qty_per_carton (>0)`, `product_code`, optional `price_per_case`/`price_per_bottle numeric`, `is_active`, `created_by`. **Archive-only:** no DELETE policy and no DELETE grant anywhere (discontinue via `is_active=false` so historical orders keep referencing it). All authenticated read; **management-only** insert/update. Pricing is optional; when present it is **snapshotted onto `order_items.price_per_case/price_per_bottle` at placement**. Products tab is management-only.

**Product-master expansion** added: `brand`, `category`, `unit_type`, **`unit_size numeric`** + **`unit_of_measure text`** (the pair the excise BL→bottles math needs — `unit` alone is free text and unusable), `gst_percent`, `shelf_life_months`, `sku`, `barcode`, `hsn_code`, `image_path`, and **`is_out_of_stock boolean not null default false`**. All are nullable/defaulted, so existing rows stayed valid. Editing uses a **3-step wizard** in `app/(admin)/products.tsx` (1 Basic info · 2 Packaging · 3 Commercial & availability); validation errors jump to the step holding the first error.

**Out-of-stock is enforced in the database, not just the UI.** The `trg_reject_oos_order_item` BEFORE INSERT trigger on `order_items` raises `'Product is out of stock'` if the referenced product has `is_out_of_stock = true`. The rep order picker also hides/blocks OOS products, but the trigger is the actual guarantee — a stale client cannot place an OOS line.

### Stock snapshots — three buckets
`store_stock_snapshots` — append-only (no update/delete). **Current stock = latest snapshot per (store, product).** Written during the check-in stepper for the products the rep actually touched. All authenticated read; insert with `recorded_by = auth.uid()`.

Stock is split into **three buckets per product**: `floor_*` (in the store, off the shelves), `display_*` (on the shelves), `godown_*` (the store's own godown), each as a `_cases`/`_bottles` pair. **`cases`/`bottles` remain the authoritative TOTAL** and are what every pre-existing reader uses (`useStores`, `useManagementDashboard`) — the buckets are the breakdown, so nothing downstream had to change.

**ABSENT IS NOT ZERO.** A bucket left blank is `null` ("no godown / not counted"); an explicit `0` means "counted and empty". Many stores have no godown, and a forced 0 would later read as real data. A bare `check (col >= 0)` admits NULL, which is how the `>= 0` discipline coexists with this. Prefill deliberately leaves never-recorded buckets blank so "no godown" doesn't drift into "godown is empty". The 6 pre-split rows carry a total with all buckets null and render **"Breakdown not recorded"** — never a guessed split.

Math lives in **`lib/stockBuckets.ts`** (pure, `lib/stockBuckets.test.ts`): totals are computed **in whole bottles then converted**, same discipline as `inventoryMath`, so floor 2cs+20btl + display 1cs+10btl is 4cs+6btl, not a drifted 3cs+30btl.

### Live location (on-demand, request/response over Realtime)
`location_requests` — `rep_id`, `requested_by`, `requested_at`, `lat`/`lng`, `responded_at`, `status ('pending'|'completed'|'expired')`. **This is the only table in the `supabase_realtime` publication.** There is no background/continuous tracking: a manager asks, and a **checked-in** rep's app answers once.

- **Ask** (`components/GetLocationButton.tsx`, manager side): INSERT a `pending` row, then subscribe to `postgres_changes` UPDATE filtered to that row id. `TIMEOUT_MS = 18000` — on timeout it falls back to the rep's last known position rather than hanging.
- **Answer** (`hooks/useLocationResponder.ts` + `components/LocationResponder.tsx`, rep side): subscribes to `postgres_changes` INSERT filtered on `rep_id=eq.<self>` **only while checked in**, takes one GPS reading, UPDATEs the row to `completed`. The channel is torn down on check-out.
- **RLS:** insert requires `requested_by = auth.uid()`, `status='pending'`, and that the target is an **active rep** the requester actually owns — management anyone, sales_manager only their own `assigned_manager_id` reports. Reads are split: `rep_id = auth.uid()` (the rep being asked) or `requested_by = auth.uid()` (the asker). Update is rep-only on their own row.

### Excise permits → inventory ledger (management-only)
Pipeline: **upload a permit PDF → parse server-side → human review/allocate → approve → append to an inventory ledger.** Every table below is **management-only** at the RLS layer (not extended to `sales_manager`).

- **`company_facilities`** — our own factories/warehouses. `name`, `license_no` (**UNIQUE**), `license_type`, `state`, `facility_type ('factory'|'warehouse')`, `is_active`, `valid_from`/`valid_until`. Anything **not** in this registry is treated as an external party (distributor / L1). Admin screen `app/(admin)/facilities.tsx`; `constants/indiaStates.ts` + `components/StatePicker.tsx` back the state field. **Licence-lock trigger** (`guard_facility_license_change`): `license_no` is editable while nothing references the facility, then **locked** once any permit or movement points at it — retire via `is_active=false` and add a new row, because the number is historical evidence.
- **`excise_permits`** — parsed permit header + `original_file_path`, `extracted_json` (raw text, parser notes, missing fields — the audit trail), `parser_version`, `status ('pending_review'|'approved'|'rejected')`, `movement_direction ('factory_to_warehouse'|'warehouse_to_l1'|'internal_transfer'|'unclassified')`, `facility_from_id`/`facility_to_id`, and **`quantity_lines jsonb`** (one entry per row of the permit's quantity table; null on rows predating multi-line parsing). Partial unique index **`excise_permits_one_approved_per_number`** on `permit_number WHERE status='approved'` — the same permit can never enter the ledger twice, enforced by the DB, not by a check-then-insert race.
- **`permit_product_allocations`** — maps permit quantity to catalog products: `line_index` (which quantity line, default `0`), `allocated_bl`, `computed_bottles`/`computed_cases`/`remainder_bottles` (**nullable — null means "couldn't compute", never a guess**), `needs_review`, `conversion_formula_version`. Writable only while the parent permit is `pending_review`.
- **`inventory_movements`** — the append-only ledger. **SELECT policy only: no INSERT/UPDATE/DELETE policy for anyone**, exactly like `orders`. The sole writer is `approve_excise_permit`.

**`approve_excise_permit(p_permit_id)`** is the only path into the ledger. It locks the permit `FOR UPDATE` and refuses unless: caller is management · status is `pending_review` · direction is not `unclassified` · `permit_number` is neither empty nor the `'UNREAD'` placeholder · at least one allocation · none flagged `needs_review` · none missing computed case counts · every allocation's `line_index` is in range · **and each quantity line's allocations sum to that line's own quantity** (±0.01). It falls back to the scalar columns for permits stored before `quantity_lines`, so old rows behave as before. **`reject_excise_permit(p_permit_id, p_reason)`** requires a reason.

**Storage:** private **`excise-permits`** bucket, `file_size_limit` 10 MB, `allowed_mime_types` `application/pdf`/`image/jpeg`/`image/png`. Policies are **management-gated SELECT + INSERT only — no UPDATE and no DELETE, deliberately.** A permit original is audit evidence, so nothing in the app can alter or remove one; this matches the immutability the rest of the design relies on (`inventory_movements` has no write policy, `order_status_history` is read-only, products are archive-only, the licence-lock trigger refuses to rewrite a referenced licence number). The consequence is that a turned-away duplicate upload leaves an orphan file, and that is **accepted rather than fixed** — see HANDOFF "Known defects". Don't add a DELETE policy to tidy it up. This bucket is *not* `visit-photos`; signing a permit path against the default bucket is a bug that has already happened once — pass `PERMITS_BUCKET` from `lib/storage.ts`.

### `parse-excise-permit` Edge Function (Deno, deployed v4)
Runs **entirely on the caller's JWT — no service-role key anywhere**, so RLS still applies to everything it does. File type is verified by **magic bytes**, not filename/extension. PDF text is extracted with `unpdf` and `isEvalSupported: false` (embedded PDF JavaScript is never executed).

**Text-layer only — there is no OCR.** Edge limits (256 MB / short CPU budget / bundle size, no multithreaded native libs) rule it out, so an image or a scanned PDF lands as `permit_number='UNREAD'` for manual entry rather than a guess. Files:
- `parsers.ts` — one parser per state, selected by `detect()`. Currently **`haryana-l32@3`** (FORM L-32). Emits one `quantity_lines` entry per Liquor Details row; reports a scalar `liquor_class` **only** for a single-row permit (with several rows it is null — row 1 must not stand in for the whole permit). Calibrated against a real L-32, not a spec. Known structural gap: **L-32 never prints the supplier's licence number**, so `license_no_source` is always null there and is explained in `parser_notes`.
- `classify.ts` — movement-direction rules. Critically distinguishes *"this licence isn't ours"* from *"this licence is ours but isn't currently valid"*: an expired/inactive facility of ours must **not** be read as an external L1, which would book an internal transfer as an outbound sale. Only a currently-valid licence auto-matches; anything else stays `unclassified` for a human.
- `index.ts` — duplicate guard (skipped for the `UNREAD` placeholder, since those all share it and aren't duplicates of each other), permit insert, and auto-allocation **only when the permit is single-line and exactly one active product exists** — the count is evaluated live, so this self-disables as the catalog grows.

Node-runnable tests sit beside the sources (`parsers.test.ts`, `classify.test.ts`, `npx tsx …`). **`supabase/functions` and `**/*.test.ts` are excluded in `tsconfig.json`** — they are Deno/Node code and would otherwise break the `tsc` gate.

### PJP (journey plans) + anti-cheat
A rep submits a planned route; their sales manager approves or sends it back. `journey_plans` (`rep_id`, `plan_date`, `status ('submitted'|'approved'|'rejected')`, `submitted_at`, `reviewed_by`, `reviewed_at`, `reject_reason`, **`unique (rep_id, plan_date)`**) + `journey_plan_stores` (`plan_id`, `store_id`, `position`).

**Approval is optimistic-with-flagging, NOT blocking** (owner decision). A rep may work against a still-`submitted` plan — the app never freezes them waiting on a manager who may be asleep at 8am. Such visits are **flagged for review**; an `approved` plan clears the flag.

**No RPC — RLS enforces the whole state machine.** Unlike `update_order_status` (5 sequential stages × role matrix), this is one transition, so policies cover it: a rep can only ever land the row back in `submitted` (self-approval is structurally impossible), a manager acts only on a `submitted` plan (an approved plan can't be reversed), and a rejection without a reason is refused by the DB. Verified by impersonation 2026-08-04 — rep self-approve and rep-takes-manager-path both raise **42501**. `journey_plans` has **no DELETE grant**: a submitted plan is evidence.

**Flags: exactly ONE is stored, the rest are derived** (`lib/journeyPlan.ts`, `lib/journeyPlan.test.ts`):
- **stored** — `store_visits.is_mock_location`, a device fact at capture time that can't be reconstructed later. **⚠️ Android only** (`expo-location` fills `mocked` from `Location.isFromMockProvider()`); on iOS it always records `false`, so a spoofed iOS device would not be flagged.
- **derived** — far-from-store (reuses `distance_from_store_meters`), impossible-movement (coords+timestamps already present), off-plan, plan-not-approved, and duplicate-store. Deriving is deliberate: an approved plan retroactively clears its visits, and **a client that skips a check is still caught** because the signal comes from the data, not from whether a dialog was shown.

**`planDateFor()`** resolves a visit to its plan by (rep, **local** calendar date) — the unique constraint makes that a natural key, so `store_visits` needs no FK. *Known ceiling:* a post-midnight visit resolves to the neighbouring day's plan. That honest-rep false positive is why the off-plan reason near midnight is worded as a question ("…may belong to the neighbouring day's plan. Worth confirming…") and marked `soft`, sorting below real flags. Upgrade path: explicit `shift_start`/`shift_end` on the plan.

**Store de-duplication** (`findDuplicateCandidates`) runs **client-side** — `pg_trgm` is not installed, and the rep's store list is already loaded. Name matching uses **Damerau/OSA `editDistance`, not plain Levenshtein**: an adjacent transposition ("Sruaj" for "Suraj") is one typo, and plain Levenshtein scores it 2, letting the duplicate through. Reuses `lib/haversine.ts` for proximity.

**Manager exception queue** — `app/(admin)/exceptions.tsx`, reached from **Team**, not its own tab (same posture as the excise screens). Floats flagged visits, plans awaiting approval, and **travel-allowance mismatches**: "review these 3", never "audit all 300".

**A rep with no `assigned_manager_id` is invisible to every sales_manager** (`manages_rep` only matches an SM to their own reports), so only management can action their plan. The queue says so on the card rather than leaving it in limbo. Plan review uses `.select()` on the update and treats **0 rows as an error** — an RLS-filtered update returns no error, so without it the UI reports success while the plan stays submitted.

⚠️ **Realtime channel topics must be unique per hook instance** (`journey-plans-${useId()}`, matching `locreq-${repId}`). Team and the review queue both mount `usePlanSubmissions`, and a native stack keeps Team mounted underneath — a shared topic means two subscribes on one topic, which Realtime rejects and which shipped once as a crash on opening the queue. Manager notification reuses the **live-location Realtime pattern** (`journey_plans` is the second table in `supabase_realtime`) rather than push notifications — no new native module, so PJP stays OTA-shippable.

### Odometer / Travel Allowance (§6)
Two rep-attested readings per day on **`attendance`** (`odo_start`/`odo_end` + photo path, timestamp and **own lat/lng per reading** — `attendance.latitude` is punch-in only). Columns, not a separate table: two readings/day is a locked decision and maps 1:1 onto the row that already represents the day, so the existing attendance RLS (rep insert/update/read own · manager read all) and its **table-level grants** cover it with zero new policy surface. **Daily TA distance = `odo_end − odo_start`.** A DB check constraint `attendance_odo_not_decreasing` enforces that odometers don't run backwards — the UI check in `lib/odometer.ts` is the friendly version, not the guarantee.

**OCR assists; the human confirms.** `components/OdometerCapture.tsx` is a guided capture — an on-screen frame the rep aligns to the odometer digits so the recogniser gets a tight crop instead of the whole dashboard cluster — then pre-fills a field the rep can correct. The reading is never saved unconfirmed, and odometer capture is **optional at both ends**: a missing reading must never block check-in or trap someone in an open attendance row.

**The engine is swappable.** `lib/odometerOcr.ts` exposes `readOdometer(uri) → { value, confidence, rawText }` with `setOdometerEngine()`; the ML Kit impl is the only thing that changes if a YOLO/TFLite reader replaces it. Engine: **`@infinitered/react-native-mlkit-text-recognition`** (Expo Module, autolinked — no config-plugin entry), **bundled** model so OCR works offline from first launch on rural routes. Its real export is **`recognizeText`** returning `{ text, blocks[] }` — **there is no confidence field**, so `confidence` is `null` here rather than a fabricated score. The module is `require`d lazily inside a try: `requireNativeModule` throws at import time when the native side is absent, and a lazy require degrades to "type it yourself" instead of a white screen.

Number picking (`extractOdometerCandidate`, pure + tested): digits only, 4–7 digits, **anything carrying a decimal separator is discarded** — that's how the trip meter (`67.8`) is told apart from the odometer (`12345`) — then longest run, then largest. *ponytail:* this is a heuristic over a guided crop, not display detection; phase 2 is a TRODO/YOLO region detector in front of the same interface.

**GPS cross-check feeds the existing exception queue** (`useOdometerFlags`, derived not stored — both numbers already sit on the attendance row). Compares odo distance against `attendance.total_distance_km`. **Only over-claims flag**, and the tolerance is deliberately generous — `MISMATCH_PERCENT = 0.6` plus a `MISMATCH_FLOOR_KM = 25` absolute floor, tunable in one place. A real day includes petrol, lunch and wrong turns, so overshoot is normal; the flag exists for "rode 5 km, claims 80", not honest slack. Under-reporting never flags — it cannot inflate TA, so it would only be noise.

### Inventory analytics
`lib/financialYear.ts` holds `FINANCIAL_YEAR_START_MONTH = 4` (Indian FY, 1 Apr – 31 Mar) as the single source of truth — same discipline as `ORDERS_CUTOVER_DATE`, never hardcoded into a query. `lib/inventoryMath.ts` is pure (`computeAnalytics`, `fmtQty`) and does its arithmetic **in whole bottles** before converting back to cases + remainder, so cases never drift; balance = sum over the whole `inventory_movements` history. `hooks/useInventoryAnalytics.ts` wraps it; unit-tested in `useInventoryAnalytics.test.ts`.

**Direction is the source of truth for balance.** `factory_to_warehouse` credits and `warehouse_to_l1` debits **regardless of facility attribution**; rows with a null facility land in an `UNATTRIBUTED_FACILITY` bucket labelled "Unattributed (no facility on permit)". This fixed a live bug where the dashboard read *Factory → warehouse 50 cases in* but *Warehouse balance 0*: the one approved permit was approved before `company_facilities` had any rows, so its ledger row carries null facility ids and the old `facility_to_id && isWarehouse.has(...)` test scored it zero. Unattributed **outbound** counts too — ignoring it would overstate stock on hand, the more dangerous error. `internal_transfer` is the exception and still requires a known warehouse, because its direction says nothing about which end is one. A backfill to attribute that row is **pending real facility rows** — see HANDOFF.

### RLS Policies
Keyed off `public.get_my_role()` (STABLE SECURITY DEFINER, `search_path=''`, EXECUTE granted to `authenticated`/`service_role`, revoked from anon/public). Manager reads use `get_my_role() = ANY (ARRAY['sales_manager','management'])`. `users` INSERT/UPDATE are management-only (plus `Users: self update (role locked)` pinning `role = get_my_role()`). Orders/history: all-authenticated read, orders insert-own, **no direct order mutation**; order_items insert only into your own order; snapshots insert-own; products management-write. **⚠️ Grants gotcha:** MCP-created tables/views get **zero** API-role grants — after any `CREATE TABLE/VIEW`, explicitly `GRANT` to `authenticated` and verify by role impersonation (`set_config('request.jwt.claims', …)`), expecting rows or a clean RLS denial (42501), never a bare permission error.

## Rep check-in stepper (app/(rep)/store-visit.tsx)

Rebuilt as a **sequential stepper** (the mount-time `store_visits` insert / check-in lock is unchanged). Steps, with the ones that auto-skip noted:
1. **Previous order** — most recent non-terminal order at the store (skipped silently if none). **Mark Delivered** (optional delivered photos → RPC), **Cancel** (structured reason picklist + free text → RPC; button shown **only to the order's placer** — others see "Store wants to cancel? Contact your manager."), or **Skip**.
2. **Update stock** — per active product, **three labelled buckets** (floor / display / godown), each cases + bottles, prefilled from the latest snapshot; **only products the rep edits ("touched") are recorded** at checkout, so the step is fully skippable. Godown's hint reads "Leave blank if this store has no godown" — blank stays `null`, so absent never becomes a fake 0, and no per-product toggle is needed for what is really a store-level fact. A touched product left entirely blank writes nothing.
3. **Shop photos** — multi-photo (back camera).
4. **Stock photo** — shown/required only when an entered stock reading is > 0 (path `stock-photos/…`).
5. **Place order** (optional) — active-product picker with cases/bottles/free-cases/free-bottles + notes + value; confirm → **immediate** INSERT `status='placed'` + items (price snapshots), linked to `visit_id`.
6. **Feedback/notes** — → Complete Check-Out.

**The `cases_sold` counter is removed.** Live actions (prior-order deliver/cancel, order placement) commit immediately via RPC/insert; passive data (stock snapshots, photos, notes, visit update) commits at checkout. Delivered/stock photos use paths `delivered-photos/…` and `stock-photos/…`; the stock photo is stored as a `store_visit_photos` row.

## Report semantics — the orders cutover (decision #3)

`lib/reportSemantics.ts` holds **`ORDERS_CUTOVER_DATE`** and the **single** hybrid `casesSold(start, endExclusive, { userId?, storeId? })` → `{ byDay, byStore, total }` (rep helpers `repCasesSold`/`repCasesSoldByDay` delegate to it). "Cases Sold" for a day = **order cases (excl. cancelled) on/after the cutover, legacy `store_visits.cases_sold` before** — never both, no double-count. **Every** cases figure routes through this one helper: rep Report tab, the rep report section (all periods), the CSV export, the PDF export, and the management dashboard. `ORDERS_CUTOVER_DATE` **must be set to the orders build's go-live date** (see HANDOFF go-live checklist). `monthly_ta_summary.total_cases_sold` is still visit-based and is no longer used for cases (the view stays for market-time/distance/stores).

## Reports (CSV + PDF)

Reached via Team → member → **Report** section (`rep-report-detail.tsx`, Daily/Weekly/Monthly). Download is a **choice: CSV (raw) or PDF (formatted)**, always exporting the full calendar month in view.
- **CSV** (`lib/reportExport.ts`) — header + Daily Summary / Visit Detail / Store Frequency; all cases figures use the cutover hybrid (per-day, per-visit, per-store); UTF-8 BOM + CRLF; photo/selfie links signed 90 days; filename `"{Rep} Report - {Month} {Year}.csv"`.
- **PDF** (`lib/reportPdf.ts`, **expo-print** → WebView) — port of the approved `sample-reports/generate.js` prototype: header, four stat tiles, cases/day bar + market-time area + visits-by-store donut (**inline SVG**, which the WebView renders), visit table, notes. **One month per page** (`exportRepPdf(repId, name, months[])`, page-break per month; `min-height` instead of the prototype's fixed height so a visit-heavy month flows instead of clipping). Filename single `"… - {Month} {Year}.pdf"` / multi `"… - {First}–{Last} {Year}.pdf"`. Fonts fall back to the device system font.

## Resume an abandoned visit + form draft

An open `store_visits` row (checked in, never checked out) **is** the resume backbone — it lives in Postgres under RLS, so it survives an app kill and a device swap with no local storage. `hooks/useOpenVisit.ts` surfaces it on the rep dashboard, **scoped to today** (live data already holds visits left open for days; offering to resume a week-old one is nonsense, and the stepper's own check-in lookup is same-day). Resuming just navigates to `StoreVisit` with the store — the stepper's existing lookup picks the visit back up.

On top of that, `lib/visitDraft.ts` (pure rules, tested) + `lib/visitDraftStore.ts` (Keystore I/O) restore what was **typed but not committed**: step index, per-bucket quantities, notes. Stored **encrypted via the chunked `SecureStorageAdapter`, never AsyncStorage**, because a draft carries store identity and stock quantities. Split into two files so the rules stay runnable under `tsx` — importing `secureStorage` pulls in `react-native` and breaks esbuild, the same split as `inventoryMath` vs `useInventoryAnalytics`.

A corrupt or missing draft degrades to "retype", never a crash. When over budget the **numbers win and notes are dropped** — quantities are what's tedious to re-enter. Resume never lands on the prior-order step (that order may have been delivered or cancelled since). *ponytail:* photo binaries are deliberately not cached — photos already upload to the locked bucket as taken, so resume re-references the uploaded rows; caching base64 in the Keystore would be slow, far past its budget, and would put images at rest for no gain. Cleared on successful checkout.

## Voice-to-text notes

`components/VoiceInput.tsx` — a multiline notes field with an integrated mic + EN/HI/MR selector (persisted per device), via **`expo-speech-recognition`** (Android SpeechRecognizer / iOS SFSpeechRecognizer).

**Language failures are diagnosed into THREE states, never two** (`diagnoseLang`): `unsupported` · `not-downloaded` · **`unknown`**. The unknown branch exists because `getSupportedLocales()` returns an **empty array on Android 12 and below**, and `installedLocales` only populates for the `com.google.android.as` service — treating that silence as "unsupported" would wrongly tell every rep on an older phone their language doesn't exist. Android 13+ gets an in-app **Download** button (`androidTriggerOfflineModelDownload`); older devices get Settings directions, since Android has no reliable intent to deep-link there. English is never force-selected, a failed language keeps a warning dot so it isn't a surprise twice, the banner retires itself on the next successful result, and **typing is never blocked** in any branch. Requests **on-device recognition where supported** (`supportsOnDeviceRecognition()`), else falls back to the device speech service. Live partials stream into the field and stay editable; **no audio is persisted** (transcript text only, saved through the same Supabase columns — zero schema change). One-time first-use notice ("runs on your phone's speech engine; TankAssist stores no audio"). Multiple instances are safe (each ignores events unless it's the active listener — gated on a ref). Wired into: rep Report notes + challenges, and Store-Visit feedback + order notes.

## Management dashboard (app/(admin)/management-dashboard.tsx)

KPI view for management (sales managers keep the legacy dashboard). Order, top to bottom: greeting + **today's date**, **Inventory** (FY-to-date movement + current warehouse balance, labelled with `financialYearLabel()`), **Cases ordered** hero + **trend**, **order pipeline strip** (tap → Orders tab pre-filtered via a `filter` route param), **Today's field activity** (reps checked in / visits), **Stores needing attention** (no visit in `STALE_VISIT_DAYS = 7`, and/or latest stock all-zero), **Top stores this month** by cases. All cases figures come from `casesSold` (no second hybrid).

**Cases trend range selector** (`hooks/useCasesTrend.ts`): 7 ranges — `1W · 1M · 3M · 6M · 1Y · 3Y · 5Y` — with **tiered granularity** (daily → weekly → monthly buckets) so a 5-year range doesn't render 1,800 bars. Each range makes **one** `casesSold` call for the whole window and buckets client-side, so the cutover hybrid is still applied exactly once. Tapping a bar reads out its full date/range.

Charting: `react-native-svg` + `react-native-gifted-charts` are now installed (the earlier "no charting library" note is obsolete); simple bars still use plain RN `<View>` via `components/TrendBars.tsx`.

## Store screens (list · detail · form)

Both store lists are state-grouped `SectionList`s with search + a collapsible accordion (`Typography.accordionHeader`; the rep list keeps its Assigned/All toggle + status dots). **`StoreDetail`** (shared) shows **Current Stock** (latest snapshot per product; "never recorded" when none — read-only for both roles), a secondary **Total Cases Ordered** stat, the non-null info block, managers-only **Recent Orders** (→ OrderDetail), embedded **Visits & Notes** (per-visit cases shown only when > 0, labelled legacy), and role actions (manager Edit/Delete; rep Check-In/Navigate). **`StoreForm`** (management) uses the `StoreLocationPicker`; `state` auto-derived.

## Orders tab (app/(admin)/orders.tsx · app/(shared)/order-detail.tsx)

**Terminology: the UI says "scheme", the columns stay `free_*`.** Trade usage is "Buy 20 Get 1 Free" = a scheme, so every user-visible string reads *Scheme cases* / *Scheme btl* / *"+N cs / N btl scheme"*. The columns `order_items.free_cases`/`free_bottles` were **deliberately not renamed** — they are never user-visible, and renaming would touch 5 files, a live migration, and the PostgREST `select()` strings for zero user gain. ⚠️ Never grep-replace `free` here: `cancelFreeText` (the cancel-reason free-text field) matches and is unrelated.

Tappable summary segments (To Process / Dispatched / In Transit / Delivered / Cancelled-secondary) filter the list. Order detail shows items+freebies+value, store, placed-by (call icon), the status-history timeline, and delivered photos (signed URLs); manager actions run through `update_order_status` (forward step with confirm; cancel + delivered-override via a reason modal). Shared status metadata + value in `lib/orders.ts`.

## Design Tokens

`constants/colors.ts`. Background `#F2ECD8`, accent `#6D7431` (olive), alert `#D02028`, success `#2D6A4F`. Font Helvetica Neue. `Typography.accordionHeader` (18/700) is the collapsible-section header used by the Team + Stores accordions. The PDF template deliberately uses its own approved slate/blue print palette (not the app tokens).

## Shared Components & Hooks

`Button` (primary/secondary/danger), `Card`, `Header` (safe-area aware), `StoreLocationPicker` (fixed-center-pin map), **`VoiceInput`** (voice notes field), `hooks/usePullToRefresh` (the one pull-to-refresh pattern). Photo upload: base64 → `base64-arraybuffer` → Supabase Storage (`lib/storage.ts`); path conventions there (`selfies/…`, `store-photos/…`, `stock-photos/…`, `delivered-photos/…`).

## Builds (EAS)

Android APKs via EAS (`eas.json` `preview` → internal APK; `channel: preview`). `app.json` config plugins: `expo-camera`, `expo-location`, `expo-font`, `expo-secure-store`, `expo-sharing`, **`expo-document-picker`** (permit upload), **`expo-speech-recognition`** (mic + speech usage strings; Android on-device service packages). **`expo-updates`** configured (`updates.url` + `runtimeVersion: { policy: 'appVersion' }`, currently **1.0.0**). The same Google Maps key (Maps SDK Android + Places + Geocoding + Directions) is wired in `app.json` → `android.config.googleMaps.apiKey`.

**OTA vs build:** JS-only changes ship with `eas update --branch preview --environment preview` and land on any installed build whose `runtimeVersion` matches. A **new EAS build is required** only when a native module is added/changed — currently `react-native-maps`, `react-native-svg`, `react-native-reanimated` (+ `react-native-worklets`), `expo-camera/location/secure-store/sharing/document-picker/print/updates/blur/haptics/linear-gradient/file-system`, `expo-speech-recognition`, **`@infinitered/react-native-mlkit-text-recognition`**.

⚠️ **Bump `app.json` `version` whenever a native module is added.** `runtimeVersion.policy` is `appVersion`, so leaving it unchanged lets a later `eas update` push JS onto an older binary that lacks the new native module — `requireNativeModule` then throws at import and white-screens the app. The ML Kit addition is why the app moved **1.0.0 → 1.1.0**.

**Two `keyboardShouldPersistTaps` lessons, both shipped as bugs once:** RN's default is `"never"`, so while the keyboard is up the dismiss gesture eats the first tap outside the input. Any `ScrollView`/`FlatList` containing a tappable result list needs `keyboardShouldPersistTaps="handled"` — its absence on the rep dashboard is why tapping a searched store did nothing.

Build gotchas already hit, worth not re-learning: `babel-preset-expo` must be an **explicit** dependency (transitive isn't enough); `newArchEnabled` is **not** valid in the SDK 56 `app.json` schema; duplicate `react` versions (moti pulled its own) need an `overrides` entry + `npm dedupe`; the worklets babel plugin must be **last**.

## Standing hooks & session conventions

This repo runs agent hooks from `.claude/` (**gitignored** — they hold machine-specific absolute paths like `C:/Python313/...`, so they do not travel with a clone and must be re-created per machine):

- **`PreToolUse` on `Bash|Grep` and `Read|Glob` → `graphify hook-guard`.** Fires a reminder to orient with `graphify query "<question>"` before grepping or reading source. Treat it as the intended default: query the graph first, then read specific files to edit or debug them.
- **`PostToolUse` on `Edit|Write|MultiEdit` → Impeccable** (`~/.claude/skills/impeccable/scripts/hook.mjs`), immediate-tier design checks on UI files. It **self-suppresses after ~6 edits to the same file** in a session and says so — that is throttling, not a clean bill of health; `/impeccable audit` re-runs the full pass.
- **`Stop` → Impeccable deep pass**, the full rule set at end of turn.
- **`SessionStart` → ponytail**, which in this setup resolves to **`ponytail:ponytail` at level `full`**: prefer reuse over new code, stdlib/native over dependencies, shortest working diff — but never at the cost of understanding the problem or of validation, error handling, security, or accessibility. Deliberate shortcuts get a `ponytail:` comment naming the ceiling and the upgrade path; non-trivial logic leaves one runnable check behind (which is why `parsers.test.ts` / `classify.test.ts` / `useInventoryAnalytics.test.ts` exist as plain `assert` scripts rather than a test framework).

`npx tsc --noEmit` remains the only CI-style gate; there is no lint and no test runner. The `*.test.ts` files are run manually with `npx tsx <file>`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. **`graphify-out/` is gitignored** — regenerate locally with `graphify update .`.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
