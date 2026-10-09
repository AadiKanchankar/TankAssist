# Store pin audit — 2026-10-09 (live DB, project ldgunrxceogfrohjrlxz)

Input for §3 (120 m check-in geofence). Nothing here has been edited in the database.
Positions are the rep's **check-in fix** (`store_visits.latitude/longitude`); "out" is the
check-out fix where one exists. Links open Google Maps.

## Summary

- **15 stores where every recorded check-in is > 120 m from the pin.** They hold **46 of the
  53** over-120 m check-ins. At every other visited store only 7 of 178 check-ins (3.9%)
  exceed 120 m, and 4 of those 7 are single bad fixes, not bad pins (see "Not pin problems").
- **30 stores with no coordinates.** 26 have **no visits, no plans, no orders** — mostly
  duplicates (13× "Old sabji mandi", 2× "BPTP", "IMT 1 ST"/"IMT 1ST"). 4 have visits.
- **Root cause of the no-coordinate rows is still live:** `AddStoreModal` inserts whatever
  `location` holds, and does not require a pin. If GPS hasn't resolved, the store is saved
  with null coordinates. This has to be closed before §3 (see the handling rule below).
- **Test stores in Pune** (Abhijit wines, Suraj wines, Shubam wines, Deccan brews cafe) and
  **Anc (Delhi)** were only ever visited by test accounts. Points at
  `18.5136, 73.9218` (Pune, ~24 km away) and `28.5477, 77.2442` (Delhi) are the testers'
  own desks and recur across unrelated stores — they are not evidence of where a shop is.

Confidence: **High** = ≥ 2 check-ins (ideally two different reps) agree within ~20 m.
**Medium** = one real check-in, or two that disagree by > 100 m. **Test** = test store.

## A. The 15 bad-pin stores

