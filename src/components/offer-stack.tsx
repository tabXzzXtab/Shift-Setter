"use client";

import dynamic from "next/dynamic";
import { PinIcon } from "./icons";
import { hhmm, longDayHeading } from "@/lib/dates";

const ProjectMap = dynamic(() => import("./project-map"), { ssr: false });

export type Offer = {
  pass_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  planned_hours: number;
  project_name: string;
  site_address: string;
};

/** How many slivers show behind the front card. */
const BEHIND = 3;

/** Each layer back: down this far, and this much smaller. */
const STEP_Y = 8;
const STEP_SCALE = 0.05;

/**
 * Acceptera Pass, stacked the way a phone stacks notifications.
 *
 * The front card is whole and is the only one that can be answered. Behind it
 * sit at most three slivers, each 8px lower and 5% smaller than the one in
 * front, aligned and centred -- no rotation, no scatter, no angles. A fanned
 * deck says "shuffle me"; a stack says "there are more behind this one", which
 * is the only thing the cards behind need to say.
 *
 * They are drawn as empty boxes and hidden from screen readers. A sliver 8px
 * tall cannot show a project name, and reading out three cards nobody can act
 * on would make the list longer for the people it is hardest for. The count
 * under the stack is what tells everyone else how many are waiting.
 *
 * ONE definition of the card, used by the landing page and by Acceptera Pass
 * itself, so the same offer cannot look like two different things depending on
 * how it was reached.
 */
export function OfferStack({
  offers,
  busy,
  onRespond,
}: {
  offers: Offer[];
  busy: boolean;
  onRespond: (passId: string, take: boolean) => void;
}) {
  if (offers.length === 0) {
    return (
      <p className="border-2 border-dashed border-black p-6 text-center text-base">
        Inga pass erbjuds just nu.
      </p>
    );
  }

  const front = offers[0]!;
  const behind = Math.min(offers.length - 1, BEHIND);

  return (
    <div>
      <div className="relative">
        {/* Furthest back first, so the DOM order and the stacking order agree.
            transform-origin is the BOTTOM edge: scaling then keeps that edge
            put and the translate moves it down, which is what leaves a sliver
            showing under the card in front. */}
        {Array.from({ length: behind }, (_, i) => {
          const depth = behind - i;      // 3, 2, 1 -- deepest drawn first
          return (
            <div
              key={depth}
              aria-hidden
              className="absolute inset-0 border-2 border-black bg-white"
              style={{
                transformOrigin: "bottom center",
                transform: `translateY(${depth * STEP_Y}px) scale(${1 - depth * STEP_SCALE})`,
                zIndex: BEHIND - depth,
              }}
            />
          );
        })}

        <section
          data-offer-card="front"
          className="relative border-2 border-black bg-white"
          style={{ zIndex: BEHIND + 1 }}
        >
          {front.site_address && <ProjectMap address={front.site_address} />}
          <div className="p-4">
            <p className="text-xl font-bold">{front.project_name}</p>
            <p className="flex items-start gap-2 text-base">
              <span className="mt-[2px] shrink-0"><PinIcon /></span>
              <span>{front.site_address}</span>
            </p>
            <p className="mt-2 text-base font-bold">{longDayHeading(front.work_date)}</p>
            <p className="text-base text-neutral-700">
              {hhmm(front.start_time)}–{hhmm(front.end_time)} ·{" "}
              {String(front.planned_hours).replace(".", ",")} h
            </p>

            {/* Acceptera left, Neka right. Both full height, because a smaller
                Neka would be a thumb pressed the wrong way. */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onRespond(front.pass_id, true)}
                disabled={busy}
                className="flex min-h-[56px] items-center justify-center border-2 border-black bg-black px-3 text-lg font-bold text-white disabled:opacity-30"
              >
                Acceptera
              </button>
              <button
                type="button"
                onClick={() => onRespond(front.pass_id, false)}
                disabled={busy}
                className="flex min-h-[56px] items-center justify-center border-2 border-black px-3 text-lg font-bold disabled:opacity-30"
              >
                Neka
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* The stack hides how deep it is, so the number is written out. Placed
          below the slivers rather than over them, which would need a badge
          sitting on a card that is not the one you can answer. */}
      {offers.length > 1 && (
        <p
          className="text-center text-base font-bold"
          style={{ marginTop: `${behind * STEP_Y + 12}px` }}
        >
          {offers.length - 1} till
        </p>
      )}
    </div>
  );
}
