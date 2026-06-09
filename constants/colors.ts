export const Colors = {
  background: '#F2ECD8',
  text: '#131212',
  accent: '#6D7431',
  alert: '#D02028',
  success: '#2D6A4F',
  muted: '#9A9585',
  white: '#FFFFFF',
  border: '#DDD8C4',
} as const;

export const Typography = {
  fontFamily: 'Helvetica Neue',
  fontFamilyFallback: 'Arial',
  hero: { fontSize: 48, fontWeight: '700' as const },
  pageTitle: { fontSize: 32, fontWeight: '700' as const },
  sectionTitle: { fontSize: 24, fontWeight: '700' as const },
  cardTitle: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const, textTransform: 'uppercase' as const, letterSpacing: 1 },
  label: { fontSize: 12, fontWeight: '400' as const, textTransform: 'uppercase' as const, letterSpacing: 1.5 },
} as const;
