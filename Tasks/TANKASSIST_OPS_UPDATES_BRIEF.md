# TankAssist — ops updates: inventory, product master, dashboard, live location

Five changes, building on the completed A–N redesign and the tester role-switch. Two of these
touch schema and are STOP-POINTs; two are presentation-only and don't need one. Work in the
order given in §6, report after each STOP-POINT confirmation and again once each item is built.

---

## 0. Guardrails

- **Schema STOP-POINTs still apply here**, even though the standing instruction says don't pause
  for visual sign-off on redesign phases — that instruction covered cosmetic phases only. Any
  change touching `products`, RLS, or a new table gets: verify live via MCP → propose full SQL →
  wait for confirmation → apply → verify live → impersonation-test → then app code.
- Verify the live schema via MCP before proposing any SQL — don't assume current column names.
- `npx tsc --noEmit` clean after each item. Complete files. No new secrets.
- **Never touch `lib/reportSemantics.ts`'s cutover logic.** Anything new that needs cases figures
  calls the existing `casesSold`/`repCasesSold` hybrid — it is never reimplemented or duplicated.
- **Out-of-stock, archived, and a store's own shelf stock are three separate concepts** — don't
  conflate them anywhere in schema, RLS, or UI copy.
- Reuse `DESIGN.md` tokens and existing patterns (the chunking stepper, `StoreLocationPicker`,
  the storage/image-picker upload pattern) — extend, don't fork.

---

## 1. Product out-of-stock flag (management-only)

