# DESIGN.md — TankAssist design system

Portable design system for TankAssist (React Native / Expo SDK 56, single Zustand auth store,
StyleSheet styling, direct Supabase). This file is the **source of truth** for colour, type,
spacing, motion, effect recipes, component behaviour, and voice. Both Claude Code and the
Impeccable skill read this; Stitch layouts are translated into these tokens.

Rule for anyone (human or agent) touching UI: **use tokens, never raw hex or magic numbers.**
If a value isn't in here, add it here first, then use it.

---

## 1. Brand

TankAssist is the field tool for **Tank No. 90**, an alcobev distributor. The feel we want:
warm, earthy, grounded, premium — not the cold blue/teal of generic fintech dashboards. Reps
use it standing in shops in poor light; managers use it to move money-shaped things (orders)
through a pipeline. So: high legibility, calm surfaces, one loud accent used rarely.

Personality: **dependable, quietly premium, motivating.** Not playful, not corporate-sterile.

---

## 2. Colour tokens

Derived from the supplied palette. Note: `#0000EE` in `figma-colors.json` is a stray default
link-blue from the colour picker — **not** a brand colour, excluded here. `#DFE350` (lime) is in
the brand palette but **currently unused in the app** — we promote it to the single spotlight
accent (Von Restorff): reserved for the one primary action / the one key metric per screen.

```ts
// constants/colors.ts — MERGE into the existing file. Keep every key the app already imports
// (Colors.background, Colors.accent, Colors.alert, Colors.success, Typography.accordionHeader …)
// and ADD the tokens below. Do not remove existing keys until their call-sites are migrated.

export const Palette = {
  ink:        '#131212', // primary text, darkest
  oliveDark:  '#222413', // premium dark surface (hero tiles, glass base)
  olive:      '#6D7431', // brand primary (existing Colors.accent)
  lime:       '#DFE350', // SPOTLIGHT accent — one use per screen, never a background wash
  cream:      '#F2ECD8', // app background (existing Colors.background)
  white:      '#FFFFFF',
  red:        '#D02028', // destructive / alert (existing Colors.alert)
  pine:       '#2D6A4F', // success (existing Colors.success)
} as const;

export const Colors = {
  // --- surfaces ---
  background:   Palette.cream,     // page canvas
  surface:      Palette.white,     // cards
  surfaceAlt:   '#FBF7EC',         // subtly warm card, for nesting a card on a card
  surfaceDark:  Palette.oliveDark, // hero / inverted surfaces
  // --- text ---
  text:         Palette.ink,       // primary
  textSecondary:'#6B6A5A',         // supporting (warm gray, not pure gray)
  textMuted:    '#9A9583',         // captions, placeholders, disabled labels
  textOnDark:   Palette.cream,     // text on surfaceDark
  // --- lines ---
  border:       '#E7E0CC',         // hairline on cream
  borderStrong: '#D8CFB4',
  // --- brand + roles ---
  accent:       Palette.olive,     // brand primary (buttons, active nav)
  spotlight:    Palette.lime,      // Von Restorff accent — see usage rule below
  onSpotlight:  '#3A3D14',         // text/icon on a lime fill (dark olive, never black)
  alert:        Palette.red,       // destructive (cancel, out-of-stock)
  bgAlert:      '#FBE7E7',         // pale danger tint for banners/badges
  success:      Palette.pine,      // delivered, in-stock, positive delta
  bgSuccess:    '#E4EFEA',
  warning:      '#B5852A',         // "needs attention" amber (accessible on cream)
  bgWarning:    '#F6EBD3',
} as const;

// Spotlight rule: lime appears AT MOST once per visible screen — the single primary CTA,
// or the single hero metric, or the current step in a stepper. Two limes on one screen
// cancels the effect. Everything else uses olive / neutrals.
```

Contrast: `ink`, `olive`, `pine`, `red`, `warning` all pass AA on cream and white. Lime is a
fill colour only — never lime text on cream (fails contrast). Text on lime is `onSpotlight`.

---

## 3. Typography

Font family stays **Helvetica Neue** (device system fallback), per the current app. One type
scale, two weights in play at a time. Sentence case everywhere (see §9).

