"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Empty, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, longDayHeading, stampToTime, stockholmToday } from "@/lib/dates";
import { patternIndex, projectPattern } from "@/lib/project-pattern";

type Shift = {
  id: string;
  project_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  project_name: string;
  site_address: string;
  clock_in: string | null;
  clock_out: string | null;
  confirmed_hours: number | null;
  day_confirmed: boolean;
  /** An Arbetsdagbok covering this day has been generated. */
  filed: boolean;
};

type View = "lista" | "kalender";

/**
 * What the Timmar line says, and it is three things rather than two.
 *
 * INVARIANT 10. The figure appears only once an Arbetsdagbok covering the day
 * has been generated -- a confirmed day can still be edited at stage two, and
 * a number that shrinks when someone corrects it is worse than no number. The
 * masking is the my_shift view's, not this page's; all this does is say which
 * of the two silences applies, because a blank with no reason reads as a fault.
 */
function hoursLine(s: Shift): string {
  if (s.filed && s.confirmed_hours !== null) {
    return `${String(s.confirmed_hours).replace(".", ",")} h`;
  }
  return s.day_confirmed ? "Väntar på arbetsdagbok" : "Inte bekräftat än";
}

/**
 * Mina Pass -- every shift this worker holds, as a list or as a calendar.
 *
 * The list is the default because it answers "where am I tomorrow" without
 * counting squares. The calendar answers "how much did I work in October",
 * which is a different question and a worse list.
 *
 * Both read the same rows, so they cannot disagree.
 */
function MinaPass() {
  const [view, setView] = useState<View>("lista");
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const today = stockholmToday();

  useEffect(() => {
    let active = true;
    void (async () => {
      // Everything, not a window: this is the worker's whole record and RLS
      // already scopes it to them. Ordered oldest first so the list reads
      // forwards and the scroll below has somewhere to land.
      const { data, error } = await getSupabase()
        .from("my_shift")
        .select("*")
        .order("work_date");

      if (!active) return;
      if (error) { setError(error.message); setShifts([]); return; }
      setShifts((data ?? []) as Shift[]);
    })();
    return () => { active = false; };
  }, [reload]);

  async function stamp(id: string, dir: "in" | "out") {
    setBusy(id);
    setError(null);
    // The server sets the timestamp. A phone running ten minutes fast would
    // otherwise write ten minutes of error into evidence of hours worked.
    const { error } = await getSupabase()
      .rpc(dir === "in" ? "clock_in" : "clock_out", { p_tilldelning: id });
    if (error) setError(error.message);
    setReload((r) => r + 1);
    setBusy(null);
  }

  if (shifts === null) {
    return <Screen title="Mina pass" back="/"><span>Laddar…</span></Screen>;
  }

  const projectIds = [...new Set(shifts.map((s) => s.project_id))];

  return (
    <Screen title="Mina pass" back="/">
      {/* Two states, both always visible, the current one filled. A switch that
          hides the thing it switches to makes people press it to find out. */}
      <div role="group" aria-label="Visa som" className="mb-6 flex">
        {(["lista", "kalender"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`flex min-h-[56px] flex-1 items-center justify-center border-2 border-black text-lg font-bold ${
              view === v ? "bg-black text-white" : "bg-white text-black"
            } ${v === "kalender" ? "border-l-0" : ""}`}
          >
            {v === "lista" ? "Lista" : "Kalender"}
          </button>
        ))}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {shifts.length === 0 && <Empty>Du har inga pass än.</Empty>}

      {view === "lista" ? (
        <Lista shifts={shifts} today={today} busy={busy} onStamp={stamp} />
      ) : (
        <Kalender shifts={shifts} today={today} projectIds={projectIds} />
      )}
    </Screen>
  );
}

/**
 * The list. Chronological, with the first day that has not happened yet pulled
 * to the top of the screen on arrival: what is coming is what a worker opens
 * this for, and the past is a scroll back rather than a second screen.
 */
