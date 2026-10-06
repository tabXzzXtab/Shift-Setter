"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { C, PrimaryButton } from "@/components/soft";
import { TOUR_UI } from "@/lib/tour/targets";
import type { TourImage } from "@/lib/tour/steps";

/**
 * A tour step: a WHITE FULL SCREEN, Duolingo's "Continue" pattern (owner,
 * 2026-10-06; Mobbin: Duolingo onboarding). Nothing of the app shows behind
 * it and nothing floats -- the step is the screen.
 *
 * Top: the way out (✕ ends the guide) and the steps as numbered dots. Middle:
 * the step's drawing (public/tour, the brand images) inside the orange circle,
 * and one big sentence, its key word in the brand colour. Foot:
 * the one button, and "Hoppa över" under it for this step alone.
 *
 * A step that needs the real app ("Tryck på Nytt projekt") is this screen too,
 * with "Visa mig": the press takes the person to the app with only a ring on
 * the thing to tap (TourRings). The screen never sits on top of the app.
 *
 * PROGRESS STAYS A PROGRESSBAR to assistive tech -- 0-100, a quarter on the
 * first step and full on the last -- and is drawn as the numbered dots.
 */
export function TourCard({
  progress, step, total, title, em, line, button, image, onNext, onSkip, onClose,
}: {
  /** 0-100. Absent on a card that is not a numbered step. */
  progress?: number;
  /** 1-based, for the dots. */
  step?: number;
  total?: number;
  title: string;
  /** The word or phrase in `title` drawn in the brand colour. */
  em?: string;
  line?: string;
  button: string;
  /** The drawing in the middle of the screen. */
  image: TourImage;
  onNext: () => void;
  /** "Hoppa över": this step only. Absent on the last screen. */
  onSkip?: () => void;
  /** ✕: the whole guide. */
  onClose?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  // A NEW CARD TAKES NO PRESS FOR ITS FIRST ARMED_MS. Every card draws its one
  // button in the same place, so the second click of a double-click -- or an
  // impatient second press -- landed on the NEXT card's button the instant it
  // appeared: a card was skipped, or "Visa mig" opened the app before its
  // sentence had been read. Measured: two clicks 150 ms apart skipped cards 4
  // and 6 of the admin tour and opened step 1 unseen. Restarted whenever the
  // card shows another step, because React reuses this component from one
  // step to the next; a layout effect, so it is set before the card paints.
  const shownAt = useRef(0);
  useLayoutEffect(() => { shownAt.current = performance.now(); }, [title, button, step]);
  const armed = (fn?: () => void) =>
    fn && (() => { if (performance.now() - shownAt.current >= ARMED_MS) fn(); });

  // The button takes focus: the screen has exactly one thing to do.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("[data-tour-next] button, button[data-tour-next]")?.focus();
  }, [title]);

  return (
    <div
      ref={box}
      {...{ [TOUR_UI]: "card" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] flex flex-col overflow-y-auto"
      // A HELD-DOWN ENTER IS ONE PRESS. The button has focus, and a held key
      // repeats -- each repeat a click on whichever card is showing by then.
      onKeyDownCapture={(e) => { if (e.key === "Enter" && e.repeat) e.preventDefault(); }}
      style={{ background: C.surface, color: C.ink, fontFamily: "var(--font-inter), system-ui, sans-serif" }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[420px] flex-col px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))]">
        <div className="flex h-[52px] items-center gap-3">
          {onClose && (
            <button
              type="button"
              onClick={armed(onClose)}
              aria-label="Avsluta guiden"
              className="-ml-[10px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M2 2l12 12M14 2 2 14" stroke={C.chevron} strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {progress !== undefined && (
            <div
              role="progressbar"
              aria-label="Hur långt du har kommit"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              className="flex min-w-0 flex-1 items-center justify-between gap-[4px]"
            >
              {step !== undefined && total !== undefined
                ? Array.from({ length: total }, (_, i) => {
                    const on = i + 1 <= step;
                    return (
                      <span
                        key={i}
                        aria-hidden
                        className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold"
                        style={{
                          width: total > 9 ? 18 : 22,
                          height: total > 9 ? 18 : 22,
                          background: on ? C.accent : C.surface,
                          border: on ? undefined : `2px solid ${C.border}`,
                          color: on ? C.onAccent : C.chevron,
                          fontSize: total > 9 ? 10 : 11,
                        }}
                      >
                        {i + 1}
                      </span>
                    );
                  })
                : (
                  <span className="h-1 w-full overflow-hidden rounded-full" style={{ background: C.panel }}>
                    <span className="tour-progress block h-full rounded-full" style={{ width: `${progress}%`, background: C.accent }} />
                  </span>
                )}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-9 py-10 text-center">
          {/* The brand orange circle with the step's drawing inside it (owner,
              2026-10-06). Decorative: the sentence under it says everything.
              Fixed size, so the sentence does not move while the file arrives. */}
          <span
            aria-hidden
            className="flex h-[188px] w-[188px] items-center justify-center rounded-full"
            style={{ background: C.accent }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser */}
            <img
              src={`/tour/${image}.png`}
              alt=""
              draggable={false}
              className="h-[124px] w-[136px] object-contain"
            />
          </span>
          <div className="flex flex-col gap-3">
            <p
              className={title.length > 90 ? "text-[22px] font-extrabold leading-[1.3]" : "text-[27px] font-extrabold leading-[1.25]"}
              style={{ letterSpacing: "-.6px", textWrap: "balance" }}
            >
              {emphasise(title, em)}
            </p>
            {line && (
              <p className="text-[17px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>{line}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <div data-tour-next className="w-full">
            <PrimaryButton onClick={armed(onNext)}>{button}</PrimaryButton>
          </div>
          {onSkip && (
            <button
              type="button"
              onClick={armed(onSkip)}
              className="h-11 px-4 text-[16px] font-bold"
              style={{ color: C.text2 }}
            >
              Hoppa över
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** How long a newly shown card ignores presses. */
const ARMED_MS = 400;

/**
 * A step's database check still running: the same white screen, empty.
 *
 * NEVER THE BARE APP DURING A CHECK. A step that needs the app asks the
 * database first whether it can happen (met() in steps.ts) and nothing was
 * drawn until it answered -- 100-550 ms of the real app between two white
 * cards, which is the flicker, and a window in which no tour listener was
 * attached, so a click there reached the page itself (before step 8, the
 * real Generera Arbetsdagbok). This holds the white screen through it.
 */
export function TourPending() {
  return (
    <div
      {...{ [TOUR_UI]: "pending" }}
      aria-hidden
      className="fixed inset-0 z-[80]"
      style={{ background: C.surface }}
    />
  );
}

/** The key word in the brand colour, the rest as it is. */
function emphasise(text: string, em?: string): ReactNode {
  const at = em ? text.indexOf(em) : -1;
  if (!em || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span style={{ color: C.accentInk }}>{em}</span>
      {text.slice(at + em.length)}
    </>
  );
}
