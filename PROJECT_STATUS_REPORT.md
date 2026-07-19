# TankAssist — Project Status Report

**Report Date:** 26 June 2026
**Project:** TankAssist (Field Sales Tracking Application)
**Client:** Tank No. 90 — Alcobev Distribution
**PRD Reference:** `Field_Sales_App_PRD.docx`
**Live DB Verified:** Yes — Supabase MCP connected, schema and RLS policies confirmed against live project `ldgunrxceogfrohjrlxz`

---

## 1. Problem Statement (from PRD)

Tank No. 90 distributes alcobev products across retail outlets in 5 states through a field sales team. Currently there is **zero digital infrastructure** to monitor or support field operations. The specific problems identified in the PRD are:

| # | Problem | Impact |
|---|---------|--------|
| 1 | No visibility into actual salesman movement | Cannot verify if assigned outlets are actually being visited |
| 2 | No verification of outlet visits or time spent | No accountability on daily field work |
| 3 | Travel Allowance (TA) paid blindly | Monthly TA with no supporting data on actual coverage or hours worked |
| 4 | Paper-based inventory, orders, and scheme records | Errors, delays, lost data reaching the office |
| 5 | No structured market feedback capture | Competitor activity and retailer feedback goes unrecorded |
| 6 | No geographic mapping of retail outlets | No area intelligence or outlet coverage analytics |

**The goal:** Build a mobile-first field sales tracking application that gives management real-time visibility into field operations, replaces paper processes with digital workflows, and generates TA justification data.

---

## 2. Initial Plan (What Was Decided to Build First)

Based on the PRD's own phased delivery plan, the project was structured as:

| Phase | Scope | Timeline (PRD) |
|-------|-------|-----------------|
| **Phase 1 (Core)** | Login, GPS tracking, outlet check-in/check-out, photo capture, admin live map, daily summary | Week 1–4 |
| **Phase 2** | Inventory entry module, outlet master with map view | Week 5–6 |
| **Phase 3** | Order taking, trade schemes & incentives module | Week 7–8 |
| **Phase 4** | Feedback module, reporting suite, TA monthly report | Week 9–10 |

**Our implementation approach** chose to build an MVP of Phase 1 using:

