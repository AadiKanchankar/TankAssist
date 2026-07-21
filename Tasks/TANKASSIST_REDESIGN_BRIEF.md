# TankAssist UI/UX redesign — implementation brief for Claude Code

**How to use this file:** paste this into Claude Code (or `@`-reference it) as the task brief.
Read `DESIGN.md` (design system) and the repo's `CLAUDE.md` + `HANDOFF.md` first. Work the
phases in order, **stop and report after each numbered phase** — do not self-continue past a
phase boundary. Every phase ends `npx tsc --noEmit` clean, complete files only.

Goal: lift the app from "typical simple UI" to a premium, motivating, fast-*feeling* product —
without changing behaviour, data, or security. This is a **presentation-layer** redesign plus a
**perceived-performance** layer. No database schema changes are needed or wanted.

**Scope = the entire app, every screen.** The three dashboards are built *first* only because they
establish the template (shell, bento, skeleton, motion, spotlight); once that template exists,
every other screen inherits it. §3 specs the dashboards; **§3B specs every remaining screen**;
the phase plan (§2) rolls the template across all of them. If a screen isn't listed in §3 or §3B,
it was missed — flag it, don't skip it.

---

## 0. Non-negotiable guardrails (carry the repo's rules forward)

1. **No schema / RLS / RPC changes.** This is UI + a client-side data-cache layer only. All data
   still flows through the existing Supabase RLS and helpers. If you think you need a DB change,
   STOP and report instead.
2. **Cases figures always go through `casesSold` / `repCasesSold`** (`lib/reportSemantics.ts`).
   Never compute cases inline. Respect `ORDERS_CUTOVER_DATE`.
3. **Order mutations stay in `update_order_status` / the existing inserts.** UI only calls them.
4. **Preserve `DashboardRouter`**: management → KPI dashboard; sales_manager → legacy dashboard;
   rep → rep dashboard. Redesign each; don't merge or re-route them.
5. **Reuse shared components** (`Button`, `Card`, `Header`, `VoiceInput`, `usePullToRefresh`) —
   extend them, don't fork. Styling stays StyleSheet + tokens from `constants/colors.ts`
   (Helvetica Neue). No NativeWind/Tailwind.
6. **Tokens only** — no raw hex or magic numbers in screens; add to `constants/colors.ts` first.
7. `npx tsc --noEmit` after every change. Complete files. No new secrets (anon-key-only).
8. **Accessibility + reduced motion** are acceptance criteria, not extras (see §6).
9. Native deps (below) don't hot-reload — they ride an **EAS build**. Batch them with the
   already-pending voice/PDF/OTA build if it hasn't shipped, else cut a new preview build.

---

## 1. Dependencies to add

```bash
npx expo install @tanstack/react-query \
  react-native-reanimated moti expo-linear-gradient \
  react-native-svg react-native-gifted-charts \
  expo-blur expo-haptics
```

- `@tanstack/react-query` — data cache → instant revisits + clean skeleton/optimistic states (the
  real Doherty fix; the app currently re-fetches per screen focus with no cache).
- `react-native-reanimated` (+ babel plugin **last** in `babel.config.js`) + `moti` — entrance
  animations, skeleton shimmer, success moments. Reduced-motion aware.
- `expo-linear-gradient` — moti skeleton shimmer + subtle fills.
- `react-native-svg` + `react-native-gifted-charts` — donut (pipeline), bar trend (cases), pie
  (top stores share). Pure-RN, themeable to brand colours; no Skia needed for "balanced".
- `expo-blur` — the single glass hero surface per screen.
- `expo-haptics` — peak-end success feedback.

`app.json`: add the `expo-blur` note only if a config plugin is required by the installed version;
`react-native-reanimated`, `react-native-svg`, `expo-haptics`, `expo-linear-gradient` need no
plugin config beyond install. **All are native → fresh EAS build required.**

Optional / later (not now, keep "balanced"): `@shopify/react-native-skia` for true liquid-glass.
Don't install until a screen genuinely needs it.

---

## 2. Phase plan

**Phase A — Tokens + motion + skeleton primitives.**
Merge `DESIGN.md` §2–§7 into `constants/colors.ts` (keep existing exports; add new). Add
`constants/motion.ts`. Build `components/skeleton/Skeleton.tsx` + `Metric`, `BentoTile`,
`Donut`, `TrendBars`, `PipelineStrip`, `StatusPill`, `SuccessOverlay`, `EmptyState`,
`Autocomplete`, `Breadcrumbs`. No screen changes yet. Report a component gallery screen (dev-only)
so the tokens/components can be eyeballed. `tsc` clean.

