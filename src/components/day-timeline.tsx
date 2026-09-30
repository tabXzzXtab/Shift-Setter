"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { C, EmptyState, SHADOW, SoftNotice } from "./soft";
import { HANDELSE_COLUMNS, whenLine, type Handelse } from "./handelse";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, stockholmToday } from "@/lib/dates";
import { useMonthColour } from "@/lib/project-palette";
import { fel } from "@/lib/fel";

/**
 * One day, top to bottom, as a timeline: the hours down the left, and every
 * pass and every timed ärende as a block placed by its times -- the Apple
 * Calendar day view, in this design's language.
 *
 * NO CARDS INSIDE CARDS. The timeline sits on the ground; a block is the only
 * surface, white with the flat shadow and a bar in its project's calendar
 * colour. A pass block says the project, the times and how full it is; tapping
 * it opens that project's day (DagPanel scoped to it), where everything that
 * acts on a pass lives. An ärende block opens the ärende.
 *
 * Overlaps sit side by side, as the calendar draws them: items are laid into
 * lanes in start order, and a cluster of mutually overlapping items shares the
 * width. A pass that runs past midnight is drawn to the end of the timeline
 * and says where it ends.
 *
 * Read-only by construction: nothing here writes. Who may do what on a
 * tapped day is the project day's business and, behind it, the database's.
 */

type PassItem = {
  kind: "pass";
  id: string;
  project_id: string;
  project_name: string;
  start: number; // minutes from midnight
  end: number;   // minutes from midnight; > 24h is clamped when drawn
  startLabel: string;
  endLabel: string;
  overnight: boolean;
  booked: number;
  headcount: number;
  /** Read-only (an arbetare's own shift): where, instead of how full. */
  site?: string;
};

type ArendeItem = {
  kind: "arende";
  id: string;
  title: string;
  colour: string;
  start: number;
  end: number;
  when: string;
};

type Item = PassItem | ArendeItem;
type Placed = Item & { lane: number; lanes: number };

const HOUR_PX = 60;
const GUTTER = 44;
const MIN_BLOCK = 46;

const minutes = (t: string | null | undefined) => {
  const [h, m] = (t ?? "00:00").split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Lanes in start order; each cluster of overlapping items shares its width. */
function place(items: Item[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = lanes;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) close();
    const taken = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) close();
  return out;
}