- **React Native (Expo)** — mobile app (matches PRD's suggested tech stack)
- **Supabase** — backend-as-a-service replacing a traditional Node.js/Express API (provides Auth, PostgreSQL database, Row Level Security, and file storage)
- **TypeScript** — throughout the codebase
- **Zustand** — lightweight state management (single `useAuthStore`)

This means we opted for a BaaS architecture (Supabase) instead of a custom backend API, which accelerates delivery but has trade-offs covered in the gap analysis below.

---

## 3. Current Implementation Status — What Has Been Built

### 3.1 Architecture Overview

```
┌────────────────────────────────────────────────────┐
│                  MOBILE APP (Expo/RN)              │
│                                                    │
│  Auth ─── (auth) ── Login (phone OTP), VerifyOtp,  │
│                      Register (self-onboarding)    │
│  Rep  ─── (rep)  ── Dashboard, Attendance,         │
│                      Stores, StoreVisit, Report    │
│  Admin── (admin) ── Dashboard, Reps, Stores,       │
│                      Reports                       │
│  Shared─ (shared)── Profile                       │
│                                                    │
│  State: Zustand (useAuthStore — auth only)         │
│  Utils: Haversine distance, Geocoding, Places API, │
│          Photo upload                              │
└──────────────────┬─────────────────────────────────┘
                   │  Supabase JS Client (anon key)
                   ▼
┌────────────────────────────────────────────────────┐
│              SUPABASE (BaaS Backend)               │
│                                                    │
│  Auth ── Phone OTP (SMS), session via AsyncStorage │
│  DB   ── PostgreSQL (6 tables, RLS on all)         │
│  Storage ── visit-photos bucket (private)          │
└────────────────────────────────────────────────────┘
```

**Auth implementation note:** Authentication uses **phone number OTP** (SMS via Supabase), not email/password. There is no forgot-password flow. Users self-register via the Register screen, which collects name, phone, and role; reps also select their assigned Sales Manager during registration. The admin can also create reps manually via the Manage Reps screen (email + password via `supabase.auth.signUp`).

**Role routing:** Four roles exist in the system — `rep`, `sales_manager`, `state_head`, `management`. Reps route to `RepTabs`; all three admin roles route to `AdminTabs`. Routing is purely reactive: `App.tsx` re-renders the correct navigator tree when `session` or `profile` changes in the Zustand store.

### 3.2 Database Schema — Live Verified (6 tables)

The following reflects the **live Supabase database** as of this report date. The `supabase-schema.sql` file in the repo is outdated and does not reflect several columns and the correct role constraint — see discrepancy notes per table.

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | Extends Supabase auth; stores profile + role | `id`, `name`, `email` (nullable), `role` CHECK IN ('rep','sales_manager','state_head','management'), `phone` (nullable), `assigned_manager_id` uuid FK→users |
| `stores` | Retail outlet master data | `id`, `name`, `address`, `latitude`, `longitude`, `contact_person`, `contact_number`, `created_by_user_id` uuid FK→auth.users, `license_number` |
| `store_assignments` | Daily assignment of stores to reps | `user_id`, `store_id`, `assigned_date` (default CURRENT_DATE) |
| `attendance` | Daily check-in / check-out record | `user_id`, `check_in_time`, `check_out_time`, `latitude`, `longitude`, `selfie_url`, `total_distance_km`, `total_market_time_minutes`, `address` |
| `store_visits` | Per-outlet visit record | `user_id`, `store_id`, `check_in_time`, `check_out_time`, `duration_minutes`, `cases_sold` (default 0), `notes`, `photo_url`, `latitude`, `longitude`, `address`, `distance_from_store_meters` float8 |
| `daily_reports` | End-of-day report from rep | `user_id`, `report_date` (default CURRENT_DATE), `notes`, `challenges` |

**Live row counts (as of 26 June 2026):** users=3, stores=1, store_assignments=0, attendance=2, store_visits=2, daily_reports=0

**SQL file discrepancies** — columns present in live DB but missing from `supabase-schema.sql`:
- `users.assigned_manager_id` + self-referencing FK
- `users` role constraint now covers all 4 roles (SQL file only had `'admin'` and `'rep'`)
- `stores.created_by_user_id`, `stores.license_number`
- `attendance.address`
- `store_visits.latitude`, `store_visits.longitude`, `store_visits.address`, `store_visits.distance_from_store_meters`

### 3.3 Screens Built (13 total)

#### Auth (3 screens)
| Screen | File | What It Does |
|--------|------|--------------|
| Login | `app/(auth)/login.tsx` | Phone number + country code picker; sends OTP via Supabase Auth; country codes: IN/US/UK/UAE/SG/AU |
| Verify OTP | `app/(auth)/verify-otp.tsx` | 6-digit numeric OTP entry; resend OTP; on success, auth state change triggers navigation automatically |
| Register | `app/(auth)/register.tsx` | Two-step self-onboarding: Step 1 collects name, phone, role (4-tile grid picker), and — for reps — a manager picker (loads all `role='sales_manager'` users); Step 2 is OTP verification; on OTP success, inserts `users` row then calls `refreshProfile()` to trigger navigation |

#### Rep / Salesman (5 screens)
| Screen | File | What It Does |
|--------|------|--------------|
| Dashboard | `app/(rep)/dashboard.tsx` | Greeting + date; attendance card (check-in status, market time + distance after punch-out); "Punch In Store" modal (search any store by name OR add new store with Google Places Autocomplete for address + lat/lng); today's assigned stores with visit-status colour dots; daily report status; "Punch Out / End Day" (requests GPS, gathers visit coords in time order, runs `totalRouteKm`, updates attendance row); `useFocusEffect` refreshes all data on every screen focus |
| Attendance (Check-In) | `app/(rep)/attendance.tsx` | Requests GPS on mount; reverse geocodes in background (non-blocking via `reverseGeocode`); front-facing `CameraView` selfie (gallery blocked — live only); on "Confirm Check In" uploads selfie to Storage then INSERTs `attendance` row with check_in_time, lat/lng, and address |
| My Stores | `app/(rep)/stores.tsx` | Segmented toggle: **Assigned Today** (today's `store_assignments` joined) or **All Stores** (full `stores` table with client-side name filter); visit-status colour dots (pending/in-progress/visited) on each card; tap a card → detail modal showing address, contact info, "Navigate to Store" (opens native maps), and "Check In" / "Continue Visit" / "Visited" state; `useFocusEffect` refreshes on focus |
| Store Visit | `app/(rep)/store-visit.tsx` | On mount: gets GPS, checks for open visit today for this store — resumes it if found, otherwise INSERTs a new `store_visits` row immediately (locking check-in time); computes `distance_from_store_meters` via `haversineKm` (logged passively, **not enforced**); background geocode patches `address` on the row; back-facing camera for store photo; cases-sold ±1 counter (0 = zero-order visit); notes `TextInput`; on "Check Out" uploads photo then UPDATEs visit row with check_out_time, duration_minutes, cases_sold, notes, photo_url |
| Daily Report | `app/(rep)/report.tsx` | Auto-populated 2×2 stats grid (market time, distance, cases sold, stores visited); notes + challenges text inputs; submit writes to `daily_reports`; once submitted, fields become read-only and "✓ Report submitted" banner replaces submit button; pull-to-refresh |

#### Admin (4 screens)
| Screen | File | What It Does |
|--------|------|--------------|
| Dashboard | `app/(admin)/dashboard.tsx` | Attendance card (present/absent counts); store coverage card (assigned / visited / missed); scrollable rep list with status dot, visit count, and "Active" / "Punched Out" / "Not checked in" label; tap rep → fetches their store_visits joined with stores(name) → slide-up detail modal; `useFocusEffect` + pull-to-refresh |
| Manage Reps | `app/(admin)/reps.tsx` | Lists all `role='rep'` users; "Add Rep" modal (name, email, phone, temp password — creates auth user via `supabase.auth.signUp` then INSERTs `users` row); "Assign Stores" modal (loads all stores + today's assignments, checkbox list, DELETE+re-INSERT pattern to save) |
| Manage Stores | `app/(admin)/stores.tsx` | Full CRUD for `stores` table; add/edit form with name, address (Google Places Autocomplete), license number, contact person, contact number; delete with `Alert.alert` confirmation; Places API used for address → lat/lng geocoding |
| Reports | `app/(admin)/reports.tsx` | Lists all `daily_reports` joined with `users(name, email)`, ordered by date descending; date filter (`TextInput` for YYYY-MM-DD, re-queries on change); tap a report → detail modal loads attendance + store_visits for that rep/date and shows a 2×2 stats grid alongside notes and challenges |

#### Shared (1 screen)
| Screen | File | What It Does |
|--------|------|--------------|
| Profile | `app/(shared)/profile.tsx` | Olive-green initials avatar; name, phone, role (human-readable label); for reps only — fetches and displays assigned manager's name from `users`; app version display (v1.0.0); "Logout" danger button with confirmation `Alert.alert` |

### 3.4 Utility Libraries
| File | Purpose |
|------|---------|
| `lib/supabase.ts` | Single Supabase client; URL + anon key hardcoded; AsyncStorage session persistence; `detectSessionInUrl: false` for RN compatibility |
| `lib/storage.ts` | `uploadPhoto(uri, folder, userId)` — reads file as base64, decodes to ArrayBuffer, uploads to `visit-photos` bucket at `{folder}/{userId}/{timestamp}.jpg`; `getSignedUrl(filePath)` — 1-hour signed URL (exported but currently unused — photos are stored by path and not yet rendered back in any screen) |
| `lib/haversine.ts` | `haversineKm(lat1,lon1,lat2,lon2)` — straight-line distance; `totalRouteKm(waypoints[])` — cumulative route distance across ordered lat/lng points; used at punch-out and for passive check-in distance logging |
| `lib/geocoding.ts` | `reverseGeocode(lat, lng)` — Google Maps Geocoding API; falls back silently to `"lat, lng"` string on error; never throws (check-in flow is non-blocking) |
| `lib/places.ts` | `searchPlaces(input)` — Google Places Autocomplete, restricted to `country:in`; `getPlaceDetails(placeId)` — returns `{address, latitude, longitude}`; both return empty/null on error; used in rep "Punch In Store" add-store form and admin store CRUD |

### 3.5 Reusable Components
| Component | Purpose |
|-----------|---------|
| `Button.tsx` | Variants: `primary` (olive fill), `secondary` (olive outline), `danger` (red fill); `loading` prop shows `ActivityIndicator` |
| `Card.tsx` | White container with tan border (`Colors.border`), radius 4, padding 20, marginBottom 16 |
| `Header.tsx` | Page header with optional back arrow and right element; background matches app cream (`Colors.background`) |

---

## 4. PRD Compliance — Feature-by-Feature Gap Analysis

### Phase 1: Core Field Sales Tracking (PRD Sections 4.1–4.6)

| PRD Requirement | Status | What's Implemented | What's Missing |
|-----------------|--------|-------------------|----------------|
| **4.1 Salesman Login & Profile** | 🟡 Partial | ✅ Phone OTP login, role-based routing, name/phone/role/assigned_manager in profile, self-registration, 4 roles supported | ❌ Device lock (warn/block if different device), ❌ Territory + supervisor + vehicle type fields in profile |
| **4.2 Live Location Tracking** | 🔴 Not Built | ✅ GPS captured at check-in and punch-out, ✅ `distance_from_store_meters` logged passively on each store check-in, ✅ Daily total distance calculated at punch-out via waypoint haversine | ❌ Background GPS tracking at 5–10 min intervals, ❌ `location_logs` table does not exist, ❌ Live admin map showing active salesmen, ❌ Daily route playback, ❌ Real-time location sync to server |
| **4.3 Outlet Check-In** | 🟡 Partial | ✅ GPS captured at check-in time (locked), ✅ Timestamp locked on entry, ✅ Any store selectable (assigned or searched or newly created), ✅ Store photo captured | ❌ Geo-fence enforcement (distance logged but check-in never rejected), ❌ Configurable geo-fence radius, ❌ Supervisor override flow for out-of-fence check-ins |
| **4.4 Outlet Check-Out** | 🟡 Partial | ✅ Timestamp captured, ✅ Duration auto-calculated, ✅ Cases sold, notes, store photo recorded | ❌ PRD requires check-out summary to reflect inventory, orders, schemes, and feedback — none of those modules exist yet |
| **4.5 Photo Capture** | 🟡 Partial | ✅ Selfie at attendance check-in, ✅ Store photo at visit, ✅ Private Supabase Storage, ✅ Gallery blocked (live camera only — anti-fraud) | ❌ Only one photo per visit (single `photo_url` field), ❌ No photo tagging (GPS, caption, category), ❌ Photos not viewable in admin dashboard (`getSignedUrl` is exported but never called in any screen) |
| **4.6 Daily Work Summary & TA** | 🟡 Partial | ✅ Auto-populated daily report (market time, distance, cases, stores visited), ✅ Admin can view per-rep report detail with aggregated stats | ❌ Monthly TA report aggregation, ❌ TA approval/query/adjust workflow, ❌ Per-outlet time-in-visit breakdown in summary, ❌ Total photos count in daily summary |

### Phase 2: Add-On Modules (PRD Section 5.1–5.5)

| PRD Requirement | Status | Notes |
|-----------------|--------|-------|
| **5.1 Store Inventory Tracking** | 🔴 Not Built | No `products` SKU master table, no inventory entry UI, no low-stock alerts, no historical inventory data |
| **5.2 Order Taking** | 🔴 Not Built | No order model, no SKU-based order form, no order confirmation, no admin order management |
| **5.3 Trade Schemes & Incentives** | 🔴 Not Built | No scheme creation, no scheme display during order entry, no uptake tracking |
| **5.4 Market Feedback** | 🔴 Not Built | No structured feedback categories, no feedback capture UI, no admin feedback log |
| **5.5 Area Mapping of Retail Outlets** | 🔴 Not Built | No map SDK integrated; no outlet type or visit frequency target fields in `stores` table; new outlet creation exists (via rep dashboard add-store flow) but uses Places search rather than GPS auto-capture; no outlet data export |

### Phase 3: Admin Dashboard — Web Interface (PRD Section 6)

| PRD Requirement | Status | Notes |
|-----------------|--------|-------|
| Live Field Map | 🔴 Not Built | No map integration (Google Maps / Mapbox) anywhere in the app |
| Salesman Summary | 🟡 Partial | Admin can see daily visit logs per rep; no distance/time per salesman in the admin view |
| Order Management | 🔴 Not Built | No order system |
| Inventory Reports | 🔴 Not Built | No inventory system |
| Scheme Dashboard | 🔴 Not Built | No scheme system |
| Feedback Log | 🔴 Not Built | No feedback system |
| TA Report | 🔴 Not Built | No monthly TA aggregation |
| Outlet Master | 🟡 Partial | Admin CRUD for stores exists, but no map view and no per-outlet visit history panel |
| **Web Dashboard** | 🔴 Not Built | Everything is in the mobile app only. PRD **explicitly requires** a browser-based web dashboard for admin. No React.js web app exists. |

### Technical Requirements (PRD Section 7)

| Requirement | Status | Notes |
|-------------|--------|-------|
| **7.1 Platform — Android-first mobile** | 🟢 Done | React Native + Expo, Android package `com.anonymous.TankAssistCodex` configured |
| **7.1 Platform — Web dashboard for admin** | 🔴 Not Built | No separate web app |
| **7.2 Offline Capability** | 🔴 Not Built | No offline data storage, no sync queue, no online/offline indicator |
| **7.3 GPS & Location** | 🟡 Partial | Foreground GPS works; no background tracking, no geo-fence enforcement |
| **7.4 Photo Storage** | 🟡 Partial | Supabase Storage used (private bucket, 4 RLS policies confirmed live); no compression before upload (`quality: 0.7` in `takePictureAsync` is camera quality, not upload compression); admin cannot view photos |
| **7.5 Data Security** | 🟡 Partial | HTTPS (Supabase), RLS on all 6 tables, role-based access. **Critical bug: see RLS section below.** |
| **7.6 Tech Stack** | 🟢 Aligned | React Native (matches PRD), PostgreSQL via Supabase (matches PRD), phone OTP auth (replaces PRD's suggested Firebase Auth / JWT) |

### Acceptance Criteria (PRD Section 9)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Salesman can log in, check in with photo, visible on admin map within 60s | 🔴 No admin map |
| 2 | GPS tracked every 5–10 min, daily route playback on dashboard | 🔴 Not built |
| 3 | Check-in rejected if >50m from outlet's GPS coordinates | 🔴 Distance logged passively, never enforced |
| 4 | Inventory data visible on admin dashboard after sync | 🔴 No inventory module |
| 5 | Order raised from field appears in admin order management | 🔴 No order module |
| 6 | Trade scheme activated by admin appears on salesman's device | 🔴 No scheme module |
| 7 | Field feedback visible and filterable in admin dashboard | 🔴 No feedback module |
| 8 | New outlet added by salesman appears on map after sync | 🔴 Reps can add stores, but there is no map |
| 9 | Monthly TA report summarises hours, outlet count, distance | 🔴 Not built |
| 10 | App functions in offline mode with correct sync | 🔴 No offline support |

---

## 5. Live RLS Audit (verified 26 June 2026 via Supabase MCP)

### Storage
| Bucket | Visibility | Policies |
|--------|-----------|---------|
| `visit-photos` | Private ✅ | 4 policies on `storage.objects` — INSERT/SELECT/UPDATE/DELETE, all scoped to `authenticated` role and `bucket_id = 'visit-photos'` ✅ |

### Public Table RLS — Summary

| Table | RLS Enabled | Rep access | Admin access | Issue |
|-------|------------|-----------|-------------|-------|
| `users` | ✅ | Read own row ✅ | `get_my_role()` IN (sales_manager/state_head/management) ✅ | None |
| `stores` | ✅ | Any authenticated user can INSERT ✅, SELECT ✅ | UPDATE/DELETE: `get_my_role()` correct ✅ | None |
| `store_assignments` | ✅ | Authenticated read ✅ | INSERT/UPDATE/DELETE: checks `role = 'admin'` ❌ | **Bug — see below** |
| `attendance` | ✅ | Read/insert/update own ✅ | Admin read: checks `role = 'admin'` ❌ | **Bug — see below** |
| `store_visits` | ✅ | Read/insert/update own ✅ | Admin read: checks `role = 'admin'` ❌ | **Bug — see below** |
| `daily_reports` | ✅ | Read/insert own ✅ | Admin read: checks `role = 'admin'` ❌ | **Bug — see below** |

### ⚠️ Critical RLS Bug

**Four tables have admin-access policies that reference `role = 'admin'`, but no user in the system has that role.** The live `users` table constraint is `CHECK (role IN ('rep', 'sales_manager', 'state_head', 'management'))`. The role `'admin'` no longer exists.

Affected policies:
- `attendance` — "Attendance: admin read all": `EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')`
- `daily_reports` — "Reports: admin read all": same pattern
- `store_visits` — "Visits: admin read all": same pattern
- `store_assignments` — "Assignments: admin insert/update/delete": same pattern

**Practical impact:**
- Admin dashboard cannot load attendance or visit data for any rep — the admin read policy will never grant access
- Sales managers cannot create or modify store assignments via the Assign Stores modal
- Admin Reports screen will load `daily_reports` list (joined with `users`) but the detail panel queries `attendance` and `store_visits` which will return empty

The `stores` and `users` tables were already migrated to use `get_my_role()` with the correct role names. The fix for the remaining four tables is to replace the `role = 'admin'` check with `get_my_role() = ANY (ARRAY['sales_manager', 'state_head', 'management'])`.

---

## 6. Current Phase Assessment

### We are in: **Phase 1 — Partially Complete**

```
PHASE 1 (Core)            ████████████░░░░░░░░  ~60%
PHASE 2 (Inventory/Maps)  ░░░░░░░░░░░░░░░░░░░░   0%
PHASE 3 (Orders/Schemes)  ░░░░░░░░░░░░░░░░░░░░   0%
PHASE 4 (Feedback/TA)     ░░░░░░░░░░░░░░░░░░░░   0%
```

**What's done in Phase 1:**
- ✅ Phone OTP login and role-based auth (4 roles)
- ✅ Self-registration with manager picker for reps
- ✅ Attendance check-in with GPS + selfie
- ✅ Outlet check-in / check-out with time tracking
- ✅ Store photo capture during visits (gallery blocked, live only)
- ✅ Cases sold tracking per visit (supports zero-order)
- ✅ Passive distance logging from rep to store (haversine, not enforced)
- ✅ Daily report with auto-populated stats (market time, distance, cases, stores visited)
- ✅ Punch-out with total distance calculation across all visit waypoints
- ✅ "Punch In Store" modal: search any store OR create a new store with Places API address
- ✅ My Stores: Assigned Today / All Stores toggle with client-side search
- ✅ Live data refresh on dashboard and stores screen via `useFocusEffect`
- ✅ Safe area tab bar fix (dynamic height using `useSafeAreaInsets`)
- ✅ Profile screen with initials avatar, role label, and rep's manager name
- ✅ Admin dashboard with attendance and store coverage overview
- ✅ Admin CRUD for stores (with Places API) and reps (email/password creation)
- ✅ Admin store assignment workflow (delete + re-insert per rep per day)
- ✅ Admin report viewing with per-rep detail drill-down

**What's missing to complete Phase 1:**
- ❌ **Fix RLS policies** on attendance, store_visits, daily_reports, store_assignments (admin access broken)
- ❌ Background GPS tracking at 5–10 min intervals
- ❌ Live admin map showing active salesmen
- ❌ Daily route playback on map
- ❌ Geo-fence enforcement on outlet check-in (50m radius)
- ❌ Configurable geo-fence radius (admin setting)
- ❌ Device locking (one device per salesman)
- ❌ Multiple photos per visit with GPS/category tagging
- ❌ Photos viewable in admin dashboard
- ❌ Monthly TA report generation
- ❌ Per-outlet time breakdown in daily summary

---

## 7. What Needs to Be Done Next

### 7.1 Immediate Fixes (bugs in current build)

| Priority | Fix | Effort | Detail |
|----------|-----|--------|--------|
| **P0 — Critical** | Fix RLS policies on 4 tables | Small | Replace `role = 'admin'` with `get_my_role() = ANY (ARRAY['sales_manager','state_head','management'])` on attendance, store_visits, daily_reports, store_assignments admin policies |
| **P0 — Critical** | Update supabase-schema.sql | Small | Add all missing columns documented in Section 3.2 so the file matches live DB |

### 7.2 To Complete Phase 1

| Priority | Feature | Effort | Dependencies |
|----------|---------|--------|--------------|
| **P0** | Geo-fence enforcement on store check-in | Small | Haversine already exists — enforce distance check at check-in, not just log it |
| **P0** | Background GPS tracking (5–10 min intervals) | Large | `expo-location` background task, new `location_logs` table, battery/permission handling |
| **P0** | Admin live map with active salesmen | Large | Google Maps / Mapbox SDK, `location_logs` real-time subscription |
| **P1** | Photo display in admin view | Small | Call `getSignedUrl` (already exists in `lib/storage.ts`) and render photos in admin visit detail modal |
| **P1** | Daily route playback on map | Medium | Requires `location_logs` data + map polyline rendering |
| **P1** | Monthly TA report | Medium | Aggregate attendance data by month; per-salesman summary view |
| **P2** | Configurable geo-fence radius | Small | Admin setting stored in a config table or `users` profile; read at check-in time |
| **P2** | Multiple photos per visit with tagging | Small | Array of photos per visit, category picker, `photo_url` → `photo_urls` jsonb or a separate `visit_photos` table |
| **P2** | Device locking | Medium | Store device ID (Expo `Constants.deviceId`) in `users` profile; validate on login |

### 7.3 Phase 2 (Inventory + Maps)

| Feature | Effort | Notes |
|---------|--------|-------|
| SKU master (admin creates/manages product list) | Medium | New `products` table |
| Inventory entry UI (salesman records stock per SKU per outlet) | Medium | New `store_inventory` table + form inside StoreVisit flow |
| Low-stock alerts | Small | Configurable threshold per SKU |
| Historical inventory charts | Medium | Admin dashboard graph/table per outlet |
| Outlet map view with colour-coded visit status | Large | Maps SDK integration (need to add `outlet_type` and `visit_frequency_target` to `stores` table) |
| Outlet data export | Small | CSV download from admin outlet master |

### 7.4 Phase 3 (Orders + Schemes)

| Feature | Effort | Notes |
|---------|--------|-------|
| Order model (orders + order_items) | Medium | New tables |
| Order taking UI for salesman | Medium | SKU picker + quantity entry during visit, linked to visit record |
| Admin order management dashboard | Medium | Order list with filters |
| Trade scheme CRUD for admin | Medium | New `schemes` table |
| Scheme display during order entry | Small | Fetch active schemes, display on relevant SKUs |
| Scheme uptake tracking | Medium | Link schemes to orders |

### 7.5 Phase 4 (Feedback + Reporting)

| Feature | Effort | Notes |
|---------|--------|-------|
| Structured feedback categories | Small | Pre-defined: competitor activity, retailer complaint, stock return, cold storage, new SKU interest |
| Feedback capture UI | Medium | Category selector + free text, linked to visit record |
| Admin feedback log with filters | Medium | Dashboard view |
| TA monthly report with approval workflow | Medium | Aggregate data, admin approve/query/reject |
| Full reporting suite | Large | Cross-module analytics |

### 7.6 Separate Web Admin Dashboard

The PRD **explicitly requires** a browser-based web dashboard for admin (Section 6, Section 7.1). The current admin screens are in the mobile app only. A React.js web dashboard needs to be built separately, connecting to the same Supabase backend using the same tables and RLS.

### 7.7 Offline Support

The PRD requires full offline capability — local storage of check-ins, inventory, orders, and feedback with sync when connectivity returns. This is a cross-cutting concern that touches every module and requires a sync queue architecture (e.g., MMKV + upload queue). The app currently has no offline mode.

### 7.8 Infrastructure / Hygiene

| Item | Notes |
|------|-------|
| Move API keys to environment variables | Supabase URL/anon key and Google Maps API key are all hardcoded in source |
| Photo compression before upload | PRD 7.4 requires device-side compression; currently `quality: 0.7` only controls camera capture quality, not upload compression |
| `getSignedUrl` wiring | The function exists and works; no screen currently calls it — photos are uploaded but never displayed back |

---

## 8. Summary

| Metric | Value |
|--------|-------|
| **PRD Phases** | 4 |
| **Current Phase** | Phase 1 (partially complete) |
| **Phase 1 Completion** | ~60% |
| **Overall PRD Completion** | ~20% |
| **Screens Built** | 13 (3 auth + 5 rep + 4 admin + 1 shared) |
| **Database Tables** | 6 (all live and RLS-enabled) |
| **Storage Buckets** | 1 (`visit-photos`, private, 4 RLS policies) |
| **Acceptance Criteria Met (of 10)** | 0 fully met |
| **Active RLS Bugs** | 1 critical — admin access broken on 4 tables |
| **Critical Missing Capabilities** | Live GPS tracking, Maps, Geo-fence enforcement, Offline mode, Web dashboard, Inventory/Orders/Schemes/Feedback modules |

The foundational scaffolding — OTP auth, basic check-in/out flow, photo capture, daily reporting, admin CRUD — is solid and functional. The most urgent task before any new features is patching the four broken RLS policies, which currently prevent all admin-role users from reading field data. After that, the GPS/maps infrastructure is the highest-value Phase 1 work remaining.

---

*Generated on 26 June 2026 from live codebase inspection (`E:\TANK90\TankAssist-Codex`) and live Supabase project `ldgunrxceogfrohjrlxz` verified via MCP.*