**Phase B — Data-cache layer.**
Add `QueryClientProvider` in `App.tsx` (inside the existing providers, outside the nav trees).
Create `lib/queryClient.ts` (staleTime 30s default, gcTime 5m, retry 1). Add query hooks for the
three dashboards' data (§3), each wrapping the existing fetch/helper calls unchanged. Wire
`useFocusEffect` → `refetch()` (keep focus-refresh behaviour, but now cache-backed so the screen
paints instantly from cache and refreshes in the background). Report. `tsc` clean.
_Every later screen phase adds its own `useQuery` hook the same way when it's touched — this phase
just stands up the provider, client, and the dashboard hooks; the pattern then repeats app-wide._

**Phase C — Rep dashboard** (`RepTabs` Dashboard). §3.1. Full redesign: bento, skeleton, motion,
empty states, one lime CTA. Report.

**Phase D — Sales-manager dashboard** (legacy). §3.2. Report.

**Phase E — Management KPI dashboard** (`management-dashboard.tsx`). §3.3. Replace the `<View>`
bars with real charts; pipeline donut; skeleton mirrors layout; tap-through preserved. Report.

Dashboards done, the template now exists. Roll it across the rest of the app (§3B has the per-screen
detail). Each phase = redesign those screens with the shell/primitives, add their `useQuery` hook,
skeleton, one spotlight, motion, empty/error states; then `tsc` clean and **report**.

