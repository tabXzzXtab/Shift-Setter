"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { C, ChevronRight, SHADOW, SoftNotice } from "@/components/soft";

/**
 * Onboarding -- the PIN gate, and the route chosen behind it.
 *
 * NOT LINKED FROM ANYWHERE. It is reached by typing the path, by whoever is
 * sitting with the customer. That is why it opens on a code rather than on a
 * login: the person using it may not have an account in this app at all, and
 * what is being decided here is which kind of account the customer gets.
 *
 * THE CODE IS CHECKED OFF THE CLIENT, by the verify-pin Edge Function. A
 * static export ships its own source, so a comparison written here would be a
 * comparison printed in the bundle. What comes back is one bit and nothing
 * else -- no token, no session, no role.
 *
 * WHICH MEANS THE GATE IS NOT A BOUNDARY. Stage two is drawn by this component
 * off a piece of state, and state is the caller's to set; anyone willing to
 * open devtools is past it. That is the architecture rather than an oversight
 * -- CLAUDE.md, every restriction that lives in the interface is decorative.
 * Nothing is read or written here yet, so there is nothing yet to protect.
 * Whatever stage three eventually DOES must be gated in the database by RLS
 * like every other write in this app, and this gate must not be mistaken for
 * having done that.
 */

const LENGTH = 5;

/** Which of the three the operator picked. Stage three will act on it. */
type Route = "demo" | "sald" | "gava";

export default function OnboardingPage() {
  const [stage, setStage] = useState<"pin" | "route">("pin");

  return stage === "pin" ? <PinGate onPass={() => setStage("route")} /> : <RouteChoice />;
}

/* ---- the frame both stages share ----------------------------------------- */

/**
 * Vertically centred, like the login screen and for the same reason: there is
 * one thing to do here and nothing above it to scroll past.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main
      data-soft-screen="Onboarding"
      className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col justify-center px-4 pb-[60px]"
      style={{
        background: C.ground,
        color: C.ink,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div className="px-1 pb-[26px]">
        <div
          className="pb-[6px] text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          Onboarding
        </div>
        <h1
          className="text-[38px] font-extrabold leading-[1.02]"
          style={{ letterSpacing: "-1.6px" }}
        >
          ByggKoll
        </h1>
      </div>
      {children}
    </main>
  );
}

/* ---- stage 1: the code --------------------------------------------------- */

