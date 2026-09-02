"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "./client";

/**
 * Session state for the whole app.
 *
 * There is no server and no middleware, so this is entirely client-side. That
 * is fine, because the login gate is a courtesy and not a security boundary --
 * see CLAUDE.md. A visitor who bypasses this provider entirely still sees
 * nothing, because the database refuses them, not because the UI hid it.
 *
 * Session persistence and silent refresh come from the client's auth options
 * (persistSession / autoRefreshToken) plus onAuthStateChange below, which fires
 * on TOKEN_REFRESHED and keeps this state in step with the refreshed token.
 */

type AuthState = {
  session: Session | null;
  user: User | null;
  /** True until the persisted session has been read from storage. Render
   *  nothing role-dependent before this flips, or the UI flashes signed-out. */
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // Fires on SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED and USER_UPDATED. The
    // TOKEN_REFRESHED case is what makes the refresh silent: the client renews
    // the token in the background and this keeps our copy current.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        await getSupabase().auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
