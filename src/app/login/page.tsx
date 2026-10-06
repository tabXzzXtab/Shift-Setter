"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
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
  // Every logged-out arrival starts on the welcome screen. Nothing is stored:
  // a session lasts until somebody logs out, so this is met on a first visit,
  // after Logga ut and after a password reset -- one extra tap, each time.
  const [welcomed, setWelcomed] = useState(false);
  // False on the server, so the exported HTML and the first client render
  // agree; an automated browser then goes straight to the form.
  const skip = useSyncExternalStore(noSubscribe, skipWelcome, () => false);

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

  if (!welcomed && !skip) return <Welcome onLogin={() => setWelcomed(true)} />;

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
      {/* THE INSTRUCTION, NOW THAT THE BRAND HAS ITS OWN SCREEN (owner,
          2026-10-06: Välkomstskärm A2, inloggning E). "Rätt folk. Rätt dag.
          Rätt timmar." moved to the welcome screen in front of this one, so
          this one says what it is and which credentials to use. */}
      <h1
        className="px-1 text-[32px] font-extrabold leading-[1.08]"
        style={{ letterSpacing: "-1.1px" }}
      >
        Logga in
      </h1>
      <p className="px-1 pb-[22px] pt-[8px] text-[15px] font-medium" style={{ color: C.text2 }}>
        Med e-posten och lösenordet du fick av din arbetsgivare.
      </p>

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
            style={{ color: C.accentInk }}
          >
            Glömt lösenord?
          </Link>
        </div>
      </form>

    </main>
  );
}

/** Set before the page loads, an automated browser sees the welcome screen. */
const WELCOME_TEST_KEY = "byggkoll.welcome-test";

/**
 * Every walkthrough signs in from a fresh browser, and a screen in front of
 * the form would stop each at its first fill -- so an automated browser goes
 * straight to the form unless it opts in, as with the tour.
 */
const noSubscribe = () => () => {};

function skipWelcome(): boolean {
  try {
    if (!navigator.webdriver) return false;
    return window.localStorage.getItem(WELCOME_TEST_KEY) !== "1";
  } catch {
    return false;
  }
}

/**
 * THE GREETING BEFORE THE FORM (owner, 2026-10-06: Välkomstskärm A2).
 *
 * The whole screen in the brand orange, because this is the one moment the
 * colour gets to be the screen; what stands on it is the dark ink (6.1:1),
 * never white (2.9:1). One sentence about what ByggKoll is for, one button,
 * and where an account comes from -- there is no sign-up and no social login,
 * so the line under the button answers the question a "Skapa konto" button
 * would have raised.
 */
function Welcome({ onLogin }: { onLogin: () => void }) {
  return (
    <main
      data-soft-screen="Välkommen"
      className="flex min-h-dvh w-full justify-center"
      style={{
        background: C.accent,
        color: C.ink,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
      }}
    >
      <div className="flex min-h-dvh w-full max-w-[420px] flex-col px-6 pb-[max(36px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))]">
        <div className="flex-1" />
        <p
          className="text-center text-[15px] font-extrabold"
          style={{ letterSpacing: "4px" }}
        >
          BYGGKOLL
        </p>
        <h1
          className="pt-[18px] text-[46px] font-medium leading-[1.1]"
          style={{ letterSpacing: "-1.6px" }}
        >
          Rätt folk.
          <br />
          Rätt dag.
          <br />
          <span className="font-extrabold">Rätt timmar.</span>
        </h1>
        <div className="flex-[1.4]" />
        <button
          type="button"
          onClick={onLogin}
          className="press-scale h-14 w-full rounded-full text-[17px] font-bold transition-transform duration-150 active:scale-[.985]"
          style={{ background: C.surface, color: C.ink, letterSpacing: "-.2px", boxShadow: `0 5px 0 ${C.accentInk}` }}
        >
          Logga in
        </button>
        <p className="px-4 pt-[18px] text-[15px] font-medium leading-[1.4]">
          Inget konto? Din arbetsgivare skapar det åt dig.
        </p>
      </div>
    </main>
  );
}
