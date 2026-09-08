"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Field, Input, Notice, Screen } from "@/components/ui";

/**
 * Glömt lösenord -- ask for a reset link.
 *
 * The request does NOT go to auth.resetPasswordForEmail() from here. It goes to
 * the reset-password Edge Function, which makes that call after checking the
 * role behind the service key. The reason is in that function's header: an
 * admin account is excluded from this flow, and a signed-out browser cannot
 * find out whether an address belongs to an admin -- nor should it be able to,
 * because that lookup is the enumeration oracle the neutral message exists to
 * prevent.
 *
 * So this page cannot fail, in the sense that matters: whatever the address is,
 * it gets the same sentence. There is no "no such user" branch to write,
 * because there is no such answer to give.
 */

// Same hardcoded value as next.config.ts, and hardcoded for the same reason:
// deriving it from an env var lets a build that forgot the var ship a link
// that 404s. Dev and Pages agree because neither is guessing.
const BASE_PATH = "/Shift-Setter";

export default function GlomtLosenordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/reset-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Signed out, so the anon key is the only credential there is.
            apikey: anon,
            Authorization: `Bearer ${anon}`,
          },
          body: JSON.stringify({
            email: email.trim(),
            redirectTo: `${window.location.origin}${BASE_PATH}/aterstall-losenord/`,
          }),
        },
      );
      // A non-OK response is a fault on our side, not a verdict on the address.
      if (!res.ok) throw new Error("request failed");
      setSent(true);
    } catch {
      // Only a transport failure surfaces, and it says nothing about the
      // address -- claiming a mail was sent when the request never arrived
      // would leave someone waiting for a message that does not exist.
      setError("Kunde inte skicka begäran. Försök igen.");
    }
    setSubmitting(false);
  }

  if (sent) {
    return (
      <Screen title="Glömt lösenord" back="/login">
        <Notice kind="info">
          Om e-postadressen finns i systemet har ett återställningsmail skickats.
        </Notice>
        <p className="mt-6 text-sm text-neutral-600">
          Kolla skräpposten om det inte dyker upp. Länken går ut efter en stund —
          begär en ny om den hunnit bli gammal.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold"
          >
            Till inloggningen
          </Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Glömt lösenord" back="/login">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-6 text-base text-neutral-700">
        Skriv din e-postadress så skickar vi en länk för att välja ett nytt
        lösenord.
      </p>

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

        <div className="mt-6">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Skickar…" : "Skicka återställningslänk"}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
