# TankAssist — Orders, Inventory, Roles & Voice Restructure

Paste this into the Claude Code session. Read `CLAUDE.md` + `HANDOFF.md` first. This is the
largest change to the app so far — it turns TankAssist from a visit tracker into an
ordering + inventory system. It will span multiple sessions; the phases below are ordered
so each leaves the app shippable.

## Non-negotiable guardrails (unchanged from previous specs)

- Verify live schema via Supabase MCP before assuming anything — every phase, every time.
- Every schema change is a STOP POINT: output exact SQL, wait for explicit confirmation,
  apply via MCP, verify live (including table GRANTs — remember the earlier finding that
  MCP-created tables get zero API-role grants), impersonation-test RLS, then write app code.
- Complete files only. `npx tsc --noEmit` clean after every touched file.
- STOP and report after each phase. Do not self-chain.
- Reuse existing design tokens and components. No new component libraries.
- Do not touch: geo-fence, offline sync, background GPS, live maps — still out of scope.
- If OTA (expo-updates) is configured, push `eas update` at the end of each JS-only phase.
  Native-module phases (Phase 8 only) require a fresh EAS build — batch that once, at the end.

## Decisions already made by the user (do not re-ask)

1. **Order processing is Management-only.** Sales managers cannot approve or advance
   orders. (The flowchart note "Order sent to SM" = the order becomes visible in
   Management's To-Process queue; no notification system in v1.)
2. **Sales Manager's app after this change:** Dashboard + Team + Stores (as today) +
   Profile. No Products, no order processing, no Add-User.
3. **Orders replace "cases sold"** as the sales record going forward. Remove the cases-sold
   input from the new check-in flow. Reports/dashboards compute "Cases Sold" as cases in
   orders placed in the period (excluding cancelled), falling back to legacy
   `store_visits.cases_sold` for historical dates. Never delete or rewrite legacy data.
4. **Roles become exactly three:** `rep`, `sales_manager`, `management`. `state_head` is
   deleted entirely.
5. **Voice notes: on-device OS speech recognition.** No Python (impossible in RN), no
   external API, no audio ever uploaded — transcript text only reaches Supabase.
6. **Pricing (default, user can veto at Phase 3 STOP point):** `products` gets optional
   `price_per_case` / `price_per_bottle numeric null`; `order_items` snapshots prices at
   placement when present; order totals display only when prices exist.

---

## PHASE 0 — Audit (read-only)

Verify live and report:
1. All distinct `users.role` values in the live table — are there any actual `state_head`
   users? Any existing constraint on the role column?
2. Every RLS policy and function whose definition references `state_head` (full list with
   table + policy name — this scopes the Phase 1 migration).
3. The register flow: files involved, the manager-dropdown RPC (`get_sales_managers`),
   and exactly where a new user's `users` row gets created after OTP.
4. The current check-in flow structure in `app/(rep)/store-visit.tsx` (mount-insert,
   photo steps, checkout update) — the Phase 5 stepper rebuilds this.
5. Where notes/text inputs live (visit notes, feedback, daily report notes/challenges) —
   these are the voice-input attachment points for Phase 8.
6. Whether expo-updates/OTA is configured and what the current channel setup is.
7. The state of the report code: in-app CSV export + the Puppeteer PDF prototype in
   `sample-reports/` — Phase 9 ports that template in-app.

---

## PHASE 1 — STOP POINT: role restructure + account deactivation + registration lockdown

Propose (do not apply until confirmed):

1. **Delete `state_head`:** migrate any existing state_head users to `management`
   (report how many from Phase 0). Update the role CHECK constraint to exactly
   `('rep','sales_manager','management')`. Rewrite every policy/function found in Phase 0
   that references `state_head` — the standard manager array becomes
   `ARRAY['sales_manager','management']`.
2. **Soft-ban:** `users.is_active boolean not null default true`. Enforcement: fold the
   check into `public.get_my_role()` (return NULL when the caller's row has
   `is_active = false`) so every existing role-based policy automatically fails for
   deactivated users — plus keep a self-read policy so the app can detect the state and
   show "Your account has been deactivated. Contact your management team." and sign out.
   Note explicitly in the proposal: with the anon-key-only architecture a deactivated
   user's *existing* session dies at next token refresh (the short JWT TTL the user
   already configured makes this minutes, not hours). A true instant kill would need a
   service-role Edge Function — offer it as an optional follow-up, do not build it
   unprompted.