```ts
export const Type = {
  display:  { fontSize: 28, lineHeight: 34, fontWeight: '700' }, // hero number / screen hero
  title:    { fontSize: 22, lineHeight: 28, fontWeight: '700' }, // screen title
  section:  { fontSize: 18, lineHeight: 24, fontWeight: '700' }, // = existing accordionHeader
  body:     { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyMed:  { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label:    { fontSize: 13, lineHeight: 18, fontWeight: '600' }, // stat labels, eyebrows
  caption:  { fontSize: 12, lineHeight: 16, fontWeight: '400' }, // meta, timestamps
  metric:   { fontSize: 27, lineHeight: 30, fontWeight: '700' }, // KPI numbers
} as const;
```

Numbers in KPIs use `fontVariant: ['tabular-nums']` so they don't jitter when they update.

---

## 4. Spacing, radius, layout

```ts
export const Space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const; // 4pt grid
export const Radius = { sm: 8, md: 12, card: 16, pill: 999 } as const;
export const Layout = { screenPad: 16, cardPad: 14, gridGap: 9, tap: 44 } as const; // 44 = min hit
```

Bento grids: 2-column with `gridGap`, hero tile spans wider (≈1.15fr vs 1fr) or full width.
Elements inside one rounded boundary read as one group (Law of Common Region) — group by card,
don't rely on spacing alone.

---

## 5. Elevation, neomorphism, glass

**Balanced intensity** (chosen): tactile effects appear on **hero surfaces only** — the dashboard
hero tile, the check-in card, and success moments. Everything else is flat with a hairline border.
Overusing glass/neomorph is the #1 way this reads as "AI slop" — don't.

```ts
export const Shadow = {
  // Soft resting shadow for raised cards (iOS shadow* + Android elevation).
  card: {
    shadowColor: '#3A3320', shadowOpacity: 0.10, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  // Neomorph is APPROXIMATED in RN (true dual light/dark shadow isn't cross-platform).
  // Use only on 1–2 controls (e.g. the stepper segmented control) on a cream surface:
  //   a raised look = Shadow.card on a surfaceAlt view with a 1px borderStrong top-left.
  // On Android, fall back to hairline border + elevation 2. Don't chase pixel-perfect neomorph.
} as const;

export const Glass = {
  // expo-blur BlurView config for the ONE hero glass surface per screen.
  intensity: 24,               // keep subtle; >40 looks foggy
  tint: 'dark' as const,       // over the oliveDark hero
  overlay: 'rgba(34,36,19,0.35)', // color wash under the blur for legibility
  hairline: 'rgba(242,236,216,0.18)', // top highlight border to sell the glass edge
};
```

Glass needs `expo-blur` (native → EAS build). If a screen can't take a blur cost, use a flat
`surfaceDark` tile instead — visually close, zero blur.

---

## 6. Motion tokens

```ts
export const Motion = {
  dur:  { fast: 120, base: 200, slow: 320, page: 380 }, // ms
  // reanimated easings
  ease: { standard: 'cubic-bezier(0.2,0,0,1)', decel: 'cubic-bezier(0,0,0,1)' },
  stagger: 55, // ms between list/card entrance items
};
```

Principles:
- **Skeleton, not spinner.** Any screen that fetches shows a skeleton that mirrors the final
  layout (§7). A rotating spinner is only allowed for a button's own in-flight state (≤1 control).
- **Doherty (<400ms perceived).** Cache with React Query so revisits are instant; entrance
  animations are ≤320ms; never block the whole screen on one slow query — render the shell + per
  tile skeletons and fill in.
- **Entrance:** cards fade+rise (`FadeInDown`, 8px travel) with `Motion.stagger` between them.
- **Peak-end:** check-out complete and order-delivered get a short success animation + one
  `expo-haptics` notificationAsync(Success). This is the emotional payload — don't skip it.
- **Respect reduced motion.** Gate every non-essential animation behind reanimated
  `useReducedMotion()` (and `AccessibilityInfo.isReduceMotionEnabled`); when true, cross-fade only.

---

## 7. Skeleton system

Skeletons mirror the real component's box model so content doesn't jump when it arrives (Law of
Continuity). Build one primitive + one composed skeleton per data screen.

```tsx
// components/skeleton/Skeleton.tsx
import { Skeleton as MotiSkeleton } from 'moti/skeleton'; // needs expo-linear-gradient
import { View } from 'react-native';
import { Radius } from '../../constants/colors';

const COLORS = ['#EAE3CE', '#F1EBD9', '#EAE3CE']; // warm cream shimmer, on-brand (not gray)

export function SkelBlock({ w, h, r = Radius.sm, style }: { w?: number|string; h: number; r?: number; style?: any }) {
  return (
    <MotiSkeleton colors={COLORS} width={w as any} height={h} radius={r as any}>
      <View style={[{ width: w as any, height: h }, style]} />
    </MotiSkeleton>
  );
}
```

