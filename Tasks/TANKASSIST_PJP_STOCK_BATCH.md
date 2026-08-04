# TankAssist — PJP + anti-cheat, stock categories, terminology, warehouse balance

Four changes from the field team. Two are schema STOP-POINTs (PJP, stock categories), one is a
bug (warehouse balance), one is pure terminology. Standing guardrails apply throughout.

---

## 0. Session start — before any feature work

This is a fresh session. Do these first, in order:

1. **Orient with the knowledge graph, not grep.** `graphify-out/` was rebuilt last session and is
   current (schema regenerated, SQL parser present, 988 nodes). Use `graphify query "<question>"`,
   `graphify path "<A>" "<B>"`, and `graphify explain "<concept>"` to find call sites before
   reading/editing — that's the low-token path. Known limitation from last session:
   `graphify explain "inventory_movements"` resolves to the *brief* node, not the code, because
   AST can't see through PostgREST string literals (`.from('inventory_movements')`). For the
   ledger's real implementation, query `lib_inventorymath` and `hooks_useinventoryanalytics`
   directly — that's community 2, the tight `useInventoryAnalytics → inventoryMath →
   computeAnalytics` cluster with `financialYear` alongside.
2. **Commit the uncommitted `supabase-schema.sql`** first (it was regenerated last session and
   left in the working tree deliberately) so the tree is clean before new work.
3. **Read `CLAUDE.md` + `HANDOFF.md`.** Yes, read both — this batch touches the check-in stepper,
   the manager→rep relationship, the inventory ledger, and adds two new schema surfaces; the
   durable architecture facts and the current-state snapshot both matter here. But **verify any
   schema assumption live via MCP** rather than trusting the docs' wording — several migrations
   post-date parts of them.

Apply **ponytail** (installed) across the batch: prefer reuse over new code (the order-status
state machine, the manager→rep relationship, the check-in gate, the append-only snapshot pattern
all already exist — lean on them), shortest working diff, and leave a `ponytail:` comment naming
the ceiling wherever you deliberately narrow scope. Run the standing Impeccable pass on every UI
change. Standard gate: `npx tsc --noEmit` clean after each item, complete files, schema changes
are STOP-POINTs (propose SQL → confirm → apply → verify live → impersonation-test → app code),
no service-role key.

---

## 1. PJP (Permanent Journey Plan) + anti-cheat — schema STOP-POINT

### 1a. The PJP approval flow
A rep must submit a planned route **before** starting the day; their sales manager is notified and
approves/rejects; a rejected plan goes back for edit + resubmit.

- New table (verify names live first), roughly `journey_plans`: `rep_id`, `plan_date`,
  `status ('submitted'|'approved'|'rejected')`, `submitted_at`, `reviewed_by`, `reviewed_at`,
  `reject_reason`, plus a child `journey_plan_stores` (plan_id, store_id, optional order) for the
  planned stores. Reuse the **order-status state machine shape** you already have rather than
  inventing a new pattern.
- RLS: a rep may insert/update **only their own** plan while it's `submitted`/`rejected` (not once
  approved); the assigned sales manager (and management) may read their reps' plans and set
  `approved`/`rejected` + reason. Mirror the **existing manager→rep relationship** that already
  gates live-location — don't invent a new ownership concept.
- **Approval posture = optimistic-with-flagging, NOT hard-blocking** (owner decision). The rep may
  start their day against a *submitted* plan; the app does not freeze them waiting on the manager
  (who may be asleep at 8am). But any check-in/visit made under a plan that is still `submitted` or
  was `rejected` is **flagged** for the manager (see 1b). An `approved` plan clears the flag.
  Rejected → the rep is told and prompted to edit + resubmit, but is not physically blocked.
- **Notify the sales manager on submit.** Reuse the live-location Realtime pattern
  (`postgres_changes` subscription) for the manager-side notification rather than adding push
  notifications (no new native module — stays OTA-eligible). A manager viewing their team sees
  "N plans awaiting approval" and can approve/reject inline.
- **Rep dashboard changes:** the day now leads with the **approved planned stores** (replacing the
  current "no assigned stores, go find your own" assumption). Show plan status (submitted /
  approved / rejected-with-reason) prominently. Keep the ability to visit an off-plan store, but
  such visits are flagged (1b).

### 1b. Anti-cheat — ALL measures approved, all flag-not-block (owner decision)
The governing principle (consistent with HANDOFF's geo-fence contract): **frictionless for the
honest, visible for the dishonest. Flag + reason, never block.** Nothing here prevents a rep from
acting; everything surfaces suspicious activity to the manager.

- **Store de-duplication on creation.** When a rep tries to create a new store, first check for an
  existing store within ~50–100m **and/or** a fuzzy name match (Levenshtein/trigram — "Sruaj" ≈
  "Suraj"). If a likely match exists, surface "did you mean this nearby store?" and steer them to
  pick it. Creating a genuinely new store stays possible but becomes the flagged exception a
  manager can verify — not the silent default. This kills both the 100-stores-in-one-spot spam and
  the typo-duplicate problem in one move. Do the proximity math against existing store
  coordinates; confirm whether it belongs client-side, in a `SECURITY DEFINER` RPC, or both
  (a determined client can skip a client-only check — the manager-visible flag is the backstop).
- **GPS / location flags** (all "flag + reason", reusing `distance_from_store_meters` which
  already exists on `store_visits`):
  - check-in GPS **>X meters** from the store's known coordinates → flag "far from store".
  - **mock-location / spoofing** detected (Android `isFromMockProvider` via the location API) →
    flag "mock location".
  - **physically-impossible movement** (two visits whose distance/time implies an implausible
    speed) → flag "impossible movement".
- **Off-plan / unapproved-plan flags** (from 1a): a visit to a store not on the approved plan, or
  any visit under a still-`submitted`/`rejected` plan → flag.
- **Manager exception queue (the "smart manager" side).** The real payoff: the manager surface
  floats the **flagged** visits/plans, not all activity — a Zeigarnik/exception-queue pattern
  ("review these 3", not "audit all 300"). Each flag carries its reason. This is where all the
  above flags converge. Build this as the manager-facing consumer of every flag type.
- **Scope/ponytail note:** decide honestly what's a schema concern (storing the flags + reasons on
  `store_visits` / plans) vs. a compute-on-read concern (deriving "impossible movement" from
  existing timestamps+coords). Flag which flags you're persisting vs. computing, and why. Don't
  over-build — a flag is a boolean + reason string surfaced to a manager, not a workflow engine.

**Confirm before building 1a/1b:** the exact new tables/columns and which flags are stored vs.
derived, as one schema STOP-POINT. Report the SQL for confirmation before applying.

---

## 2. Stock categories — three separate buckets — schema STOP-POINT

Today the check-in stepper records one stock number per product. Split into **three separate
categories** per product per store (owner decision — all three tracked distinctly):

- **Floor stock** — in the store but not on the shelves (in-store back stock).
- **Display stock** — everything on the shelves / display.
- **Godown stock** — in the store's own warehouse/godown, if any.

- Extend `store_stock_snapshots` with the three buckets (verify current columns live first). Keep
  it **append-only** (no update/delete), same as today; **current stock = latest snapshot per
  (store, product)** stays the rule. Preserve `>= 0` checks per bucket.
- Back-compat: existing snapshots have only the single legacy figure — decide and document how the
  old value maps (likely → display, or left as a legacy total) so historical "current stock"
  reads don't break. Confirm this mapping in the STOP-POINT.
- **Check-in stepper UI:** the stock step now captures three inputs per touched product (floor /
  display / godown), clearly labelled. Keep the "only products the rep actually touched" behavior
  and the required-stock-photo rule. Godown is optional (many stores have none) — a store with no
  godown shouldn't be forced to enter 0 awkwardly; make absent ≠ zero clear in the UI.
- Anywhere current stock is displayed (Store Detail, dashboards) show the breakdown, and confirm
  what "total" means (sum of the three).

Report the SQL (new columns + back-compat mapping) for confirmation before applying.

---

## 3. Terminology — drop "FREE" → "scheme" — no schema STOP-POINT needed

Replace the word **"Free"** everywhere it appears in order placement and stock/update flows with
**scheme** language ("scheme cases" / "scheme qty"). This matches real FMCG usage ("Buy 20 Get 1
Free" *is* a scheme). Pure relabel:

- Update all UI labels in the order-placement step and anywhere stock/order shows "free".
- If a **column** is literally named `free_*` (e.g. `order_items.free_cases`), a rename is
  cosmetic but touches schema — if so, treat the rename as a small STOP-POINT; otherwise if it's
  only UI strings, just do it. Check live first and report which case it is.
- Grep-replace is risky for a word this common — use `graphify query "free cases order"` /
  `graphify query "scheme"` to find the real call sites first, then change only those.

---

## 4. Warehouse balance shows 0 — bug — likely a data-shape issue, not just a query bug

On the management dashboard, "Warehouse balance" reads **0** while "Factory → warehouse" shows
**50 cases in** and "Warehouse → L1" shows 0. Balance = inbound − outbound, so it should read 50.

- **Strong hypothesis to confirm first:** the approved permit that produced those 50 cases was
  approved **before any facilities were registered** (`company_facilities` has 0 rows), so its
  `inventory_movements` rows likely have **null `facility_from_id`/`facility_to_id`**. If the
  balance query attributes stock *by facility*, null-facility rows match no warehouse and
  contribute 0 — which is exactly the symptom. **Verify this live via MCP** (inspect the actual
  `inventory_movements` rows) before writing any fix. Query `hooks_useinventoryanalytics` /
  `lib_inventorymath` (community 2) for the balance logic — don't grep.
- If confirmed, the fix is **two parts**, not one:
  1. **Handle null-facility ledger rows** in `computeAnalytics` — decide the correct semantics: a
     `factory_to_warehouse` movement with a null destination still represents stock that entered
     *a* warehouse. Either treat direction as the source of truth for balance (inbound counts
     regardless of which facility, since there's effectively one warehouse today) or require
     backfill. Document the choice; keep the whole-bottles-then-convert arithmetic intact so cases
     don't drift.
  2. **Backfill / data note:** the existing approved permit's null-facility rows may need
     attributing once real facilities are registered. Flag whether a backfill is needed and,
     if so, propose it as a separate data step (not silently done).
- Extend `useInventoryAnalytics.test.ts` with a case covering **null-facility inbound** so this
  can't silently regress.
- If the live inspection shows the movements *do* have facilities and the bug is purely in the
  query, say so and fix that instead — don't assume the hypothesis is right without checking.

---

## 5. Order of work

1. Session-start orientation (§0): commit schema file, graph queries, read docs.
2. **Item 4** (warehouse balance) — smallest, most schema-sensitive, and the graph points right at
   it; confirm the hypothesis live first. Report.
3. **Item 3** (terminology) — quick, low-risk; report whether it's UI-only or a column rename.
4. **Item 2** (stock categories) — schema STOP-POINT, then stepper UI. Report at the STOP-POINT.
5. **Item 1** (PJP + anti-cheat) — the big one; schema STOP-POINT for the plan tables + flag
   storage, then the flow, then the manager exception queue. Report at the STOP-POINT and again
   per sub-part.

Report after each schema STOP-POINT confirmation and after each item builds `tsc`-clean.
