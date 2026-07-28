# TankAssist — excise permit ingestion, inventory ledger, and analytics

Architecture for uploading government excise permits (PDF/image), extracting shipment data
without a paid LLM, converting it into per-product bottle/case movements, and surfacing
factory→warehouse / warehouse→L1 analytics + current warehouse balance on the management
dashboard. This is new schema + a new ingestion pipeline — treat it as its own set of STOP-POINTs,
separate from the ops-updates brief already in flight.

**Two real gaps closed by design, not by the formula alone:**
1. A permit's bulk-litre total is a *liquor-class* total, not a SKU total — it never states which
   product it belongs to. A product-match step is required, not inferred.
2. A permit has no "Factory / Warehouse / Distributor" field — only two license numbers. Movement
   direction can only be derived by looking those numbers up against a registry of **our own**
   facilities, which does not exist yet and must be built + manually populated by the business
   before classification can work at all.

---

## 0. Guardrails

- Verify the live `products` schema via MCP first — use the **real** column names already
  confirmed (`qty_per_carton`, `unit_type`, `unit_size`, `unit_of_measure`, `product_code`, `sku`,
  `barcode`, `hsn_code`, `price_per_case`, `price_per_bottle`, `gst_percent`,
  `shelf_life_months`, `image_path`, `is_active`, `is_out_of_stock`) — not the guessed names from
  the earlier ops-updates brief, if those differ once applied.
- Every new table is additive; nothing here touches `orders`/`order_items`/existing RLS.
- **The inventory ledger is append-only.** `inventory_movements` rows are only ever inserted,
  never updated/deleted. Current balance = a sum over history, never a mutable counter.
- **Never auto-write a movement from an unreviewed permit.** Extraction produces a `pending`
  record; a human (management) must confirm/correct the product match and facility classification
  before an `inventory_movements` row is created.
- **No service-role key in the mobile app**, same as everywhere else in this codebase. Any actual
  file parsing runs server-side (Supabase Edge Function or a dedicated worker); the app only
  uploads to a locked storage bucket and reads back `pending`/`approved` rows via the anon key.
- STOP-POINT protocol for all schema: confirm → apply → verify live → impersonation-test → app code.
- `npx tsc --noEmit` clean after each phase. Complete files.

---

## 1. Data model

```sql
-- Our own facilities — the registry that makes movement classification possible.
-- Anything NOT in this table is treated as an external party (a distributor/L1) by default.
create table public.company_facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_no text not null unique,
  license_type text,              -- e.g. 'L-1', 'L-1AB1' — descriptive, state-specific meaning
  state text not null,
  facility_type text not null check (facility_type in ('factory','warehouse')),
  is_active boolean not null default true
);
-- Management-only insert/update, all-auth read, mirroring the products RLS pattern.
-- THIS TABLE STARTS EMPTY. It must be populated with Tank 90's real license numbers by the
-- business before any permit can be classified — until then everything correctly falls into
-- 'unclassified', not a guess. Build a small admin screen for management to add/edit rows here.

create table public.excise_permits (
  id uuid primary key default gen_random_uuid(),
  state text not null,                       -- detected from the document; drives which parser ran
  permit_number text not null,
  license_no_source text,
  license_no_dest text,
  licensee_name_source text,
  licensee_name_dest text,
  liquor_class text,                         -- e.g. 'WINE', 'IMFL', 'COUNTRY LIQUOR'
  quantity_value numeric not null,
  quantity_type text not null check (quantity_type in ('BL','PL','UNKNOWN')),
  permit_date date,
  permit_generated_at timestamptz,
  valid_until date,
  original_file_path text not null,          -- storage path, locked-down bucket, signed-URL only
  extracted_json jsonb not null,             -- raw parser/OCR output, for audit + diffing corrections
  parser_version text not null,              -- which state-parser + version produced extracted_json
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected')),
  movement_direction text not null default 'unclassified'
    check (movement_direction in
      ('factory_to_warehouse','warehouse_to_l1','internal_transfer','unclassified')),
  facility_from_id uuid references public.company_facilities(id),
  facility_to_id uuid references public.company_facilities(id),
  uploaded_by uuid not null references public.users(id),
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  notes text
);

-- Product match — a join table, not a single FK, even though Tank 90 has exactly one product
-- today. Tank 90 is actively expanding flavors/products, and a permit's BL total legitimately
-- may need splitting across multiple SKUs once that happens. Building the single-FK version now
-- would need a schema change the moment a second product ships — do it right the first time.
create table public.permit_product_allocations (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references public.excise_permits(id),
  product_id uuid not null references public.products(id),
  allocated_bl numeric not null,             -- must sum to the permit's quantity_value across rows
  computed_bottles numeric not null,         -- pre-rounding, for audit
  computed_cases integer not null,
  remainder_bottles numeric not null,        -- leftover bottles not forming a full case
  needs_review boolean not null default false, -- set true if rounding tolerance is exceeded — see §4
  conversion_formula_version text not null
);

-- The append-only ledger. Both YTD figures and current balance are pure aggregates over this.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  direction text not null
    check (direction in ('factory_to_warehouse','warehouse_to_l1','internal_transfer')),
  facility_from_id uuid references public.company_facilities(id),
  facility_to_id uuid references public.company_facilities(id),
  cases integer not null,
  remainder_bottles numeric not null,
  source_permit_id uuid references public.excise_permits(id), -- nullable: future non-permit movements
  movement_date date not null,               -- buckets YTD/FY figures; from the permit's generated date
  created_at timestamptz not null default now()
);
```

