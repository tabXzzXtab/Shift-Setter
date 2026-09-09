"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { PinIcon } from "./icons";
import { C, EmptyState, SectionLabel, SHADOW } from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, longDayHeading, passEndAt, stockholmToday } from "@/lib/dates";

// Leaflet reaches for `window` on import, and this app is prerendered at build
// time. Loaded only in the browser, and only once there is an address to show.
const ProjectMap = dynamic(() => import("./project-map"), { ssr: false });

type Next = {
  project: string;
  address: string;
  date: string;
  start: string;
  end: string;
} | null;

/** One row as the card holds it. */
type Shift = NonNullable<Next>;

/**
 * How many upcoming rows to hold, so the card can skip the finished ones.
 *
 * The query cannot ask "not finished yet" itself -- that is start_time and
 * end_time and work_date combined, with a night shift ending on the following
 * date, and PostgREST has no expression for it. So a short window comes back
 * and the first row still ahead of now is chosen here. A handful of shifts a
 * day makes 25 far more than a person can burn through between two renders.
 */
const WINDOW = 25;

/**
 * Nästa Pass -- where this person is next, for whichever role is looking.
 *
 * One component and one query, because "my next shift" is one question. An
 * arbetsledare is also a worker who holds shifts, so both roles read it from
 * my_shift and neither can end up with its own slightly different answer.
 *
 * READ ONLY, and that is a decision rather than an omission. A leader's days
 * are auto-assigned so there is nothing to accept; a worker's next shift is
 * one they already hold. A button that only ever agrees with what is already
 * true teaches people to press without reading.
 *
 * site_address is the PROJECT's address -- where the work is -- and never the
 * beställare's, which is where the invoice goes.
 *
 * IT GOES WHEN THE SHIFT ENDS, NOT WHEN THE DAY DOES. The card used to ask for
 * work_date >= today, so a shift finished at 16:00 sat on the home screen until
 * midnight and the one after it could not appear until the calendar caught up.
 * A day is not the unit anybody works in. The row is dropped the moment the
 * clock passes its end_time, and the next one takes its place on the spot --
 * on a timer, not on the next page load, because the person holding the phone
 * is standing still watching it.
 *
 * A SHIFT UNDER WAY IS STILL "nästa". The test is the END, so a 07:00-16:00
 * shift stays on the card all day and leaves at 16:00 -- which is what somebody
 * glancing at their phone at 11:00 wants to see.
 *
 * THE WINDOW STARTS YESTERDAY. A night shift booked 22:00-06:00 belongs to
 * yesterday's work_date and is still running at 03:00; asking from today would
 * hide the shift the person is standing on. passEndAt is what knows that, and
 * it is the same helper pendingDays() uses, so the card and the confirmation
 * queue cannot disagree about when a day finished.
 *
 * EXPORTED AS A HOOK because the arbetare startsida renders this answer in its
 * own design language while the arbetsledare's landing page keeps the card
 * below. Two presentations, ONE answer to "where am I next" -- the alternative
 * was a second copy of the end_time filter and the timer, which is exactly how
 * the two Stämpla In implementations came to disagree.
 */
export function useNextShift(): Next | undefined {
  const [rows, setRows] = useState<Shift[] | undefined>(undefined);
  /** Bumped when the current shift ends, which is what re-picks the card. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void (async () => {
      const today = stockholmToday();
      const { data } = await getSupabase()
        .from("my_shift")
        .select("project_name, site_address, work_date, start_time, end_time")
        .gte("work_date", addDays(today, -1))
        .lte("work_date", addDays(today, 365))
        // Earliest day, then earliest start. The tiebreak matters now that the
        // card prints the span: an arbetsledare can hold a day on two projects
        // at once (invariant 2's one exception), and "nästa" should be the one
        // that starts first rather than whichever row came back first.
        .order("work_date")
        .order("start_time")
        .limit(WINDOW);

      if (!live) return;
      setRows(
        (data ?? []).map((s) => ({
          project: s.project_name ?? "Projekt",
          address: s.site_address ?? "",
          date: s.work_date!,
          start: s.start_time!,
          end: s.end_time!,
        })),
      );
    })();
    return () => { live = false; };
  }, []);

  // undefined while the rows are still coming; null once they are here and
  // nothing in them is still ahead.
  const next: Next | undefined = useMemo(
    () =>
      rows === undefined
        ? undefined
        : rows.find((s) => passEndAt(s.date, s.start, s.end).getTime() > now) ?? null,
    [rows, now],
  );

  /**
   * One timer, armed for the exact moment the shift on screen ends.
   *
   * Not an interval: a card showing a shift three weeks out has nothing to
   * recompute until then, and waking every minute to find that out is a
   * background drain on a phone in someone's pocket. Re-armed whenever the
   * card changes, which includes the moment it fires.
   *
   * Clamped to the 32-bit setTimeout ceiling. A delay past ~24.8 days silently
   * fires immediately in every browser, which would spin. Firing early is
   * harmless -- `now` moves, the same shift is chosen again, and the timer is
   * simply re-armed for the remainder.
   */
  useEffect(() => {
    if (!next) return;
    const left = passEndAt(next.date, next.start, next.end).getTime() - Date.now();
    const t = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(left + 1000, 2 ** 31 - 1)),
    );
    return () => clearTimeout(t);
  }, [next]);

  return next;
}

