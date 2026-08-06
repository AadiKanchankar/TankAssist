# TankAssist — rep-side bug batch + odometer OCR (ML Kit)

A batch of field-reported bugs/changes (§1–§5), plus the odometer-OCR feature (§6) whose native
dependency means this whole batch ships as **one new EAS build**, not OTA. Do the bug fixes first
(they're the OTA-eligible part in spirit and de-risk the build), then the odometer work, then cut
one build carrying everything.

---

## 0. Session start + standing rules

- Orient with `graphify query "<question>"` before grepping. If `supabase-schema.sql` is stale
  (it was 3 migrations behind last session), regenerate it from live via MCP and rebuild the graph
  **before** relying on it for anything schema-touching (§4, §5). Verify schema live via MCP.
- Standing guardrails: `npx tsc --noEmit` clean per item, complete files, schema changes are
  STOP-POINTs, no service-role key, reuse over new code (ponytail), Impeccable pass on every UI
  change, leave a `ponytail:` comment where scope is deliberately narrowed.
- **First, reconcile open state from last session before building:** confirm the PJP/anti-cheat
  batch actually committed + pushed, and resolve the outstanding `loc.mocked` / `expo-location`
  question (does the installed build's `expo-location` expose `mocked`, or is the mock-location
  flag silently dead?). Since this batch forces a new build anyway, any native bump needed for that
  can ride along — report it.

---

## 1. 🐛 Rep dashboard — can't check in from store search
Tapping a searched store on the rep dashboard does nothing (should open the check-in / store
visit). Reproduce live, find the root cause (a broken/renamed nav param or handler after the
plan-card changes is the likely suspect — the store-search → StoreVisit path may have regressed
when the dedup/plan work landed). Fix the actual handler; confirm both an existing-store tap and a
newly-created-store tap route into StoreVisit correctly. Use `graphify` to find the search→visit
call path rather than grepping blind.

## 2. Voice input — non-English languages handled as a dead-end
Hindi/Marathi voice shows Android's raw "supported, but not yet downloaded" and strands the user.
- Catch that specific state and show an **actionable** message: the language pack isn't downloaded
  on this device, how to get it (Settings → Languages & input → Voice input / offline speech), and
  that they can **type instead** — typing must always stay available, never blocked.
- Do **not** hard-force English. Keep EN/HI/MR selectable; when a pack is missing, degrade
  gracefully to typing with the message above, and remember the working language per the existing
  persistence.
- Distinguish "language genuinely not supported on this device" from "supported but not
  downloaded" — they need different copy. Impeccable pass on the alert/inline copy.

## 3. 🐛 Store Detail — current-stock rows visually merge
On Store Detail, the three-bucket breakdown chips (Floor / Display / Godown) collide with the
`cs / btl` total and the next product row bleeds up (see it live on "Tank 90 z"). Same class as the
earlier badge/divider clash. Fix the layout so: each product's breakdown chips get their own row
with proper spacing, the total doesn't overlap the chips, and row dividers don't collide with chip
content. Impeccable pass.

## 4. Resume an abandoned store visit (server-resume + encrypted form draft)
If a rep has an **open** `store_visits` row (checked in, never checked out) and reopens the app,
offer to resume — this is a real field case (app killed mid-visit).
- **Backbone = server-resume (do this first, it's the robust + secure half).** On app open / rep
  dashboard focus, query for the rep's own open (no `check_out_time`) visit. If one exists, show a
  clear "Resume your visit at [store]?" affordance that reopens the stepper for that visit. This
  data is already in Postgres under RLS — no local storage needed for the core, survives app-kill
  and device-swap.
- **Form-draft caching (the "pick up mid-form" nicety) = encrypted + small only.** To restore
  which stock buckets/quantities were typed and the current step, persist a **small** draft keyed
  to the visit id. **Reuse the existing encrypted `lib/secureStorage.ts` (`expo-secure-store`,
  Keystore/Keychain) — NOT plain AsyncStorage** (a draft holds store + quantity data; it must not
  sit unencrypted on the device). Keep the draft tiny (typed numbers + step index).
- **Do NOT cache photo binaries** (`expo-secure-store` is ~2KB/key; photos already upload to the
  locked bucket as they're taken). On resume, re-reference already-uploaded photos; leave a
  `ponytail:` note that photo-draft caching is deliberately out of scope for security/size, not
  overlooked. Clear the draft on successful checkout.

## 5. Plan-my-day fixes
### 5.1 Scope + virtualize the store list (don't render thousands of rows)
An unbounded checkbox list of every store will crawl at scale and pointlessly shows out-of-region
stores. Scope the default list; search reaches anything.
- **Default scoping = "GPS if checked in, else assigned area" (owner decision).** If the rep is
  checked in, order/limit by proximity to their check-in coordinates (reuse the coordinates already
  captured at check-in; a rep works a ~100km radius, so far-away/other-state stores are noise
  until searched). If not checked in, fall back to the rep's assigned area/state.
- **Virtualize** the list (FlatList windowing / pagination) so it never renders the full table at
  once. Search queries the full set on demand (server-side filter), so a store outside the default
  scope is still reachable by typing its name.
- Verify the proximity/area math against a real coordinate; `graphify` the existing check-in
  location capture rather than reinventing it.

### 5.2 "No stores found" → add a new store (through the existing dedup path)
When search returns nothing, offer **Add a new store** rather than dead-ending.
- Route this through the **existing store-dedup / "did you mean?" flow** you already built — adding
  from the plan must not become a backdoor around the anti-duplicate check. Reuse it, don't fork it.
- The existing add-store path already captures GPS at creation; when the rep reaches the location
  and adds it, that capture stands. Wire the plan screen's empty-state CTA into that same add-store
  screen, returning to the plan with the new store selected.

### 5.3 🐛 Approve-plan notification crashes (management + sales_manager)
Tapping the approve-plan notification crashes the app for both roles. Owner is currently testing as
their own rep+manager, and **the rep has no assigned sales manager**, so the review screen likely
dereferences a null manager/rep link.
- Reproduce live and fix the **root cause** — a null `assigned_manager_id` (or a null plan/rep
  join) must never crash; render an honest empty/error state instead.
- This is a real robustness bug independent of the tester setup (production reps can lack an
  assigned manager too), so fix it as such, not as a tester workaround.
- Verify the manager review path end-to-end after the fix: submit a plan → notification →
  approve/reject → status reflects, using the RLS matrix already proven for `journey_plans`.

## 6. Odometer OCR for TA (Travel Allowance) — ML Kit first, engine swappable
Confirmed decisions (locked): **new EAS build accepted** (no OCR is OTA-able); **ML Kit Text
Recognition first** (on-device, offline, Android 5+ and cross-platform for future iOS, far lighter
on old phones than a bundled YOLO model); **TRODO/YOLO only if ML Kit fails on real motorcycle
dashboards**; two readings/day (check-in + check-out); mismatch-vs-GPS feeds the existing exception
queue. Purpose: compute daily distance for TA (A→B→C→D total), not per-store.

**Build the capture + validation + flag scaffold now with the OCR engine behind a swappable
interface** — that scaffold is identical whether the engine ends up ML Kit or YOLO, and it's the
actual anti-cheat value.

- **Schema (STOP-POINT):** store two readings on `attendance` (or a small `odometer_readings`
  table if cleaner — verify live first): `odo_start`, `odo_end`, their photo paths, and the
  captured GPS/time. Daily odo distance = `odo_end − odo_start`. Keep photos in a **locked bucket**
  like the permit/visit photos (management/manager-readable), never public.
- **Capture flow:** at check-in and check-out the rep photographs the odometer; the app runs OCR
  on-device and pre-fills the number, which the rep can **correct** before saving (OCR assists, the
  human confirms — never blindly trusted). Store photo + reading + GPS + timestamp together.
- **The engine is an interface**, e.g. `readOdometer(imageUri): Promise<{ value, confidence }>`,
  with an ML Kit implementation now. Isolate it so swapping to a YOLO/TFLite reader later touches
  one module. ML Kit is a **new native module** → this is what forces the build; confirm the RN
  ML Kit text-recognition package + its config plugin, and that it stays offline.
- **Which-number problem:** a dashboard shows odometer + trip + speed (the classic `12345` vs
  `67.8`). For a first cut, hand ML Kit a **framed/guided capture** (an on-screen box the rep aligns
  to the odometer digits) so it reads a tight crop, plus post-processing: digits only, plausible
  length, and **reject a reading lower than the day's start** (odometers don't decrease). Leave a
  `ponytail:` note that auto-detecting the display region (TRODO/YOLO) is the phase-2 upgrade if the
  guided crop proves unreliable on real bikes.
- **Anti-cheat tie-in (the real value):** compare odo distance vs GPS distance for the day; flag a
  large mismatch into the **existing manager exception queue** (a photo is spoofable, so the
  cross-check is the point). Only surface to the manager on a flag — clean days need no attention.
- **Validation:** unit-test the pure bits (distance = end − start, the "reject lower than start"
  rule, the mismatch-flag threshold) as plain `assert` scripts, same discipline as the other `lib/`
  modules.

## 7. Ship
Once §1–§6 are `tsc`-clean and tests pass: update `CLAUDE.md` + `HANDOFF.md` (new odometer
schema/bucket, the ML Kit native module, the resume-visit draft, the plan scoping), commit + push
to GitHub, run `expo-doctor` (last two builds hit dependency-drift failures — check first), then
cut **one** EAS build carrying the ML Kit native module + everything else. Report the build link.
No `eas update` mid-way — the odometer feature is build-gated, so shipping half of it OTA would
put a broken/absent native path on the phone.

## Order of work
1. Session reconcile (§0) — confirm last batch shipped, resolve `loc.mocked`.
2. §5.3 crash → §1 check-in-from-search → §3 stock UI (the three broken/ugly paths, quick wins).
3. §2 voice fallback.
4. §4 resume-visit (server first, then encrypted draft).
5. §5.1 + §5.2 plan scoping + add-from-plan.
6. §6 odometer (schema STOP-POINT → capture/engine → flag tie-in).
7. §7 docs, build.

Report after §5.3+§1+§3 (so the owner can sanity-check the crash/nav fixes), after the §6 schema
STOP-POINT, and after the build.
