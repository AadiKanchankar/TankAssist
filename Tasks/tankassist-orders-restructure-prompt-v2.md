# TankAssist — Orders, Inventory, Roles, Voice & Handoff Restructure (v2)

Paste this into the Claude Code session. Read `CLAUDE.md` + `HANDOFF.md` first. This is
the largest change to the app so far — it turns TankAssist from a visit tracker into an
ordering + inventory system. It spans multiple sessions; phases are ordered so the app is
always shippable between them.

## Non-negotiable guardrails (unchanged from previous specs)

- Verify live schema via Supabase MCP before assuming anything — every phase, every time.
- Every schema change is a STOP POINT: output exact SQL, wait for explicit confirmation,
  apply via MCP, verify live (including table GRANTs — MCP-created tables get zero
  API-role grants, per the earlier finding), impersonation-test RLS, then write app code.
- Complete files only. `npx tsc --noEmit` clean after every touched file.
- STOP and report after each phase. Do not self-chain.
- Reuse existing design tokens and components. No new component libraries.
- Do not touch: geo-fence, offline sync, background GPS, live maps — still out of scope.
- If OTA (expo-updates) is configured, push `eas update` at the end of each JS-only phase.
  Native-module work (Phase 9 only) requires a fresh EAS build — batch it once, at the end.

## Decisions already made by the user (do not re-ask)

1. **Order status machine — 5 stages + Cancelled, with role-owned transitions:**

   | # | Status | Set by |
   |---|--------|--------|
   | 1 | `placed` (Order Registered) | Sales Rep (at order creation) |
   | 2 | `in_process` (acknowledged) | Sales Manager & Management |
   | 3 | `dispatched` | Sales Manager & Management |
   | 4 | `in_transit` | Sales Manager & Management |
   | 5 | `delivered` (verified at store) | Sales Rep |
   | — | `cancelled` (terminal, from any non-terminal state) | Rep (at check-in, with reason) + SM & Management (with reason) |

   Transitions are strictly sequential (1→2→3→4→5); no skipping stages, no reversing.
   **One edge case to surface at the Phase 4 STOP point, not decide silently:** with
   `delivered` rep-only, an order whose store never gets re-visited stays `in_transit`
   forever. Ask the user: allow SM/Management a delivered-override (reason recorded in
   history), or keep rep-only strict?

2. **Sales Managers process orders too.** Consequence for navigation: **Orders becomes
   its own tab, visible to Sales Manager AND Management.** **Products (catalog
   add/edit/archive) is a separate tab, Management only.** Tab sets:
   - Rep: unchanged.
   - Sales Manager: Dashboard · Team · Stores · Orders · Profile.
   - Management: Dashboard · Team · Stores · Products · Orders · Profile.
   Only Management adds users (unchanged). Only Management manages the product catalog.
3. **Orders replace "cases sold"** as the sales record going forward. Remove the
   cases-sold input from the new check-in flow. Reports/dashboards compute "Cases Sold"
   as cases in orders placed in the period (excluding cancelled), falling back to legacy
   `store_visits.cases_sold` for dates predating the orders feature. Single documented
   cutover-date constant; never double-count; never rewrite legacy data.
4. **Roles become exactly three:** `rep`, `sales_manager`, `management`. `state_head` is
   deleted entirely.
5. **Voice notes: on-device OS speech recognition.** No Python (impossible in RN), no
   external API, no audio ever uploaded — transcript text only reaches Supabase.
6. **Pricing (default, user may veto at Phase 3 STOP point):** `products` gets optional
   `price_per_case` / `price_per_bottle numeric null`; `order_items` snapshots prices at
   placement when present; totals display only when prices exist.

---

## PHASE 0 — Audit (read-only)

Verify live and report:
1. All distinct `users.role` values live — any actual `state_head` users? Existing role
   CHECK constraint?
2. Every RLS policy/function referencing `state_head` (table + policy name — scopes
   Phase 1).
3. Register flow: files, the `get_sales_managers` RPC, where the `users` row is created
   post-OTP.
4. Current `app/(rep)/store-visit.tsx` structure (mount-insert, photo steps, checkout) —
   Phase 5 rebuilds it.
5. All notes/text inputs (visit notes/feedback, daily report notes + challenges) — voice
   attachment points for Phase 9.
6. expo-updates/OTA state and channel config.
7. Report code state: in-app CSV export + the Puppeteer PDF prototype (`sample-reports/`).
8. Current admin dashboard contents (both roles see the same one today?) — baseline for
   Phase 8.
9. Diff `supabase-schema.sql` against the live DB (list every drift item) — baseline for
   Phase 11.

---

## PHASE 1 — STOP POINT: role restructure + deactivation + registration lockdown

