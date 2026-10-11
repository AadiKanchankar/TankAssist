# TankAssist — spot sales, face blur, camera zoom, compulsory stock, privacy policy

**§1 (spot sales) is the headline feature and §2 (on-device face blur) is not optional — it ships in
the same release or neither ships.** The app will be photographing members of the public buying
alcohol; storing identifiable faces is the single largest legal exposure in the product. §4 makes
stock counting compulsory, which is what eventually makes §1 credible rather than decorative.

Standing rules: verify live via MCP, `graphify query` before grep, `tsc` clean per item, complete
files, schema/RLS/storage changes are STOP-POINTs, no service-role key, reuse over new code
(ponytail), Impeccable pass on every UI change. State at the end which parts are OTA vs build-gated.
**Note up front: §2 and §3 are native-module work and will need a new build — plan the release
accordingly.**

**Owner decisions already made — build to these, don't re-ask:**
| Question | Decision |
|---|---|
| Face blur | **Day one.** Not a fast-follow |
| Camera zoom | **Digital zoom on expo-camera** (pinch + 1x/2x/5x). No vision-camera swap |
| Stock can't be counted | **Skip with a reason**, recorded and flagged — never a silent skip |
| Gamification | **Separate batch immediately after** — not in this release |
| Privacy policy text | Owner is supplying a draft; build the page to hold it |

---

## 1. Spot sales — logging rep-to-customer selling

A rep spends 30–60 minutes in a shop converting walk-in customers to Tank 90. Today that work is
invisible: the store's till records a sale, but nothing connects it to the rep who caused it. Reps
currently WhatsApp a photo of the customer holding a bottle, which proves nothing and creates a legal
problem. This replaces that.

**Frame it correctly in the code and the docs: the photo is a work artifact, not proof of sale.**
What makes a spot sale credible is the pattern — timestamps spread across the visit, location, and
the store's stock moving afterwards (§4). A photo alone proves a bottle was near a phone.

### 1a. One event per customer interaction — the core design rule
**The rep logs each interaction as it happens. They never type a visit total.** The count is always
derived from the events.

This is the main anti-gaming mechanism and it must not be compromised for convenience. Opening the
camera per conversion spreads the timestamps naturally across the visit; faking eight sales means
staging eight separate moments, which is more effort than selling. A "quantity: 8" box at check-out
takes two seconds to fake and is worthless.

Each `spot_sale` event carries:
- **product** and **quantity** (one customer may take three bottles — quantity is for *that*
  interaction). Note there is currently exactly one active product (`Tank 90 select`, 330 ml), so the
  picker must be built generally but will show one option today — don't hard-code it.
- **photo** (camera-only, never gallery — same rule as shelf photos), face-blurred per §2
- **`switched_from`** — one tap from a short competitor list (Kingfisher, Tuborg, Budweiser, etc.,
  plus "nothing specific" and "other"). This is the conversion story: *came in for X, left with ours*.
  In aggregate it becomes competitive intelligence worth more than the photos. Make the list a
  seeded, editable table, not a hard-coded array.
- `visit_id`, `store_id`, `user_id`, `captured_at`, GPS, `actor_role`, perceptual hash (§1c)
- optional one-line note

Append-only. Allow a **60-second undo** for genuine mistakes, then the row locks. No edit, no delete.

### 1b. Where it lives — ambient, not a stepper step
Not a step in the 6-step stepper. The stepper is linear and completed once; spot sales happen at
unpredictable moments across an hour.

- A **persistent bar at the top of the store-visit screen**, available the whole time the check-in is
  open — check-in to check-out — sitting alongside the stepper, not inside it. (Owner asked for this
  placement specifically.)
- It shows a **live tally for this store today** — "3 logged here" — so the rep's own effort is
  visible to them while they're still standing in the shop. Goal-gradient; this is the hook the
  gamification batch will build on.
- Tapping it opens the capture flow: camera → product → quantity → switched-from → save. Keep it
  under 10 seconds end to end, because a rep who is mid-conversation will not use anything slower.
