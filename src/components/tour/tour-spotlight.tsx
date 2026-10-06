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

  // SETTLED: found, brought into view, and still for SETTLE_MS. Every move of
  // the box restarts the wait, so a smooth scroll settles when it stops.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!brought || settled) return;
    const id = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [boxes, brought, settled]);

  return (
    <>
      {!settled && <TourBlocker />}
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
    </>
  );
}

/** How long the ring must stand still before the page takes taps again. */
const SETTLE_MS = 250;
/** No step may hold the page longer than this, found or not. */
const BLOCK_MAX_MS = 10000;

/**
 * NO TAP BEFORE THE RING (owner, 2026-10-06). After "Visa mig" the full
 * screen goes at once, but the ring is drawn only when its element has been
 * found -- after a navigation, a data load, a scroll; and on an autofill step
 * only once the form has filled itself. In between the page showed with
 * nothing on it and took any tap: that read as the screen flashing open, and
 * a tap there landed on whatever was under the finger.
 *
 * So the page takes no taps until the ring stands still -- transparent, so
 * nothing changes on screen -- and never for longer than BLOCK_MAX_MS: a
 * target that never comes is the provider's to turn into a card, and nobody
 * is held on a page that cannot be used.
 */
export function TourBlocker() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setGone(true), BLOCK_MAX_MS);
    return () => window.clearTimeout(id);
  }, []);
  if (gone) return null;
  return <div aria-hidden className="fixed inset-0 z-[71]" style={{ touchAction: "none" }} />;
}