**Phase F — Auth.** Login, Verify OTP, and the deactivated state. §3B.1.
**Phase G — Check-in stepper** (`store-visit.tsx`, the rep's most-used, most-complex flow). §3B.2.
**Phase H — Stores** (list · detail · form) + breadcrumbs. §3B.3.
**Phase I — Orders** (list · order detail) + optimistic status advance + prefetch from the pipeline
tap + `SuccessOverlay` on delivered. §3B.4.
**Phase J — Products** (list · add/edit). §3B.5.
**Phase K — Team** (reps list · member detail · Add-User enrollment) + Autocomplete. §3B.6.
**Phase L — Reports** (rep Report tab · rep-report-detail). Restyle the *screens* only — the PDF
print template keeps its own approved palette (do not touch `lib/reportPdf.ts` styling). §3B.7.
**Phase M — Profile + global shell** (tab bar, headers, breadcrumbs wiring, shared empty/error
states, the `VoiceInput` field restyle to tokens). §3B.8.
**Phase N — App-wide polish + perf + a11y sweep.** Entrance stagger consistency, reduced-motion
audit on every screen, hit-target + contrast + screen-reader-label pass, and a final
Impeccable `audit`/`polish` on each screen. Report.

Each phase is independently shippable via `eas update --channel preview` **after** the native
build that includes Phase A's deps is installed.

---

## 3. The three dashboards (flagship — build these to be the template the rest inherit)

Shared shell for all three: `Header` (greeting + date + brand mark), pull-to-refresh, a bento
grid, skeleton-on-first-load, one lime spotlight element, entrance stagger. Data via React Query.

### 3.1 Rep dashboard (`app/(rep)` Dashboard tab)
Purpose: get the rep into their day fast; make check-in the obvious action.
- **Hero (glass or dark tile):** check-in state. If not checked in → big lime **"Start check-in"**
  CTA (the screen's one spotlight) + today's date. If checked in → market-time running + distance
  travelled + a subtle "punch out" secondary.
- **Bento row:** "Cases today" (via `repCasesSold` for today) · "Stores visited today".
- **Assigned stores preview:** first 3–4 assigned stores with status dots (visited / stale /
  out-of-stock), "See all" → Stores. Autocomplete search entry at top.
- **Skeleton:** hero block + 2 stat tiles + 3 store rows.
- **Empty:** no assigned stores → EmptyState inviting them to check with their manager.

### 3.2 Sales-manager dashboard (legacy attendance/coverage — keep it, redesign it)
Purpose: coverage at a glance.
- **Bento:** "Reps checked in today X/Y" (spotlight if <50%) · "Visits today" · "Coverage %".
- **Reps strip:** list of reps with checked-in/out status dots + last-seen.
- **Orders glance:** small `PipelineStrip` summarising open orders → taps to Orders tab.
- Reuse existing legacy data sources; just recompose into bento + skeleton + motion.

### 3.3 Management KPI dashboard (`app/(admin)/management-dashboard.tsx`)
Purpose: the premium payoff screen. Replace the basic `<View>` bars with real charts.
- **Order pipeline** as a `Donut` (segments per bucket: to-process / dispatched / in-transit /
  delivered / cancelled) with the open-count in the centre; tapping a segment → Orders tab
  pre-filtered via the existing `filter` route param. (Zeigarnik: the open buckets pull attention.)
- **Cases this month vs last** as a `Metric` with delta + a `TrendBars` per-day chart; **spotlight
  the latest/today bar in lime**. All via `casesSold` (no second hybrid).
- **Today's field activity** tile (reps checked in / visits).
- **Stores needing attention** (`STALE_VISIT_DAYS = 7` and/or latest stock all-zero) — count +
  first few, red/amber accent, → filtered Stores.
- **Top stores this month** by cases — small ranked list or a share `Donut`.
- **Skeleton:** `DashboardSkeleton` from `DESIGN.md` §7 (mirrors this exact bento).
- Keep every tap-through and route param that exists today.

---

## 3B. The rest of the app — same template, every screen

Each screen keeps its exact behaviour, data source, and routing (per `CLAUDE.md`); only the
presentation + loading/motion layer changes. Every fetch screen gets its own `useQuery` hook, a
skeleton that mirrors its layout, at most one lime spotlight, entrance stagger, and proper
empty/error states. Reuse `Header`, `Card`, `Button`, `VoiceInput`, `usePullToRefresh`.

### 3B.1 Auth (Phase F)
- **Login** — cream canvas, brand mark/logo up top, phone field with the eager `phone_registered`
  gate unchanged. Spotlight = the "Send code" button. Inline microcopy for the "No account found"
  case (invitation tone, not error-shout). No spinner on the number check — a subtle inline
  activity dot on the field.
- **Verify OTP** — chunked code input, resend affordance with a countdown (Goal-gradient: the
  countdown ring), clear error state. Keep `shouldCreateUser:false` + one-login logic untouched.
- **Deactivated state** — a calm full-screen message (not an alarming alert), single "Sign out"
  action. Wire to the existing `deactivated` flag; don't change the auth logic.

### 3B.2 Check-in stepper — `store-visit.tsx` (Phase G) — the big one
Keep the 6 steps and their auto-skip rules exactly (prev-order deliver/cancel/skip · stock touched-
tracking · shop photos · required stock photo when stock>0 · optional order · feedback) and the
mount-time visit insert / check-in lock.
- **Progress header:** a step indicator (Chunking + Goal-gradient) showing 1–6 with the current
  step accented; the one spotlight lives here.
- **Per-step motion:** steps slide/cross-fade; reduced-motion → cross-fade.
- **Prev-order step** uses `PipelineStrip` + `StatusPill`; the placer-only cancel rule stays.
- **Stock step:** clean numeric steppers; "touched" rows subtly highlight so the rep sees what
  will be saved. Camera/photo steps get framed capture cards.
- **Checkout:** on Complete Check-Out → `SuccessOverlay` + success haptic (Peak-end). Live
  writes (deliver/cancel/order insert) still commit immediately; passive data at checkout.

### 3B.3 Stores — list · detail · form (Phase H)
- **Lists** (rep + admin `SectionList`s): keep state-grouping + accordion + the rep Assigned/All
  toggle + status dots. Add the `Autocomplete` search (debounced) and skeleton rows. Von Restorff:
  none needed here — keep calm.
- **StoreDetail** (shared): recompose Current Stock + Total Cases Ordered + info + recent orders +
  visits into bento cards (Common Region). Add `Breadcrumbs` (Stores → StoreDetail). Role actions
  unchanged (manager Edit/Delete; rep Check-In/Navigate — Check-In is the spotlight for reps).
  "Never recorded" empty state for stock.
- **StoreForm** (management): tidy form styling + the existing `StoreLocationPicker`; submit is the
  spotlight; inline validation microcopy.

### 3B.4 Orders — list · order detail (Phase I)
- **OrdersList:** keep the tappable summary segments as the filter control; skeleton list rows;
  `StatusPill` per row; Zeigarnik — open buckets read as "unfinished". Prefetch a row's detail on
  press-in.
- **OrderDetail** (shared): items+freebies+value, store, placed-by, the status-history timeline,
  delivered photos. Add `PipelineStrip` at the top. Manager actions still run through
  `update_order_status` — but make the forward-advance **optimistic** (update cache immediately,
  roll back on error). Delivered-override + cancel keep the reason modal. `Breadcrumbs`.

### 3B.5 Products — list · add/edit (Phase J) — management only
- List with the collapsed Archived section preserved; skeleton rows; add/edit as a clean form
  (price optional). Archive/unarchive stays (no delete anywhere). Spotlight = "Add product".

### 3B.6 Team — reps list · member detail · Add User (Phase K)
- **RepsList:** role-grouped accordion kept; `Autocomplete` search; skeleton; status dots.
- **RepDetail / member detail:** bento header (avatar, role, dependent-rep count for SMs), then the
  Assign-Stores / Report / management-only Deactivate/Reactivate sections as grouped cards. Keep
  the not-self + role rules.
- **Add User (OTP enrollment):** present the relay flow as a clear 2-step mini-stepper (enter phone
  → relay code) with honest status microcopy; keep the ephemeral-client enrollment + orphan "Retry
  Save" logic exactly. Manager's session must stay untouched — UI only.

### 3B.7 Reports — rep Report tab · rep-report-detail (Phase L)
- Restyle the **screens** (Daily/Weekly/Monthly toggle, stat tiles, the CSV/PDF choice) with the
  template; skeletons for the period fetch; all cases via `casesSold`.
- **Do not restyle the PDF** itself — `lib/reportPdf.ts` keeps its approved slate/blue print
  palette and inline-SVG charts. The CSV/PDF *choice UI* is in scope; the generated document is not.

### 3B.8 Profile + global shell + VoiceInput (Phase M)
- **Profile:** bento of user info + settings rows; sign-out; app version. Calm, no spotlight.
- **Tab bars / headers:** restyle to tokens (active tab = olive, not lime); safe-area aware.
- **Breadcrumbs** wired into the nested Stores/Orders/Team stacks.
- **VoiceInput:** restyle the field + mic + EN/HI/MR selector to tokens; keep the one-time notice
  and "no audio stored" behaviour. Mic active = a gentle pulse (reduced-motion → static).
- Shared **EmptyState** / error components applied everywhere lists can be empty or a fetch fails.
- **`kickedOut` alert** (App.tsx "logged in on another device"): still a raw `Alert.alert` — the only
  un-restyled leftover alert after Phase F redesigned the `deactivated` state into a full-screen. Bring it
  into the redesign here (restyle to a calm surface consistent with the deactivated screen). Keep the
  `kickedOut`/`clearKickedOut` flag + server-revocation logic untouched — presentation only.

---

## 4. Reference implementations (drop-in starting points)

```ts
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false } },
});
```

```tsx
// App.tsx (excerpt) — wrap the nav trees; keep existing AppState/auth logic untouched
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
// ...
return (
  <QueryClientProvider client={queryClient}>
    {/* existing providers + the three reactive nav trees */}
  </QueryClientProvider>
);
```

```tsx
// Example: management dashboard data hook — wraps EXISTING fetches/helpers, adds cache.
import { useQuery } from '@tanstack/react-query';
import { casesSold } from '../lib/reportSemantics';
// import the existing pipeline-count / stale-store / top-store fetchers you already have

export function useManagementDashboard(monthStart: Date, monthEnd: Date) {
  return useQuery({
    queryKey: ['mgmt-dashboard', monthStart.toISOString()],
    queryFn: async () => {
      const [pipeline, cases, activity, attention, topStores] = await Promise.all([
        fetchPipelineCounts(),                        // existing
        casesSold(monthStart, monthEnd),              // existing hybrid — do not reimplement
        fetchTodayActivity(),                         // existing
        fetchStoresNeedingAttention(),                // existing (STALE_VISIT_DAYS)
        fetchTopStores(monthStart, monthEnd),         // existing
      ]);
      return { pipeline, cases, activity, attention, topStores };
    },
  });
}
// Screen: const { data, isPending } = useManagementDashboard(...);
//         if (isPending && !data) return <DashboardSkeleton/>;  else render bento with `data`.
```

```tsx
// components/PipelineStrip.tsx — goal-gradient segmented progress for an order
import { View, Text } from 'react-native';
import { Colors, Space, Radius, Type } from '../constants/colors';

const STEPS = ['Placed','Ack','Dispatch','Transit','Delivered'] as const;

export function PipelineStrip({ currentIndex }: { currentIndex: number }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {STEPS.map((_, i) => (
          <View key={i} style={{
            flex: 1, height: 5, borderRadius: Radius.pill,
            backgroundColor: i < currentIndex ? Colors.accent
              : i === currentIndex ? Colors.spotlight   // current step = the one lime
              : Colors.border,
          }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: Space.xs }}>
        {STEPS.map((s) => <Text key={s} style={[Type.caption, { color: Colors.textMuted }]}>{s}</Text>)}
      </View>
    </View>
  );
}
```

```tsx
// components/SuccessOverlay.tsx — peak-end moment. Call on check-out complete / order delivered.
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { View, Text } from 'react-native';
import { Colors, Type, Radius } from '../constants/colors';

export function SuccessOverlay({ label }: { label: string }) {
  const reduce = useReducedMotion();
  // fire haptic when this mounts
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  return (
    <View style={{ position:'absolute', inset:0, alignItems:'center', justifyContent:'center' }}>
      <MotiView
        from={{ scale: reduce ? 1 : 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'timing', duration: reduce ? 120 : 280 }}
        style={{ backgroundColor: Colors.surface, borderRadius: Radius.card, padding: 24, alignItems:'center' }}>
        {/* check icon here */}
        <Text style={[Type.section, { color: Colors.success, marginTop: 8 }]}>{label}</Text>
      </MotiView>
    </View>
  );
}
```

Charts: theme `react-native-gifted-charts` to brand — bars `Colors.accent` with the latest bar
`Colors.spotlight`; donut segment colours = the status metadata colours from `lib/orders.ts`
(fallback to `accent`/`success`/`warning`/`alert`/`textMuted`). Keep chart config in the wrapper
components (`Donut`, `TrendBars`) so screens stay clean.

---

## 5. Stitch + Impeccable workflow (do this in your Claude Code, once, before Phase C)

Stitch outputs **web** layouts, not React Native — so use it for *composition and hierarchy*, then
translate to RN with these tokens. Impeccable audits/polishes the RN you write.

1. **Impeccable init:** run `/impeccable init`, choose the **product** lane. Point it at this
   `DESIGN.md` so its `PRODUCT.md`/`DESIGN.md` inherit these tokens, the "balanced effects" rule,
   and reduced-motion requirement. Then after each dashboard: `/impeccable audit <screen>` and
   `/impeccable polish <screen>`; use `/impeccable animate` for motion and `bolder`/`quieter` to
   tune intensity. Its anti-"AI slop" gates will (correctly) push back on over-glassing — let it.
2. **Stitch:** connect the Stitch MCP, then generate each dashboard layout with the prompts below,
   fetch the screen image/HTML as a **reference only**, and implement in RN with the §4 primitives.

**Stitch prompt — management dashboard**
> Mobile dashboard, 390px wide. Warm cream background (#F2ECD8), one dark olive hero tile
> (#222413) with a large lime (#DFE350) number. Bento grid: top row = wide "cases this month"
> metric tile with a small bar trend + a square donut tile "order pipeline" with a center count;
> second row = two small stat tiles "checked in today" and "needs attention" (red dot); then a
> full-width order card with a 5-segment horizontal progress strip (Placed→Ack→Dispatch→Transit→
> Delivered); then a "top stores" list. Minimal, premium, generous padding, rounded 16px cards,
> hairline borders, Helvetica. One accent only. No gradients on text.

**Stitch prompt — rep dashboard**
> Mobile home screen, 390px, cream background. Hero glass/dark card with a big lime "Start
> check-in" button and today's date; two small stat tiles "cases today" and "stores visited";
> a search field; a list of 3 assigned-store rows with colored status dots and a "see all" link.
> Bottom tab bar. Minimal, premium, one accent, rounded 16px, Helvetica.

**Stitch prompt — sales-manager dashboard**
> Mobile coverage dashboard, cream. Three stat tiles: "reps checked in X/Y", "visits today",
> "coverage %"; a reps list with status dots and last-seen; a compact 5-segment order pipeline
> summary that links out. Minimal, premium, one accent, rounded 16px, Helvetica.

---

## 6. Acceptance criteria (per screen)

- First load shows a **skeleton that mirrors the final layout**; no full-screen spinner anywhere.
- Revisiting a screen paints **instantly from React Query cache**, then background-refreshes.
- Exactly **one lime spotlight** element visible per screen.
- Charts render with brand colours; numbers use tabular-nums and route through `casesSold`.
- All existing tap-throughs / route params / role-gating still work; `DashboardRouter` intact.
- Reduced-motion on → animations become simple cross-fades; nothing essential is motion-only.
- Icon-only controls have accessibility labels; hit targets ≥44px; text meets AA on its surface.
- `npx tsc --noEmit` clean. No schema/RLS/secret changes. Complete files.
- Check-out complete and order-delivered fire `SuccessOverlay` + a success haptic.

---

## 7. Out of scope (do not start without a go-ahead)
Geo-fence enforcement; offline queue / batch-sync backend; instant-kill deactivation; any DB
migration. These are parked in `HANDOFF.md` and unchanged by this redesign.
