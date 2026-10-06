"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { C } from "@/components/soft";
import { ArbetsdagbokDocument } from "@/components/arbetsdagbok-document";
import { TOUR_UI } from "@/lib/tour/targets";
import type { TourImage } from "@/lib/tour/steps";
import type { DocPayload } from "@/lib/doc/arbetsdagbok";

/**
 * A tour step: a WHITE FULL SCREEN, drawn to Brilliant's guide screens
 * (canvas "1 Admin", 03-14 · vit helskärm; owner, 2026-10-06). Nothing of the
 * app shows behind it and nothing floats -- the step is the screen.
 *
 *   top     58 px down: ✕ (22 px, #89867F) and a 4 px progress bar
 *           (#F1F0ED track, brand fill), space between them
 *   middle  120 px under it: the step's drawing at its own size -- no
 *           circle -- then, 36 px below, one 27 px REGULAR sentence, LEFT
 *           aligned, 326 px wide, its key word BOLD in accentInk
 *   foot    the 58 px button with Brilliant's hard shadow (#B64E10, 5 px
 *           down, no blur), label 18 px heavy; 16 px under it "Hoppa över",
 *           15 px bold #5E5A53
 *
 * A step that needs the real app ("Börja med att skapa ditt första projekt")
 * is this screen too, with "Visa mig": the press takes the person to the app
 * with only a ring on the thing to tap (TourRings).
 *
 * PROGRESS IS A PROGRESSBAR to assistive tech -- 0-100, a quarter on the first
 * step and full on the last -- and is drawn as Brilliant's bar.
 */
export function TourCard({
  progress, step, title, em, line, button, image, onNext, onSkip, onClose,
}: {
  /** 0-100. Absent on a card that is not a numbered step. */
  progress?: number;
  /** 1-based; which step this card is, so a new one is armed afresh. */
  step?: number;
  total?: number;
  title: string;
  /** The word or phrase in `title` drawn bold in the brand ink. */
  em?: string;
  line?: string;
  button: string;
  /** The drawing in the middle of the screen. */
  image: TourImage;
  onNext: () => void;
  /** "Hoppa över". */
  onSkip?: () => void;
  /** ✕: the whole guide. */
  onClose?: () => void;
}) {
  const armed = useArmed([title, button, step]);
  const size = IMAGE_SIZE[image] ?? DEFAULT_SIZE;
  return (
    <Frame label={title} progress={progress} onClose={armed(onClose)} armedKey={[title, button, step]}>
      <div className="flex flex-col items-center gap-9" style={{ paddingTop: "clamp(28px, 14dvh, 120px)" }}>
        <span aria-hidden className="relative flex items-end justify-center" style={{ width: size[0], height: size[1] }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser */}
          <img src={`/tour/${image}.png`} alt="" draggable={false} className="h-full w-full object-contain" />
          {image === "ritning" && (
            // Brilliant's "Skugga · mark": the drawing stands on something.
            <span
              className="pointer-events-none absolute -bottom-[14px] left-1/2 h-[20px] w-[170px] -translate-x-1/2 rounded-[50%]"
              style={{ background: C.ink, opacity: 0.16, filter: "blur(9px)" }}
            />
          )}
        </span>
        <Sentence title={title} em={em} line={line} />
      </div>
      <Foot button={button} onNext={armed(onNext)} onSkip={armed(onSkip)} />
    </Frame>
  );
}

/**
 * The sandbox's Arbetsdagbok, ON SCREEN ONLY (owner, 2026-10-06). The admin
 * pressed Generera Arbetsdagbok; the press was caught, nothing was generated,
 * and this shows what the document looks like from sandbox.ts's two worked
 * days -- the same component the real screen previews with, so it is the real
 * layout. No download, no file, no row in arbetsdagbok.
 */
