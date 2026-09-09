"use client";

import dynamic from "next/dynamic";
import { C, EmptyState, SHADOW } from "./soft";
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

/** The slabs' own shadow -- softer than a card's, because they are not one. */
const SHADOW_SLAB = "0 6px 16px rgba(9,21,64,.06)";

/**
 * Acceptera Pass, as the handoff draws it.
 *
 * TWO SLABS AND A CARD. The front card is whole and is the only one that can
 * be answered; behind it sit exactly two white slabs, 24px tall, peeping out
 * 7px and 4px below at .55 and .8 opacity. Not a fanned deck -- a fan says
 * "shuffle me", and the only thing the cards behind need to say is "there are
 * more of these". They are aria-hidden: a 24px sliver cannot show a project
 * name, and reading out two cards nobody can act on would make the list longer
 * for the people it is hardest for. The count beside the section label is what
 * tells everyone how many are waiting.
 *
 * ONE DEFINITION OF THE CARD, used by the arbetare's startsida and by Acceptera
 * Pass itself, so the same offer cannot look like two different things
 * depending on how it was reached. It was drawn on the startsida first, from
 * the handoff; it lives here now for the same reason SoftNastaPass moved.
 *
 * The map is the real map view centred on the shift address, inset 16px on
 * three sides at radius 9 -- not a placeholder, which is what the design file
 * could only show.
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
  const front = offers[0];
  if (!front) return <EmptyState>Inga pass erbjuds just nu.</EmptyState>;

  return (
    <div className="relative">
      {/* The stack illusion: two slabs behind the card, nothing more. */}
      <div
        data-stack-slab="deep"
        className="absolute bottom-[-7px] left-[14px] right-[14px] h-6 rounded-[14px] opacity-55"
        style={{ background: C.surface, boxShadow: SHADOW_SLAB }}
        aria-hidden
      />
      <div
        data-stack-slab="near"
        className="absolute bottom-[-4px] left-[7px] right-[7px] h-6 rounded-[14px] opacity-80"
        style={{ background: C.surface, boxShadow: SHADOW_SLAB }}
        aria-hidden
      />

      <div
        data-offer-card="front"
        className="relative overflow-hidden rounded-[15px]"
        style={{ background: C.surface, boxShadow: SHADOW.offer }}
      >
        {front.site_address && (
          <div
            className="mx-4 mt-4 h-[150px] overflow-hidden rounded-[9px]"
            style={{ background: C.panel, boxShadow: "inset 0 0 0 1px rgba(9,21,64,.06)" }}
          >
            <ProjectMap address={front.site_address} />
          </div>
        )}

        <div className="px-5 pb-5 pt-4">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <div className="text-[21px] font-bold" style={{ letterSpacing: "-.5px" }}>
              {front.project_name}
            </div>
            <span className="text-right text-[15px] font-medium" style={{ color: C.text2 }}>
              {front.site_address}
            </span>
          </div>

          <div
            className="mb-4 flex items-baseline justify-between gap-3 rounded-[10px] px-4 py-[14px]"
            style={{ background: C.panel2 }}
          >
            <div>
              <div
                className="mb-[3px] text-[12px] font-bold uppercase"
                style={{ letterSpacing: ".9px", color: C.text2 }}
              >
                {longDayHeading(front.work_date)}
              </div>
              <div className="text-[20px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
                {hhmm(front.start_time)}–{hhmm(front.end_time)}
              </div>
            </div>
            {/*
              Typed by a human and never derived from the span -- invariant 1,
              and the handoff says the same thing in its own words.
            */}
            <div className="whitespace-nowrap text-[15px] font-bold" style={{ color: C.accent }}>
              {String(front.planned_hours).replace(".", ",")} h
            </div>
          </div>

          {/* Acceptera left and twice the width, Neka right. Both 54px tall,
              because a smaller Neka would be a thumb pressed the wrong way. */}
          <div className="flex gap-[10px]">
            <button
              type="button"
              onClick={() => onRespond(front.pass_id, true)}
              disabled={busy}
              className="press-scale h-[54px] flex-[2] rounded-[10px] text-[17px] font-bold text-white transition-transform duration-[120ms] hover:bg-[#12206b] active:scale-[.985] disabled:opacity-60"
              style={{ letterSpacing: "-.2px", background: C.accent }}
            >
              Acceptera
            </button>
            <button
              type="button"
              onClick={() => onRespond(front.pass_id, false)}
              disabled={busy}
              className="press-scale h-[54px] flex-1 rounded-[10px] text-[17px] font-semibold transition-transform duration-[120ms] hover:bg-[#dbe4f9] active:scale-[.985] disabled:opacity-60"
              style={{ letterSpacing: "-.2px", background: C.panel, color: C.inkHover }}
            >
              Neka
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