A third product state, distinct from `archived` (discontinued forever) and distinct from
`store_stock_snapshots` (a store's own shelf stock, recorded by reps). Out-of-stock means:
temporarily unsellable everywhere, but still a live SKU that can come back.

- Verify live schema, then add `products.is_out_of_stock boolean not null default false`
  (additive, zero behavior change for existing rows). Bundle this into the same STOP-POINT
  migration as §2's new columns — one confirm/apply/verify cycle for both.
- Confirm the existing management-only product UPDATE RLS already covers this column; extend it
  if not.
- **Enforce server-side, not just client-side.** Extend the `order_items` INSERT policy (or add a
  trigger) so a row can't be inserted if its `product_id` maps to a product with
  `is_out_of_stock = true`. Impersonation-test: a rep's order attempt on an OOS product must fail
  at the DB level even if the client somehow tries to submit it anyway.
- Client-side: **disable, don't hide** OOS products in the order-placement picker (the check-in
  stepper's order step) — a clear "Out of stock" tag, so it reads as unavailable rather than
  having silently vanished.
- Management Products screen: a toggle per product ("Mark out of stock" / "Mark in stock"),
  visually distinct from the existing Archive/Unarchive control and from each other.

---

## 2. Product schema + multi-step add/edit redesign (management-only)

Supersedes the earlier Phase J reskin of this screen — this is a schema + UX overhaul of the same
area, not a second pass on top of it. Generic across any brand, not Tank-90-specific.

**New columns (all nullable — verify against live schema first, only add what's actually
missing):**
- `brand` (text) — a plain field for now, not a normalized Brands table; that's real future scope
  only if a second brand actually onboards, not before.
- `category` (text)
- `unit_type` (text — Bottle/Can/Packet/Box/etc.; a curated picker in the UI, not a DB CHECK)
- `unit_size` (numeric), `unit_of_measure` (text: ml/L/g/kg/pcs)
- `units_per_case` (integer)
- `gst_percent` (numeric)
- `shelf_life_months` (integer — general shelf life, not per-batch expiry/lot tracking; that's
  out of scope)
- `sku`, `barcode`, `hsn_code` (text — all optional; blank is fine for non-Indian /
  non-Tank-90 products)
- product image — reuse the existing Supabase storage + image-picker pattern already used for
  shop/stock photos; don't invent a new upload path.

**Don't store** a computed "24 × 500 ml" case-config string — derive it for display from
`unit_size` + `unit_of_measure` + `units_per_case` so it can never drift out of sync with the
underlying fields.

**UI:** rebuild add/edit as a 3-step wizard (reuse the chunking-stepper pattern from the check-in
flow / OTP enrollment):
1. **Basic info** — name, brand, category, image.
2. **Packaging** — unit type/size/UOM, units per case, a live-computed case-config preview.
3. **Commercial & availability** — price (optional, existing), GST (optional), shelf life
   (optional), archived / out-of-stock status.

Only name + at least one packaging field are required — everything else stays genuinely optional
so a fast, simple entry is still fast. Use Stitch for the layout reference (brand-agnostic,
DESIGN.md tokens); skip Higgsfield — this is a form/data-entry problem, not a visual-asset one.

---

## 3. Today's date on the management dashboard

Add today's actual date to the management dashboard header, matching the exact greeting/date
pattern already built for the rep dashboard. Presentation-only, no STOP-POINT.

---

## 4. Cases trend chart — real dates + a stock-style range selector

- Add a header on the chart card showing the exact date range currently displayed and its total,
  so the graph is self-explanatory without guessing.
- Add a compact range selector (segmented control or dropdown): **1W / 1M / 3M / 6M / 1Y / 3Y /
  5Y**.
- **Before committing to daily granularity at long ranges, check how expensive
  `casesSold`/`repCasesSold` actually is per call.** If it's not cheap in bulk, cap granularity by
  range instead of making hundreds of calls — e.g. daily for 1W–1M, weekly for 3M–1Y, monthly for
  3Y–5Y. Whatever bucketing is used must still route through the exact same hybrid cutover rule
  (`ORDERS_CUTOVER_DATE` — never both legacy and order-cases for the same bucket); don't
  reimplement that logic a second time for the chart.
- Real dates labeled on the x-axis; tap a bar for exact date + value. Bar vs. line is your call
  per range — keep the one-lime-spotlight rule (highlight only the current/most recent bucket).

---

## 5. On-demand live location (management + sales_manager, own reps only)

**Architecture (confirmed):** request/response over **Supabase Realtime**, not push
notifications, not continuous tracking. This is its own STOP-POINT — new table, new RLS surface,
and a real security question of who can request location for whom.

- Verify live schema first, then propose the full SQL for confirmation before applying.
- `location_requests` table: `id`, `rep_id` (fk users), `requested_by` (fk users),
  `requested_at`, `lat`, `lng`, `responded_at`, `status` (`pending`/`completed`/`expired`).
- **RLS:**
  - A `sales_manager` may INSERT a request only where `rep_id` is one of their own assigned/
    dependent reps (mirror whatever relationship already backs the existing "dependent-rep count"
    on the sales-manager side).
  - `management` may INSERT a request for any active rep.
  - A rep may UPDATE only **their own** row's `lat`/`lng`/`responded_at`/`status`, and only while
    `is_active = true`.
  - The requester may SELECT only requests they themselves created.
- **App — rep side:** while checked in, subscribe to `postgres_changes` on this table filtered to
  their own `rep_id`. On a new pending request, take one `getCurrentPositionAsync()` reading and
  write it back immediately. Don't subscribe at all while not checked in — a request for a
  not-checked-in rep should fail fast with "Rep isn't checked in," not hang.
- **App — requester side** (Team / rep detail, management + sales_manager): "Get location" button
  → loading state → on response within a ~15–20s timeout, show a map (reuse the
  `StoreLocationPicker` map pattern) with a marker + "as of just now" + a Navigate button
  (`Linking.openURL` to a Google Maps directions URL — no maps SDK call needed for this part).
  On timeout, **fall back** to the rep's most recent check-in/visit GPS event with its real
  timestamp, clearly labeled as not live — never hang, never fake currency.
- **Impersonation-test:** a sales_manager can request their own reps but is denied requesting a
  rep outside their team; management can request any active rep; a rep can update only their own
  pending request, never someone else's.
- No new native dependency (rides existing `expo-location` + the Supabase client) — this stays
  OTA-eligible like everything else in this brief.

---

## 6. Suggested order of work

1. **Item 3** first — trivial, zero risk, ships immediately.
2. **Items 1 + 2** together — one coordinated STOP-POINT migration (both touch `products`), then
   the multi-step UI. Report the SQL for confirmation before applying.
3. **Item 4** — no STOP-POINT, but do the `casesSold` cost check before committing to granularity.
4. **Item 5** — its own separate STOP-POINT (new table + RLS). Report the SQL for confirmation
   before applying, then build, then report the impersonation-test results explicitly.

Report after each STOP-POINT confirmation and again once each item is built and `tsc`-clean.