3. **Register flow removal:** self-registration is deleted. New login behavior for a
   phone number with no `users` row: show "No account found. Contact your management
   team." Recommend a pre-OTP check via a minimal SECURITY DEFINER RPC
   (`phone_registered(phone) returns boolean`, anon-executable, returns only a boolean)
   so the app never sends an OTP SMS to unregistered numbers (saves SMS cost); flag the
   phone-enumeration tradeoff explicitly and let the user pick pre-OTP RPC vs post-OTP
   check at this STOP point. Remove the Register screen + `get_sales_managers` usage from
   auth flows (verify nothing else consumes it before dropping anything).
4. **User creation is Management-only** (UI enforcement in Phase 2; RLS: the users INSERT
   policy, if any exists beyond the register path, must be management-scoped).

Apply on confirmation, verify live, impersonation-test: deactivated rep gets nothing;
sales_manager retains manager-level reads; management retains everything.

## PHASE 2 — Team section (rename, grouping, add/deactivate users) — app-side

1. Rename Reps → **Team** everywhere (tab, headers, titles).
2. **Role-grouped accordion** in the Team list, same collapsible pattern as the stores
   state accordion: for management, three groups (Sales Managers / Sales Reps /
   Management); for sales managers, reps only (flat or single group — their view is
   otherwise unchanged).
3. **Accordion header font bump:** the user finds the current state-accordion headers too
   small. Increase the accordion section-header typography (both here and the Stores
   screen) — noticeably larger and bolder than card body text, while staying within the
   existing type scale. Apply consistently to both accordions.
4. **Add User (Management only):** extend the existing add-rep form with a role selector
   (rep / sales_manager / management). Preserve the existing signUp-based creation
   pattern exactly as it works today. Sales managers see no Add button.
5. **Deactivate/Reactivate (Management only):** inside the member detail, a clearly
   destructive-styled action with confirmation. Cannot deactivate yourself. When
   deactivating a sales manager, surface (read-only note) how many reps have
   `assigned_manager_id` pointing at them — don't block, just inform.

## PHASE 3 — STOP POINT: Products