/**
 * The card itself, as the arbetsledare's landing page draws it.
 *
 * THE SPAN IS SHOWN AND NO HOURS FIGURE IS. Same body as the Acceptera Pass
 * card, minus its "· 8 h" -- an offer prints planned_hours because that is the
 * figure being offered, while this is a day already held and invariant 10
 * masks its hours until an Arbetsdagbok covering the date exists, which for a
 * coming day it never does. Mina Pass reads these same rows and prints no
 * planned figure either. On an arbetsledare's row the number would be wrong on
 * top of being early: their row carries the ENVELOPE across the day's passes,
 * so planned_hours belongs to whichever pass it hangs on and not to them.
 * start_time and end_time are safe because my_shift coalesces own_start /
 * own_end over the pass's times -- the leader's card shows the leader's span.
 */
export function NastaPassCard() {
  const next = useNextShift();

  return (
    <>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Nästa Pass</h2>

      {next === undefined && <p className="text-base">Laddar…</p>}
      {next === null && (
        <p className="border-2 border-dashed border-black p-6 text-center text-base">
          Inga kommande pass.
        </p>
      )}

      {next && (
        // The whole card is the link. Tapping it hands the address to whatever
        // the phone uses for navigation rather than trying to be a map itself.
        <a
          href={`https://maps.google.com/maps?q=${encodeURIComponent(next.address)}`}
          target="_blank"
          rel="noreferrer"
          className="block border-2 border-black"
        >
          {next.address && <ProjectMap address={next.address} />}
          <div className="p-4">
            <p className="text-xl font-bold">{next.project}</p>
            <p className="flex items-start gap-2 text-base">
              <span className="mt-[2px] shrink-0"><PinIcon /></span>
              <span>{next.address}</span>
            </p>
            <p className="mt-2 text-base font-bold">{longDayHeading(next.date)}</p>
            <p className="text-base text-neutral-700">
              {hhmm(next.start)}–{hhmm(next.end)}
            </p>
          </div>
        </a>
      )}
    </>
  );
}

/**
 * Nästa pass in the handoff's language, for a redesigned landing page.
 *
 * THE HANDOFF DESIGNS THIS BLOCK'S EMPTY STATE ONLY -- both roles' sample data
 * had no upcoming shift. Rather than invent a look, the populated card is
 * built from the vocabulary the handoff already defines for "a shift with a
 * map": the offer card's surface, radius, map panel and title row, minus the
 * time panel's duration and the two actions, because there is nothing here to
 * accept. The whole card is the link, so a tap hands the address to the
 * phone's own navigation.
 *
 * NO HOURS FIGURE, and that is invariant 10 rather than an omission: a day
 * already held has its hours masked until an Arbetsdagbok covers the date,
 * which a coming day never has. On an auto-assigned leader's row the pass's
 * planned number would not be theirs in any case.
 *
 * One component for both roles. The arbetare and the arbetsledare read the
 * same card from the same rows, so the two cannot drift apart.
 */
export function SoftNastaPass() {
  const next = useNextShift();

  return (
    <>
      <SectionLabel>Nästa pass</SectionLabel>

      {next === undefined && <EmptyState>Laddar…</EmptyState>}
      {next === null && <EmptyState>Inga kommande pass.</EmptyState>}

      {next && (
        <a
          href={`https://maps.google.com/maps?q=${encodeURIComponent(next.address)}`}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-[15px]"
          style={{ background: C.surface, boxShadow: SHADOW.offer }}
        >
          {next.address && (
            <div
              className="mx-4 mt-4 h-[150px] overflow-hidden rounded-[9px]"
              style={{ background: C.panel, boxShadow: "inset 0 0 0 1px rgba(9,21,64,.06)" }}
            >
              <ProjectMap address={next.address} />
            </div>
          )}
          <div className="px-5 pb-5 pt-4">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div className="text-[21px] font-bold" style={{ letterSpacing: "-.5px" }}>
                {next.project}
              </div>
              <span className="text-right text-[15px] font-medium" style={{ color: C.text2 }}>
                {next.address}
              </span>
            </div>
            <div
              className="flex items-baseline justify-between gap-3 rounded-[10px] px-4 py-[14px]"
              style={{ background: C.panel2 }}
            >
              <div>
                <div
                  className="mb-[3px] text-[12px] font-bold uppercase"
                  style={{ letterSpacing: ".9px", color: C.text2 }}
                >
                  {longDayHeading(next.date)}
                </div>
                <div className="text-[20px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
                  {hhmm(next.start)}–{hhmm(next.end)}
                </div>
              </div>
            </div>
          </div>
        </a>
      )}
    </>
  );
}
