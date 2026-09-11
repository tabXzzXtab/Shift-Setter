"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, EmptyState, SHADOW, Segmented, SoftNotice, SoftScreen,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, longDayHeading, stampToTime, stockholmToday } from "@/lib/dates";
import { fel } from "@/lib/fel";

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
      if (error) {
        setError(fel(error, "Kunde inte läsa dina pass. Ladda om sidan, eller prata med din arbetsledare."));
        setShifts([]);
        return;
      }
      setShifts((data ?? []) as Shift[]);
    })();
    return () => { active = false; };
  }, []);

  if (shifts === null) {
    return (
      <SoftScreen title="Mina pass" back="/">
        <div className="px-4 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Mina pass" back="/">
      {/* Both states always visible, the current one on a white thumb. A switch
          that hides the thing it switches to makes people press it to find out. */}
      <div className="px-4 pt-[2px]">
        <Segmented
          label="Visa som"
          value={view}
          onChange={setView}
          options={[
            { value: "lista" as View, label: "Lista" },
            { value: "kalender" as View, label: "Kalender" },
          ]}
        />
      </div>

      {error && <div className="px-4 pt-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {view === "lista" ? (
        <Lista shifts={shifts} today={today} />
      ) : (
        <Kalender shifts={shifts} today={today} />
      )}
    </SoftScreen>
  );
}

/**
 * The list. Chronological, with the first day that has not happened yet pulled
 * to the top of the screen on arrival: what is coming is what a worker opens
 * this for, and the past is a scroll back rather than a second screen.
 */