Propose (apply only on confirmation):

1. **Delete `state_head`:** migrate any existing state_head users to `management` (count
   from Phase 0). Role CHECK becomes exactly `('rep','sales_manager','management')`.
   Rewrite every policy/function from Phase 0 — the manager array becomes
   `ARRAY['sales_manager','management']`.
2. **Soft-ban:** `users.is_active boolean not null default true`. Fold the check into
   `public.get_my_role()` (return NULL when `is_active = false`) so every role-keyed
   policy fails automatically for deactivated users; keep a self-read policy so the app
   can show "Your account has been deactivated. Contact your management team." and sign
   out. Note: with anon-key-only architecture, an existing session dies at next token
   refresh (minutes, given the short JWT TTL already configured). True instant-kill needs
   a service-role Edge Function — offer as optional follow-up, don't build unprompted.
3. **Registration removal:** self-registration deleted. Unknown phone at login → "No
   account found. Contact your management team." Recommend a pre-OTP
   `phone_registered(phone) returns boolean` SECURITY DEFINER RPC (anon-executable,
   boolean only) so OTP SMS never goes to unregistered numbers (SMS cost); flag the
   phone-enumeration tradeoff and let the user choose pre-OTP RPC vs post-OTP check at
   this STOP point. Remove the Register screen; verify nothing else consumes
   `get_sales_managers` before dropping it.
4. **User creation Management-only** (UI in Phase 2; any users INSERT policy beyond the
   register path must be management-scoped).

Verify + impersonation-test: deactivated rep gets nothing; sales_manager keeps
manager-level reads; management keeps everything.

## PHASE 2 — Team section (rename, grouping, add/deactivate) — app-side

1. Rename Reps → **Team** everywhere.
2. **Role-grouped accordion** (same collapsible pattern as the stores state accordion):
   management sees Sales Managers / Sales Reps / Management groups; sales managers see
   reps only.
3. **Accordion header font bump** — the current state-accordion headers are too small.
   Increase section-header typography (Team AND Stores accordions), noticeably larger and
   bolder than card body text, within the existing type scale.
4. **Add User (Management only):** extend the existing add form with a role selector
   (rep / sales_manager / management). Preserve the existing signUp-based creation
   pattern exactly. Sales managers see no Add button.
5. **Deactivate/Reactivate (Management only):** in member detail, destructive-styled,
   confirmed action. Cannot deactivate self. Deactivating a sales manager surfaces
   (read-only) how many reps point at them via `assigned_manager_id` — inform, don't
   block.

## PHASE 3 — STOP POINT: Products

