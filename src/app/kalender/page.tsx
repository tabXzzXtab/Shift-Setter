"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, EmptyState, MonthCard, monthShape, Segmented, SoftNotice, SoftScreen,
} from "@/components/soft";
import { HANDELSE_COLUMNS, type Handelse } from "@/components/handelse";
import { PersonligKalender } from "@/components/personlig-kalender";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { useMonthColour } from "@/lib/project-palette";
import { fel } from "@/lib/fel";

type PassRow = { id: string; project_id: string; project_name: string; work_date: string };

/**
 * How many ärende dots a day cell draws.
 *
 * They share the day-number line rather than taking one of their own: three
 * 6px dots and a 13px numeral fit inside the 20px that line already spends, so
 * the cell stays the fixed 64px whatever the day holds. A fourth would cost a
 * stripe, and a stripe is the thing this calendar is for.
 */
const MAX_DOTS = 3;

/**
 * How many projects a day cell draws before it stops drawing them.
 *
 * A cell is one seventh of a phone. Four stripes and the day number is what
 * fits at a size a thumb can still aim at; past that they become a count,
 * because a calendar that grows a row for every project stops being a calendar.
 */
const MAX_STRIPES = 4;

/**
 * Skiftkalendern -- every project's shifts on one calendar.
 *
 * THE ARBETE HALF of the calendar screen's switch. It draws a body rather than
 * a screen: the header, the switch and the subtitle belong to the page below,
 * because both halves share them and chrome that each half redrew for itself
 * would move under the finger that just pressed it.
 *
 * A day cell is a FIXED height whatever the day holds. Each project working
 * that day is one colour stripe, stacked from the top, and past the fourth they
 * become "+N". The stripes are packed per day rather than each project keeping
 * a reserved line all month: a reserved line costs every cell in the month
 * 14px per project, so a month with twenty sites on it grew cells taller than
 * the screen and the grid stopped reading as a calendar at all.
 *
 * The cost of packing is that a run of consecutive days no longer joins into
 * one bar -- a project sits on a different line as its neighbours come and go.
 * That was traded away deliberately: the bar was legible only while the month
 * held two or three projects, which is the case that never needed the help.
 *
 * Colour is the one thing here the palette spends freely, because here it
 * carries meaning: it is what makes "Tuesday is two different sites" visible
 * without reading anything. The stripes carry no names -- there is no room for
 * one at this size -- so the legend below the grid is what names them, and the
 * day page a cell opens carries the same colour on each project's tab.
 *
 * Visible to admin and arbetsledare. An arbetare has no business seeing the
 * company's schedule -- they see their own shifts. That is a courtesy here and
 * a fact in the database: the pass policy scopes rows to projects you lead, so
 * a leader's calendar shows only their sites and a worker's would be empty.
 *
 * PAST DAYS ARE NOT DIMMED, unlike the day picker's. A picker's past is
 * unusable and says so; a shift calendar's past is work that happened, and it
 * is read exactly as often as the future is.
 */
