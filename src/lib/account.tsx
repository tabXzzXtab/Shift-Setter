"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSupabase } from "./supabase/client";
import { useAuth } from "./supabase/auth";

export type Role = "admin" | "arbetsledare" | "arbetare";

export type Account = {
  id: string;
  role: Role;
  active: boolean;
  worker_id: string | null;
  name: string | null;
};

type State = { account: Account | null; loading: boolean; reload: () => void };

const Ctx = createContext<State | undefined>(undefined);

/**
 * The signed-in user's role, read from the database on every load.
 *
 * Never from the JWT (spec Section 6): a role change must take effect on the
 * next load rather than persisting stale for the token's lifetime. This is
 * also why nothing here is cached beyond the page session.
 *
 * What it returns is a convenience for choosing which screen to draw. It is
 * not a permission check -- those live in RLS, and a worker who edits this
 * value in devtools still reads nothing.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  // Keyed by user id so the account can never be read as belonging to whoever
  // was signed in before. Derived rather than set, so signing out needs no
  // synchronous write from an effect.
  const [fetched, setFetched] = useState<{ id: string; account: Account | null } | null>(null);
  const [tick, setTick] = useState(0);

  const uid = session?.user.id ?? null;

  useEffect(() => {
    if (!uid) return;
    let active = true;

    void (async () => {
      const { data } = await getSupabase()
        .from("account_directory")
        .select("id, role, active, worker_id, name")
        .eq("id", uid)
        .maybeSingle();

      if (!active) return;
      setFetched({
        id: uid,
        account:
          data?.id && data.role
            ? {
                id: data.id,
                role: data.role as Role,
                active: data.active ?? false,
                worker_id: data.worker_id,
                name: data.name,
              }
            : null,
      });
    })();

    return () => { active = false; };
  }, [uid, tick]);

  const account = uid && fetched?.id === uid ? fetched.account : null;
  const loading = authLoading || (uid !== null && fetched?.id !== uid);

  return (
    <Ctx.Provider value={{ account, loading, reload: () => setTick((t) => t + 1) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAccount(): State {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}

/** Admin can do everything an arbetsledare can, except confirm days. */
export const isStaff = (r: Role | undefined) => r === "admin" || r === "arbetsledare";
