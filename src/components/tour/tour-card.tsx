"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { C, PrimaryButton } from "@/components/soft";
import { TOUR_UI } from "@/lib/tour/targets";

/** What the step is about, drawn as the big mark in the middle of the screen. */
export type TourIcon = "info" | "do" | "fill" | "done";

/**
 * A tour step: a WHITE FULL SCREEN, Duolingo's "Continue" pattern (owner,
 * 2026-10-06; Mobbin: Duolingo onboarding). Nothing of the app shows behind
 * it and nothing floats -- the step is the screen.
 *
 * Top: the way out (✕ ends the guide) and the steps as numbered dots. Middle:
 * one big mark and one big sentence, its key word in the brand colour. Foot:
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
  progress, step, total, title, em, line, button, icon = "info", onNext, onSkip, onClose,
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
  icon?: TourIcon;
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
          <span
            aria-hidden
            className="flex h-[148px] w-[148px] items-center justify-center rounded-full"
            style={{ background: C.accent }}
          >
            <Mark kind={icon} />
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

/** One white mark per kind of step, 64px, 2.4 stroke like the app's other icons. */
function Mark({ kind }: { kind: TourIcon }) {
  const s = { stroke: C.surface, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden>
      {kind === "info" && (
        // a lightbulb: something to know
        <>
          <path {...s} d="M12 25h8M13 28.5h6" />
          <path {...s} d="M16 4a8 8 0 0 0-5 14.2c1 .9 1.6 2.1 1.7 3.4L12.8 22h6.4l.1-.4c.1-1.3.7-2.5 1.7-3.4A8 8 0 0 0 16 4Z" />
        </>
      )}
      {kind === "do" && (
        // a finger on a point: something to tap
        <>
          <circle {...s} cx="12" cy="9" r="4" />
          <path {...s} d="M12 13v11l-2.2-2.4a2 2 0 0 0-3 2.6l3.8 4.8h11.6l1.8-7.4a2 2 0 0 0-1.6-2.4L16 18" />
        </>
      )}
      {kind === "fill" && (
        // a wand and a spark: the form fills itself
        <>
          <path {...s} d="M5 27 21 11l2.5 2.5L7.5 29.5 5 27Z" />
          <path {...s} d="M23 3v4M21 5h4M27 9v3M25.5 10.5h3M15 4v2.5M13.8 5.2h2.4" />
        </>
      )}
      {kind === "done" && (
        // a check: done
        <path {...s} strokeWidth={3} d="M7 16.5 13 22.5 25.5 9.5" />
      )}
    </svg>
  );
}
