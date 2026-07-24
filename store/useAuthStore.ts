import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  name: string;
  email: string | null;
  role: 'rep' | 'sales_manager' | 'management';
  phone: string | null;
  assigned_manager_id: string | null;
  is_active: boolean;
  is_tester: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  initialized: boolean;
  // True when the session was terminated by the server (e.g. logged in on
  // another device), as opposed to the user tapping "log out". Drives the
  // "you were signed out elsewhere" message.
  kickedOut: boolean;
  // True when the account was found deactivated (is_active = false) and the
  // session was torn down because of it. Drives the "account deactivated"
  // message — kept distinct from kickedOut so the right alert shows.
  deactivated: boolean;

  initialize: () => Promise<void>;
  sendOtp: (phone: string) => Promise<{ error: string | null }>;
  verifyOtp: (phone: string, token: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  clearKickedOut: () => void;
  clearDeactivated: () => void;
  signOutDeactivated: () => Promise<void>;
  fetchProfile: (userId: string) => Promise<UserProfile | null>;
}

// Module-level flag (not reactive state): set only when the user deliberately
// logs out, so the auth-state-change handler can tell a voluntary sign-out
// apart from a server-side session revocation.
let intentionalLogout = false;

/**
 * One-login enforcement (rep role only). Called right after a rep establishes
 * a new session: revokes every OTHER active session/refresh token for this
 * account server-side, forcing any previously signed-in device back to login.
 * Never throws — a failure here must not block the successful login.
 */
async function enforceSingleSession(role: string | undefined): Promise<void> {
  if (role !== 'rep') return;
  try {
    await supabase.auth.signOut({ scope: 'others' });
  } catch {
    // Non-fatal: the new session is still valid even if revocation fails.
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: false,
  initialized: false,
  kickedOut: false,
  deactivated: false,

  initialize: async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const profile = await get().fetchProfile(data.session.user.id);
        if (profile && !profile.is_active) {
          await get().signOutDeactivated();
          set({ initialized: true });
        } else {
          set({
            session: data.session,
            user: data.session.user,
            profile,
            initialized: true,
          });
        }
      } else {
        set({ initialized: true });
      }

      // Listen for auth state changes
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session) {
          const profile = await get().fetchProfile(session.user.id);
          if (profile && !profile.is_active) {
            await get().signOutDeactivated();
            return;
          }
          set({ session, user: session.user, profile });
        } else {
          // Session cleared. If we previously had one and the user did not
          // tap "log out", this is a server-side revocation (logged in
          // elsewhere) — surface it to the UI.
          const wasSignedIn = get().session !== null;
          const kicked = wasSignedIn && !intentionalLogout;
          intentionalLogout = false;
          set({ session: null, user: null, profile: null, kickedOut: kicked });
        }
      });
    } catch {
      set({ initialized: true });
    }
  },

  sendOtp: async (phone: string) => {
    set({ loading: true });
    // Login must NEVER create an auth user — unknown numbers are rejected by
    // the phone_registered gate before we get here; shouldCreateUser:false is
    // defense in depth so the login path can't mint an orphan auth user.
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: false },
    });
    set({ loading: false });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  },

  verifyOtp: async (phone: string, token: string) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });
    if (error) {
      set({ loading: false });
      return { error: error.message };
    }
    if (data.session) {
      const profile = await get().fetchProfile(data.session.user.id);
      if (profile && !profile.is_active) {
        // Deactivated account: tear the session down; the global
        // "account deactivated" alert takes it from here.
        await get().signOutDeactivated();
        set({ loading: false });
        return { error: null };
      }
      set({
        session: data.session,
        user: data.session.user,
        profile,
        loading: false,
        kickedOut: false,
      });
      // Enforce one active session per rep. Runs after the new session is
      // established so it revokes the OTHER devices, not this one.
      await enforceSingleSession(profile?.role);
    } else {
      set({ loading: false });
    }
    return { error: null };
  },

  refreshProfile: async () => {
    const user = get().user;
    if (!user) return;
    const profile = await get().fetchProfile(user.id);
    if (profile && !profile.is_active) {
      await get().signOutDeactivated();
      return;
    }
    set({ profile });
  },

  logout: async () => {
    intentionalLogout = true;
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, kickedOut: false });
  },

  clearKickedOut: () => set({ kickedOut: false }),

  clearDeactivated: () => set({ deactivated: false }),

  // Tears down the session for a deactivated account. Clears local state
  // BEFORE signing out so the resulting auth event doesn't read as a
  // server-side kick (kickedOut).
  signOutDeactivated: async () => {
    intentionalLogout = true;
    set({ session: null, user: null, profile: null, deactivated: true });
    try {
      await supabase.auth.signOut();
    } catch {
      // Local state is already cleared; a failed server sign-out is non-fatal.
    }
  },

  fetchProfile: async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error || !data) return null;
    return data as UserProfile;
  },
}));
