"use client";

import { useEffect, useState } from "react";
import { C, EmptyState, SecondaryButton, SectionLabel, SoftNotice } from "./soft";
import { CELL_GROUND, CELL_H, MonthGrid } from "./month-grid";
import {
  EventCard, HANDELSE_COLUMNS, NyHandelse, pickableFrom, useKonton, type Handelse,
} from "./handelse";
import { getSupabase } from "@/lib/supabase/client";
import { longDayHeading } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { fel } from "@/lib/fel";

/**
 * How many events a day cell draws before it stops drawing them.
 *
 * Each event is a 7px dot with 4px between, on one row under the day number;
 * three dots and a "+N" fit the narrowest cell (~44px on a 360px phone), so
 * the fourth event is a count.
 */
const MAX_CHIPS = 3;

/**
 * Personlig -- the owner's own calendar, on the shift calendar's screen.
 *
 * WHAT IT IS NOT is the important half. Nothing here is shift data: the tier
 * walk does not read it, the overlap test does not read it, and the
 * Arbetsdagbok does not read it. An event on a day makes nobody unavailable
 * and prints nowhere. That is why it lives in its own table with no key
 * pointing at pass, tilldelning or project_day -- a column on `pass` would
 * eventually be read by something that reads `pass`, and the document would
 * gain a row nobody worked.
 *
 * DISTINCT FROM A SHIFT ON SIGHT, which is the reason the two views share
 * month-grid.tsx rather than each drawing their own. A project on the Arbete
 * grid is a SOLID, nameless, full-bleed 5px bar. An event here is a ROUND DOT
 * under the day number, and its title is in the selected day's list. Colour
 * alone would not do it -- both draw from the same eight chips -- so shape
 * carries the difference. (It was an outlined chip on a tint of its own
 * colour until the Komponentspråk pass, 2026-10-05: the tint pair it removes,
 * and a title that never fit the cell.)
 *
 * WHO SEES ONE IS THE DATABASE'S ANSWER, not this screen's. The select below
 * has no viewer clause in it; RLS on personal_event returns the owner's rows
 * and the rows they were named on, and what comes back is drawn. There is no
 * client-side filter to get wrong, and adding one would only mask the day the
 * policy stopped agreeing with it.
 */
