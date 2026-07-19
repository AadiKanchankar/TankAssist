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

Stacks: **Team** (`RepsList` → `RepDetail`, member detail hosts Assign-Stores/Report for reps + management-only Deactivate/Reactivate). **Stores** (`StoresList` → `StoreDetail` → `StoreForm`, plus `OrderDetail` so the recent-orders list links in). **Orders** (`OrdersList` → `OrderDetail`). `StoreVisit` is pushed from the rep Dashboard and Stores stacks. `OrderDetail` and `StoreDetail` live in `app/(shared)/` and derive actions from role.

App.tsx also owns: the `AppState` token-refresh pause/resume + proactive `refreshSession()` on foreground, the "logged in on another device" alert (`kickedOut`), and the "account deactivated" alert (`deactivated`).

## State Management

Single Zustand store (`store/useAuthStore.ts`): `session`, `user`, `profile` (role is the three-role union + `is_active`), `loading`, `initialized`, `kickedOut`, `deactivated`. Everything else is local `useState` per screen; screens fetch from Supabase on mount and on focus (`useFocusEffect`). No global data cache.

## Supabase Usage

Client initialized once in `lib/supabase.ts` (hardcoded URL + anon key). Session persisted **encrypted** via the chunked `expo-secure-store` adapter (`lib/secureStorage.ts`; Android Keystore / iOS Keychain; one-time lazy migration from old AsyncStorage). A second **`enrollClient`** (no persistence, no listener) exists solely for management OTP enrollment. All DB access is direct PostgREST through RLS. The private `visit-photos` bucket holds selfies, store/stock/delivered photos; signed URLs via `lib/storage.ts` (`getSignedUrl`/`getSignedUrls`, default 1 h; the CSV export uses 90 days).

## Database (live)

`supabase-schema.sql` is **regenerated from the live DB via MCP** (Phase 11) and is a trustworthy reference — **do not hand-edit**; make changes as migrations then regenerate.

Tables: `users` (+`assigned_manager_id`, `is_active`), `stores` (+`license_number`, `created_by_user_id`, `state`, `owner_name`; `contact_person` shown as "Store Manager Name"), `store_assignments`, `attendance` (+`address`), `store_visits` (+`latitude`/`longitude`/`address`/`distance_from_store_meters`; `cases_sold` is now **legacy** — see report semantics), `daily_reports`, `store_visit_photos`, **`products`**, **`orders`**, **`order_items`**, **`order_status_history`**, **`store_stock_snapshots`**. View: `monthly_ta_summary` (`security_invoker=on`).

### Orders & the status machine
5 stages + cancelled: `placed → in_process → dispatched → in_transit → delivered`, plus `cancelled` (terminal, from any non-terminal state). **Strictly sequential; no skipping, no reversing.** Ownership: rep sets `placed` (at order creation) and `delivered` (verified at store); sales_manager & management set `in_process`/`dispatched`/`in_transit`. Cancel: rep (own orders only) + SM/management, reason mandatory.

**All status changes go through the `update_order_status(order_id, new_status, reason, delivered_photo_paths)` SECURITY DEFINER RPC** — the only legal mutator. Direct `UPDATE` on `orders` is denied to **everyone incl. management** (no UPDATE policy **and** no UPDATE grant); the RPC bypasses RLS as the table owner. It enforces the role matrix + strict sequential check atomically (`FOR UPDATE` lock) and writes an `order_status_history` row per transition. Hardened like `get_my_role` (`search_path=''`, anon EXECUTE revoked).
- **Delivered-override (approved Option B):** SM/management may mark `delivered` **only from `in_transit`, with a mandatory reason** (recorded in history). Reps mark `delivered` from **any** non-terminal state but require an **open (not checked-out) `store_visit` by that rep at the order's store** (whoever is physically checked in verifies delivery — not necessarily the placer).
- **History/audit:** order creation is represented by the order row itself (`placed_by`, `created_at`) — **no** creation history row; the RPC logs every transition after. Order detail renders "Placed by … " as the first timeline entry, then history rows.

### Products (catalog)
`products` — `name`, `unit` (free text), `qty_per_carton (>0)`, `product_code`, optional `price_per_case`/`price_per_bottle numeric`, `is_active`, `created_by`. **Archive-only:** no DELETE policy and no DELETE grant anywhere (discontinue via `is_active=false` so historical orders keep referencing it). All authenticated read; **management-only** insert/update. Pricing is optional; when present it is **snapshotted onto `order_items.price_per_case/price_per_bottle` at placement**. Products tab is management-only.

### Stock snapshots
`store_stock_snapshots` — append-only (no update/delete). **Current stock = latest snapshot per (store, product).** Written during the check-in stepper for the products the rep actually touched. `>= 0` checks on cases/bottles. All authenticated read; insert with `recorded_by = auth.uid()`.

### RLS Policies
Keyed off `public.get_my_role()` (STABLE SECURITY DEFINER, `search_path=''`, EXECUTE granted to `authenticated`/`service_role`, revoked from anon/public). Manager reads use `get_my_role() = ANY (ARRAY['sales_manager','management'])`. `users` INSERT/UPDATE are management-only (plus `Users: self update (role locked)` pinning `role = get_my_role()`). Orders/history: all-authenticated read, orders insert-own, **no direct order mutation**; order_items insert only into your own order; snapshots insert-own; products management-write. **⚠️ Grants gotcha:** MCP-created tables/views get **zero** API-role grants — after any `CREATE TABLE/VIEW`, explicitly `GRANT` to `authenticated` and verify by role impersonation (`set_config('request.jwt.claims', …)`), expecting rows or a clean RLS denial (42501), never a bare permission error.

