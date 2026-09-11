"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, EmptyState, MonthCard, monthShape, SoftNotice, SoftScreen,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { useMonthColour } from "@/lib/project-palette";
import { fel } from "@/lib/fel";

type PassRow = { id: string; project_id: string; project_name: string; work_date: string };

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
  const { account } = useAccount();
  const [month, setMonth] = useState(() => stockholmToday().slice(0, 7));
  const [passes, setPasses] = useState<PassRow[] | null>(null);
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

  return (
    <SoftScreen
      title="Skiftkalender"
      back="/"
      subtitle="Tryck på en dag för att se vilka som jobbar då."
    >
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

              return (
                <Link
                  key={date}
                  href={`/dag?datum=${date}`}
                  data-date={date}
                  aria-label={`${day}, ${here.length} projekt`}
                  className="flex h-16 flex-col overflow-hidden rounded-[8px] text-left"
                  style={{
                    background: isToday ? C.surface : "#f8faff",
                    boxShadow: isToday ? `inset 0 0 0 2px ${C.ink}` : undefined,
                  }}
                >
                  <span
                    className={`block pb-[3px] pl-[6px] pt-1 text-[13px] leading-none ${
                      isToday ? "font-extrabold" : "font-bold"
                    }`}
                  >
                    {day}
                  </span>

                  <span className="flex flex-col gap-[2px] px-[3px] pb-[3px]">
                    {shown.map((pid) => {
                      const colour = colourOf(pid);
                      if (!colour) return null;
                      return (
                        <span
                          key={pid}
                          title={names.get(pid)}
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
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Skiftkalender />
    </AuthGate>
  );
}