export function PersonligKalender({
  month, onMonthChange, today,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  today: string;
}) {
  const { account } = useAccount();
  const [events, setEvents] = useState<Handelse[] | null>(null);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});
  const konton = useKonton();
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const me = account?.id ?? null;

  useEffect(() => {
    let live = true;
    void (async () => {
      const sb = getSupabase();

      // Half-open month window, per invariant 9. `${month}-01` is the first of
      // this month and the same string a month on is the first of the next.
      const [y, m] = month.split("-").map(Number);
      const next = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;

      const { data, error } = await sb
        .from("personal_event")
        .select(HANDELSE_COLUMNS)
        .gte("event_date", `${month}-01`)
        .lt("event_date", next)
        .order("event_date");

      if (!live) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa månadens ärenden. Ladda om sidan."));
        setEvents([]);
        return;
      }

      const rows = (data ?? []) as Handelse[];
      setEvents(rows);

      // The list an owner edits, read back rather than remembered. A viewer
      // reading somebody else's event gets only their own row here, which is
      // the policy working -- the card falls back to "Delad med dig" for them.
      if (rows.length === 0) { setViewers({}); return; }
      const { data: vs } = await sb
        .from("personal_event_viewer")
        .select("event_id, account_id")
        .in("event_id", rows.map((r) => r.id));

      if (!live) return;
      const by: Record<string, string[]> = {};
      for (const v of vs ?? []) (by[v.event_id] ??= []).push(v.account_id);
      setViewers(by);
    })();
    return () => { live = false; };
  }, [month, tick]);

  const byDate = new Map<string, Handelse[]>();
  for (const e of events ?? []) {
    if (!byDate.has(e.event_date)) byDate.set(e.event_date, []);
    byDate.get(e.event_date)!.push(e);
  }
  // All-day first, then by start. A day's shape should read the same every time.
  for (const list of byDate.values()) {
    list.sort((a, b) =>
      Number(b.all_day) - Number(a.all_day) ||
      (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
      a.title.localeCompare(b.title, "sv"));
  }

  const pickable = pickableFrom(konton, me);

  const nameOf = (id: string) => konton.find((k) => k.id === id)?.name ?? null;

  async function remove(id: string) {
    setBusy(true); setError(null);
    // Viewer rows go with it: the foreign key is ON DELETE CASCADE, so the
    // list cannot outlive the event it describes.
    const { error } = await getSupabase().from("personal_event").delete().eq("id", id);
    if (error) setError(fel(error, "Ärendet kunde inte tas bort. Ladda om sidan."));
    setBusy(false);
    setTick((t) => t + 1);
  }

  return (
    <div>
      <div className="px-4 pt-[14px]">
        <MonthGrid
          month={month}
          onMonthChange={(m) => { onMonthChange(m); setOpen(null); setComposing(false); }}
          today={today}
          cell={(date, day, isToday) => {
            const here = byDate.get(date) ?? [];
            // Exactly MAX_CHIPS fit. A third event takes the second chip away
            // and puts it in the counter, so the count is never off by one.
            const shown = here.length <= MAX_CHIPS ? here : here.slice(0, MAX_CHIPS - 1);
            const hidden = here.length - shown.length;
            const chosen = open === date;

            return (
              <button
                type="button"
                data-date={date}
                data-events={here.length}
                aria-pressed={chosen}
                aria-label={`${day}, ${here.length === 0
                  ? "inget inlagt"
                  : here.length === 1 ? "1 händelse" : `${here.length} händelser`}`}
                onClick={() => {
                  setOpen((d) => (d === date ? null : date));
                  setComposing(false);
                }}
                className="flex w-full flex-col overflow-hidden rounded-[8px] text-left"
                style={{
                  height: CELL_H,
                  background: chosen || isToday ? C.surface : CELL_GROUND,
                  // Selected wins over today when a day is both: the ring says
                  // "this is what the panel below is about", which is the more
                  // urgent of the two things a ring can mean here.
                  boxShadow: chosen
                    ? `inset 0 0 0 2px ${C.accent}`
                    : isToday ? `inset 0 0 0 2px ${C.ink}` : undefined,
                }}
              >
                <span
                  className="block pl-[6px] pt-[4px] text-[13px] leading-[16px]"
                  style={{ fontWeight: chosen || isToday ? 800 : 700, color: C.ink }}
                >
                  {day}
                </span>

                <span className="flex flex-wrap items-center gap-[4px] px-[6px] pt-[6px]">
                  {shown.map((e) => (
                    /* A DOT, not a bar and not a chip -- see the note on this
                       component. A project on the Arbete grid is a solid
                       full-bleed bar; this is a round mark, so the two stay
                       different objects at a glance. The title is read in the
                       day's list below, where it has room: text in a 50px
                       cell was always clipped ("Besiktn"). */
                    <span
                      key={e.id}
                      title={e.title}
                      data-event-chip
                      className="block h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{ background: e.colour }}
                    />
                  ))}
                  {hidden > 0 && (
                    <span
                      className="block text-[10px] font-bold leading-[10px]"
                      style={{ color: C.text2 }}
                    >
                      +{hidden}
                    </span>
                  )}
                </span>
              </button>
            );
          }}
        />
      </div>

      {error && <div className="px-4 pt-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {open === null ? (
        <div className="px-4 pt-[22px]">
          <EmptyState>Tryck på en dag för att lägga in något.</EmptyState>
        </div>
      ) : (
        <div className="px-4 pt-[22px]">
          <SectionLabel>{longDayHeading(open)}</SectionLabel>

          {(byDate.get(open) ?? []).length === 0 ? (
            <EmptyState>Inget inlagt den här dagen.</EmptyState>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {(byDate.get(open) ?? []).map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  mine={e.owner_id === me}
                  viewerNames={(viewers[e.id] ?? [])
                    .map((id) => nameOf(id))
                    .filter((n): n is string => n !== null)}
                  viewerCount={(viewers[e.id] ?? []).length}
                  busy={busy}
                  onDelete={() => void remove(e.id)}
                />
              ))}
            </div>
          )}

          <div className="pt-[14px]">
            {composing ? (
              <NyHandelse
                date={open}
                ownerId={me}
                pickable={pickable}
                onCancel={() => setComposing(false)}
                onSaved={() => { setComposing(false); setTick((t) => t + 1); }}
              />
            ) : (
              <SecondaryButton onClick={() => setComposing(true)}>Ny händelse</SecondaryButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