```tsx
// components/skeleton/DashboardSkeleton.tsx  — mirrors the management bento (§10.3)
import { View } from 'react-native';
import { SkelBlock } from './Skeleton';
import { Layout, Space, Radius } from '../../constants/colors';

export function DashboardSkeleton() {
  return (
    <View style={{ padding: Layout.screenPad, gap: Space.md }}>
      <SkelBlock w={180} h={20} />                 {/* greeting */}
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="55%" h={120} r={Radius.card} />  {/* hero metric */}
        <SkelBlock w="42%" h={120} r={Radius.card} />  {/* donut */}
      </View>
      <View style={{ flexDirection: 'row', gap: Layout.gridGap }}>
        <SkelBlock w="49%" h={72} r={Radius.card} />
        <SkelBlock w="49%" h={72} r={Radius.card} />
      </View>
      <SkelBlock h={92} r={Radius.card} />          {/* pipeline strip */}
      <SkelBlock h={140} r={Radius.card} />         {/* top stores */}
    </View>
  );
}
```

Each data screen ships a matching `*Skeleton`. Show it while React Query `isPending` AND there's
no cached data; on a cache hit render real data immediately.

---

## 8. Component inventory (extend, don't fork)

Reuse the existing `Button`, `Card`, `Header`, `VoiceInput`, `usePullToRefresh`. Add:

| Component | Purpose | Notes |
|---|---|---|
| `Skeleton` / `*Skeleton` | loading states | §7; one composed skeleton per data screen |
| `BentoTile` | dashboard grid tile | variants: `flat` (default), `dark` (hero), `glass` (one per screen) |
| `Metric` | KPI number + label + delta | tabular-nums; up/down delta in `success`/`alert` |
| `Donut` | pipeline / share ring | wrap `react-native-gifted-charts` PieChart, brand colours |
| `TrendBars` | cases-per-day trend | wrap gifted-charts BarChart; spotlight the latest bar |
| `PipelineStrip` | segmented order-status progress | goal-gradient fill; current segment = lime |
| `StatusPill` | order status chip | colour per status from `lib/orders.ts` metadata |
| `Autocomplete` | team member / store search | debounced; keyboard + a11y labels (§ Hicks/Jakob) |
| `Breadcrumbs` | nested stack location | Stores → StoreDetail → OrderDetail |
| `SuccessOverlay` | peak-end moment | check-out / delivered; haptic + check animation |
| `EmptyState` | empty lists | invitation, not apology (§9) |

Button: keep `primary/secondary/danger`; the **primary** variant is the only place `spotlight`
(lime) may fill — and only one primary per screen.

---

## 9. Voice & microcopy

- Sentence case for every label, button, heading. Never Title Case, never ALL CAPS.
- Verb-first buttons: "Place order", "Mark delivered", "Start check-in" — not "OK"/"Submit".
- No "successfully" (the success state is the success), no "please", no exclamation on system copy.
- Errors say what happened + what to do, no first person: "Couldn't reach the server. Retry."
- Empty states are an invitation: headline names the space, one line explains, CTA is a verb.
  e.g. Orders empty → "No open orders" / "New orders show up here as reps place them."
- Use "your" for the user's things ("Your stores"), never "my".

---

## 10. Principle → screen map (applied)

- **Doherty threshold** → React Query cache + skeletons + optimistic writes. The heavy-feel fix.
- **Skeleton wireframes** → every focus-fetch screen (replaces spinners).
- **Zeigarnik + Goal-gradient + Progress bar** → order `PipelineStrip` (SM/management feel pull to
  finish an in-flight order); the fill leans toward completion.
- **Von Restorff** → lime spotlight, one per screen.
- **Law of Common Region** → bento cards group related stats.
- **Hick's + Jakob's** → dashboards lead with 1 primary action; patterns match familiar apps.
- **Autocomplete** → team + store search.
- **Breadcrumbs** → nested Stores/Orders stacks.
- **Chunking** → the 6-step check-in stepper (already chunked; refine rhythm + progress).
- **Peak-end** → `SuccessOverlay` + haptic on check-out and delivered.
- **Accessibility** → 44px hit targets, AA contrast, reduced-motion, screen-reader labels on
  icon-only controls.
