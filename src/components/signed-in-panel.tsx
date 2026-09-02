"use client";

import { useAuth } from "@/lib/supabase/auth";

export function SignedInPanel({
  envPresent,
}: {
  envPresent: Record<string, boolean>;
}) {
  const { user, session, signOut } = useAuth();

  const expiresAt = session?.expires_at
    ? new Date(session.expires_at * 1000).toLocaleTimeString("sv-SE")
    : "—";

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Shift Setter</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Inloggad som <span className="text-neutral-200">{user?.email}</span>
        </p>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Session
        </p>
        <ul className="mt-3 space-y-1.5 font-mono text-sm">
          <li className="flex items-baseline justify-between gap-4">
            <span className="text-neutral-400">token förnyas före</span>
            <span className="text-neutral-200">{expiresAt}</span>
          </li>
          {Object.entries(envPresent).map(([key, ok]) => (
            <li key={key} className="flex items-baseline justify-between gap-4">
              <span className="truncate text-neutral-400">{key}</span>
              <span className={ok ? "text-emerald-400" : "text-red-400"}>
                {ok ? "set" : "MISSING"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-neutral-500">
        Inget bakom inloggningen ännu — inget schema, inga funktioner.
      </p>

      <button
        onClick={() => void signOut()}
        className="self-start rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
      >
        Logga ut
      </button>
    </main>
  );
}
