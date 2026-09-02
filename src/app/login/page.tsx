"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (persisted session restored) -- don't show the form.
  useEffect(() => {
    if (!loading && session) router.replace("/");
  }, [loading, session, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error } = await getSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      // Deliberately not distinguishing "no such user" from "wrong password".
      setError("Fel e-post eller lösenord.");
      setSubmitting(false);
      return;
    }
    router.replace("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shift Setter</h1>
        <p className="mt-1 text-sm text-neutral-400">Logga in</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            E-post
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Lösenord
          </span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {submitting ? "Loggar in…" : "Logga in"}
        </button>
      </form>

      <p className="text-xs leading-relaxed text-neutral-600">
        Konton skapas av administratören. Denna inloggning är en bekvämlighet —
        databasen är den verkliga gränsen.
      </p>
    </main>
  );
}
