"use client";

import { useState, type FormEvent } from "react";
import {
  C, Card, PrimaryButton, SecondaryButton, SoftField, SoftInput, SoftNotice,
  SoftScreen,
} from "@/components/soft";

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

// The app serves from the root of its own domain, so the reset link is the
// origin plus the path. This carried "/Shift-Setter" while GitHub Pages served
// the repo from a subpath; the prefix is gone with the subpath, and it has to
// go from here too -- Supabase matches redirectTo against an allow list, and a
// link to a path that no longer exists is refused rather than silently wrong.
const BASE_PATH = "";

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
      <SoftScreen title="Glömt lösenord" back="/login">
        {/* The same sentence whatever the address was. There is no "no such
            user" branch to draw, because there is no such answer to give. */}
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="live">
            Om e-postadressen finns i systemet har ett återställningsmail skickats.
          </SoftNotice>
        </div>

        <p
          className="px-5 pt-[14px] text-[15px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          Kolla skräpposten om det inte dyker upp. Länken går ut efter en stund —
          begär en ny om den hunnit bli gammal.
        </p>

        <div className="px-4 pt-[22px]">
          <SecondaryButton href="/login">Till inloggningen</SecondaryButton>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen
      title="Glömt lösenord"
      back="/login"
      subtitle="Skriv din e-postadress så skickar vi en länk för att välja ett nytt lösenord."
    >
      {error && <div className="px-4 pb-[4px] pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <form onSubmit={onSubmit}>
        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <SoftField label="E-post">
              <SoftInput
                type="email"
                required
                autoComplete="email"
                placeholder="namn@bolaget.se"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </SoftField>
          </Card>
        </div>

        <div className="px-4 pt-[22px]">
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "Skickar…" : "Skicka återställningslänk"}
          </PrimaryButton>
        </div>
      </form>
    </SoftScreen>
  );
}