Schema proposal: `products` — `id uuid pk`, `name text not null`, `unit text not null`
(free text: ml/kg/pieces/…), `qty_per_carton int not null check (> 0)`,
`product_code text null`, `price_per_case numeric null`, `price_per_bottle numeric null`
(decision #6 — veto point), `is_active boolean not null default true`,
`created_by uuid references users`, `created_at timestamptz`.

RLS: all authenticated SELECT (reps need the catalog); INSERT/UPDATE management only;
**no DELETE policy at all** — archive via `is_active=false` only, because historical
orders must keep referencing discontinued products. GRANTs per the MCP gotcha.

App: **Products tab, Management only**: list (active + collapsed archived section),
add/edit, archive/unarchive. Verify + impersonation-test (rep reads ✓, rep inserts ✗).

## PHASE 4 — STOP POINT: Orders + stock (the big schema)

Propose in one block:

- **`orders`**: `id`, `store_id fk`, `placed_by fk users`, `visit_id fk store_visits
  null`, `status text not null check in
  ('placed','in_process','dispatched','in_transit','delivered','cancelled')` (text +
  CHECK, not a Postgres enum), `order_notes text null`, `cancellation_reason text null`,
  `delivered_photo_paths text[] null`, `delivered_verified_by fk users null`,
  `created_at`.
- **`order_items`**: `order_id fk cascade`, `product_id fk products`, `cases int`,
  `bottles int`, `free_cases int default 0`, `free_bottles int default 0`, price-snapshot
  columns (if pricing survives Phase 3), CHECK at least one quantity > 0.
- **`order_status_history`**: `order_id`, `from_status`, `to_status`, `changed_by`,
  `reason text null`, `changed_at`. Every transition writes here — this is where "who
  approved / who dispatched / who verified" comes from.
- **`store_stock_snapshots`**: `id`, `store_id`, `product_id`, `visit_id null`,
  `cases int not null`, `bottles int not null`, `recorded_by`, `recorded_at`.
  Current stock = latest snapshot per store+product. Append-only (no updates) — the
  timeline is the audit trail.
- **Status transitions via a SECURITY DEFINER RPC**
  `update_order_status(order_id, new_status, reason default null)` enforcing decision
  #1's matrix atomically (permission check + strict sequential transition check + history
  insert). Rep: → `delivered` (sets `delivered_verified_by`) or → `cancelled` (reason
  mandatory). SM & Management: → `in_process`, → `dispatched`, → `in_transit`, and →
  `cancelled` (reason mandatory) from any non-terminal state. **Surface the
  stuck-in-transit edge case here** (decision #1) and get the user's call on an SM/M
  delivered-override before finalizing the RPC. Harden like `get_my_role`
  (`SET search_path = ''`, EXECUTE revoked from anon).
- RLS: all authenticated SELECT on all four tables (reps must see a store's prior orders
  at check-in regardless of assignment); orders INSERT any authenticated with
  `placed_by = auth.uid()`; order_items INSERT only with own order; **direct UPDATE on
  orders denied to everyone** (mutations only via the RPC); snapshots INSERT with
  `recorded_by = auth.uid()`.

Verify + impersonation-test the matrix: rep cancels w/ reason ✓; rep tries
placed→in_process ✗; SM advances placed→in_process→dispatched→in_transit ✓; SM tries
in_process→in_transit (skipping dispatched) ✗; management same rights as SM ✓.

## PHASE 5 — New rep check-in flow (stepper, per the user's flowchart)

Rebuild `store-visit.tsx` as a sequential stepper. Keep the mount-time visit insert
(check-in lock) exactly as-is. Steps:

1. **Previous order status** — fetch the store's most recent non-terminal order. None →
   skip silently. Exists → show detail (items, date, status badge) with: **Mark
   Delivered** (optional delivered-stock photos → `delivered_photo_paths`, RPC →
   delivered), **Cancel Order** (structured reason picklist: store refused / wrong order
   / duplicate / other + free text — confirm dialog, RPC), or **Skip** ("no new stock
   visible, continue check-in").
2. **Update present stock** — per active product: cases + bottles, prefilled from the
   latest snapshot ("last updated <date> by <name>"). Fully skippable (new store / can't
   verify). Each filled product writes one snapshot row at checkout.
3. **Shop photos** — existing multi-photo capture, unchanged.
4. **Stock photo** — required only when any entered stock > 0; existing photo pipeline,
   distinct path segment (`stock-photos/...` per the established convention).
5. **Place order (optional)** — product picker (active only) → per product: cases,
   bottles, freebies → order notes → confirmation summary (store, items, freebies, total
   value if priced) → confirm → INSERT `status='placed'` + items, linked to `visit_id`.
6. **Feedback/notes** — existing notes field (voice attaches in Phase 9).

Checkout completes as today minus the removed cases-sold input. Skipped/optional steps
must be obvious; a plain visit (no order, no stock) must cost under four extra taps vs
today.

## PHASE 6 — Orders tab (Sales Manager + Management)

Standalone Orders tab for both roles (decision #2):
- Top: tappable summary — count cards or a simple segmented bar (existing RN styling) for
  **To Process / Dispatched / In Transit / Delivered** (+ Cancelled visually secondary).
  Tap filters the list.
- **To Process** (placed, in_process): detail = items + freebies (+ value if priced),
  store (name/address/state), placed-by (name + call icon), date, status history.
  Actions per the matrix: **Acknowledge → in_process**, **Mark Dispatched**, **Cancel
  (reason)**.
- **Dispatched / In Transit**: detail + status history; actions: **Mark In Transit**
  (from dispatched), Cancel; delivered-override only if the user approved it in Phase 4.
  No delivery-partner integration in v1 — don't scaffold for it.
- **Delivered**: history — who acknowledged/dispatched (from status history), who
  verified (rep), delivered photos via the signed-URL pipeline.

## PHASE 7 — Stock visibility + report semantics

1. **Store Detail (SM/Management):** replace "Total Cases Sold (All-Time)" with **Current
   Stock** — one row per product: cases, bottles, last-updated date + by whom; no
   snapshot → "never recorded". Total-cases-ordered stays as a secondary stat. Add a
   compact status-badged recent-orders list linking into order detail.
2. **Rep store view:** same current-stock summary, read-only.
3. **Report semantics switch** (decision #3) everywhere "Cases Sold" appears — orders
   placed in period (excl. cancelled) + legacy `store_visits.cases_sold` for pre-cutover
   dates; single exported cutover constant; no double-counting.

## PHASE 8 — Management dashboard revamp

Rebuild the Dashboard for **management** into a proper KPI view (sales managers keep the
current dashboard unless trivial to share). Cards + simple charts in the existing visual
language (clean cards, inline SVG/basic RN charts — same aesthetic as the PDF prototype;
no charting library unless one is already installed):
- **Order pipeline strip:** live counts per status (tap → Orders tab pre-filtered).
- **Cases ordered:** this month vs last month, plus a small trend chart (per-day, current
  month).
- **Today's field activity:** reps checked in today / visits so far today.
- **Stores needing attention:** stores with no visit in the last N days (pick a sensible
  default, make the constant obvious) and stores whose latest stock snapshot is zero
  across all products.
- **Top stores this month** by cases ordered.
Everything computes via existing tables + the new orders/snapshots — no new schema. If a
rollup query is heavy, propose a `security_invoker` view (STOP POINT) instead of
client-side aggregation.

## PHASE 9 — Voice-to-text notes (native — needs the fresh EAS build)

- `expo-speech-recognition` (Android SpeechRecognizer / iOS SFSpeechRecognizer). Config
  plugin + RECORD_AUDIO / iOS mic + speech usage strings.
- **On-device:** request on-device recognition where supported
  (`requiresOnDeviceRecognition` iOS; offline preference Android 13+). Report honestly:
  some Android devices/languages lack local models and fall back to the device's speech
  service. One-time notice on first mic use: transcription runs on the phone's speech
  engine; TankAssist stores no audio. Live transcription only — no audio files; if the
  API persists temp audio anywhere, delete immediately.
- **Languages:** English (en-IN), Hindi (hi-IN), Marathi (mr-IN) — selector on the mic
  UI, remembered locally per device.
- **UX:** mic button on every notes field from Phase 0 → listening indicator → live
  partials → final transcript appends to the text field, editable before submit. Saves
  through the same Supabase columns as typed text — zero schema change.
- Batch this + expo-updates (if not already in the installed APK) into **one** fresh EAS
  build at the end of the whole effort.

## PHASE 10 — Reports: in-app PDF + template normalization

1. Port the approved Puppeteer prototype template into the app via `expo-print` — same
   layout (header block, four stat cards, three inline-SVG charts, visit table, notes).
   Flag any CSS the WebView renderer can't reproduce; adjust minimally.
2. **Per-month template, always:** one month per page, identical layout regardless of
   month count (1 month = 1 page, 10 = 10 pages). No layout difference between
   single-month and multi-month exports.
3. Download becomes a choice: **CSV (raw)** or **PDF (formatted)**. PDF filename:
   `"{Rep Name} Report - {Month Name} {Year}.pdf"`; multi-month:
   `"... - {First Month}–{Last Month} {Year}.pdf"`. Share via existing expo-sharing flow.
4. Cases-sold figures follow Phase 7 semantics in both formats.

## PHASE 11 — Sync `supabase-schema.sql` to the live DB

Using the Phase 0 drift list: regenerate `supabase-schema.sql` from the live database via
MCP so it exactly matches production — all tables (including everything added this
session), columns, constraints, indexes, RLS policies, functions/RPCs, views, and the
role GRANTs. Add a header comment: generated date + "regenerate via MCP; do not
hand-edit." This file has been stale since before the four-role era — after this phase it
must be a trustworthy reference.

## PHASE 12 — Full handoff for a fresh session (Claude Code AND Claude Desktop)

The user is ending this chat lineage after this work. Produce a complete, self-contained
handoff so a brand-new session (with zero prior context) can continue:

1. **`CLAUDE.md`** — full update of durable architecture facts: three-role model +
   is_active, registration lockdown, order status machine + RPC + role matrix, stock
   snapshot pattern, products catalog rules (archive-only), Orders/Products tab split by
   role, report semantics cutover constant, voice architecture, PDF/CSV export
   conventions, schema-file regeneration rule.
2. **`HANDOFF.md`** — full re-snapshot: everything completed this effort (with migration
   names + verification evidence), pending on-device tests (new check-in stepper,
   two-device one-login, voice on real hardware, CSV/PDF share), the one fresh EAS build
   requirement and what's batched into it, out-of-scope items carried forward unchanged,
   and any open user decisions.
3. **`PROJECT_STATUS.md`** (new, repo root) — a plain-language, non-technical summary for
   the user themself: what the app now does end-to-end per role, what's live vs awaiting
   device testing, and the exact next actions in order.
4. Propose all three in chat first (house style), write on confirmation, and end with a
   short **kickoff paragraph the user can paste as the first message of the next fresh
   session** pointing it at these three files.

---

## Open items resolved at STOP points (not before)
- Pricing on products (default: optional nullable prices — Phase 3).
- Pre-OTP `phone_registered` RPC vs post-OTP handling (Phase 1).
- Instant-kill deactivation via Edge Function (offered only — Phase 1).
- SM/Management delivered-override for stuck-in-transit orders (Phase 4).
