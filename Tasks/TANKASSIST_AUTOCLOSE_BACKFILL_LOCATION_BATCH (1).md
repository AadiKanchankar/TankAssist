# TankAssist — auto-checkout correctness + 7-day backfill, check-in hard gate, location refresh

Two goals: **(A) stop auto-checkout producing wrong market-time/distance, and repair the last 7 days
of data it corrupted**, and **(B) fix stale/slow location capture at check-in and add-store.**
Make the check-in gate genuinely tamper-resistant (DB-enforced, not just UI).

Standing rules: verify live via MCP, `graphify query` before grep, `tsc` clean per item, complete
files, schema changes are STOP-POINTs, no service-role key, ponytail scope notes, Impeccable pass on
UI. **The 7-day backfill is a destructive write on real data — it is its own STOP-POINT (see §2).**
State at the end which parts are OTA vs build-gated.

---

## 1. Auto-checkout — diagnose why it missed, then correct the logic

### 1a. First, find out whether the sweep actually ran (diagnose before rewriting SQL)
Live symptom: a rep (Bhagwan Singh) appears checked in **5:01 PM on 22-09-2026** and was never
auto-closed; the next day's figures are consequently wrong (showing 5:10 PM–7:13 PM when the real
work — a Magpai store visit — was around 10:40 AM). Before changing anything, check:
- **Did `pg_cron` actually fire on those nights?** Inspect `cron.job_run_details` for the
  `auto-close-stale` job — "it never ran" and "it ran but skipped rows" are completely different
  bugs with different fixes.
- **Does the cutoff predicate actually catch a 5:01 PM same-day check-in?** Read the deployed
  `auto_close_stale` source and reason about the `check_in_time < cutoff` comparison and the
  Asia/Kolkata conversion. Report what you find before editing.

### 1b. The rule, hardened (owner requirement)
**At 22:30 IST, close EVERY still-open row — no exceptions, no minimum duration, no same-day
window escape.** A rep who checked in at 22:29 is closed at 22:30. There must be no path by which an
open attendance row or open store visit survives the sweep.

### 1c. Compute honest figures on auto-close — three cases (owner-specified)
Today the sweep closes with null market time and null distance. Replace that with the correct value
per case, and **never fabricate an odometer reading** (odometer is only ever captured by the rep, so
on auto-close it stays **not recorded**, never 0-as-if-measured):

1. **Rep checked out of their last store but forgot to end the day.**
   - Market time = day's check-in → **last store check-out time**.
   - Distance = route from check-in location → store A → B → C … → **last store visited** (use the
     same Directions/Haversine route logic punch-out already uses).
   - Odometer end = **not recorded**.
2. **Rep forgot to check out of the last store AND the day.**
   - Market time = check-in → **last store check-out time available** (same as case 1 — the open
     store visit itself is auto-closed by the sweep, so use that store's close as the end bound).
   - Distance = same route computation, through the last store covered.
   - Odometer end = **not recorded**.
3. **Rep checked in but never visited any store (no work).**
   - Market time = **0** and distance = **0** — these are genuinely measured zeros, and should read
     as such (distinct from "not recorded").

**Everywhere downstream, "not recorded" must not render as 0.** The report must distinguish a
measured zero from an unobserved value (this is the same presentation bug flagged in the reports
batch — keep it consistent).

### 1d. Hard gate: no work without a proper check-in (UI + DB)
Root cause enabler: the rep could visit a store without a valid day check-in, because nothing
blocked it. Fix at **both** layers:
- **DB (the real guarantee):** a `store_visits` insert must be **refused** unless the rep has an
  open attendance row for that day. Schema STOP-POINT — propose the constraint/trigger, and make the
  client surface it as a friendly "Check in for the day first" rather than a raw error.
- **UI (what actually changes behaviour):** until the day's check-in is complete, **grey out /
  disable Stores, Report, and the dashboard's work actions**. Leave **Profile** accessible. The rep
  cannot start any work until check-in is done.
- **Check-in requires: a live selfie photo AND an odometer photo.** `ponytail:` make the **photo**
  compulsory but keep the odometer **reading** skippable/correctable — a camera or OCR hiccup must
  never strand a rep from starting work, and OCR has been flaky. Flag to the owner if they want the
  reading hard-required too.
- Client-side greying is UX, not security — say so in the code comment; the DB constraint is the
  guarantee.

## 2. 🛑 STOP-POINT — backfill the last 7 days of corrupted data
Owner wants the last **7 days for all reps** repaired using §1c's rules. This **overwrites real
rows**, and this project has already had one data-loss incident from an over-broad predicate — so:
- **Propose the backfill as a reviewable one-time script, not a silent migration.**
- **Before running:** produce a dry-run listing **exactly which rows will be touched**, and for each,
  the current values and the values they will become (rep, date, current market time/distance →
  new market time/distance, which case applies). Show it to the owner and wait.
- Target rows precisely (specific ids / a tight date+condition predicate) — **never a broad
  `WHERE ... IS NULL` sweep**.
- Odometer values are **never** invented by the backfill.
- Report the row count changed after running, and confirm nothing outside the 7-day window moved.

## 3. Location — stale coordinates and latency
Two rep complaints, same root cause: the app reuses the **last captured** location instead of taking
a fresh fix.

### 3a. Refresh before check-in to a store
When checking into a store, the location shown is the **previous store's** position because it was
captured earlier. Add an explicit **refresh / "use my current location"** control on the screen
immediately before check-in, and re-fetch a fresh fix at that moment rather than reusing a cached
one.

### 3b. Refresh on the add-store screen
Same problem when adding a new store — a shop across the street (within ~50 m) gets the previous
store's coordinates. Add the familiar **blue "locate me" pin/dot** control (the pattern every maps
app uses — no new UX to learn) that re-captures the current position. Since this coordinate becomes
the store's permanent saved location and feeds the proximity/dedup checks, a stale fix here corrupts
data long-term — call that out in a comment.

### 3c. Latency
Fetch the location **earlier and in the background** so it's ready when the rep arrives at the
screen (e.g. start acquiring on entering the flow, not on tapping the button), and show an honest
"getting your location…" state rather than silently using a stale value. Reading device GPS is free
(no API cost) — the cost is time-to-fix, so warm it rather than avoid it. Don't add continuous
background tracking.

## 4. Ship
After §1, §3 tsc-clean and §2's backfill reviewed+run: update `CLAUDE.md`/`HANDOFF.md` (auto-close
now computes figures per the three cases; the check-in DB gate; "not recorded" vs 0; the backfill and
what it touched; location refresh). Commit + push. `expo-doctor` if dependency-touching. State which
parts are OTA vs build.

On-device test: check in at 22:29 → auto-closed at 22:30 → figures match the right case → a rep who
never checked in **cannot** open Stores/Report or insert a visit (UI greyed AND DB refuses) →
checking into a store shows a **fresh** location, not the last store's → add-store locate-me pin
re-captures → reports show "not recorded" where nothing was observed, and 0 only where truly zero.

## Order of work
1. §1a diagnose (did cron run? does the predicate catch it?) — **report before changing SQL**.
2. §1b/1c corrected sweep logic + §1d hard gate (schema STOP-POINT for the visit constraint).
3. §2 backfill — **dry-run listing first, wait for approval, then run**.
4. §3 location refresh + latency.
5. §4 docs → ship.

Report after §1a, at each schema STOP-POINT, at the §2 dry-run (before writing), and before shipping.