export function TourPreview({
  progress, title, em, line, payload, onNext, onClose,
}: {
  progress?: number;
  step?: number;
  total?: number;
  title: string;
  em?: string;
  line?: string;
  payload: DocPayload;
  onNext: () => void;
  onClose?: () => void;
}) {
  const armed = useArmed([title]);
  // MEASURED, not assumed: the document is laid out at its own A4 width, and
  // is zoomed so that whole width fits the column -- a fixed guess clipped
  // its right edge.
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.4);
  useLayoutEffect(() => {
    const fit = () => {
      const o = outer.current, i = inner.current;
      if (o && i && i.scrollWidth) setZoom(o.clientWidth / i.scrollWidth);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <Frame label={title} progress={progress} onClose={armed(onClose)} armedKey={[title]}>
      <div className="flex flex-col gap-5 pt-8">
        <Sentence title={title} em={em} line={line} />
        <div
          ref={outer}
          data-tour-preview
          className="max-h-[52dvh] overflow-y-auto overflow-x-hidden rounded-[14px]"
          style={{ border: `1px solid ${C.border}`, background: C.surface }}
        >
          <div style={{ zoom }}>
            {/* The running header and footer overhang the sheet on both sides;
                the margin keeps their first and last letters on screen. */}
            <div ref={inner} style={{ width: "max-content", padding: "28px 48px" }}>
              <ArbetsdagbokDocument payload={payload} />
            </div>
          </div>
        </div>
      </div>
      <Foot button="Nästa" onNext={armed(onNext)} />
    </Frame>
  );
}

// ---- the parts every tour screen shares ---------------------------------------

/** Brilliant draws each image at its own size; these are its frames. */
const IMAGE_SIZE: Partial<Record<TourImage, [number, number]>> = {
  hjalm: [180, 180],
  ritning: [250, 137],
};
const DEFAULT_SIZE: [number, number] = [234, 170];

/**
 * A NEW SCREEN TAKES NO PRESS FOR ITS FIRST ARMED_MS. Every screen draws its
 * one button in the same place, so the second click of a double-click -- or an
 * impatient second press -- landed on the NEXT screen's button the instant it
 * appeared: a card was skipped, or "Visa mig" opened the app before its
 * sentence had been read. Measured: two clicks 150 ms apart skipped cards 4
 * and 6 of the admin tour and opened step 1 unseen. Restarted whenever the
 * screen shows another step, because React reuses the component from one step
 * to the next; a layout effect, so it is set before the screen paints.
 */
function useArmed(key: unknown[]) {
  const shownAt = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key IS the dependency list
  useLayoutEffect(() => { shownAt.current = performance.now(); }, key);
  return (fn?: () => void) =>
    fn && (() => { if (performance.now() - shownAt.current >= ARMED_MS) fn(); });
}

function Frame({
  label, progress, onClose, armedKey, children,
}: {
  label: string;
  progress?: number;
  onClose?: () => void;
  armedKey: unknown[];
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The button takes focus: the screen has exactly one thing to do.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("[data-tour-next] button")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per screen
  }, armedKey);

  return (
    <div
      ref={box}
      {...{ [TOUR_UI]: "card" }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[80] flex flex-col overflow-y-auto"
      // A HELD-DOWN ENTER IS ONE PRESS. The button has focus, and a held key
      // repeats -- each repeat a click on whichever screen is showing by then.
      onKeyDownCapture={(e) => { if (e.key === "Enter" && e.repeat) e.preventDefault(); }}
      style={{ background: C.surface, color: C.ink, fontFamily: "var(--font-inter), system-ui, sans-serif" }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[390px] flex-col px-6 pb-[max(40px,env(safe-area-inset-bottom))] pt-[max(58px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-5">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Avsluta guiden"
              className="-m-[11px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                <path d="M5 5l12 12M17 5 5 17" stroke="#89867F" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          ) : <span className="h-[22px] w-[22px]" />}
          {progress !== undefined && (
            <div
              role="progressbar"
              aria-label="Hur långt du har kommit"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              className="h-1 min-w-0 max-w-[300px] flex-1 overflow-hidden rounded-full"
              style={{ background: C.panel }}
            >
              <span
                className="tour-progress block h-full rounded-full"
                style={{ width: `${progress}%`, background: C.accent }}
              />
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function Sentence({ title, em, line }: { title: string; em?: string; line?: string }) {
  return (
    <div className="flex w-full max-w-[326px] flex-col gap-3 self-center text-left">
      <p className="text-[27px] font-normal leading-[1.3]" style={{ textWrap: "pretty" }}>
        {emphasise(title, em)}
      </p>
      {line && (
        <p className="text-[17px] font-medium leading-[1.4]" style={{ color: C.text2, textWrap: "pretty" }}>{line}</p>
      )}
    </div>
  );
}

function Foot({ button, onNext, onSkip }: { button: string; onNext?: () => void; onSkip?: () => void }) {
  return (
    <>
      <div className="min-h-[32px] flex-1" />
      <div className="flex flex-col items-center gap-4">
        <div data-tour-next className="w-full">
          <button
            type="button"
            onClick={onNext}
            className="h-[58px] w-full rounded-full text-[18px] font-extrabold transition-[transform,box-shadow] duration-100 active:translate-y-[5px] active:shadow-none"
            style={{ background: C.accent, color: C.onAccent, boxShadow: "0 5px 0 0 #B64E10" }}
          >
            {button}
          </button>
        </div>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="-my-[12px] h-11 px-4 text-[15px] font-bold"
            style={{ color: "#5E5A53" }}
          >
            Hoppa över
          </button>
        )}
      </div>
    </>
  );
}

/** How long a newly shown screen ignores presses. */
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

/** The key word bold in the brand ink, the rest as it is (Brilliant's spans). */
function emphasise(text: string, em?: string): ReactNode {
  const at = em ? text.indexOf(em) : -1;
  if (!em || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-bold" style={{ color: C.accentInk }}>{em}</span>
      {text.slice(at + em.length)}
    </>
  );
}
