"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      // Not distinguishing "no such user" from "wrong password".
      setError("Fel e-post eller lösenord.");
      setSubmitting(false);
      return;
    }
    router.replace("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      <h1 className="mb-8 text-3xl font-bold">Shift Setter</h1>

      {error && <Notice kind="error">{error}</Notice>}

      <form onSubmit={onSubmit}>
        <Field label="E-post">
          <Input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Lösenord">
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <div className="mt-6">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Loggar in…" : "Logga in"}
          </Button>
        </div>

        {/* Quiet on purpose: the way in is the button above, and this is for
            the one person in a hundred who cannot use it. Still a 44px target,
            because "small" is about weight on the page, not about the size of
            the thing a thumb has to hit. */}
        <div className="mt-4 flex justify-center">
          <Link
            href="/glomt-losenord"
            className="flex min-h-[44px] items-center px-2 text-sm text-black/40 underline"
          >
            Glömt lösenord?
          </Link>
        </div>
      </form>

      <p className="mt-8 text-sm text-neutral-600">
        Konton skapas av administratören.
      </p>
    </main>
  );
}
