// Motion tokens (DESIGN.md §6). Durations in ms; easings as cubic-bezier for
// reanimated/moti. Every non-essential animation must be gated behind
// useReducedMotion() (see components/SuccessOverlay, entrance staggers).

export const Motion = {
  dur: { fast: 120, base: 200, slow: 320, page: 380 }, // ms
  ease: {
    standard: 'cubic-bezier(0.2,0,0,1)',
    decel: 'cubic-bezier(0,0,0,1)',
  },
  stagger: 55, // ms between list/card entrance items
} as const;

/** Entrance transition for a card at position `index` in a staggered list. */
export const entrance = (index: number, reduce: boolean) => ({
  from: { opacity: 0, translateY: reduce ? 0 : 8 },
  animate: { opacity: 1, translateY: 0 },
  transition: {
    type: 'timing' as const,
    duration: reduce ? Motion.dur.fast : Motion.dur.slow,
    delay: reduce ? 0 : index * Motion.stagger,
  },
});