function Lista({ shifts, today }: { shifts: Shift[]; today: string }) {
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

  if (days.length === 0) {
    return (
      <div className="px-4 pt-[26px]">
        <SectionKicker>Kommande</SectionKicker>
        <EmptyState headline="Inga pass ännu">
          Pass du accepterar hamnar här.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {days.map((date) => (
        <section
          key={date}
          ref={date === nextUp ? firstFuture : undefined}
          className="scroll-mt-4 px-4 pt-[26px]"
        >
          <SectionKicker faded={date < today}>{longDayHeading(date)}</SectionKicker>

          <div className="flex flex-col gap-[10px]">
            {byDay.get(date)!.map((s) => (
              <div
                key={s.id}
                className="rounded-[14px] px-4 pb-[14px] pt-[15px]"
                style={{
                  background: C.surface,
                  boxShadow: SHADOW.group,
                  opacity: date < today ? 0.75 : 1,
                }}
              >
                <div className="mb-[3px] flex items-baseline justify-between gap-[10px]">
                  <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                    {s.project_name}
                  </div>
                  {/*
                    INVARIANT 10. The figure appears only once an Arbetsdagbok
                    covering the day has been generated; until then this says
                    which of the two silences applies, because a blank with no
                    reason reads as a fault.
                  */}
                  <div
                    data-hours
                    className="whitespace-nowrap text-[15px] font-bold"
                    style={{ color: s.filed && s.confirmed_hours !== null ? C.accent : C.text2 }}
                  >
                    {hoursLine(s)}
                  </div>
                </div>

                <div className="mb-3 text-[15px] font-medium" style={{ color: C.text2 }}>
                  {s.site_address}
                </div>

                <div className="flex items-center justify-between gap-[10px]">
                  <div className="text-[16px] font-bold" style={{ letterSpacing: "-.2px" }}>
                    {hhmm(s.start_time)}–{hhmm(s.end_time)}
                  </div>
                  {/*
                    READ-ONLY. There is exactly one place to stamp and it is the
                    landing page; reading your own stamps was never the half that
                    could disagree.
                  */}
                  {(s.work_date === today || s.work_date === addDays(today, -1)) && (
                    <div className="text-[14px] font-medium" style={{ color: C.text2 }}>
                      Stämplade {stampToTime(s.clock_in) || "—"} till{" "}
                      {stampToTime(s.clock_out) || "—"}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The kicker above each day group. Faded once the day is behind you. */
function SectionKicker({ children, faded }: { children: ReactNode; faded?: boolean }) {
  return (
    <div
      className="px-1 pb-[10px] text-[12px] font-bold uppercase"
      style={{ letterSpacing: "1px", color: C.text2, opacity: faded ? 0.7 : 1 }}
    >
      {children}
    </div>
  );
}

/**
 * The calendar. A month grid, then the selected day underneath it.
 *
 * NO PER-PROJECT MARK, which is a change the handoff makes deliberately: every
 * day holding a shift gets the same pale fill and the same accent dot, and
 * WHICH project it was is answered by the day section below rather than by a
 * legend. Two sites on one calendar used to be told apart by fill pattern; they
 * are now told apart by being read. Colour still carries nothing here -- the
 * shift calendar remains the one screen where it does.
 */
function Kalender({ shifts, today }: { shifts: Shift[]; today: string }) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);

  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const leadingBlanks = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;

  const byDate = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (!s.work_date.startsWith(month)) continue;
    if (!byDate.has(s.work_date)) byDate.set(s.work_date, []);
    byDate.get(s.work_date)!.push(s);
  }

  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long" })
    .format(new Date(`${first}T12:00:00Z`));

  return (
    <div>
      <div className="px-4 pt-5">
        <Card radius={16} pad="px-[14px] pb-[18px] pt-4">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              aria-label="Föregående månad"
              onClick={() => { setMonth(addDays(first, -1).slice(0, 7)); setOpen(null); }}
              className="press-scale flex h-10 w-10 items-center justify-center rounded-[11px] transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
              style={{ background: C.panel2 }}
            >
              <svg width="8" height="14" viewBox="0 0 9 15" fill="none" aria-hidden>
                <path d="M7.5 1.5 2 7.5l5.5 6" stroke={C.ink} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="text-center">
              <div className="text-[19px] font-extrabold capitalize" style={{ letterSpacing: "-.5px" }}>
                {monthName}
              </div>
              <div className="text-[12px] font-bold" style={{ letterSpacing: "1px", color: C.text2 }}>
                {month.slice(0, 4)}
              </div>
            </div>

            <button
              type="button"
              aria-label="Nästa månad"
              onClick={() => { setMonth(addDays(first, daysInMonth).slice(0, 7)); setOpen(null); }}
              className="press-scale flex h-10 w-10 items-center justify-center rounded-[11px] transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
              style={{ background: C.panel2 }}
            >
              <svg width="8" height="14" viewBox="0 0 9 15" fill="none" aria-hidden>
                <path d="M1.5 1.5 7 7.5l-5.5 6" stroke={C.ink} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="mb-[6px] grid grid-cols-7 gap-[2px]">
            {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => (
              <div
                key={i}
                className={`text-center text-[11px] ${i > 4 ? "font-semibold" : "font-bold"}`}
                style={{ letterSpacing: ".8px", color: C.text2 }}
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-[2px]">
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <span key={`b${i}`} className="h-11" />
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const date = `${month}-${String(day).padStart(2, "0")}`;
              const worked = byDate.get(date);
              const isToday = date === today;
              const chosen = open === date;

              return (
                <button
                  key={date}
                  type="button"
                  data-date={date}
                  aria-label={`${day}${worked ? `, ${worked.length} pass` : ", inget pass"}`}
                  aria-pressed={chosen}
                  onClick={() => setOpen((d) => (d === date ? null : date))}
                  className="flex h-11 flex-col items-center justify-center gap-[3px] rounded-[10px]"
                  style={{
                    background: chosen ? C.accent : worked ? C.panel2 : "transparent",
                    boxShadow: isToday && !chosen ? `inset 0 0 0 2px ${C.ink}` : undefined,
                  }}
                >
                  <span
                    className="text-[16px]"
                    style={{
                      letterSpacing: "-.2px",
                      fontWeight: chosen || isToday ? 800 : worked ? 700 : 600,
                      color: chosen ? C.surface : worked || isToday ? C.ink : C.text2,
                    }}
                  >
                    {day}
                  </span>
                  <span
                    className="block h-1 w-1 rounded-full"
                    style={{
                      background: worked ? (chosen ? C.surface : C.accent) : "transparent",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {open && (
        <div className="px-4 pt-[22px]">
          <SectionKicker>{longDayHeading(open)}</SectionKicker>
          {(byDate.get(open) ?? []).length === 0 ? (
            <EmptyState>Inga pass denna dag.</EmptyState>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {(byDate.get(open) ?? []).map((s) => (
                <div
                  key={s.id}
                  className="rounded-[14px] px-4 pb-[14px] pt-[15px]"
                  style={{ background: C.surface, boxShadow: SHADOW.group }}
                >
                  <div className="mb-[3px] flex items-baseline justify-between gap-[10px]">
                    <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                      {s.project_name}
                    </div>
                    <div
                      data-hours
                      className="whitespace-nowrap text-[15px] font-bold"
                      style={{ color: s.filed && s.confirmed_hours !== null ? C.accent : C.text2 }}
                    >
                      {hoursLine(s)}
                    </div>
                  </div>
                  <div className="mb-3 text-[15px] font-medium" style={{ color: C.text2 }}>
                    {s.site_address}
                  </div>
                  <div className="text-[16px] font-bold" style={{ letterSpacing: "-.2px" }}>
                    {hhmm(s.start_time)}–{hhmm(s.end_time)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