- The order step shows "You logged 4 spot sales here today" to close the loop (peak-end).
- Gated by an open check-in, which falls out of the existing gate for free.

### 1c. Anti-gaming — flag, don't block
- **Perceptual hash on every spot-sale photo.** Flag near-duplicates by the same rep, at the same
  store, and company-wide. This kills literal photo re-use, which is the obvious first cheat.
- **Flag implausible patterns, never cap the count** — a genuinely good rep might convert ten people:
  - several events within a couple of minutes of each other
  - events logged after the rep's GPS has moved away from the store
  - a cluster in the final two minutes before check-out (the signature of bulk-logging on the way out)
  - a rep whose spot sales never show up in that store's stock depletion
- Flags route to the manager exception queue on the existing terms; SM flags go to management.
- **No monetary incentive attaches to the logged count.** Recognition uses the logged figure;
  anything that pays uses the depletion-corroborated figure (§4). Write this into `CLAUDE.md` — the
  moment money attaches to a self-reported number, the number stops being data.

### 1d. Schema — STOP-POINT
- `spot_sales` table as above. Write policy pinned to `auth.uid()` **and** to the writer's own visit —
  exactly the A1–A4 pattern just applied. Read: own rows, `manages_rep(user_id)`, management.
- New **`spot-sale-photos`** storage bucket, not a folder in `visit-photos`. It needs its own
  retention rule and its own policy, and face-bearing images should stay separable from shelf photos.
  Visibility mirrors the visit-photo rules including the peer-SM exclusion.
- `competitor_brands` lookup table, seeded, editable by management.
- Present the migration and the policies before applying.

## 2. 🔒 On-device face blur — ships with §1 or §1 doesn't ship

The app will photograph members of the public buying alcohol. That is identifiable personal data
about a sensitive purchase, and under the DPDP Act it is collected from people who are not employees
and have given no consent. **Do not store identifiable faces.**

- **Detect and blur faces on-device, before upload, using Google ML Kit Face Detection** — the same
  library already shipped for the odometer OCR. The blurred frame is what uploads; **the original
  never leaves the phone and is never written to the device gallery or a cache that survives the
  upload.**
- The company still gets what it asked for: a photo of a real customer at the counter holding the
  product. They just don't get a face, and neither does any future breach.
- **Fail closed.** If face detection fails or is unavailable, the photo must not upload unblurred —
  either block the save with a clear message, or apply a conservative blur. Decide and state which.
  A silent fallback to raw upload is the one outcome that must be impossible.
- Viewfinder guidance: *"Show the bottle and the counter — faces aren't needed."* Framing that avoids
  faces entirely is better than blurring one.
- **90-day automatic deletion** of spot-sale photos via the existing `pg_cron` setup, once the
  depletion cross-check has run. Keep the event row forever; drop the image. Smaller breach surface,
  and it's a concrete retention commitment the privacy policy can state.
- Verify on a real device that the stored object has no recoverable face — check the uploaded file,
  not the preview.

## 3. Camera zoom — spot sale, check-in, and everywhere else
Currently every capture is locked at 1x, which makes shelf labels and distant bottles unreadable.
- Add **pinch-to-zoom plus 1x / 2x / 5x tap buttons** using `expo-camera`'s zoom prop. Digital zoom
  only — owner decision, no camera-library swap.
- Apply to **every** camera surface: check-in selfie, odometer, shelf/visit photos, challan, and the
  new spot-sale capture. One shared camera component — do not fork five variants (ponytail).
- **Watch the odometer OCR.** The crop maths previously broke on a scale factor (`0.78 × 1.8` clamped
  to 1.0). Zoom changes the effective frame, so the OCR crop must be computed against the *zoomed*
  image, not the sensor frame. Re-test odometer reading at 1x, 2x and 5x before shipping, and say in
  the report what each returned.
- Zoom level is captured per photo so a reviewer knows whether a shot was taken from across the shop.

## 4. Stock counting becomes compulsory
Only **130 of 252 visits** have ever recorded a stock count, and only **36 store-product pairs** have
been counted twice. Depletion is what eventually proves a spot sale is real, and it cannot be
computed from a single count. This is the unglamorous prerequisite for the whole feature.

