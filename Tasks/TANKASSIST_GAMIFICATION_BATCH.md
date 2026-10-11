# TankAssist — subtle gamification (personal, self-competitive)

Ships **after** the spot-sale batch, because most of what it measures only becomes real once spot
sales and compulsory stock counting are live.

**The owner's framing, which governs everything here: personal level, reps challenging themselves.**
Not peer leaderboards, not public ranking. The reference points are Swiggy / Blinkit / Zepto rider
mechanics — but deliberately only the healthy half of that playbook. §1 says which half and why.

Standing rules: verify live via MCP, `graphify query` before grep, `tsc` clean per item, complete
files, schema changes are STOP-POINTs, no service-role key, reuse over new code (ponytail),
Impeccable pass on every UI change. State at the end which parts are OTA vs build-gated.

---

## 1. What NOT to build — read this first

Gig-platform gamification works, which is exactly why parts of it are dangerous. These are excluded
deliberately. **Do not add them later "just as an experiment".**

- **No countdown timers or urgency mechanics.** Reps ride motorbikes between liquor stores. Any
  mechanic that rewards hurrying creates road-safety risk, and that is a real documented harm in gig
  delivery, not a theoretical one. Nothing in this app should ever make a rep want to ride faster.
- **No loss framing.** "Only 2 more or you lose your streak" pushes people to work while ill and
  turns a motivator into anxiety. Frame forward — what's within reach — never what's about to be
  taken away.
- **No public leaderboards or visible bottom ranks.** The owner asked for personal, and ranking field
  staff against each other in a small team is demoralising for everyone below the median.
- **No random or variable rewards.** The slot-machine mechanic is the deliberately addictive one.
  Rewards here are predictable and earned.
- **Nothing that rewards the raw count of logged spot sales.** The previous batch is built on the
  rule that no incentive attaches to a self-reported number. Gamifying that count would reintroduce
  the exact fraud incentive the design removed. Spot sales can be *celebrated* once corroborated by
  stock depletion; they are never a score on their own.

**The positive rule: gamify behaviours that are both wanted and hard to fake.** Counting stock at
every planned store is verifiable and useful. Logging a photo is neither.

## 2. Derive everything — no points ledger
Compute every streak, total and personal best **from the rows that already exist** — attendance,
visits, stock snapshots, journey plans, spot sales. **Do not create a points or score table.**

A separate score ledger would be a second source of truth that can drift from reality, and a thing to
corrupt. Derived numbers are always consistent with the work actually recorded, and they recompute
correctly if a visit is later voided. Put the derivation in one place alongside
`lib/reportSemantics.ts` so the app and any report agree.

If performance becomes a problem at scale, cache it — but cache a derived value, never author one.

## 3. The daily layer — today, on the rep dashboard
A quiet progress line, not a scoreboard.

- **Today's plan progress**: stores visited against stores planned, as a progress bar that fills.
  Goal-gradient — the bar should visibly accelerate near completion.
- One **forward-framed nudge** when close: *"2 more stores to finish today's plan."* Never "don't
  lose".
- **Quality, not just quantity**: show stock counted (e.g. "stock counted at 5 of 6") so a rep who
  rushes through without counting doesn't see a full bar. This is the point — the bar must measure
  the work you actually want.
- Sits inside the existing dashboard layout. It does not become a new screen.

## 4. Streaks — with forgiveness built in
- A streak counts **consecutive working days where the rep completed their plan and counted stock**.
  Not days logged in.
- **Rest-day allowance:** one missed day per week does not break the streak, and Sundays/declared
  holidays never count against it. Illness should not destroy three weeks of effort — and a streak
  that punishes sick days is a streak that sends sick people into the field.
- Streak is displayed plainly ("12-day streak"), with no warning, timer or countdown attached.
- Derived from attendance + visits; no new storage.

## 5. The monthly layer — personal bests
This is where the owner's "challenging themselves" lands.

- **Compare the rep only against their own history**: best month for stores covered, best week for
  unique stores, best month for corroborated conversions.
- *"Your best month was 84 stores. You're at 71 with 9 days left."* Specific, personal, forward.
- **Corroborated spot sales only** in anything that reads as achievement — conversions that showed up
  in stock depletion. The raw logged count can appear as plain activity, labelled as such, with no
  celebration attached.
- Managers see their own personal view too, now that they do field work.

## 6. Celebration moments — peak-end, used sparingly
The peak-end rule is already in the design system. Spend it where it matters:

- **Plan completed for the day** — the main one. A brief, well-made moment at check-out: the bar
  completing, haptics, a short figure of the day ("6 stores · 4 counted · 2 conversions").
- **A new personal best** — rarer, so it can be slightly bigger.
- **A round milestone** — 100th store visit, 50th conversion.

Nothing else gets an animation. Three celebration types total. If every action sparkles, none of them
mean anything, and the app starts to feel like it's managing the rep rather than helping them.

Use `moti` / `react-native-reanimated` and `expo-haptics`, already in the project. Keep every
animation under ~600ms and make it skippable by tapping through. A rep who has seen it 40 times
should be able to move past it instantly.

## 7. Design-system constraints — do not break these
- **The lime spotlight rule still holds: `#DFE350` appears at most once per visible screen.** This is
  the single most likely thing for a gamification pass to destroy — badges, bars and celebrations all
  want to be the bright thing. Progress bars use olive; lime is reserved for the one element that
  deserves the eye on that screen, and on a celebration screen that is the celebration.
- No new visual language, no new palette, no badge illustrations in a foreign style. Everything is
  built from existing tokens and components.
- **Never encode meaning in colour alone.** Every progress indicator carries a text label — "5 of 6
  stores" — for both accessibility and legibility in Indian daylight on a cheap screen.
- Screen-reader labels on every new element. Impeccable pass.
- Keep it quiet. The owner's word was *subtle*, and the app's existing character is calm and
  professional. This should feel like the app noticing good work, not like a mobile game.

## 8. Management view
One addition for management only: **who is consistently counting stock and completing plans**, as a
simple per-rep pattern over the month. Not a ranking to show anyone — a management signal about
coaching, not a competition to publish.

## 9. Ship
Update `CLAUDE.md`/`HANDOFF.md`: the derived-not-stored rule, the excluded mechanics and why (this is
a design decision future sessions must not casually reverse), the streak forgiveness rule, the three
celebration moments, and the lime-spotlight constraint under gamification. Commit + push.

This should be JavaScript-only → OTA. Confirm.

On-device test: complete a partial plan and confirm the bar reflects stock counted, not just visits →
finish a plan and confirm the celebration fires once, is under a second, and can be tapped through →
miss a day and confirm the streak survives one miss in a week → check a screen with a progress bar
and a celebration and confirm lime appears exactly once → run a screen reader over the dashboard.

## Order of work
1. §2 the derivation layer, with tests — everything else reads from it.
2. §3 daily progress, §4 streaks.
3. §5 personal bests.
4. §6 celebrations, §7 Impeccable and accessibility pass.
5. §8 management view.
6. §9 docs → ship.

Report once the derivation layer is tested, and again before shipping with screenshots of the three
celebration moments.
