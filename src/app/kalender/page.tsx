"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Empty, Notice, Screen } from "@/components/ui";
import { DagPanel } from "@/components/dag-panel";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { colourIndex, projectColour, readableInk } from "@/lib/project-colour";

type PassRow = { id: string; project_id: string; project_name: string; work_date: string };

/**
 * Skiftkalendern -- every project's shifts on one calendar.
 *
 * A pass repeating across consecutive days reads as ONE continuous bar. That
 * falls out of the layout rather than being drawn: each project keeps the same
 * slot in every day cell, the cells sit flush with no horizontal gap, so
 * adjacent days join into a single band. The project name is written once per
 * run, on its first day, because repeating it every day turns a bar into a
 * wall of text.
 *
 * Colour is the one thing here that is not black and white, because here it
 * carries meaning: it is what makes "Tuesday is two different sites" visible
 * without reading anything.
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
  const [openDay, setOpenDay] = useState<string | null>(null);

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
  const projectIds = [...names.keys()];
  const slots = [...projectIds].sort((a, b) =>
    (names.get(a) ?? "").localeCompare(names.get(b) ?? "", "sv"),
  );

  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" })
    .format(new Date(`${first}T12:00:00Z`));

  const worksOn = (pid: string, date: string) => byDate.get(date)?.has(pid) ?? false;

  return (
    <Screen title="Skiftkalender" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-4 text-base">Tryck på en dag för att se allt som händer då.</p>

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

      {/* No gap between columns: that is what lets consecutive days join. */}
      <div className="grid grid-cols-7 border-2 border-black">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`b${i}`} className="min-h-[84px] border-b border-r border-neutral-300" />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const here = byDate.get(date);
          const isToday = date === today;

          return (
            <button
              key={date}
              type="button"
              data-date={date}
              aria-label={`${day}, ${here?.size ?? 0} projekt`}
              onClick={() => setOpenDay((d) => (d === date ? null : date))}
              className={`min-h-[84px] border-b border-r border-neutral-300 p-0 text-left align-top ${
                isToday ? "ring-2 ring-inset ring-black" : ""
              } ${openDay === date ? "ring-4 ring-inset ring-black" : ""}`}
            >
              <span className={`block px-1 pt-1 text-sm font-bold ${date < today ? "opacity-40" : ""}`}>
                {day}
              </span>

              <span className="mt-1 block">
                {slots.map((pid) => {
                  if (!worksOn(pid, date)) {
                    // An empty slot, so a project keeps the same line every day
                    // and its bar stays unbroken across the days it does run.
                    return <span key={pid} className="block h-[14px]" />;
                  }
                  const colour = projectColour(colourIndex(projectIds, pid));
                  // Labelled at the start of the run, and again wherever the
                  // run wraps onto a new week row -- a segment with no name on
                  // it sends the reader back to the legend.
                  const isMonday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 === 0;
                  const startsRun = !worksOn(pid, addDays(date, -1)) || isMonday;
                  return (
                    <span
                      key={pid}
                      title={names.get(pid)}
                      className="block h-[14px] overflow-hidden whitespace-nowrap text-[10px] font-bold leading-[14px]"
                      style={{ background: colour, color: readableInk(colour) }}
                    >
                      {/* Written once per run, on its first day. */}
                      {startsRun ? <span className="px-1">{names.get(pid)}</span> : ""}
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>

      {openDay && (
        <section data-day-panel={openDay} className="mt-6 border-t-4 border-black pt-4">
          <DagPanel date={openDay} />
        </section>
      )}

      {passes !== null && slots.length === 0 && (
        <div className="mt-4"><Empty>Inga pass den här månaden.</Empty></div>
      )}

      {slots.length > 0 && (
        <div className="mt-6 flex flex-col gap-2 text-base">
          {slots.map((pid) => {
            const colour = projectColour(colourIndex(projectIds, pid));
            return (
              <span key={pid} className="flex items-center gap-3">
                <span
                  className="inline-block h-6 w-10 border-2 border-black"
                  style={{ background: colour }}
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
