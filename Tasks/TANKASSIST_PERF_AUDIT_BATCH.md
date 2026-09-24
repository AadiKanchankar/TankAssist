# TankAssist — PERFORMANCE EMERGENCY: audit, measure, fix; then the auto-close batch

**The app is effectively unusable — dashboards for every role take an enormous time to load, or
never finish.** That blocks everything else, so it comes first. The previously-written
`TANKASSIST_AUTOCLOSE_BACKFILL_LOCATION_BATCH.md` (auto-checkout correctness, 7-day backfill,
location refresh) is **deferred to §4 of this file** — do it only after the app is usable again.

**Measure before optimising.** The owner has a list of suspects (below) — treat them as hypotheses,
not a work order. Fixing twelve speculative things and missing the real cause wastes the session.
**Instrument, find where the time actually goes, report it, then fix what's proven.**

Standing rules: verify live via MCP, `graphify query` before grep (it's far cheaper than reading
files blind for a whole-app audit), `tsc` clean, complete files, schema changes are STOP-POINTs, no
service-role key, ponytail scope notes, Impeccable pass on UI changes.

---

## 1. MEASURE FIRST — where does the time actually go?
Instrument and report a timing breakdown before changing anything. Cover:
- **Cold start → first paint:** how long from launch to the auth/session restore completing, to the
  first screen rendering, to the dashboard being interactive. Break it into phases.
- **Per-query timing on each role's dashboard** (rep / sales_manager / management): log each
  Supabase call's duration and whether calls run **sequentially or in parallel**. Sequential waterfalls
  are the single most likely culprit in this codebase.
- **Row counts actually fetched** per query — the app may be pulling whole tables (stores, visits,
  users, assignments) where it needs a page or a filtered window.
- **Blocking vs non-blocking:** what is `await`ed *before* the first render? Anything awaited pre-paint
  is a direct contributor.
- **Query plans for the slow ones** (`explain analyze` via MCP) — a missing index on a table that's
  grown is a classic "it used to be fast" cause.

**Report the measured breakdown with numbers before fixing.** Name the top 3 contributors.

## 2. The owner's suspect list — check each, confirm or rule out
Go through these explicitly and say which are real here and which aren't:
- Supabase queries executed **sequentially** that could be parallel (`Promise.all`) — **top suspect**.
- **Location acquisition** (`getCurrentPositionAsync`) blocking render — several seconds each.
- **Reverse geocoding** during dashboard load — a network round-trip per call.
- **Over-fetching**: stores, visits, reps, assignments pulled in full rather than scoped/paginated.
- **Chained `useEffect`s** triggering each other (render → effect → fetch → render → effect…).
- **Awaiting everything before rendering** instead of painting a skeleton and filling in.
- **Bundle size / dev-build overhead** — confirm whether the slowness is dev-only or also in the
  production build (this matters: dev builds are legitimately slower and may be a false alarm).
- **Startup synchronous work**, heavy library init at import time, large assets/fonts pre-render.
- **SecureStore/AsyncStorage** reads blocking startup (the chunked adapter is used for the session —
  check it isn't serialising a lot of reads before first paint).
- **Supabase init / session restoration** latency.
- React Query config: are dashboards refetching on every focus/mount when cached data exists?
  (`refetchOnMount:false` + focus refetch was the house pattern — verify it's still in force and not
  double-fetching.)
- **Anything else you find** — this list is not exhaustive; the audit is "scan the app for what's
  actually slow", not "tick these twelve boxes".

## 3. Fix what the measurements prove, in impact order
Apply the fixes the data justifies. Likely shapes (only if measured):
- **Parallelise** independent queries; collapse waterfalls into one wave.
- **Paint first, fill after:** render the existing skeletons immediately; never await the full data
  set before showing the shell. This is already the house pattern — find where it regressed.
- **Scope and paginate** over-fetching queries; add missing indexes (schema STOP-POINT).
- **Move location/geocoding off the render path** — acquire in the background, never block a dashboard
  on a GPS fix or a geocode.
- **Break `useEffect` chains** that re-trigger fetches.
- Defer heavy imports/assets that aren't needed for first paint.
Re-measure after each significant fix and report the before/after numbers — don't claim an
improvement that isn't measured.

## 4. THEN the deferred batch (only once the app is usable)
Work `Tasks/TANKASSIST_AUTOCLOSE_BACKFILL_LOCATION_BATCH.md` as written: auto-close diagnosis +
corrected three-case logic, the check-in hard gate (UI grey-out + DB constraint), the **7-day
backfill (STOP-POINT: dry-run listing before any write)**, and the location refresh/latency fixes.
Note §3 of this file and §3 of that file overlap on location — do the location work **once**, in
whichever place it lands first, and don't duplicate it.

## 5. Ship
Update `CLAUDE.md`/`HANDOFF.md` (measured root causes, what was fixed, before/after numbers, any new
indexes, plus the auto-close/backfill/location outcomes). Commit + push to GitHub. `expo-doctor` if
dependency-touching. **State clearly whether this ships as OTA or needs a build** — JS/query changes
are OTA; only a native dep change forces a build. If it's OTA, publish it and report the update ID.

## Order of work
1. §1 measure — **report the timing breakdown and top 3 causes before fixing.**
2. §2 confirm/rule out the suspect list as part of that report.
3. §3 fix in impact order, re-measuring as you go.
4. §4 the deferred auto-close/backfill/location batch (its own STOP-POINTs apply).
5. §5 docs → push → OTA (or build, if forced — say which).

Report after §1–§2 (measurements + causes, before fixing), after §3 with before/after numbers, at the
§4 backfill dry-run, and before shipping.
