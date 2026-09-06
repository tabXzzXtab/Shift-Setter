"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Empty, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { useMonthColour } from "@/lib/project-palette";

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
 * Colour is the one thing here that is not black and white, because here it
 * carries meaning: it is what makes "Tuesday is two different sites" visible
 * without reading anything. The stripes carry no names -- there is no room for
 * one at this size -- so the legend below the grid is what names them, and the
 * day page a cell opens carries the same colour on each project's tab.
 *
 * Visible to admin and arbetsledare. An arbetare has no business seeing the
 * company's schedule -- they see their own shifts. That is a courtesy here and
 * a fact in the database: the pass policy scopes rows to projects you lead, so
 * a leader's calendar shows only their sites and a worker's would be empty.
 */
function Skiftkalender() {
  const { account } = useAccount();
  const [month, setMonth] = useState(() => stockholmToday().slice(0, 7));
  const [passes, setPasses] = useState<PassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colourOf = useMonthColour(month);

  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const leadingBlanks = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;  // Monday-based
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
      if (error) { setError(error.message); setPasses([]); return; }
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
      <Screen title="Skiftkalender" back="/">
        <Notice kind="info">
          Skiftkalendern visar hela företagets schema. Dina egna pass finns under
          “Mina pass”.
        </Notice>
      </Screen>
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

  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" })
    .format(new Date(`${first}T12:00:00Z`));

  return (
    <Screen title="Skiftkalender" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-4 text-base">Tryck på en dag för att se vilka som jobbar då.</p>

      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Föregående månad"
          onClick={() => setMonth(addDays(first, -1).slice(0, 7))}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ‹
        </button>
        <span className="text-lg font-bold capitalize">{monthName}</span>
        <button
          type="button"
          aria-label="Nästa månad"
          onClick={() => setMonth(addDays(first, daysInMonth).slice(0, 7))}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 text-center text-xs font-bold">
        {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => <span key={i}>{d}</span>)}
      </div>

      <div className="grid grid-cols-7 border-2 border-black">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`b${i}`} className="h-[84px] border-b border-r border-neutral-300" />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const here = projectsOn(date);
          // Exactly MAX_STRIPES fit. A fifth project takes the fourth stripe
          // away and puts it in the counter, so the count is never off by one.
          const shown = here.length <= MAX_STRIPES ? here : here.slice(0, MAX_STRIPES - 1);
          const hidden = here.length - shown.length;
          const isToday = date === today;

          return (
            <Link
              key={date}
              href={`/dag?datum=${date}`}
              data-date={date}
              aria-label={`${day}, ${here.length} projekt`}
              // A FIXED height, not a minimum. Every measurement below is
              // spelled out so the cell cannot grow: 20 for the day number, 4
              // above the stripes, 4 x 10 stripes with 2 between them, 2 under
              // = 76 of the 84, and the counter takes exactly the room the
              // fourth stripe gives up. overflow-hidden is the backstop for a
              // browser that renders any of it a pixel larger.
              className={`flex h-[84px] flex-col overflow-hidden border-b border-r border-neutral-300 text-left ${
                isToday ? "ring-2 ring-inset ring-black" : ""
              }`}
            >
              <span
                className={`block px-1 pt-1 text-sm font-bold leading-[20px] ${
                  date < today ? "opacity-40" : ""
                }`}
              >
                {day}
              </span>

              <span className="mt-1 flex flex-col gap-[2px] px-[2px] pb-[2px]">
                {shown.map((pid) => {
                  const colour = colourOf(pid);
                  if (!colour) return null;
                  return (
                    <span
                      key={pid}
                      title={names.get(pid)}
                      className="block h-[10px]"
                      style={{ background: colour }}
                    />
                  );
                })}
                {hidden > 0 && (
                  <span className="block px-[2px] text-[10px] font-bold leading-[12px]">
                    +{hidden}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>

      {passes !== null && legend.length === 0 && (
        <div className="mt-4"><Empty>Inga pass den här månaden.</Empty></div>
      )}

      {/*
        With no name on a stripe this is not decoration, it is the key. It lists
        every project in the month, including one whose stripes all fell behind
        a "+N" -- otherwise a busy day could hide a site from the page entirely.
      */}
      {legend.length > 0 && (
        <div className="mt-6 flex flex-col gap-2 text-base">
          {legend.map((pid) => {
            const colour = colourOf(pid);
            return (
              <span key={pid} className="flex items-center gap-3">
                <span
                  className="inline-block h-6 w-10 border-2 border-black"
                  style={colour ? { background: colour } : undefined}
                />
                {names.get(pid)}
              </span>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Skiftkalender />
    </AuthGate>
  );
}
