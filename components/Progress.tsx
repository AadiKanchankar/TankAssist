import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { Colors, Type, Space, Radius, tabularNums } from '../constants/colors';
import BentoTile from './BentoTile';
import { nudgeFor, bestLine, type DayProgress, type PersonalBests } from '../lib/reportSemantics';
import type { PersonPattern } from '../hooks/useProgress';

/**
 * The quiet personal-progress layer (CLAUDE.md "Gamification"). Olive only —
 * lime is the screen's one spotlight and never a progress colour. Every
 * indicator carries its meaning in TEXT as well as colour. No timers, no
 * warnings, no ranking.
 */

/**
 * Today's plan bar, inside the existing plan tile. Fills by stores DONE
 * (visited + stock counted or honestly skipped), with visited-but-not-done as
 * a pale olive segment — so rushing through without counting never reads as a
 * full bar.
 */
export function PlanProgress({ p, streak }: { p: DayProgress; streak: number }) {
  const reduce = useReducedMotion();
  if (!p.hasPlan || p.planned === 0) return null;
  const pct = (n: number) => `${Math.round((n / p.planned) * 100)}%` as const;
  const pending = Math.max(0, p.visited - p.done);
  const nudge = nudgeFor(p);
  const label = p.complete
    ? `Plan complete · ${p.planned} store${p.planned === 1 ? '' : 's'} · ${p.counted} stock counted${
        p.skipped ? ` · ${p.skipped} skipped with a reason` : ''
      }`
    : `Stock counted at ${p.counted} of ${p.planned}${p.skipped ? ` (+${p.skipped} skipped with a reason)` : ''} · visited ${p.visited} of ${p.planned}`;
  return (
    <View style={styles.block}>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Today's plan. ${label}`}
        accessibilityValue={{ min: 0, max: p.planned, now: p.done }}
      >
        <MotiView
          animate={{ width: pct(p.done) }}
          transition={{ type: 'timing', duration: reduce ? 0 : 420 }}
          style={styles.done}
        />
        <MotiView
          animate={{ width: pct(pending) }}
          transition={{ type: 'timing', duration: reduce ? 0 : 420 }}
          style={styles.pending}
        />
      </View>
      <Text style={[Type.caption, tabularNums, styles.label]}>{label}</Text>
      {nudge ? <Text style={[Type.label, styles.nudge]}>{nudge}</Text> : null}
      {streak >= 2 ? <Text style={[Type.caption, tabularNums, styles.label]}>{streak}-day streak</Text> : null}
    </View>
  );
}

/** "Your month" — compared only against the person's own history. */
export function MonthTile({ b }: { b: PersonalBests }) {
  const line = bestLine(b);
  const wk = b.weekUniqueStores;
  const conv = b.monthConversions;
  return (
    <BentoTile>
      <Text style={[Type.section, { color: Colors.text }]}>Your month</Text>
      <Text style={[Type.body, tabularNums, styles.line]}>
        {line ?? `${b.monthVisits.current} store visit${b.monthVisits.current === 1 ? '' : 's'} so far this month.`}
      </Text>
      <Text style={[Type.caption, tabularNums, styles.sub]}>
        This week: {wk.current} different store{wk.current === 1 ? '' : 's'}
        {wk.best > 0 ? ` · your best week was ${wk.best}` : ''}
      </Text>
      {conv.current > 0 || conv.best > 0 ? (
        <Text style={[Type.caption, tabularNums, styles.sub]}>
          {conv.current} conversion{conv.current === 1 ? '' : 's'} confirmed by stock this month
          {conv.best > 0 ? ` · best month ${conv.best}` : ''}
        </Text>
      ) : null}
      {b.loggedThisMonth > 0 ? (
        // Plain activity, never achievement: a logged sale counts once the
        // store's next stock count confirms it.
        <Text style={[Type.caption, tabularNums, styles.sub]}>
          {b.loggedThisMonth} spot sale{b.loggedThisMonth === 1 ? '' : 's'} logged — confirmed when the store is next counted
        </Text>
      ) : null}
    </BentoTile>
  );
}

const STATE_LABEL = { complete: 'plan done', partial: 'worked, plan not finished', off: 'not working', future: '' } as const;

/**
 * Management: each person's month as a day strip + one sentence. Listed by
 * name — a coaching signal, not a competition to publish.
 */
export function TeamPatterns({ rows, monthTitle }: { rows: PersonPattern[]; monthTitle: string }) {
  return (
    <BentoTile>
      {rows.length === 0 ? (
        <Text style={[Type.body, { color: Colors.textMuted }]}>No field staff yet.</Text>
      ) : (
        rows.map((r, i) => {
          const m = r.pattern;
          const pctCounted = m.visits ? Math.round((m.countedVisits / m.visits) * 100) : null;
          const summary =
            `Plan done on ${m.completeDays} of ${m.workedDays} day${m.workedDays === 1 ? '' : 's'} worked` +
            (pctCounted != null ? ` · stock counted at ${pctCounted}% of ${m.visits} visits` : ' · no visits yet') +
            (m.handledVisits > m.countedVisits ? ` (${m.handledVisits - m.countedVisits} skipped with a reason)` : '');
          return (
            <View key={r.userId} style={[styles.person, i > 0 && styles.rule]}>
              <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                {r.name}
                {r.role === 'sales_manager' ? ' (sales manager)' : ''}
              </Text>
              <View
                style={styles.strip}
                accessible
                accessibilityLabel={`${r.name}, ${monthTitle}: ${summary}`}
              >
                {m.days.map((d) => (
                  <View
                    key={d.day}
                    style={[styles.cell, styles[d.state]]}
                    accessibilityLabel={STATE_LABEL[d.state] || undefined}
                  />
                ))}
              </View>
              <Text style={[Type.caption, tabularNums, styles.sub]}>{summary}</Text>
            </View>
          );
        })
      )}
      {rows.length ? (
        <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.cell, styles.complete]} />
          <Text style={[Type.caption, styles.legendText]}>Plan done</Text>
          <View style={[styles.cell, styles.partial]} />
          <Text style={[Type.caption, styles.legendText]}>Worked</Text>
          <View style={[styles.cell, styles.off]} />
          <Text style={[Type.caption, styles.legendText]}>Off</Text>
        </View>
      ) : null}
    </BentoTile>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: Space.md, gap: Space.xs },
  track: {
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  done: { height: '100%', backgroundColor: Colors.accent },
  // Same hue, paler: visited, stock not yet handled. The label says it in words.
  pending: { height: '100%', backgroundColor: Colors.accent, opacity: 0.3 },
  label: { color: Colors.textSecondary },
  nudge: { color: Colors.accent },
  line: { color: Colors.text, marginTop: Space.xs },
  sub: { color: Colors.textSecondary, marginTop: Space.xs },
  person: { paddingVertical: Space.sm },
  rule: { borderTopWidth: 1, borderTopColor: Colors.border },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: Space.xs },
  cell: { width: 8, height: 14, borderRadius: 2 },
  complete: { backgroundColor: Colors.accent },
  partial: { borderWidth: 1.5, borderColor: Colors.accent, backgroundColor: Colors.surface },
  off: { backgroundColor: Colors.border },
  future: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.sm, flexWrap: 'wrap' },
  legendText: { color: Colors.textMuted, marginRight: Space.sm },
});
