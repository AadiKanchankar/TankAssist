import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Queue triage: dismissing a flag, or warning the rep about it.
 *
 * Every flag but mock_location is DERIVED and recomputed on each load, so a
 * dismissal has to be stored or the flag simply reappears next time the
 * manager opens the queue. Resolutions are keyed to the subject plus the
 * flag_kind, so dismissing "far from store" leaves any other flag on that same
 * visit still showing — a manager resolves reasons, not whole rows.
 */

export type FlagAction = 'dismissed' | 'warned';

export interface FlagResolution {
  visit_id: string | null;
  attendance_id: string | null;
  flag_kind: string;
  action: FlagAction;
}

/** `visit|<id>|<kind>` or `attendance|<id>|<kind>` — one key per resolvable reason. */
export function resolutionKey(
  subject: 'visit' | 'attendance',
  id: string,
  flagKind: string,
): string {
  return `${subject}|${id}|${flagKind}`;
}

/** Every resolution the manager can see, as a Set of resolutionKey(). */
export function useFlagResolutions() {
  return useQuery({
    queryKey: ['flag-resolutions'],
    refetchOnMount: false,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('flag_resolutions')
        .select('visit_id, attendance_id, flag_kind');
      if (error) throw error;
      const out = new Set<string>();
      for (const r of (data as FlagResolution[]) ?? []) {
        if (r.visit_id) out.add(resolutionKey('visit', r.visit_id, r.flag_kind));
        else if (r.attendance_id) out.add(resolutionKey('attendance', r.attendance_id, r.flag_kind));
      }
      return out;
    },
  });
}

export interface ResolveInput {
  subject: 'visit' | 'attendance';
  subjectId: string;
  flagKind: string;
  action: FlagAction;
  note?: string;
  /** Required for 'warned': who the warning is addressed to. */
  repId?: string;
  /** Shown to the rep. Defaults to the flag's own reason. */
  message?: string;
}

export function useResolveFlag(resolverId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResolveInput) => {
      if (!resolverId) throw new Error('You are not signed in.');

      // The warning goes FIRST. If it fails, nothing is recorded and the
      // manager can retry — whereas recording the resolution first would hide
      // the flag from the queue while the rep never heard anything.
      if (input.action === 'warned') {
        if (!input.repId) throw new Error('No rep to warn on this item.');
        const { error } = await supabase.from('rep_warnings').insert({
          rep_id: input.repId,
          message: input.message?.trim() || 'Your manager flagged something on a recent visit.',
          sent_by: resolverId,
          visit_id: input.subject === 'visit' ? input.subjectId : null,
          attendance_id: input.subject === 'attendance' ? input.subjectId : null,
        });
        if (error) throw error;
      }

      const { error } = await supabase.from('flag_resolutions').insert({
        visit_id: input.subject === 'visit' ? input.subjectId : null,
        attendance_id: input.subject === 'attendance' ? input.subjectId : null,
        flag_kind: input.flagKind,
        action: input.action,
        note: input.note?.trim() || null,
        resolved_by: resolverId,
      });
      // 23505 = already resolved, which is success from the manager's point of
      // view: someone got there first and the flag is gone either way.
      if (error && (error as any).code !== '23505') throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flag-resolutions'] });
    },
  });
}

/** The rep's own unacknowledged warnings, newest first. */
export function useMyWarnings(repId: string | undefined) {
  return useQuery({
    queryKey: ['my-warnings', repId],
    enabled: !!repId,
    refetchOnMount: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rep_warnings')
        .select('id, message, created_at, acknowledged_at')
        .eq('rep_id', repId!)
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as { id: string; message: string; created_at: string }[]) ?? [];
    },
  });
}

export function useAcknowledgeWarning(repId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('rep_warnings')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-warnings', repId] }),
  });
}
