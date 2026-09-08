"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { Button, Field, Input, Notice, Screen } from "@/components/ui";

/**
 * Where the reset mail's link lands -- choosing the new password.
 *
 * Supabase's recovery link carries a token that the client exchanges for a
 * session on load (detectSessionInUrl, set in lib/supabase/client.ts). So the
 * presence of a session IS the proof that the person opened a real link from a
 * real mailbox; there is nothing else to verify here and nothing to ask them.
 * No session means the link was already used, has expired, or was never valid.
 *
 * The recovery session is dropped the moment the password is written. That is
 * not ceremony: the app reads role from the database on load, so sending them
 * back through the front door is what makes the new session an ordinary one.
 */

// Spec Section 3, the same bounds create-account enforces: typeable on a phone
// and on a desktop.
const MIN = 6;
const MAX = 20;

export default function AterstallLosenordPage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN || password.length > MAX) {
      setError(`Lösenordet måste vara ${MIN}-${MAX} tecken.`);
      return;
    }
    // Typed blind and twice, because the only way back from a typo is the whole
    // flow again -- a new mail, a new link.
    if (password !== repeat) {
      setError("Lösenorden är inte lika.");
      return;
    }

    setSaving(true);
    setError(null);
    const { error: err } = await getSupabase().auth.updateUser({ password });
    if (err) {
      setError("Kunde inte spara lösenordet. Begär en ny länk och försök igen.");
      setSaving(false);
      return;
    }

    await getSupabase().auth.signOut();
    setDone(true);
    setSaving(false);
  }

  if (done) {
    return (
      <Screen title="Nytt lösenord">
        <Notice kind="ok">Lösenordet är ändrat.</Notice>
        <div className="mt-8">
          <Link
            href="/login"
            className="flex min-h-[56px] w-full items-center justify-center border-2 border-black bg-black px-4 text-lg font-bold text-white"
          >
            Logga in
          </Link>
        </div>
      </Screen>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-neutral-500">Laddar…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <Screen title="Nytt lösenord" back="/login">
        <Notice kind="error">
          Länken gäller inte längre. Den kan ha använts redan eller hunnit gå ut.
        </Notice>
        <div className="mt-8">
          <Link
            href="/glomt-losenord"
            className="flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold"
          >
            Begär en ny länk
          </Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Nytt lösenord">
      {error && <Notice kind="error">{error}</Notice>}

      <form onSubmit={onSubmit}>
        <Field label="Nytt lösenord" hint={`${MIN}-${MAX} tecken.`}>
          <Input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Field label="Upprepa lösenordet">
          <Input
            type="password"
            required
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </Field>

        <div className="mt-6">
          <Button type="submit" disabled={saving}>
            {saving ? "Sparar…" : "Spara lösenord"}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
