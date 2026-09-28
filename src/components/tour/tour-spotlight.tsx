"use client";

import { useEffect, useState } from "react";
import { C, SHADOW } from "@/components/soft";
import { TOUR_UI } from "@/lib/tour/targets";

type Box = { top: number; left: number; width: number; height: number };

const PAD = 6;

const same = (a: Box[], b: Box[]) =>
  a.length === b.length &&
  a.every((x, i) =>
    Math.abs(x.top - b[i]!.top) < 0.5 && Math.abs(x.left - b[i]!.left) < 0.5 &&
    Math.abs(x.width - b[i]!.width) < 0.5 && Math.abs(x.height - b[i]!.height) < 0.5);

/**
 * Where the step's elements are, every frame.
 *
 * Every frame because nothing announces a move: the page scrolls, a list
 * finishes loading above the target, a sheet opens. A ring that stays where
 * its element WAS points at the wrong thing, which is worse than no ring.
 */
function useBoxes(resolve: () => Element[]): Box[] {
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const next = resolve().map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
      setBoxes((prev) => (same(prev, next) ? prev : next));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [resolve]);
  return boxes;
}

const visible = (b: Box) => b.top + b.height > 0 && b.top < window.innerHeight;

/**
 * The ring and the tooltip for a nav step, or for an autofill step once the
 * form is filled and the button is what is left.
 *
 * THE PAGE STAYS LIVE. Everything drawn here is pointer-events: none except
 * the tooltip itself, so the ringed element takes the tap it is asking for and
 * nothing else on the screen is locked -- the tour must not stand between
 * anybody and the app. The dimming is the ring's own spread shadow, which is
 * why only a single target dims: two holes cannot be cut from one shadow.
 *
 * With several rings, or with the one element scrolled out of view, there is
 * no single place to point, and the tip moves to the bar at the foot.
 */
export function TourSpotlight({
  resolve, tip, onSkip,
}: {
  resolve: () => Element[];
  tip: string;
  onSkip: () => void;
}) {
  const boxes = useBoxes(resolve);
  const single = boxes.length === 1 ? boxes[0]! : null;
  const anchored = single !== null && visible(single);

  // A tip that says "tryck här" over a button below the fold is pointing at
  // nothing. The first time the element is found, it is brought into view;
  // after that, scrolling is the person's, and the bar offers the way back.
  const show = () => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resolve()[0]?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  };
  const found = single !== null;
  const [brought, setBrought] = useState(false);
  useEffect(() => {
    if (!found || brought) return;
    const id = window.setTimeout(() => { show(); setBrought(true); }, 0);
    return () => window.clearTimeout(id);
    // show reads the latest resolve; this runs once per element found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, brought]);

  return (
    <>
      <div {...{ [TOUR_UI]: "rings" }} className="pointer-events-none fixed inset-0 z-[70]" aria-hidden>
        {boxes.map((b, i) => (
          <div
            key={i}
            className="absolute rounded-[14px]"
            style={{
              top: b.top - PAD,
              left: b.left - PAD,
              width: b.width + PAD * 2,
              height: b.height + PAD * 2,
              boxShadow: `0 0 0 2px ${C.accent}${single ? ", 0 0 0 9999px rgba(9,21,64,.30)" : ""}`,
            }}
          >
            <div className="animate-tourpulse absolute inset-0 rounded-[14px]" />
          </div>
        ))}
      </div>

      {anchored ? (
        <Tooltip box={single} tip={tip} onSkip={onSkip} />
      ) : (
        <TourBar
          text={tip}
          action={single ? { label: "Visa", onClick: show } : undefined}
          onSkip={onSkip}
        />
      )}
    </>
  );
}

function Tooltip({ box, tip, onSkip }: { box: Box; tip: string; onSkip: () => void }) {
  const vw = window.innerWidth;
  const width = Math.min(358, vw - 32);
  const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, 16), vw - 16 - width);
  // Below the element when a tooltip fits there, otherwise above it: a thumb
  // reaching for the element should not have to reach through the tip.
  const below = box.top + box.height + PAD + 14 + 150 < window.innerHeight;
  const arrowX = Math.min(Math.max(box.left + box.width / 2 - left - 7, 18), width - 32);

  return (
    <div
      {...{ [TOUR_UI]: "tip" }}
      role="status"
      className="fixed z-[75]"
      style={{
        left,
        width,
        ...(below
          ? { top: box.top + box.height + PAD + 14 }
          : { bottom: window.innerHeight - box.top + PAD + 14 }),
        fontFamily: "var(--font-inter), system-ui, sans-serif",
      }}
    >
      <div className="relative rounded-[14px] p-4 pb-3" style={{ background: C.surface, boxShadow: SHADOW.offer }}>
        <span
          aria-hidden
          className="absolute h-[14px] w-[14px] rotate-45"
          style={{ left: arrowX, background: C.surface, ...(below ? { top: -7 } : { bottom: -7 }) }}
        />
        <p className="relative text-[16px] font-semibold" style={{ color: C.ink, textWrap: "pretty" }}>
          {tip}
        </p>
        <div className="relative mt-2 flex justify-end">
          <SkipButton onSkip={onSkip} />
        </div>
      </div>
    </div>
  );
}

function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="press-scale h-11 rounded-[10px] px-[14px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
      style={{ background: C.panel2, color: C.inkHover }}
    >
      Hoppa över
    </button>
  );
}

/**
 * The tip with nowhere to point: the step is on another screen, the form is
 * still being filled, or there are several places at once. At the foot, where
 * the sheets are, and never covering more than it has to.
 */
export function TourBar({
  text, action, onSkip,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
  onSkip?: () => void;
}) {
  return (
    <div
      {...{ [TOUR_UI]: "bar" }}
      role="status"
      className="fixed inset-x-0 bottom-0 z-[75] mx-auto w-full max-w-[390px] px-4 pb-[max(16px,env(safe-area-inset-bottom))]"
      style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}
    >
      <div className="rounded-[16px] p-4" style={{ background: C.surface, boxShadow: SHADOW.sheet }}>
        <p className="text-[16px] font-semibold" style={{ color: C.ink, textWrap: "pretty" }}>{text}</p>
        {(action || onSkip) && (
          <div className="mt-3 flex gap-[10px]">
            {action && (
              <button
                type="button"
                onClick={action.onClick}
                className="press-scale h-12 flex-[2] rounded-[10px] text-[16px] font-bold transition-[transform,background] duration-150 hover:bg-[#12206b] active:scale-[.985]"
                style={{ background: C.accent, color: C.surface }}
              >
                {action.label}
              </button>
            )}
            {onSkip && (
              <div className="flex flex-1 [&>button]:h-12 [&>button]:w-full">
                <SkipButton onSkip={onSkip} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
