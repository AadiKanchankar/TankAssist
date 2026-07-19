# TankAssist — Project Status

A plain-language summary for the Tank No. 90 team. (Technical detail lives in `CLAUDE.md`; the developer to-do snapshot is `HANDOFF.md`.)

_Last updated: 18 July 2026_

---

## What the app does now

TankAssist started as an attendance + store-visit tracker. It has grown into a full **ordering and inventory** tool. Here's what each type of user can do, end to end.

### Sales Rep (field staff)
- **Check in for the day** with a selfie + GPS, and **punch out** (the app measures market time and distance travelled).
- **Visit a store** through a simple step-by-step screen:
  1. See the store's **last pending order** and either mark it **Delivered** (with optional photos) or **Cancel** it (with a reason). Reps can only cancel orders they placed themselves; for anyone else's order they're told to contact their manager.
  2. **Record current stock** on the shelf (only the products they actually check).
  3. Take **shop photos**, and a **stock photo** when they've entered stock.
  4. Optionally **place a new order** — pick products, quantities, freebies, add notes.
  5. Add **feedback/notes**, then finish.
- Type **or speak** any notes (voice-to-text in English, Hindi, or Marathi — the phone does the transcription; no audio is ever saved).
- Submit a **daily report**.

### Sales Manager
- Everything visible about the team and stores, plus the new **Orders** tab: see every order by stage (To Process / Dispatched / In Transit / Delivered / Cancelled) and move each one forward — **Acknowledge → Dispatch → In Transit**, or **Cancel** with a reason. Each step records who did it and when.
- Manage the **team** (grouped by role) and review any rep's activity + download reports (CSV or PDF).

### Management
- Everything a sales manager can do, plus:
- A **KPI dashboard**: live order pipeline, cases ordered this month vs last with a daily trend, today's field activity, stores that need attention (not visited recently or out of stock), and top stores.
- The **Products** catalog: add, edit, and archive products (with optional prices). Products are never deleted — discontinued ones are archived so past orders stay intact.
- **Add and deactivate users.** New accounts are created by sending a one-time code to the new employee's phone and having them read it back — no self sign-up.

### Order journey (who does what)
`Placed` (rep) → `Acknowledged` (manager) → `Dispatched` (manager) → `In Transit` (manager) → `Delivered` (rep verifies at the store). Any order can be `Cancelled` with a reason. If an order is stuck "In Transit" because a store isn't revisited, a manager can mark it delivered with a recorded reason.

---

## What's live vs. awaiting the new app build

**Live now (in the database, verified):** the three-role model, account lockdown, the product catalog, the full orders + stock + status system, and all the security rules around them.

**Built, but needs one new app build to go onto phones:** everything visual and interactive — the new check-in flow, Orders/Products/Team screens, the management dashboard, voice notes, and the in-app PDF report. These use phone features (camera, microphone, PDF) that only take effect in a freshly built app, not a live-updated one.

Nothing is on reps' phones yet — it all ships together in the next build.

---

## Exact next actions, in order

1. **Build the app** (one Android build that bundles voice notes, the PDF export, and future over-the-air updates).
2. **Test on a real phone** using the checklist in `HANDOFF.md` (enrolment + login, the check-in flow, the order lifecycle, voice notes, and CSV/PDF export).
3. **Set the "cutover date"** in the code to the day you roll out — this is the day the app switches from counting "cases sold" the old way (per visit) to the new way (per order). It matters for report accuracy.
4. **Roll out to all reps on the same day** (not staggered), so everyone's data lines up around that cutover date.
5. **Four Supabase settings** (a developer can do these in minutes): make the SMS code last long enough for a manager to relay it, confirm the live SMS provider and remove any test numbers, and shorten the login session length.
6. After the build is out, future small changes can be pushed **over the air** without a new store install.

---

## Notes & decisions on record
- **No audio is ever stored** for voice notes — only the transcribed text.
- **Deactivating a user** takes effect within a few minutes (at their next app refresh), not instantly. An instant cut-off was considered and deliberately left out to keep the setup simple; it can be added later if needed.
- **Out of scope for now:** GPS geo-fencing (flagging check-ins far from a store) and offline use. Both are noted for the future.