Propose schema: `products` — `id uuid pk`, `name text not null`, `unit text not null`
(free text: ml/kg/pieces/etc.), `qty_per_carton int not null check (> 0)`,
`product_code text null`, `price_per_case numeric null`, `price_per_bottle numeric null`
(pricing default per decision #6 — user may veto here), `is_active boolean not null
default true`, `created_by uuid references users`, `created_at timestamptz`.

RLS: all authenticated can SELECT (reps need the catalog to place orders); INSERT/UPDATE
management only; **no DELETE policy at all — archiving via `is_active=false` is the only
removal**, because historical orders must keep referencing discontinued products. GRANTs
per the known MCP gotcha.

App: **Products tab, Management only** (this is the moment AdminTabs splits by role —
sales managers keep today's tab set, management gains Products): list (active +
collapsed archived section), add/edit form, archive/unarchive. Type-check, verify,
impersonation-test (rep can read, rep cannot insert).

## PHASE 4 — STOP POINT: Orders + stock (the big schema)

Propose all of it in one block, apply only on confirmation:

- **`orders`**: `id`, `store_id fk`, `placed_by fk users`, `visit_id fk store_visits null`,
  `status text not null check in ('placed','in_process','in_transit','delivered',
  'cancelled')` (text + CHECK, not a Postgres enum — easier to migrate later),
  `order_notes text null`, `cancellation_reason text null`, `delivered_photo_paths text[]
  null`, `delivered_verified_by fk users null`, `created_at`.
- **`order_items`**: `order_id fk cascade`, `product_id fk products`, `cases int`,
  `bottles int`, `free_cases int default 0`, `free_bottles int default 0`, price
  snapshot columns (if pricing survives Phase 3), check that at least one quantity > 0.
- **`order_status_history`**: `order_id`, `from_status`, `to_status`, `changed_by`,
  `reason text null`, `changed_at`. Every transition writes here.
- **`store_stock_snapshots`**: `id`, `store_id`, `product_id`, `visit_id null`,
  `cases int not null`, `bottles int not null`, `recorded_by`, `recorded_at`.
  "Current stock" for a store+product = the latest snapshot row. Append-only history by
  design (no updates) — the timeline is the audit trail.
- **Status transition enforcement — recommend a SECURITY DEFINER RPC**
  `update_order_status(order_id, new_status, reason default null)` that atomically
  validates the permission matrix + legal transitions and writes the history row, instead
  of trying to express the matrix in UPDATE policies. Matrix: **rep** may set only
  `delivered` (any active order at a store they're checking into, sets
  delivered_verified_by) or `cancelled` (with mandatory reason); **management** may move
  placed→in_process→in_transit→delivered and cancel from any non-terminal state, also
  with reason. No other transitions exist. Follow the `get_my_role` hardening pattern
  (`SET search_path = ''`, EXECUTE revoked from anon).
- RLS: all authenticated SELECT on all four tables (reps must see a store's previous
  orders at check-in regardless of assignment); orders INSERT by any authenticated with
  `placed_by = auth.uid()`; order_items INSERT only alongside own order; direct UPDATE on
  orders denied to everyone (all mutations via the RPC); snapshots INSERT with
  `recorded_by = auth.uid()`.

Verify + impersonation-test the matrix (rep cancels with reason ✓, rep tries
placed→in_process ✗, management advances ✓).

## PHASE 5 — New rep check-in flow (stepper, per the user's flowchart)

Rebuild `store-visit.tsx` as a sequential stepper. Keep the mount-time visit insert
(check-in lock) exactly as-is. Steps:

1. **Previous order status** — fetch the store's most recent non-terminal order
   (placed/in_process/in_transit). None (or brand-new store) → skip silently. If one
   exists, show its detail (items, date, status) with three choices: **Mark Delivered**
   (optional delivered-stock photos → `delivered_photo_paths`, then RPC → delivered),
   **Cancel Order** (mandatory structured reason — present a short picklist: store
   refused / wrong order / duplicate / other+free text — confirm dialog, then RPC), or
   **Skip** ("no new stock visible, continue check-in").
2. **Update present stock** — per active product: cases + bottles inputs, prefilled with
   the store's latest snapshot values where they exist (label: "last updated <date> by
   <name>"). Rep may skip entirely (new store / can't verify). Each filled product writes
   one `store_stock_snapshots` row at checkout.
3. **Shop photos** — existing multi-photo capture, unchanged.
4. **Stock photo** — required only when any stock entered in step 2 is > 0; uses the
   existing photo pipeline with a distinct storage path segment (`stock-photos/...`
   following the established path convention).
5. **Place order (optional)** — product picker (active products only) → per product:
   cases, bottles, freebies (free cases/bottles) → order notes → a confirmation summary
   screen (store, items, freebies, total value if prices exist) → confirm → INSERT order
   (`status='placed'`) + items, linked to this `visit_id`.
6. **Feedback/notes** — existing notes field (voice attaches here in Phase 8).

Checkout completes as today (photos upload, snapshots insert, visit row updates) — minus
the removed cases-sold input. The step indicator should make skipped/optional steps
obvious; a rep doing a plain visit (no order, no stock update) must not be slowed down —
target: skip-skip-photo-done in under four taps beyond today's flow.

## PHASE 6 — Management: Track & Process Orders

Inside the Products tab area (per the user's structure), an Orders view, Management only:
- Top: a tappable summary — count cards or a simple segmented bar chart (built with
  existing RN styling, clean card aesthetic) for **To Process / In Transit / Delivered**
  (+ Cancelled accessible but visually secondary). Tapping filters the list below.
- **To Process** (status placed or in_process): order detail = items w/ quantities +
  freebies (+ value if priced), store (name, address, state), who placed it (name + the
  existing call-icon pattern to phone them), placed date, status history. Actions:
  **Approve → in_process**, **Mark In Transit**, **Cancel (reason)** — all via the RPC.
- **In Transit**: same detail, read-focused; action: **Mark Delivered** (management
  override for when the rep can't verify) and Cancel. No delivery-partner integration in
  v1 — do not scaffold for it.
- **Delivered**: history view — who approved (from status history), who verified
  (rep name), delivered photos rendered via the signed-URL pipeline.

## PHASE 7 — Stock visibility in store screens + report semantics

1. **Store Detail (admin/manager)**: replace the "Total Cases Sold (All-Time)" block with
   a **Current Stock** section — one row per product with a snapshot: cases, bottles,
   last-updated date + by whom; products with no snapshot show "never recorded". Keep
   total-cases-ordered as a secondary stat. Add a compact recent-orders list for the
   store (status-badged), linking into order detail for management.
2. **Rep store view**: show the same current-stock summary read-only (it's what they
   confirm/update at check-in).
3. **Report semantics switch** (decision #3): everywhere "Cases Sold" is computed
   (dashboards, rep report Daily/Weekly/Monthly, CSV, PDF), the figure = cases from
   orders placed in the period (excluding cancelled) **plus** legacy
   `store_visits.cases_sold` for dates predating the orders feature. Implement the
   cutover date as a single exported constant, documented, so the two sources are never
   double-counted for the same visit.

## PHASE 8 — Voice-to-text notes (native — needs one fresh EAS build)

- Library: `expo-speech-recognition` (wraps Android SpeechRecognizer / iOS
  SFSpeechRecognizer). Config plugin + permissions (RECORD_AUDIO / iOS speech +
  microphone usage strings).
- **On-device requirement:** request on-device recognition where the platform supports it
  (`requiresOnDeviceRecognition` on iOS; `EXTRA_PREFER_OFFLINE` on Android 13+). Report
  honestly in the phase summary: on some Android devices/languages, on-device models may
  be unavailable — in that case the OS may process audio via the device's speech service.
  Surface a one-time in-app notice on first mic use stating transcription runs on the
  phone's speech engine and no audio is stored by TankAssist. Never record to a file; use
  live transcription only, so there is nothing to delete at checkout — verify the chosen
  API doesn't persist temp audio, and if it does, delete it immediately.
- **Language:** selector on the mic UI — English (en-IN), Hindi (hi-IN), Marathi (mr-IN)
  — remembered per user (local storage, not Supabase).
- **UX:** a mic button on every notes field found in Phase 0 (visit notes/feedback, daily
  report notes + challenges). Tap → listening indicator → live partial results → final
  transcript appends into the existing text field, fully editable before submit. Text
  saves through the exact same Supabase columns as typed text — zero schema change.
- This phase + expo-updates (if not yet built into the installed APK) batch into **one**
  fresh EAS build at the end.

## PHASE 9 — Reports: PDF export in-app + template normalization

1. Port the approved Puppeteer prototype template (sample-reports/) into the app via
   `expo-print` (HTML → PDF on-device): same layout — header block, four stat cards, the
   three inline-SVG charts, visit table, notes. Flag any CSS features the prototype used
   that WebView-based rendering can't reproduce and adjust minimally.
2. **Template is per-month, always:** the report renders one month per page in the
   identical template regardless of how many months the export covers — 1 month = 1 page,
   10 months = 10 pages, same pattern every time. No layout differences between a
   single-month and multi-month download.
3. Download button becomes a two-option choice: **CSV (raw data)** or **PDF (formatted)**.
   PDF filename: `"{Rep Name} Report - {Month Name} {Year}.pdf"` (multi-month:
   `"... - {First Month}–{Last Month} {Year}.pdf"`). Share via the existing expo-sharing
   flow.
4. "Cases Sold" figures in both formats follow the Phase 7 semantics.

## PHASE 10 — Docs

Propose diffs to `CLAUDE.md` (new tables, three-role model, order status machine + RPC,
stock snapshot pattern, voice architecture, report semantics cutover constant) and a full
`HANDOFF.md` re-snapshot. Wait for confirmation before writing, per house style.

---

## Open items the user may veto at the marked STOP points
- Pricing on products (default: optional nullable prices — Phase 3).
- Pre-OTP `phone_registered` RPC vs post-OTP unknown-number handling (Phase 1).
- Instant-kill deactivation via Edge Function (offered, not built — Phase 1).