function Lista({
  shifts,
  today,
  busy,
  onStamp,
}: {
  shifts: Shift[];
  today: string;
  busy: string | null;
  onStamp: (id: string, dir: "in" | "out") => void;
}) {
  const firstFuture = useRef<HTMLElement | null>(null);

  useEffect(() => {
    firstFuture.current?.scrollIntoView({ block: "start" });
  }, [shifts]);

  const byDay = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (!byDay.has(s.work_date)) byDay.set(s.work_date, []);
    byDay.get(s.work_date)!.push(s);
  }

  const days = [...byDay.keys()];
  const nextUp = days.find((d) => d >= today);

  return (
    <div className="flex flex-col gap-6">
      {days.map((date) => (
        <section
          key={date}
          ref={date === nextUp ? firstFuture : undefined}
          className="scroll-mt-4"
        >
          <h2 className={`mb-2 text-sm font-bold uppercase tracking-wide ${
            date < today ? "text-neutral-500" : ""
          }`}>
            {longDayHeading(date)}
          </h2>

          <div className="flex flex-col gap-3">
            {byDay.get(date)!.map((s) => (
              <section key={s.id} className={`border-2 border-black p-4 ${
                date < today ? "opacity-70" : ""
              }`}>
                <p className="text-xl font-bold">{s.project_name}</p>
                <p className="mb-2 text-base">{s.site_address}</p>
                <p className="text-lg font-bold">
                  {hhmm(s.start_time)}–{hhmm(s.end_time)}
                </p>

                <dl className="mt-3 text-base">
                  <div className="flex justify-between border-t-2 border-black py-2">
                    <dt>Timmar</dt>
                    <dd className="text-right font-bold">{hoursLine(s)}</dd>
                  </div>
                </dl>

                {/* Clocking stays reachable here for the soft window -- today
                    and yesterday -- because the landing page's stamp acts on
                    one shift and a worker can hold two in that window. */}
                {(s.work_date === today || s.work_date === addDays(today, -1)) && (
                  <div className="mt-3">
                    <p className="mb-2 text-base text-neutral-700">
                      Stämplade {stampToTime(s.clock_in) || "—"} till{" "}
                      {stampToTime(s.clock_out) || "—"}
                    </p>
                    {!s.clock_in && (
                      <Button onClick={() => onStamp(s.id, "in")} disabled={busy === s.id}>
                        Stämpla in
                      </Button>
                    )}
                    {s.clock_in && !s.clock_out && (
                      <Button onClick={() => onStamp(s.id, "out")} disabled={busy === s.id}>
                        Stämpla ut
                      </Button>
                    )}
                    {s.clock_in && s.clock_out && (
                      <p className="text-center text-lg font-bold">Klart för dagen</p>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The calendar. Days worked are filled; which project is which is told by the
 * fill, never by colour -- this is not the shift calendar, and the rule outside
 * that one screen is black and white.
 *
 * The day number sits in a white pill so it stays readable over a solid fill
 * and over a hatch alike.
 */
function Kalender({
  shifts,
  today,
  projectIds,
}: {
  shifts: Shift[];
  today: string;
  projectIds: string[];
}) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);

  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const leadingBlanks = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;   // Monday-based

  const byDate = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (!s.work_date.startsWith(month)) continue;
    if (!byDate.has(s.work_date)) byDate.set(s.work_date, []);
    byDate.get(s.work_date)!.push(s);
  }

  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" })
    .format(new Date(`${first}T12:00:00Z`));

  // Only the projects actually on screen get a line in the legend.
  const here = [...new Set([...byDate.values()].flat().map((s) => s.project_id))];
  const nameOf = new Map(shifts.map((s) => [s.project_id, s.project_name]));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Föregående månad"
          onClick={() => { setMonth(addDays(first, -1).slice(0, 7)); setOpen(null); }}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ‹
        </button>
        <span className="text-lg font-bold capitalize">{monthName}</span>
        <button
          type="button"
          aria-label="Nästa månad"
          onClick={() => { setMonth(addDays(first, daysInMonth).slice(0, 7)); setOpen(null); }}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 text-center text-xs font-bold">
        {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => <span key={i}>{d}</span>)}
      </div>

      <div className="grid grid-cols-7 gap-[2px]">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`b${i}`} className="aspect-square" />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const worked = byDate.get(date);
          const fill = worked
            ? projectPattern(patternIndex(projectIds, worked[0]!.project_id))
            : undefined;

          return (
            <button
              key={date}
              type="button"
              data-date={date}
              aria-label={`${day}${worked ? `, ${worked.length} pass` : ", inget pass"}`}
              aria-pressed={open === date}
              onClick={() => setOpen((d) => (d === date ? null : date))}
              className={`flex aspect-square items-center justify-center border-2 text-base font-bold ${
                open === date ? "border-black ring-4 ring-inset ring-black" : "border-black"
              } ${date === today ? "ring-2 ring-inset ring-black" : ""}`}
              style={fill ? { background: fill } : undefined}
            >
              <span className={worked ? "bg-white px-1 leading-tight" : ""}>{day}</span>
            </button>
          );
        })}
      </div>

      {here.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 text-base">
          {here.map((pid) => (
            <span key={pid} className="flex items-center gap-3">
              <span
                className="inline-block h-6 w-10 shrink-0 border-2 border-black"
                style={{ background: projectPattern(patternIndex(projectIds, pid)) }}
              />
              {nameOf.get(pid)}
            </span>
          ))}
        </div>
      )}

      {open && (
        <section className="mt-6 border-t-4 border-black pt-4">
          <h2 className="mb-3 text-lg font-bold">{longDayHeading(open)}</h2>
          {(byDate.get(open) ?? []).length === 0 ? (
            <Empty>Inget pass den dagen.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {(byDate.get(open) ?? []).map((s) => (
                <section key={s.id} className="border-2 border-black p-4">
                  <p className="text-xl font-bold">{s.project_name}</p>
                  <p className="mb-2 text-base">{s.site_address}</p>
                  <p className="text-lg font-bold">
                    {hhmm(s.start_time)}–{hhmm(s.end_time)}
                  </p>
                  <dl className="mt-3 text-base">
                    <div className="flex justify-between border-t-2 border-black py-2">
                      <dt>Timmar</dt>
                      <dd className="text-right font-bold">{hoursLine(s)}</dd>
                    </div>
                  </dl>
                </section>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <MinaPass />
    </AuthGate>
  );
}