RLS: management-only insert/update on `company_facilities`, `excise_permits` (upload = any
management user; approve/reject = management, mirroring existing role gates), and
`permit_product_allocations`. `inventory_movements` gets **no direct client INSERT at all** — it's
only ever written by the approval RPC below, so a bad client can never fabricate a ledger entry.

---

## 2. Extraction pipeline (no LLM, no per-token cost)

1. **Check for a real text layer first.** Government e-permits like this one (emSigner-signed)
   are frequently generated as native PDFs with embedded text, not scans. A plain PDF text
   extraction pass (e.g. `pdf-parse`/`pdfjs` server-side) gets exact values with zero OCR error.
   Only fall back to OCR when there's no usable text layer (i.e. it's a photographed/scanned page).
2. **OCR fallback (open-source, free, self-hosted):** Tesseract or PaddleOCR. Both run locally
   with no per-call cost. Use whichever the runtime environment supports better — flag this to me
   as an infra decision (see §7), don't guess it into the migration.
3. **Template/key-value parsing, not AI layout understanding.** Extract by matching the labels
   that are already consistent on a given state's form ("Permit Number:", "Total Quantity in
   BL:-", etc.), not by asking a model to "read" the document.
4. **One parser module per state — confirmed as the right approach.** Detect the issuing state
   from header text or the verification URL (e.g. `haryanatax.gov.in`), then dispatch to that
   state's parser. New states = a new parser module, not a redesign of the pipeline.
5. **Capture `quantity_type` from the document itself, don't assume it.** This sample's quantity
   column literally shows "396 BL" — the parser must record the unit suffix (BL vs PL) it actually
   read, not default to BL. Some liquor classes/states may report Proof Litres instead (see §4).
6. **Security on untrusted uploads:**
   - Verify actual file type by magic bytes, not filename/extension.
   - Enforce a strict size cap.
   - Run all parsing server-side, isolated (Edge Function or dedicated worker) — never on-device,
     never with elevated DB credentials reachable from the client.
   - Don't execute embedded PDF JavaScript/active content; confirm whichever library is chosen
     doesn't evaluate it.
   - Strip metadata before long-term storage.
   - Store the original file in a locked bucket, accessible only via short-lived signed URLs.
   - Optional extra layer: an open-source AV scan (e.g. ClamAV) in the ingestion path before the
     file is parsed or persisted — free, fits the no-paid-API constraint, genuine defense-in-depth.

---

## 3. Business logic — classification (Gap 2)

On upload, after extraction, resolve `facility_from_id`/`facility_to_id` by matching
`license_no_source`/`license_no_dest` against `company_facilities`:

- both match our own facilities → `internal_transfer` (e.g. inter-warehouse)
- source = our factory, dest = our warehouse → `factory_to_warehouse`
- source = our warehouse, dest = not in the registry → `warehouse_to_l1`
- anything else (neither side matches, or an unexpected combination) → `unclassified`,
  surfaced in a review queue for a human to resolve manually — **never guess**.

**This registry starts empty.** Every permit will land as `unclassified` until Tank 90's real
factory/warehouse license numbers are entered via the admin screen — this is expected, correct
behavior for a new deployment, not a bug. Build the admin screen for this in the same phase as the
schema, since there's no other way to populate it.

## Product match (Gap 1)

- If exactly one active product exists (true today): auto-select it, write one
  `permit_product_allocations` row at 100% of the permit's BL — but still write it explicitly, as
  a real row, not an implicit assumption. Show it to the reviewer as a confirm-not-silent step.
- Once 2+ active products exist: require the reviewer to add one or more allocation rows (product
  + BL amount) that must sum to the permit's total `quantity_value` before it can be approved.

---

## 4. Calculation formula

