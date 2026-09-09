"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import {
  C, Card, PrimaryButton, SHADOW, SoftField, SoftInput, SoftNotice,
} from "@/components/soft";

/**
 * The way in, in the handoff's language.
 *
 * Vertically centred rather than top-aligned: there is one thing to do here
 * and nothing above it to scroll past, so the card sits where the eye already
 * is instead of clinging to a header that carries no title.
 *
 * NO ROLE KICKER. The handoff draws "Admin" above the wordmark, but it draws
 * the admin's copy of a screen every role shares -- and the role is not known
 * until the password has been accepted. A kicker that says "Admin" to an
 * arbetare would be the screen's first statement and a false one, so the slot
 * is left empty and the wordmark carries the top of the composition alone.
 */
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
    <main
      data-soft-screen="Logga in"
      className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col justify-center px-4 pb-[60px]"
      style={{
        background: C.ground,
        color: C.ink,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <h1
        className="px-1 pb-[26px] text-[38px] font-extrabold leading-[1.02]"
        style={{ letterSpacing: "-1.6px" }}
      >
        Shift Setter
      </h1>

      {error && (
        <div className="pb-[14px]">
          <SoftNotice tone="stop">{error}</SoftNotice>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <Card radius={16} shadow={SHADOW.hero} pad="p-5">
          <div className="mb-[14px]">
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
          </div>

          <div className="mb-5">
            <SoftField label="Lösenord">
              <SoftInput
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ letterSpacing: "2px" }}
              />
            </SoftField>
          </div>

          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "Loggar in…" : "Logga in"}
          </PrimaryButton>
        </Card>

        {/* Quiet on purpose: the way in is the button above, and this is for
            the one person in a hundred who cannot use it. Still a 44px target,
            because "small" is about weight on the page, not about the size of
            the thing a thumb has to hit. */}
        <div className="flex justify-center pt-[18px]">
          <Link
            href="/glomt-losenord"
            className="flex min-h-[44px] items-center px-2 text-[15px] font-bold no-underline"
            style={{ color: C.accent }}
          >
            Glömt lösenord?
          </Link>
        </div>
      </form>

      <p className="pt-[22px] text-center text-[15px] font-medium" style={{ color: C.text2 }}>
        Konton skapas av administratören.
      </p>
    </main>
  );
}