function PinGate({ onPass }: { onPass: () => void }) {
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Counts refusals, and is the digit row's React key.
   *
   * Remounting is what replays the animation: re-adding a class an element
   * already carries does not restart it, so a second wrong code in a row would
   * sit perfectly still -- which reads as "nothing happened", the one thing a
   * refusal must never read as.
   */
  const [refusals, setRefusals] = useState(0);

  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) =>
    boxes.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  /** Back to five empty boxes with the caret in the first. */
  function clear() {
    setDigits(Array(LENGTH).fill(""));
    // After the render that empties them, or the caret lands in a box that is
    // about to be rewritten out from under it.
    requestAnimationFrame(() => focus(0));
  }

  function write(i: number, value: string): string[] {
    const next = [...digits];
    next[i] = value;
    setDigits(next);
    if (error) setError(null);
    return next;
  }

  async function submit(pin: string) {
    setBusy(true);
    setError(null);

    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    let verdict: "ok" | "wrong" | "waiting" | "down";
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verify-pin`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Nobody is signed in here, so the anon key is the only credential
            // there is -- and it is not what the function checks.
            apikey: anon,
            Authorization: `Bearer ${anon}`,
          },
          body: JSON.stringify({ pin }),
        },
      );
      if (res.status === 429) verdict = "waiting";
      else if (!res.ok) verdict = "down";
      else verdict = ((await res.json()) as { valid?: boolean }).valid ? "ok" : "wrong";
    } catch {
      verdict = "down";
    }

    setBusy(false);
    if (verdict === "ok") {
      onPass();
      return;
    }

    // Every refusal empties the row, whatever its reason. A wrong code half
    // corrected is a code somebody retypes wrong the same way.
    setRefusals((n) => n + 1);
    setError(
      verdict === "waiting"
        ? "För många försök. Vänta en minut och försök igen."
        : verdict === "down"
          ? "Kunde inte nå servern. Försök igen."
          : "Fel kod.",
    );
    clear();
  }

  /** One box took a character. Keep the last digit typed, then move on. */
  function onDigit(i: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (!only) {
      // A non-digit, or the box being emptied. Either way it is cleared and
      // nothing advances.
      write(i, "");
      return;
    }
    // The LAST digit, so overtyping a filled box replaces what is in it rather
    // than being dropped by a maxLength that has already been reached.
    const next = write(i, only.slice(-1));
    if (i < LENGTH - 1) focus(i + 1);
    const pin = next.join("");
    // The fifth digit submits. There is no button: a five-box row that is full
    // has nothing left to ask, and a Fortsätt underneath it would only be a
    // second thing to reach for after the last one.
    if (pin.length === LENGTH) void submit(pin);
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      // Backspace in a box that is already empty steps back and clears the one
      // behind it. Without this the caret appears stuck on an empty box.
      e.preventDefault();
      write(i - 1, "");
      focus(i - 1);
      return;
    }
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      focus(i - 1);
    }
    if (e.key === "ArrowRight" && i < LENGTH - 1) {
      e.preventDefault();
      focus(i + 1);
    }
  }

  /** A pasted code fills the whole row, whichever box it was dropped into. */
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const only = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!only) return;
    e.preventDefault();
    setDigits(Array.from({ length: LENGTH }, (_, i) => only[i] ?? ""));
    setError(null);
    if (only.length === LENGTH) void submit(only);
    else requestAnimationFrame(() => focus(only.length));
  }

  return (
    <Frame>
      {error && (
        <div className="pb-[14px]">
          <SoftNotice tone="stop">{error}</SoftNotice>
        </div>
      )}

      <div
        className="p-5"
        style={{ background: C.surface, borderRadius: 16, boxShadow: SHADOW.hero }}
      >
        <div
          className="mb-[6px] text-[12px] font-bold uppercase"
          style={{ letterSpacing: ".9px", color: C.text2 }}
        >
          Kod
        </div>

        <div
          key={refusals}
          className={`flex gap-[10px] ${refusals > 0 ? "animate-shake" : ""}`}
          role="group"
          aria-label={`Kod, ${LENGTH} siffror`}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              value={d}
              onChange={(e) => onDigit(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              onPaste={onPaste}
              // Select on focus, so a tap into a filled box overwrites it
              // rather than parking a caret beside a digit nothing can be
              // added to.
              onFocus={(e) => e.target.select()}
              disabled={busy}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={`Siffra ${i + 1} av ${LENGTH}`}
              className="h-[60px] min-w-0 flex-1 rounded-[10px] border-0 text-center text-[26px] font-extrabold outline-none focus:outline-2"
              style={{
                background: C.panel2,
                color: C.ink,
                letterSpacing: "-.6px",
                outlineColor: C.accent,
              }}
            />
          ))}
        </div>
      </div>

      <p className="pt-[22px] text-center text-[15px] font-medium" style={{ color: C.text2 }}>
        {busy ? "Kontrollerar…" : "Koden får du av ByggKoll."}
      </p>
    </Frame>
  );
}

/* ---- stage 2: which route -------------------------------------------------
    Three ways on, in the order they are offered. The two that are sold or
    trialled get a card each; giving it away is a text button underneath.
    THE WEIGHT IS THE RANKING -- handing the product over for nothing should
    not be as easy to hit as selling it, and on a screen of three equal cards
    it would be.                                                              */

const ROUTES: { key: Route; title: string; body: string }[] = [
  {
    key: "demo",
    title: "Tilldela Demo",
    body:
      "Tilldela ByggKoll till en företagsägare som får tillgång till appen " +
      "med begränsad tillgång av 3 veckor kostnadsfri tillgång",
  },
  {
    key: "sald",
    title: "Sålt ByggKoll",
    body: "Har du sålt ByggKoll och användaren har bekräftat att de ska betala?",
  },
];

function RouteChoice() {
  /**
   * The seam stage three plugs into.
   *
   * Held rather than acted on, because the screens behind these three are not
   * built. A card that visibly does nothing when tapped reads as broken rather
   * than as unfinished, so the choice is recorded and said back; both the
   * state and the line below go when the real step arrives.
   */
  const [route, setRoute] = useState<Route | null>(null);

  return (
    <Frame>
      {ROUTES.map((r, i) => (
        <button
          key={r.key}
          type="button"
          onClick={() => setRoute(r.key)}
          aria-pressed={route === r.key}
          className={`press-scale block w-full p-[18px] text-left transition-transform duration-[110ms] hover:bg-[#f6f9ff] active:scale-[.985] ${
            i > 0 ? "mt-[14px]" : ""
          }`}
          style={{ background: C.surface, borderRadius: 14, boxShadow: SHADOW.group }}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[19px] font-bold" style={{ letterSpacing: "-.4px" }}>
                {r.title}
              </span>
              <span
                className="mt-[6px] block text-[15px] font-medium"
                style={{ color: C.text2, textWrap: "pretty" }}
              >
                {r.body}
              </span>
            </span>
            <span className="mt-[5px] shrink-0">
              <ChevronRight />
            </span>
          </span>
        </button>
      ))}

      {/* Small, and still a 44px target: "small" is about weight on the page,
          not about the size of the thing a thumb has to hit. */}
      <div className="flex justify-center pt-[18px]">
        <button
          type="button"
          onClick={() => setRoute("gava")}
          aria-pressed={route === "gava"}
          className="flex min-h-[44px] items-center px-2 text-[15px] font-semibold underline underline-offset-[3px]"
          style={{ color: C.text2 }}
        >
          Ge Bort ByggKoll
        </button>
      </div>

      {route && (
        <div className="pt-[18px]">
          <SoftNotice tone="quiet">Nästa steg är inte byggt ännu.</SoftNotice>
        </div>
      )}
    </Frame>
  );
}