| # | Store | Pin now | Check-ins (rep, IST, position, distance) | Suggested pin | Confidence |
|---|---|---|---|---|---|
| 1 | **Magpai** (Sector 50, Faridabad) | [28.37280, 77.29628](https://www.google.com/maps?q=28.372800,77.296281) | Bhagwan 21-09 10:47 · 23-09 10:40 · 05-10 11:05 · 08-10 10:51 — all [28.40594, 77.31090](https://www.google.com/maps?q=28.40594,77.31090) (3.95 km). Pranoy (tester) 07-10 at the Delhi desk (20 km) — ignore | **28.40594, 77.31090** | High (4 visits, < 3 m spread) |
| 2 | **Discovery park** (Sector 85) | [28.40244, 77.35934](https://www.google.com/maps?q=28.402443,77.359341) | Bhagwan 24-09 16:24 [28.37479, 77.35050](https://www.google.com/maps?q=28.37479,77.35050) · Banty 30-09 14:47 [28.37471, 77.35122](https://www.google.com/maps?q=28.37471,77.35122) (3.19 km) | **28.37475, 77.35086** | High (2 reps agree, ~70 m) |
| 3 | **Gopichand' chowk** (Mavai) | [28.44621, 77.34730](https://www.google.com/maps?q=28.446210,77.347299) | Bhagwan 24-09 15:49 · Banty 30-09 16:07 — both [28.43032, 77.34843](https://www.google.com/maps?q=28.43032,77.34843) (1.77 km) | **28.43032, 77.34843** | High (2 reps, identical) |
| 4 | **Sector 12** | [28.38769, 77.32149](https://www.google.com/maps?q=28.387694,77.321494) | Bhagwan 23-09 18:48 · 26-09 19:01 · 01-10 18:01 · 07-10 18:27 — all ≈ [28.38719, 77.31735](https://www.google.com/maps?q=28.38719,77.31735) (402–415 m) | **28.38719, 77.31735** | High (4 visits, < 25 m) |
| 5 | **SECTOR 21 D** | [28.41674, 77.28299](https://www.google.com/maps?q=28.416741,77.282987) | Bhagwan 30-09 13:46 [28.42065, 77.28765](https://www.google.com/maps?q=28.42065,77.28765) (630 m) · Banty 05-10 12:55 [28.42048, 77.28855](https://www.google.com/maps?q=28.42048,77.28855) (685 m) | **28.42056, 77.28810** | High (2 reps, ~90 m apart) |
| 6 | **SECTOR 56** | [28.34515, 77.29207](https://www.google.com/maps?q=28.345146,77.292066) | Bhagwan 28-09 16:00 [28.33840, 77.28941](https://www.google.com/maps?q=28.33840,77.28941) (794 m, out 28.33828, 77.29172) · 03-10 15:24 [28.33824, 77.29190](https://www.google.com/maps?q=28.33824,77.29190) (769 m) | **28.33822, 77.29185** (3 of 4 fixes) | Medium (one check-in 245 m off) |
| 7 | **Anc** (GK-II, Delhi) | [28.53953, 77.23922](https://www.google.com/maps?q=28.539535,77.239222) | Pranoy (tester) ×4 at the Delhi desk [28.54768, 77.24421](https://www.google.com/maps?q=28.54768,77.24421) | — do not use the desk point | **Test** — delete or confirm address |
| 8 | **Abhijit wines** (Nigdi, Pune) | [18.66102, 73.74881](https://www.google.com/maps?q=18.661018,73.748810) | Shreeyash 03-07 · Aadi (tester) 31-07, 20-08 ≈ [18.66194, 73.75081](https://www.google.com/maps?q=18.66194,73.75081) (233–285 m); 4× Pune desk 24 km — ignore | 18.66194, 73.75081 | **Test** |
| 9 | **Suraj wines** (Ravet, Pune) | [18.66062, 73.75108](https://www.google.com/maps?q=18.660619,73.751080) | 8 check-ins cluster ≈ [18.66190, 73.75085](https://www.google.com/maps?q=18.66190,73.75085) (130–181 m); 1 at 852 m; 3 at Pune desk — ignore | 18.66190, 73.75085 | **Test** |
| 10 | **BPTP** (address: Sector 29) | [28.42964, 77.32374](https://www.google.com/maps?q=28.429642,77.323737) | Bhagwan 24-09 16:43 [28.38941, 77.34028](https://www.google.com/maps?q=28.38941,77.34028) (4.76 km) | 28.38941, 77.34028 | Medium — **confirm**: address and check-in are 4.8 km apart; "BPTP" is a developer name used in several sectors |
| 11 | **Malena by pass** | [28.30259, 77.34251](https://www.google.com/maps?q=28.302589,77.342513) | Bhagwan 25-09 14:34 [28.30496, 77.32385](https://www.google.com/maps?q=28.30496,77.32385) (1.85 km) | 28.30496, 77.32385 | Medium (1 visit) |
| 12 | **Old sabji mandi** | [28.40934, 77.31726](https://www.google.com/maps?q=28.409344,77.317262) | Bhagwan 23-09 15:21 [28.41616, 77.32081](https://www.google.com/maps?q=28.41616,77.32081) (834 m) | 28.41616, 77.32081 | Medium (1 visit) — also has 13 no-coordinate duplicates, see B |
| 13 | **Dheeraj nagar** (near SLF Mall) | [28.45389, 77.31917](https://www.google.com/maps?q=28.453890,77.319174) | Bhagwan 05-10 14:31 [28.45389, 77.32244](https://www.google.com/maps?q=28.45389,77.32244) (319 m; checked out 1.7 km away) | 28.45389, 77.32244 | Medium (1 visit) |
| 14 | **World street** (Sector 76) | [28.38778, 77.35304](https://www.google.com/maps?q=28.387780,77.353045) | Bhagwan 24-09 16:35 [28.38736, 77.35018](https://www.google.com/maps?q=28.38736,77.35018) (284 m) | 28.38736, 77.35018 | Medium (1 visit) |
| 15 | **Shahupura** | [28.30389, 77.33483](https://www.google.com/maps?q=28.303886,77.334835) | Bhagwan 25-09 14:51 [28.30533, 77.33480](https://www.google.com/maps?q=28.30533,77.33480) (160 m; out 28.30492, 77.33522) | 28.30533, 77.33480 | Medium (1 visit, closest miss) |

**How to correct a pin:** management → Stores → store → Edit → move the pin (the edit form
re-derives `state`). Or send me the confirmed coordinates and I'll apply them as one reviewed
SQL update.

## B. The 30 stores with no coordinates

**With visits (4) — a pin can be taken from the check-in:**

| Store | Created by | Check-ins | Suggested pin | Notes |
|---|---|---|---|---|
| **Firewater L1** | Bhagwan | Bhagwan 21-09 12:57 [28.46910, 77.30344](https://www.google.com/maps?q=28.46910,77.30344) (out 28.46965, 77.30396) | 28.46910, 77.30344 | 2 orders, 1 plan — real customer |
| **Sector 19** | Bhagwan | Bhagwan 21-09 14:51 [28.42758, 77.31016](https://www.google.com/maps?q=28.42758,77.31016) | 28.42758, 77.31016 | |
| **Rajeev chowk** | Bhagwan | Banty 30-09 11:58 [28.41632, 77.31027](https://www.google.com/maps?q=28.41632,77.31027) — **checked out 700 m away** at 28.41875, 77.31720 | confirm | Check-in vs check-out disagree; needs someone who knows the shop |
| **Deccan brews cafe** (Pune) | Varad | 11 check-ins across Pune and the Delhi desk | — | **Test** store |

**Never visited, no plans, no orders (26):** 13× **Old sabji mandi**, 2× **BPTP**, **Bata chowk**,
**Bata more**, **Border 2nd**, **Chandila chowk**, **Gopichand' chowk**, **Gouchi**, **IMT 1 ST**,
**IMT 1ST**, **IMT 2ND**, **Krishana coloney**, **Sector 15** — all created by Bhagwan. Several
duplicate names that also exist *with* a pin (Old sabji mandi, BPTP, Gopichand' chowk, Bata more).

## Proposed handling rule for stores with no coordinates

**Remove the case instead of handling it at the gate.**

1. **Close the source (client):** `AddStoreModal` refuses to save until the picker holds a
   coordinate ("Waiting for your location…" / "Place the pin to continue"). The same for
   management's `StoreForm`.
2. **Close the source (database):** `alter table stores add constraint stores_location_required
   check (latitude is not null and longitude is not null) not valid;` — `NOT VALID` enforces it
   on every new or edited row immediately without failing on today's 30. After step 3 cleans
   them up, `validate constraint` makes it total. (Schema change → its own STOP-POINT.)
3. **Clean up today's 30** (your decision, row by row):
   - the **26 never-visited rows**: delete. None is referenced by a visit, plan or order, so
     nothing dangles. ⚠️ The in-app **Delete store** button cannot do it today: the
     `Stores: manager delete` policy exists but `authenticated` has **no DELETE grant** (open bug
     from the 2026-10-02 audit). So this is either a one-off SQL delete of the listed ids (your
     approval) or a grant fix first;
   - **Firewater L1** and **Sector 19**: set the pin from the check-in above;
   - **Rajeev chowk**: confirm which point is the shop;
   - **Deccan brews cafe**: test store — delete or leave out of the field.
4. **Defence in depth at the gate:** if a store somehow has no coordinates when §3 is live,
   the server-side check refuses check-in with "This store has no saved location" and the
   rep's only path is the **"store location looks wrong"** report — never a pass-through.
   (An unpinned store must not become the one store the geofence can't see.)

Rejected alternative: *"first check-in sets the pin"*. It lets the first rep pin a shop from
wherever they are standing — including home — and then check in there forever. That is the
bypass §3 exists to remove.

## Not pin problems (do not "correct" these stores)

Single bad **fixes** at otherwise well-pinned stores — the geofence will rightly refuse these:
Bata more (one check-in 1,150 km away), Gopi colony (one at 1,154 km — stale/teleported fix),
Hardware chowk (one at 3.5 km), Shubam wines (Pune desk). Sector 30 by pass (one at 365 m, the other at 31 m), Anandvan / Sarai fatak (132–135 m,
one visit each among close ones) are GPS slop at the threshold, which is exactly what §3's
accuracy-gating is for.