function Skiftkalender() {
  const [month, setMonth] = useState(() => stockholmToday().slice(0, 7));
  const [passes, setPasses] = useState<PassRow[] | null>(null);
  const [events, setEvents] = useState<Handelse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const colourOf = useMonthColour(month);

  const { first, daysInMonth, leadingBlanks } = monthShape(month);
  const today = stockholmToday();

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("pass")
        .select("id, project_id, work_date, project(name)")
        .is("deleted_at", null)
        .gte("work_date", first)
        .lte("work_date", addDays(first, daysInMonth - 1))
        .order("work_date");

      if (!active) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa månadens pass. Ladda om sidan."));
        setPasses([]);
        return;
      }
      setPasses((data ?? []).map((p) => ({
        id: p.id,
        project_id: p.project_id,
        project_name: (p.project as { name: string } | null)?.name ?? "Projekt",
        work_date: p.work_date,
      })));
    })();
    return () => { active = false; };
  }, [first, daysInMonth]);

  /**
   * The month's ärenden -- a SECOND read rather than a join, because they are a
   * second kind of fact. Nothing about a pass is derived from one and nothing
   * about one is derived from a pass; they merely land on the same date.
   *
   * There is no viewer clause here. RLS on personal_event returns the owner's
   * rows and the rows they were named on, so what a leader sees on this grid is
   * what the policy hands them -- the admin's other ärenden are not fetched and
   * filtered, they never arrive. A failed read is left silent: an ärende is a
   * note on a day, and a stop notice over the whole schedule because a note
   * could not be read would be the smaller thing shouting down the larger one.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await getSupabase()
        .from("personal_event")
        .select(HANDELSE_COLUMNS)
        .gte("event_date", first)
        .lte("event_date", addDays(first, daysInMonth - 1))
        .order("event_date");
      if (active) setEvents((data ?? []) as Handelse[]);
    })();
    return () => { active = false; };
  }, [first, daysInMonth]);

  // date -> project ids working that date; and the projects on screen
  const byDate = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  for (const p of passes ?? []) {
    if (!byDate.has(p.work_date)) byDate.set(p.work_date, new Set());
    byDate.get(p.work_date)!.add(p.project_id);
    names.set(p.project_id, p.project_name);
  }
  const byName = (a: string, b: string) =>
    (names.get(a) ?? "").localeCompare(names.get(b) ?? "", "sv");
  const legend = [...names.keys()].sort(byName);

  /** The projects working one day, in the order their stripes stack. */
  const projectsOn = (date: string) => [...(byDate.get(date) ?? [])].sort(byName);

  // All-day first, then by start, so a day's dots read the same every time.
  const eventsByDate = new Map<string, Handelse[]>();
  for (const e of events) {
    if (!eventsByDate.has(e.event_date)) eventsByDate.set(e.event_date, []);
    eventsByDate.get(e.event_date)!.push(e);
  }
  for (const list of eventsByDate.values()) {
    list.sort((a, b) =>
      Number(b.all_day) - Number(a.all_day) ||
      (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
      a.title.localeCompare(b.title, "sv"));
  }

  return (
    <>
      {error && <div className="px-4 pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <div className="px-4 pt-[14px]">
        <MonthCard month={month} onMonthChange={setMonth}>
          <div className="grid grid-cols-7 gap-[3px]">
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <span key={`b${i}`} className="h-16" />
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const date = `${month}-${String(day).padStart(2, "0")}`;
              const here = projectsOn(date);
              // Exactly MAX_STRIPES fit. A fifth project takes the fourth stripe
              // away and puts it in the counter, so the count is never off by
              // one -- and so the cell can be a fixed 64px rather than a
              // minimum, which is what keeps every row of the grid level.
              const shown = here.length <= MAX_STRIPES ? here : here.slice(0, MAX_STRIPES - 1);
              const hidden = here.length - shown.length;
              const isToday = date === today;
              const arenden = eventsByDate.get(date) ?? [];

              return (
                <Link
                  key={date}
                  href={`/dag?datum=${date}`}
                  data-date={date}
                  data-arenden={arenden.length}
                  aria-label={
                    `${day}, ${here.length} projekt`
                    + (arenden.length === 0
                      ? ""
                      : arenden.length === 1 ? ", 1 ärende" : `, ${arenden.length} ärenden`)
                  }
                  className="flex h-16 flex-col overflow-hidden rounded-[8px] text-left"
                  style={{
                    background: isToday ? C.surface : "#f8faff",
                    boxShadow: isToday ? `inset 0 0 0 2px ${C.ink}` : undefined,
                  }}
                >
                  {/*
                    THE DOTS SHARE THE DAY NUMBER'S LINE, and they are ROUND.
                    A stripe is a full-bleed rectangle below the numeral and
                    says a site is working; an ärende is a dot beside it and
                    says nothing about who is where. Both draw from the same
                    eight colours, so shape and position are what tell them
                    apart -- colour alone would make an ärende read as a ninth
                    project.
                  */}
                  <span className="flex items-center justify-between gap-[3px] pb-[3px] pl-[6px] pr-[5px] pt-1">
                    <span
                      className={`text-[13px] leading-none ${
                        isToday ? "font-extrabold" : "font-bold"
                      }`}
                    >
                      {day}
                    </span>
                    {arenden.length > 0 && (
                      <span className="flex shrink-0 items-center gap-[2px]">
                        {arenden.slice(0, MAX_DOTS).map((e) => (
                          <span
                            key={e.id}
                            title={e.title}
                            data-arende-dot
                            className="block h-[6px] w-[6px] rounded-full"
                            style={{ background: e.colour }}
                          />
                        ))}
                      </span>
                    )}
                  </span>

                  <span className="flex flex-col gap-[2px] px-[3px] pb-[3px]">
                    {shown.map((pid) => {
                      const colour = colourOf(pid);
                      if (!colour) return null;
                      return (
                        <span
                          key={pid}
                          title={names.get(pid)}
                          // Named as a stripe, because a cell now draws two
                          // kinds of coloured span and "the ones with a style
                          // attribute" stopped meaning "the projects" the day
                          // ärende dots arrived.
                          data-stripe={names.get(pid)}
                          className="block h-[5px] rounded-[2px]"
                          style={{ background: colour }}
                        />
                      );
                    })}
                  </span>

                  {hidden > 0 && (
                    <span
                      className="block pb-[3px] pl-[6px] pt-[1px] text-[10px] font-bold leading-none"
                      style={{ color: C.text2 }}
                    >
                      +{hidden}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </MonthCard>
      </div>

      {passes !== null && legend.length === 0 && (
        <div className="px-4 pt-[22px]">
          <EmptyState>Inga pass den här månaden.</EmptyState>
        </div>
      )}

      {/*
        With no name on a stripe this is not decoration, it is the key. It lists
        every project in the month, including one whose stripes all fell behind
        a "+N" -- otherwise a busy day could hide a site from the page entirely.
      */}
      {legend.length > 0 && (
        <div className="px-4 pt-[22px]">
          <div
            className="px-1 pb-[10px] text-[12px] font-bold uppercase"
            style={{ letterSpacing: "1px", color: C.text2 }}
          >
            Projekt
          </div>
          <Card radius={14} pad="px-4 py-[14px]" className="flex flex-col gap-[10px]">
            {legend.map((pid) => {
              const colour = colourOf(pid);
              return (
                <span key={pid} className="flex items-center gap-[10px]">
                  <span
                    className="inline-block h-4 w-4 shrink-0 rounded-[5px]"
                    style={colour ? { background: colour } : { background: C.hairline }}
                  />
                  <span className="text-[15px] font-semibold" style={{ letterSpacing: "-.2px" }}>
                    {names.get(pid)}
                  </span>
                </span>
              );
            })}
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * The calendar screen -- two calendars, one switch.
 *
 * ARBETE is the company's schedule: who is on which site. PERSONLIG is the
 * viewer's own ärenden, and the spec is emphatic that it is NOT shift data --
 * nothing on it makes anybody unavailable and nothing on it prints. They sit
 * one press apart rather than on two pages because that is what makes the
 * distinction visible: the same grid, the same chrome, two different claims.
 *
 * EACH HALF KEEPS ITS OWN MONTH. Paging your own diary into December should not
 * quietly move the company's schedule with it, and coming back to a half should
 * find it where you left it.
 *
 * AN ARBETARE REACHES NEITHER, and that is answered before the switch is drawn
 * rather than on the Arbete tab alone -- offering a worker a choice between a
 * screen they cannot have and one this page does not carry for them would be a
 * worse refusal than the plain one. It is a courtesy either way: the pass
 * policy already scopes the rows, so the grid would come back empty.
 */
type Vy = "arbete" | "personlig";

function Kalender() {
  const { account } = useAccount();
  const [vy, setVy] = useState<Vy>("arbete");
  const [personligMonth, setPersonligMonth] = useState(() => stockholmToday().slice(0, 7));
  const today = stockholmToday();

  if (account && account.role === "arbetare") {
    return (
      <SoftScreen title="Skiftkalender" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">
            Skiftkalendern visar hela företagets schema. Dina egna pass finns under
            “Mina pass”.
          </SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen
      title={vy === "arbete" ? "Skiftkalender" : "Personlig kalender"}
      back="/"
      subtitle={
        vy === "arbete"
          ? "Tryck på en dag för att se vilka som jobbar då."
          : "Vad som annars ligger i vägen — möten, besök, ledighet."
      }
    >
      <div className="px-4 pt-[14px]">
        <Segmented
          label="Vilken kalender"
          value={vy}
          onChange={setVy}
          options={[
            { value: "arbete", label: "Arbete" },
            { value: "personlig", label: "Personlig" },
          ]}
        />
      </div>

      {vy === "arbete" ? (
        <Skiftkalender />
      ) : (
        <PersonligKalender
          month={personligMonth}
          onMonthChange={setPersonligMonth}
          today={today}
        />
      )}
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Kalender />
    </AuthGate>
  );
}