export function DayTimeline({ date, from, readOnly = false }: {
  date: string;
  from: string;
  /** An arbetare's day: their OWN shifts (my_shift), and blocks that open
   *  nothing -- there is nothing on a pass for them to act on. */
  readOnly?: boolean;
}) {
  const colourOf = useMonthColour(date.slice(0, 7));
  const [passes, setPasses] = useState<PassItem[] | null>(null);
  const [allDay, setAllDay] = useState<Handelse[]>([]);
  const [timed, setTimed] = useState<ArendeItem[]>([]);
  const [cancelled, setCancelled] = useState<{ project_name: string; n: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // No reset here: the day page keys this component by date, so a new day
    // is a fresh mount that starts at "Laddar…".
    let live = true;
    void (async () => {
      const sb = getSupabase();

      if (readOnly) {
        const [{ data: mine, error: mErr }, { data: events }] = await Promise.all([
          sb.from("my_shift").select("id, project_id, project_name, site_address, start_time, end_time")
            .eq("work_date", date).order("start_time"),
          sb.from("personal_event").select(HANDELSE_COLUMNS).eq("event_date", date),
        ]);
        if (!live) return;
        if (mErr) { setError(fel(mErr, "Kunde inte läsa dina pass. Ladda om sidan.")); setPasses([]); return; }
        setPasses((mine ?? []).map((r) => {
          const start = minutes(r.start_time);
          let end = minutes(r.end_time);
          const overnight = end <= start;
          if (overnight) end += 24 * 60;
          return {
            kind: "pass" as const, id: r.id ?? "", project_id: r.project_id ?? "",
            project_name: r.project_name ?? "Projekt", start, end,
            startLabel: hhmm(r.start_time), endLabel: hhmm(r.end_time), overnight,
            booked: 0, headcount: 0, site: r.site_address ?? undefined,
          };
        }));
        const evs = (events ?? []) as Handelse[];
        setAllDay(evs.filter((e) => e.all_day));
        setTimed(evs.filter((e) => !e.all_day).map((e) => ({
          kind: "arende" as const, id: e.id, title: e.title, colour: e.colour,
          start: minutes(e.start_time),
          end: Math.max(minutes(e.end_time), minutes(e.start_time) + 15),
          when: whenLine(e),
        })));
        setError(null);
        return;
      }

      const [{ data: rows, error: pErr }, { data: events }] = await Promise.all([
        sb.from("pass")
          .select("id, project_id, start_time, end_time, headcount, project!pass_project_id_fkey(name)")
          .eq("work_date", date)
          .is("deleted_at", null)
          .order("start_time"),
        sb.from("personal_event").select(HANDELSE_COLUMNS).eq("event_date", date),
      ]);
      if (!live) return;
      if (pErr) {
        setError(fel(pErr, "Kunde inte läsa dagens pass. Ladda om sidan."));
        setPasses([]);
        return;
      }

      const ids = (rows ?? []).map((r) => r.id);
      const { data: people } = ids.length
        ? await sb.from("tilldelning").select("pass_id, source").in("pass_id", ids).is("released_at", null)
        : { data: [] };

      // A day with nothing on it may be a day somebody emptied: say so, as
      // the day page always has, rather than drawing it as a quiet one.
      let off: { project_name: string; n: number }[] = [];
      if ((rows ?? []).length === 0) {
        const { data } = await sb.from("cancelled_day")
          .select("project_name, cancelled_passes").eq("work_date", date);
        off = (data ?? []).map((c) => ({ project_name: c.project_name ?? "Projekt", n: c.cancelled_passes ?? 0 }));
      }
      if (!live) return;

      setPasses((rows ?? []).map((r) => {
        const start = minutes(r.start_time);
        let end = minutes(r.end_time);
        const overnight = end <= start;
        if (overnight) end += 24 * 60;
        return {
          kind: "pass" as const,
          id: r.id,
          project_id: r.project_id,
          project_name: (r.project as { name: string } | null)?.name ?? "Projekt",
          start,
          end,
          startLabel: hhmm(r.start_time),
          endLabel: hhmm(r.end_time),
          overnight,
          // The arbetsledare is placed, never a slot the pass asked for (4b).
          booked: (people ?? []).filter((p) => p.pass_id === r.id && p.source !== "ledare").length,
          headcount: r.headcount,
        };
      }));
      const evs = (events ?? []) as Handelse[];
      setAllDay(evs.filter((e) => e.all_day));
      setTimed(evs.filter((e) => !e.all_day).map((e) => ({
        kind: "arende" as const,
        id: e.id,
        title: e.title,
        colour: e.colour,
        start: minutes(e.start_time),
        end: Math.max(minutes(e.end_time), minutes(e.start_time) + 15),
        when: whenLine(e),
      })));
      setCancelled(off);
      setError(null);
    })();
    return () => { live = false; };
  }, [date, readOnly]);

  if (passes === null) {
    return <p className="px-5 pt-2 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>;
  }

  const items: Item[] = [...passes, ...timed];
  const today = date === stockholmToday();
  const nowMin = (() => {
    const [h, m] = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(now)).split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  })();

  // The hours shown: 06-18 by default, widened to whatever the day holds.
  const first = Math.min(6, ...items.map((i) => Math.floor(i.start / 60)));
  const last = Math.max(18, ...items.map((i) => Math.min(24, Math.ceil(i.end / 60))));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const top = (min: number) => ((min - first * 60) / 60) * HOUR_PX;
  const placed = place(items);
  const encoded = encodeURIComponent(from);

  const nothing = items.length === 0 && allDay.length === 0;

  return (
    <div data-day-timeline={date}>
      {error && <div className="px-4 pb-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {cancelled.length > 0 && (
        <div className="px-4 pb-[14px]">
          <SoftNotice tone="warn" headline="Inställd dag">
            {cancelled.map((c) => (
              <span key={c.project_name} className="block">
                {c.project_name} · {c.n === 1 ? "1 pass borttaget" : `${c.n} pass borttagna`}
              </span>
            ))}
          </SoftNotice>
        </div>
      )}

      {nothing && cancelled.length === 0 && (
        <div className="px-4 pb-[14px]"><EmptyState>Inga pass den dagen.</EmptyState></div>
      )}

      {/* HELA DAGEN: ärenden without times, above the hours they have none of. */}
      {allDay.length > 0 && (
        <div className="px-4 pb-[18px]">
          <div className="px-1 pb-[8px] text-[12px] font-bold uppercase"
               style={{ letterSpacing: "1px", color: C.text2 }}>
            Hela dagen
          </div>
          <div className="flex flex-col gap-[6px]">
            {allDay.map((e) => (
              <Link
                key={e.id}
                href={`/dag/arende?datum=${date}&id=${e.id}&fran=${encoded}`}
                data-handelse={e.id}
                className="flex min-h-[44px] items-center gap-[10px] rounded-[10px] px-3 text-[15px] font-bold"
                style={{ background: C.surface, boxShadow: SHADOW.flat, color: C.ink }}
              >
                <span aria-hidden className="h-6 w-1 shrink-0 rounded-full" style={{ background: e.colour }} />
                <span className="truncate">{e.title}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* THE HOURS. A hairline per hour, the label on it, blocks laid over. */}
      <div className="relative mx-4" style={{ height: hours.length * HOUR_PX }}>
        {hours.map((h, i) => (
          <div key={h} className="absolute inset-x-0" style={{ top: i * HOUR_PX }}>
            <span
              className="absolute -top-[9px] left-0 w-[36px] text-[12px] font-bold tabular-nums"
              style={{ color: C.text2 }}
            >
              {String(h).padStart(2, "0")}
            </span>
            <div className="ml-[44px] h-px" style={{ background: C.hairline }} />
          </div>
        ))}

        {today && nowMin >= first * 60 && nowMin <= last * 60 && (
          <div aria-hidden className="absolute right-0 z-[2] flex items-center"
               style={{ top: top(nowMin) - 4, left: GUTTER - 6 }}>
            <span className="h-2 w-2 rounded-full" style={{ background: C.accent }} />
            <span className="h-[2px] flex-1" style={{ background: C.accent }} />
          </div>
        )}

        {placed.map((it) => {
          const clampedEnd = Math.min(it.end, last * 60);
          const height = Math.max(top(clampedEnd) - top(it.start) - 3, MIN_BLOCK);
          const style = {
            top: top(it.start) + 1,
            height,
            left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${it.lane / it.lanes})`,
            width: `calc((100% - ${GUTTER}px) / ${it.lanes} - 4px)`,
          };
          if (it.kind === "pass" && readOnly) {
            const colour = colourOf(it.project_id) ?? C.accent;
            return (
              <div
                key={`p-${it.id}`}
                data-pass-block={it.id}
                data-block-project={it.project_name}
                className="absolute z-[1] flex overflow-hidden rounded-[10px]"
                style={{ ...style, background: C.surface, boxShadow: SHADOW.flat, color: C.ink }}
              >
                <span aria-hidden className="w-1 shrink-0" style={{ background: colour }} />
                <span className="min-w-0 px-[10px] py-[7px]">
                  <span className="block truncate text-[15px] font-bold" style={{ letterSpacing: "-.2px" }}>
                    {it.project_name}
                  </span>
                  <span className="block truncate text-[14px] font-medium" style={{ color: C.text2 }}>
                    {it.startLabel}–{it.endLabel}{it.overnight ? " (nästa dag)" : ""}
                  </span>
                  {height >= 80 && it.site && (
                    <span className="block truncate text-[14px] font-medium" style={{ color: C.text2 }}>{it.site}</span>
                  )}
                </span>
              </div>
            );
          }
          if (it.kind === "pass") {
            const colour = colourOf(it.project_id) ?? C.accent;
            return (
              <Link
                key={`p-${it.id}`}
                href={`/dag/projekt?datum=${date}&projekt=${it.project_id}&fran=${encoded}`}
                data-pass-block={it.id}
                data-block-project={it.project_name}
                className="absolute z-[1] flex overflow-hidden rounded-[10px] hover:bg-[#f6f9ff]"
                style={{ ...style, background: C.surface, boxShadow: SHADOW.flat, color: C.ink }}
              >
                {/* Findable by attribute: the calendar's stripe and this bar
                    must be the same colour, and a test compares them. */}
                <span aria-hidden data-block-swatch={it.project_name} className="w-1 shrink-0" style={{ background: colour }} />
                <span className="min-w-0 px-[10px] py-[7px]">
                  <span className="block truncate text-[15px] font-bold" style={{ letterSpacing: "-.2px" }}>
                    {it.project_name}
                  </span>
                  <span className="block truncate text-[14px] font-medium" style={{ color: C.text2 }}>
                    {it.startLabel}–{it.endLabel}{it.overnight ? " (nästa dag)" : ""}
                  </span>
                  {height >= 80 && (
                    <span className="block truncate text-[14px] font-bold" style={{ color: C.accent }}>
                      {it.booked} av {it.headcount} platser
                    </span>
                  )}
                </span>
              </Link>
            );
          }
          return (
            <Link
              key={`a-${it.id}`}
              href={`/dag/arende?datum=${date}&id=${it.id}&fran=${encoded}`}
              data-handelse={it.id}
              className="absolute z-[1] flex overflow-hidden rounded-[10px]"
              style={{ ...style, background: C.panel2, color: C.ink }}
            >
              <span aria-hidden className="w-1 shrink-0" style={{ background: it.colour }} />
              <span className="min-w-0 px-[10px] py-[7px]">
                <span className="block truncate text-[15px] font-bold">{it.title}</span>
                <span className="block truncate text-[14px] font-medium" style={{ color: C.text2 }}>{it.when}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
