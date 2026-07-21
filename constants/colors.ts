import type { TextStyle } from 'react-native';

// TankAssist design tokens. Source of truth = DESIGN.md.
// Rule: use tokens, never raw hex or magic numbers in screens. Add here first.
//
// This file MERGES the DESIGN.md system onto the original tokens. Every key the
// app already imported (Colors.background/text/accent/alert/success/muted/white/
// border and the whole Typography object) is preserved unchanged so existing,
// not-yet-redesigned screens keep working; the new tokens are added alongside.

export const Palette = {
  ink: '#131212', // primary text, darkest
  oliveDark: '#222413', // premium dark surface (hero tiles, glass base)
  olive: '#6D7431', // brand primary (= Colors.accent)
  lime: '#DFE350', // SPOTLIGHT accent — one use per screen, never a background wash
  cream: '#F2ECD8', // app background (= Colors.background)
  white: '#FFFFFF',
  red: '#D02028', // destructive / alert (= Colors.alert)
  pine: '#2D6A4F', // success (= Colors.success)
} as const;

export const Colors = {
  // --- original keys (do not change values; existing screens depend on them) ---
  background: '#F2ECD8',
  text: '#131212',
  accent: '#6D7431',
  alert: '#D02028',
  success: '#2D6A4F',
  muted: '#9A9585',
  white: '#FFFFFF',
  border: '#DDD8C4', // hairline on cream (kept at the original value)

  // --- new surfaces ---
  surface: Palette.white, // cards
  surfaceAlt: '#FBF7EC', // subtly warm card, for nesting a card on a card
  surfaceDark: Palette.oliveDark, // hero / inverted surfaces
  // --- new text ---
  textSecondary: '#6B6A5A', // supporting (warm gray, not pure gray)
  textMuted: '#9A9583', // captions, placeholders, disabled labels
  textOnDark: Palette.cream, // text on surfaceDark
  // --- new lines ---
  borderStrong: '#D8CFB4',
  // --- brand + roles (new) ---
  spotlight: Palette.lime, // Von Restorff accent — at most once per visible screen
  onSpotlight: '#3A3D14', // text/icon on a lime fill (dark olive, never black)
  bgAlert: '#FBE7E7', // pale danger tint for banners/badges
  bgSuccess: '#E4EFEA',
  warning: '#B5852A', // "needs attention" amber (accessible on cream)
  bgWarning: '#F6EBD3',
} as const;

// Spotlight rule: lime appears AT MOST once per visible screen — the single
// primary CTA, or the single hero metric, or the current step in a stepper.

// --- Original typography (preserved; existing screens import Typography.*) ---
export const Typography = {
  fontFamily: 'Helvetica Neue',
  fontFamilyFallback: 'Arial',
  hero: { fontSize: 48, fontWeight: '700' as const },
  pageTitle: { fontSize: 32, fontWeight: '700' as const },
  sectionTitle: { fontSize: 24, fontWeight: '700' as const },
  cardTitle: { fontSize: 20, fontWeight: '600' as const },
  accordionHeader: { fontSize: 18, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const, textTransform: 'uppercase' as const, letterSpacing: 1 },
  label: { fontSize: 12, fontWeight: '400' as const, textTransform: 'uppercase' as const, letterSpacing: 1.5 },
} as const;

// --- New type scale (DESIGN.md §3). Sentence case; two weights in play. ---
export const Type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  section: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyMed: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  metric: { fontSize: 27, lineHeight: 30, fontWeight: '700' as const },
} as const;

// Numbers in KPIs add this so they don't jitter when they update.
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const; // 4pt grid
export const Radius = { sm: 8, md: 12, card: 16, pill: 999 } as const;
// tabBar = base bottom-tab height (mirrors App.tsx getTabScreenOptions: 60 + inset).
// Screens add `Layout.tabBar + insets.bottom` as paddingBottom to clear the bar.
export const Layout = { screenPad: 16, cardPad: 14, gridGap: 9, tap: 44, tabBar: 60 } as const; // 44 = min hit

export const Shadow = {
  // Soft resting shadow for raised hero cards (iOS shadow* + Android elevation).
  card: {
    shadowColor: '#3A3320',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
} as const;

export const Glass = {
  // expo-blur BlurView config for the ONE hero glass surface per screen.
  intensity: 24, // keep subtle; >40 looks foggy
  tint: 'dark' as const, // over the oliveDark hero
  overlay: 'rgba(34,36,19,0.35)', // wash under the blur for legibility
  hairline: 'rgba(242,236,216,0.18)', // top highlight border to sell the glass edge
} as const;