```
if quantity_type == 'BL':
    bottle_liters = unit_size converted to liters via unit_of_measure
    raw_bottles   = allocated_bl / bottle_liters
    bottles       = round(raw_bottles)  # nearest whole bottle
    cases         = floor(bottles / qty_per_carton)
    remainder     = bottles - (cases * qty_per_carton)
    needs_review  = abs(raw_bottles - bottles) > TOLERANCE   -- flags likely wrong product match,
                                                              -- not normal rounding noise
elif quantity_type == 'PL':
    -- Proof Litres reflects alcohol-strength-adjusted volume, not physical volume — applying the
    -- BL formula here would silently produce a wrong bottle count for spirits. Not solved yet
    -- (confirmed with you): mark needs_review = true, computed_* = null, route to manual entry.
    -- Revisit once a real spirits/IMFL permit is available to confirm the correct PL→volume
    -- conversion (typically strength-dependent) for the relevant state.
else:
    needs_review = true  -- UNKNOWN quantity_type, always manual
```

`conversion_formula_version` is stored per allocation row so that if this formula changes later,
historical rows aren't silently reinterpreted under a new rule — a real requirement given this
feeds regulatory-adjacent reporting.

## Approval → ledger write (the only path to `inventory_movements`)

A `SECURITY DEFINER` RPC, `approve_excise_permit(permit_id)`:
- management-only (mirror existing role checks); rejects if `movement_direction = 'unclassified'`
  or any allocation has `needs_review = true` — both must be resolved by a human first.
- On success: sets `excise_permits.status = 'approved'`, `reviewed_by = auth.uid()`,
  `reviewed_at = now()`, and inserts one `inventory_movements` row per allocation (cases +
  remainder_bottles, correct direction/facilities, `movement_date` from the permit).
- A parallel `reject_excise_permit(permit_id, reason)` sets `status='rejected'`, writes no ledger
  rows, keeps the reason in `notes`.

---

## 5. Dashboard analytics

- **Financial year** = 1 April – 31 March, as an explicit named constant (mirror how
  `ORDERS_CUTOVER_DATE` already works) — never hardcoded per query.
- **YTD Factory → Warehouse** and **YTD Warehouse → L1**: `sum(cases)` (+ remainder bottles) from
  `inventory_movements` filtered by `direction` and `movement_date >= financial_year_start`.
- **Current warehouse balance** (per product, per warehouse facility):
  `sum(cases where facility_to = warehouse AND direction='factory_to_warehouse')`
  `− sum(cases where facility_from = warehouse AND direction='warehouse_to_l1')`
  (adjust for `internal_transfer` rows the same way, in and out).
- **UX**: company-wide aggregate first, drill into a specific product from there — not a forced
  "pick a product" landing screen. With one product today this is moot, but it's the right default
  for when the catalog grows, and it matches the same Doherty/Hick's reasoning already used
  elsewhere in this app's dashboards.
- Reuse the trend-chart/range-selector primitives from the ops-updates brief where they fit
  (e.g. an FY-to-date cumulative movement chart) rather than building new chart components.

---

## 6. Review UI + audit trail

A management-only "Excise Permits" screen:
- **Upload** (image or PDF) → runs extraction → lands as `pending_review`.
- **Review queue**: shows extracted fields side-by-side with the original document, lets the
  reviewer correct any field before approval (the diff between `extracted_json` and the final
  approved columns *is* the correction history — no separate table needed unless a stronger
  field-by-field diff log is wanted later).
  - If `movement_direction = 'unclassified'`: reviewer manually picks the direction + facilities.
  - If product allocation is ambiguous or `needs_review = true`: reviewer resolves it before the
    Approve action is enabled.
- **Status pill** (`Pending`/`Approved`/`Rejected`), uploaded-by/reviewed-by with timestamps,
  visible on every record — satisfies the audit-trail requirement directly from the schema.
- A small **Facilities admin screen** (management-only): add/edit `company_facilities` rows
  (name, license number, type, state). This is a real onboarding task for the business — flag to
  the user that TankAssist can't populate this on its own; someone needs to supply Tank 90's
  actual factory/warehouse license numbers before classification will work.

---

## 7. One thing to decide before building the extraction runtime

Where OCR/parsing actually executes is an infra decision, not something to guess into the
migration: a Supabase Edge Function is likely sufficient for native-text PDFs (lightweight text
extraction), but Tesseract/PaddleOCR for scanned images typically needs more runtime/memory than a
typical edge function allows — this may need a small separate self-hosted OCR service the app
calls via HTTPS instead. Check current Edge Function limits before committing, and report back
which path you're taking before building the ingestion trigger.

---

## 8. Suggested order of work

1. Schema STOP-POINT: `company_facilities`, `excise_permits`, `permit_product_allocations`,
   `inventory_movements`, the two RPCs. Confirm SQL → apply → verify → impersonation-test.
2. Facilities admin screen (small, unblocks everything else being testable end-to-end).
3. Upload + extraction pipeline for the Haryana L-32 format only, to start (real, available
   samples) — text-layer path first, OCR fallback second.
4. Review queue UI + approve/reject RPC wiring.
5. Dashboard analytics (YTD figures + current balance).
6. Additional state parsers, added incrementally as real samples become available.

Report after the schema STOP-POINT confirmation, and again after each numbered step.