- The stock step becomes **required** to complete a visit.
- **Skip requires a reason** (owner decision) — a short list: *owner unavailable · stock in locked
  godown · shop too busy · section closed · other (with text)*. The skip is recorded on the visit,
  visible to the manager, and counts toward a flag if a rep skips repeatedly.
- **This matters more than it looks.** A hard block with no escape produces invented numbers from
  reps who genuinely can't count, and invented stock figures are worse than missing ones — they
  silently poison the depletion calculation that §1 depends on. An honest recorded skip is data; a
  fabricated count is damage.
- Build the **sell-through calculation** while you're here: `stock at last count + delivered since −
  stock now`, per store per product, from `store_stock_snapshots`, `orders` and `challans`. In
  excise-controlled alcobev the store can only source this brand through your channel, so the
  arithmetic is clean. Surface it in the manager and management reports.
- Then wire the §1c depletion flag: spot sales claimed at a store between two counts versus actual
  movement.

## 5. Privacy policy page under Profile
The app collects employee GPS during work hours, odometer photos, selfies, store photos, device
identifiers, and now customer photos. There is no notice anywhere. This protects Aderfia Ventures and
it protects the developer personally.

- Add a **Privacy & Data** entry under Profile, visible to every role, opening a readable in-app page.
- The owner is supplying the policy text. Build the page to **render it from a single source** —
  a markdown/HTML constant or a `policies` row — so the text can be updated without a code change
  hunting through JSX.
- Show a **version and effective date**, and record a per-user acknowledgement (`policy_version`,
  `acknowledged_at`) the first time a user opens the app after a new version publishes. A
  non-blocking one-time notice, not a wall.
- Also expose it **before first login** (a link on the login screen), since location permission is
  requested early.
- Mirror it at a public URL eventually — needed if the app is ever listed on Play. Note it, don't
  build it now.
- Schema (acknowledgement columns) → STOP-POINT.

## 6. Remove the "someone viewed your location" notification
- Drop the push notification fired when a manager views a rep's live location during check-in hours.
- **Keep the database audit log.** `trg_location_viewed` / `on_location_viewed` should still record
  who viewed whose location and when — remove only the push. The owner asked for the notification
  gone, not the record. The audit trail costs nothing, is invisible to the rep, and is exactly the
  evidence of proportionate use that the §5 policy will claim. Removing it would weaken the privacy
  position while gaining nothing.
- Confirm no other notification path fires on this event.

## 7. Ship
Update `CLAUDE.md`/`HANDOFF.md`: the spot-sale model and the one-event-per-interaction rule, the
"photo is a work artifact, not proof" framing, **the rule that no monetary incentive attaches to a
self-reported count**, face blur failing closed, the 90-day photo retention, the mandatory-stock skip
reasons, the sell-through formula, and the policy acknowledgement. Commit + push. `expo-doctor`.

**State OTA vs build clearly.** Face blur and camera zoom are native — this needs a new build, and it
cannot be an OTA-only release. Say so up front in the report so the rollout is planned.

On-device test: check in → the spot-sale bar is visible for the whole visit → log a sale with a face
in frame and confirm the **uploaded file** has no recoverable face → log a second identical photo and
confirm the duplicate flag fires → zoom to 5x and confirm odometer OCR still reads → try to finish a
visit without stock and confirm the reason prompt appears and is recorded → open Privacy & Data from
Profile → have a manager view a rep's location and confirm no push arrives but the audit row exists.

## Order of work
1. **§2 face blur** — prove it works on a device before anything is built on top of it. If ML Kit
   face detection can't be made reliable, that changes §1 entirely, so find out first.
2. §3 camera zoom (shared component), including the odometer OCR re-test.
3. **§1d schema + policies. STOP-POINT.**
4. §1a–§1c the spot-sale feature.
5. §4 compulsory stock + skip reasons + sell-through.
6. §5 privacy page, §6 notification removal.
7. §7 docs → build → ship.

Report after §2 (with device evidence that faces are gone from the stored file), at the §1d
stop-point, and before shipping.
