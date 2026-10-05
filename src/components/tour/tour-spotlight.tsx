"use client";

import { useEffect, useState } from "react";
import { C } from "@/components/soft";
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

/**
 * The ring and nothing else (owner, 2026-10-06): the step's sentence was said
 * on its own full screen before "Visa mig", so the app comes back with only a
 * ring on the thing to tap -- no tooltip, no bar, no box floating over it.
 *
 * Everything here is pointer-events: none, so the ringed element takes the
 * tap it is asking for and nothing else is locked. A single target also dims
 * the rest of the page with the ring's own spread shadow.
 */
export function TourRings({ resolve }: { resolve: () => Element[] }) {
  const boxes = useBoxes(resolve);
  const single = boxes.length === 1 ? boxes[0]! : null;

  // Brought into view once, when first found; after that scrolling is theirs.
  const found = boxes.length > 0;
  const [brought, setBrought] = useState(false);
  useEffect(() => {
    if (!found || brought) return;
    const id = window.setTimeout(() => {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resolve()[0]?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      setBrought(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [found, brought, resolve]);

  return (
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
            boxShadow: `0 0 0 3px ${C.accent}${single ? ", 0 0 0 9999px rgba(36,24,15,.30)" : ""}`,
          }}
        >
          <div className="animate-tourpulse absolute inset-0 rounded-[14px]" />
        </div>
      ))}
    </div>
  );
}
