import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import type { CelebrationSpec } from '../components/Celebration';
import type { MyProgress } from './useProgress';
import { milestoneAt, weekKey, VISIT_MILESTONES, CONVERSION_MILESTONES } from '../lib/reportSemantics';

/**
 * Decides whether one of the three celebration moments is due, and makes each
 * fire ONCE. The "already shown" markers are per-device UI state (AsyncStorage,
 * like VoiceInput's first-use notice) — the numbers themselves stay derived.
 *
 * At most one celebration per dashboard focus; priority plan > best >
 * milestone, so a later one waits for the next visit to the dashboard rather
 * than stacking. Milestones are seeded silently the first time they're seen,
 * so nobody gets a retroactive "100 visits!" for history from before this.
 */
type Candidate = { key: string; spec: CelebrationSpec; seedOnly?: boolean; value?: string };

async function seen(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return 'unknown'; // storage unavailable: stay quiet rather than repeat
  }
}
async function mark(key: string, value = '1') {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Worst case it shows again next time; never an error for the rep.
  }
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function useCelebration(userId: string | undefined, progress: MyProgress | undefined) {
  const focused = useIsFocused();
  const [spec, setSpec] = useState<CelebrationSpec | null>(null);

  useEffect(() => {
    if (!userId || !progress || !focused || spec) return;
    let cancelled = false;
    (async () => {
      const { today, bests } = progress;
      const month = today.day.slice(0, 7);
      const candidates: Candidate[] = [];

      if (today.complete) {
        candidates.push({
          key: `celebrate:plan:${userId}:${today.day}`,
          spec: {
            kind: 'plan',
            title: 'Today’s plan is done',
            figure:
              `${plural(today.planned, 'store')} · ${today.counted} stock counted` +
              (today.skipped ? ` · ${today.skipped} skipped with a reason` : ''),
          },
        });
      }
      const mv = bests.monthVisits;
      if (mv.best > 0 && mv.current > mv.best) {
        candidates.push({
          key: `celebrate:best:visits:${userId}:${month}`,
          spec: { kind: 'best', title: 'New personal best', figure: `${mv.current} store visits this month — your previous best was ${mv.best}` },
        });
      }
      const wk = bests.weekUniqueStores;
      if (wk.best > 0 && wk.current > wk.best) {
        candidates.push({
          key: `celebrate:best:week:${userId}:${weekKey(today.day)}`,
          spec: { kind: 'best', title: 'New personal best', figure: `${wk.current} different stores this week — your previous best was ${wk.best}` },
        });
      }
      const mc = bests.monthConversions;
      if (mc.best > 0 && mc.current > mc.best) {
        candidates.push({
          key: `celebrate:best:conv:${userId}:${month}`,
          spec: { kind: 'best', title: 'New personal best', figure: `${mc.current} conversions confirmed by stock this month — previous best ${mc.best}` },
        });
      }
      for (const [metric, total, steps, word] of [
        ['visits', bests.lifetimeVisits, VISIT_MILESTONES, 'store visits'],
        ['conv', bests.lifetimeConversions, CONVERSION_MILESTONES, 'conversions confirmed by stock'],
      ] as const) {
        const m = milestoneAt(total, steps as unknown as number[]);
        if (m === 0) continue;
        candidates.push({
          key: `celebrate:ms:${metric}:${userId}`,
          value: String(m),
          spec: { kind: 'milestone', title: `${m} ${word}`, figure: 'A milestone worth noticing. Thank you for the work behind it.' },
        });
      }

      for (const c of candidates) {
        const prev = await seen(c.key);
        if (c.value !== undefined) {
          // Milestone: seed silently on first sight; fire only on a NEW one.
          if (prev === null) {
            await mark(c.key, c.value);
            continue;
          }
          if (prev === 'unknown' || Number(prev) >= Number(c.value)) continue;
          await mark(c.key, c.value);
        } else {
          if (prev !== null) continue;
          await mark(c.key);
        }
        if (!cancelled) setSpec(c.spec);
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, progress, focused, spec]);

  return { spec, dismiss: () => setSpec(null) };
}
