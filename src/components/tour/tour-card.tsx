"use client";

import { useEffect, useRef } from "react";
import { C, PrimaryButton, SHADOW } from "@/components/soft";
import { TOUR_UI } from "@/lib/tour/targets";

/**
 * A tour card: the whole screen, the app blurred and dimmed behind it.
 *
 * The scrim is the sheet's own rgba(9,21,64,.42), so the tour reads as part of
 * the app rather than something laid over it. The blur is what the brief asks
 * for and what the handoff already does behind an open menu -- the page stays
 * recognisable as the place the next step happens on.
 *
 * The button takes focus when the card opens: a card that only says something
 * has exactly one thing to do, and a keyboard or a screen reader should land
 * on it rather than on the page underneath, which the dialog has taken out of
 * reach.
 */
export function TourCard({
  kicker, title, line, button, onNext,
}: {
  kicker?: string;
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
        background: "rgba(9,21,64,.42)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
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
        {kicker && (
          <div
            className="mb-[10px] text-[12px] font-bold uppercase"
            style={{ letterSpacing: "1px", color: C.text2 }}
          >
            {kicker}
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
