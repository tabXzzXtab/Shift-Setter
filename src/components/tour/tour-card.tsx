"use client";

import { useEffect, useRef } from "react";
import { C, PrimaryButton, SHADOW } from "@/components/soft";
import { TOUR_UI } from "@/lib/tour/targets";

/**
 * A tour card: the whole screen, with nothing of the app showing behind it.
 *
 * FULLY COVERING, on purpose. A card step only says something, and an app
 * half-visible behind it invites a tap on a page the dialog has taken out of
 * reach. So the ground is the ink itself at .94 under a heavy blur -- the app
 * is gone, not dimmed. The real screen comes back only on nav and autofill
 * steps, where the person has to use it (TourSpotlight, TourBar).
 *
 * PROGRESS IS A BAR, not "Steg 6 av 9": a thin accent fill across the top of
 * the card, never empty -- the first step already shows a quarter -- and full
 * on the last. The width animates between steps (dropped under reduced
 * motion, globals.css), so moving on is something the eye sees happen.
 *
 * The button takes focus when the card opens: a card that only says something
 * has exactly one thing to do, and a keyboard or a screen reader should land
 * on it rather than on the page underneath, which the dialog has taken out of
 * reach.
 */
export function TourCard({
  progress, title, line, button, onNext,
}: {
  /** 0-100. Absent on a card that is not a numbered step. */
  progress?: number;
  title: string;
  line?: string;
  button: string;
  onNext: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector("button")?.focus();
  }, [title]);

  return (
    <div
      {...{ [TOUR_UI]: "card" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:items-center"
      style={{
        background: "rgba(36,24,15,.94)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      <div
        ref={box}
        className="w-full max-w-[358px] rounded-[22px] p-5 pt-6"
        style={{
          background: C.surface,
          color: C.ink,
          boxShadow: SHADOW.hero,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        }}
      >
        {progress !== undefined && (
          <div
            role="progressbar"
            aria-label="Hur långt du har kommit"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            className="mb-5 h-1 w-full overflow-hidden rounded-full"
            style={{ background: C.panel }}
          >
            <div
              className="tour-progress h-full rounded-full"
              style={{ width: `${progress}%`, background: C.accent }}
            />
          </div>
        )}
        {/* 22/800 for a line; a card that explains a step it had to replace
            runs to three sentences, and those take the handoff's 19/700. */}
        <p
          className={title.length > 90
            ? "text-[19px] font-bold leading-[1.35]"
            : "text-[22px] font-extrabold leading-[1.2]"}
          style={{ letterSpacing: title.length > 90 ? "-.4px" : "-.7px", textWrap: "pretty" }}
        >
          {title}
        </p>
        {line && (
          <p className="mt-2 text-[16px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            {line}
          </p>
        )}
        <div className="pt-6">
          <PrimaryButton onClick={onNext}>{button}</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