## Rep check-in stepper (app/(rep)/store-visit.tsx)

Rebuilt as a **sequential stepper** (the mount-time `store_visits` insert / check-in lock is unchanged). Steps, with the ones that auto-skip noted:
1. **Previous order** — most recent non-terminal order at the store (skipped silently if none). **Mark Delivered** (optional delivered photos → RPC), **Cancel** (structured reason picklist + free text → RPC; button shown **only to the order's placer** — others see "Store wants to cancel? Contact your manager."), or **Skip**.
2. **Update stock** — per active product, cases + bottles, prefilled from the latest snapshot; **only products the rep edits ("touched") are recorded** at checkout, so the step is fully skippable.
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

## Voice-to-text notes

`components/VoiceInput.tsx` — a multiline notes field with an integrated mic + EN/HI/MR selector (persisted per device), via **`expo-speech-recognition`** (Android SpeechRecognizer / iOS SFSpeechRecognizer). Requests **on-device recognition where supported** (`supportsOnDeviceRecognition()`), else falls back to the device speech service. Live partials stream into the field and stay editable; **no audio is persisted** (transcript text only, saved through the same Supabase columns — zero schema change). One-time first-use notice ("runs on your phone's speech engine; TankAssist stores no audio"). Multiple instances are safe (each ignores events unless it's the active listener — gated on a ref). Wired into: rep Report notes + challenges, and Store-Visit feedback + order notes.

## Management dashboard (app/(admin)/management-dashboard.tsx)

KPI view for management (sales managers keep the legacy dashboard). **Order pipeline strip** (live counts per bucket; tap → Orders tab pre-filtered via a `filter` route param), **Cases ordered** this vs last month + a per-day **trend** (basic RN `<View>` bars — no charting library / SVG; none is installed), **Today's field activity** (reps checked in / visits), **Stores needing attention** (no visit in `STALE_VISIT_DAYS = 7`, and/or latest stock all-zero), **Top stores this month** by cases. All cases figures come from `casesSold` (no second hybrid). No new schema.

## Store screens (list · detail · form)

Both store lists are state-grouped `SectionList`s with search + a collapsible accordion (`Typography.accordionHeader`; the rep list keeps its Assigned/All toggle + status dots). **`StoreDetail`** (shared) shows **Current Stock** (latest snapshot per product; "never recorded" when none — read-only for both roles), a secondary **Total Cases Ordered** stat, the non-null info block, managers-only **Recent Orders** (→ OrderDetail), embedded **Visits & Notes** (per-visit cases shown only when > 0, labelled legacy), and role actions (manager Edit/Delete; rep Check-In/Navigate). **`StoreForm`** (management) uses the `StoreLocationPicker`; `state` auto-derived.

## Orders tab (app/(admin)/orders.tsx · app/(shared)/order-detail.tsx)

Tappable summary segments (To Process / Dispatched / In Transit / Delivered / Cancelled-secondary) filter the list. Order detail shows items+freebies+value, store, placed-by (call icon), the status-history timeline, and delivered photos (signed URLs); manager actions run through `update_order_status` (forward step with confirm; cancel + delivered-override via a reason modal). Shared status metadata + value in `lib/orders.ts`.

## Design Tokens

`constants/colors.ts`. Background `#F2ECD8`, accent `#6D7431` (olive), alert `#D02028`, success `#2D6A4F`. Font Helvetica Neue. `Typography.accordionHeader` (18/700) is the collapsible-section header used by the Team + Stores accordions. The PDF template deliberately uses its own approved slate/blue print palette (not the app tokens).

## Shared Components & Hooks

`Button` (primary/secondary/danger), `Card`, `Header` (safe-area aware), `StoreLocationPicker` (fixed-center-pin map), **`VoiceInput`** (voice notes field), `hooks/usePullToRefresh` (the one pull-to-refresh pattern). Photo upload: base64 → `base64-arraybuffer` → Supabase Storage (`lib/storage.ts`); path conventions there (`selfies/…`, `store-photos/…`, `stock-photos/…`, `delivered-photos/…`).

## Builds (EAS)

Android APKs via EAS (`eas.json` `preview` → internal APK; `channel: preview`). `app.json` config plugins: `expo-camera`, `expo-location`, `expo-font`, `expo-secure-store`, `expo-sharing`, **`expo-speech-recognition`** (mic + speech usage strings; Android on-device service packages). **`expo-updates`** configured (`updates.url` + `runtimeVersion: appVersion`) for OTA after go-live. The same Google Maps key (Maps SDK Android + Places + Geocoding + Directions) is wired in `app.json` → `android.config.googleMaps.apiKey`. Native modules — `react-native-maps`, `expo-camera/location/secure-store/sharing`, **`expo-speech-recognition`**, **`expo-print`**, **`expo-updates`** — need a fresh EAS build; the voice + PDF + OTA work is batched into **one** build.
