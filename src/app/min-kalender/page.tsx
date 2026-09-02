"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";

type Mark = boolean; // true = can work, false = cannot
type Marks = Record<string, Mark>;

/** Diagonal hatch for "cannot work". Reads at cell size and needs no colour. */
const HATCH =
  "bg-[repeating-linear-gradient(45deg,#000_0_2px,transparent_2px_7px)] bg-white";

/**
 * Min kalender -- the worker paints the days they can work.
 *
 * This is the one screen in the slice that gets real layout work while
 * everything else stays plain, because drag-to-paint is unusable without it:
 * the cells have to be a true grid, big enough for a thumb, and the drag has to
 * track the finger rather than relying on hover.
 *
 * Still black and white. The three states are told apart by fill, not by
 * colour: solid is can-work, hatched is cannot, empty is unsaid. Nothing here
 * depends on being able to distinguish two hues.
 *
 * Painting a day that already holds the current mode clears it back to unsaid,
 * which is the same "drag over a selected day to unselect" gesture the leader's
 * calendar uses.
 */
function MinKalender() {
  const { account } = useAccount();
  const [month, setMonth] = useState(() => stockholmToday().slice(0, 7));
  const [marks, setMarks] = useState<Marks>({});
  const [mode, setMode] = useState<Mark>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const painting = useRef(false);
  const touched = useRef<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);

  const workerId = account?.worker_id ?? null;
  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  // Monday-based, like the ISO week the priority list counts in.
  const leadingBlanks = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const today = stockholmToday();

  useEffect(() => {
    if (!workerId) return;
    let active = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("forval")
        .select("work_date, can_work")
        .gte("work_date", first)
        .lte("work_date", addDays(first, daysInMonth - 1));
      if (!active) return;
      if (error) { setError(error.message); return; }
      setMarks(Object.fromEntries((data ?? []).map((r) => [r.work_date, r.can_work])));
    })();
    return () => { active = false; };
  }, [workerId, first, daysInMonth]);

  const paint = useCallback((date: string) => {
    if (touched.current.has(date)) return;   // one change per day per drag
    touched.current.add(date);
    setMarks((m) => {
      const next = { ...m };
      if (next[date] === mode) delete next[date];   // drag over it again to clear
      else next[date] = mode;
      return next;
    });
  }, [mode]);

  /**
   * Touch does not fire enter/leave on the elements a finger slides across, so
   * the day under the pointer is resolved by hit-testing instead of hover. The
   * same path serves the mouse, so there is only one behaviour to reason about.
   */
  const dateUnder = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>("[data-date]")?.dataset.date ?? null;
  };

  async function commit() {
    if (!workerId || touched.current.size === 0) return;
    setSaving(true);
    setError(null);
    const sb = getSupabase();
    const changed = [...touched.current];

    const toSet = changed.filter((d) => marks[d] !== undefined);
    const toClear = changed.filter((d) => marks[d] === undefined);

    if (toSet.length) {
      const { error } = await sb.from("forval").upsert(
        toSet.map((work_date) => ({ worker_id: workerId, work_date, can_work: marks[work_date]! })),
        { onConflict: "worker_id,work_date" },
      );
      if (error) setError(error.message);
    }
    if (toClear.length) {
      const { error } = await sb.from("forval").delete()
        .eq("worker_id", workerId).in("work_date", toClear);
      if (error) setError(error.message);
    }

    touched.current.clear();
    setSaving(false);
  }

  if (!workerId) {
    return (
      <Screen title="Min kalender" back="/">
        <Notice kind="info">Ditt konto har ingen arbetarprofil.</Notice>
      </Screen>
    );
  }

  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" })
    .format(new Date(`${first}T12:00:00Z`));

  return (
    <Screen title="Min kalender" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-4 text-base">
        Dra över dagarna. Dra igen för att ta bort.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={mode === true}
          onClick={() => setMode(true)}
          className={`min-h-[56px] border-2 border-black text-base font-bold ${
            mode ? "bg-black text-white" : "bg-white text-black"
          }`}
        >
          Kan jobba
        </button>
        <button
          type="button"
          aria-pressed={mode === false}
          onClick={() => setMode(false)}
          className={`min-h-[56px] border-2 border-black text-base font-bold ${
            !mode ? "bg-black text-white" : "bg-white text-black"
          }`}
        >
          Kan inte
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Föregående månad"
          onClick={() => setMonth(addDays(first, -1).slice(0, 7))}
          className="h-12 w-12 border-2 border-black text-2xl font-bold"
        >
          ‹
        </button>
        <span className="text-lg font-bold capitalize">{monthName}</span>
        <button
          type="button"
          aria-label="Nästa månad"
          onClick={() => setMonth(addDays(first, daysInMonth).slice(0, 7))}
          className="h-12 w-12 border-2 border-black text-2xl font-bold"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-bold">
        {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div
        ref={gridRef}
        className="grid touch-none select-none grid-cols-7 gap-1"
        onPointerDown={(e) => {
          const d = dateUnder(e.clientX, e.clientY);
          if (!d) return;
          painting.current = true;
          touched.current.clear();
          gridRef.current?.setPointerCapture(e.pointerId);
          paint(d);
        }}
        onPointerMove={(e) => {
          if (!painting.current) return;
          const d = dateUnder(e.clientX, e.clientY);
          if (d) paint(d);
        }}
        onPointerUp={() => { painting.current = false; void commit(); }}
        onPointerCancel={() => { painting.current = false; void commit(); }}
      >
        {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const mark = marks[date];
          const past = date < today;

          // Three states, told apart without colour: solid is can-work, hatched
          // is cannot, plain is unsaid. A strikethrough on the number was too
          // faint at cell size and read as a stray glyph.
          const look =
            mark === true ? "bg-black text-white"
            : mark === false ? "text-black " + HATCH
            : "bg-white text-black";

          return (
            <div
              key={date}
              data-date={date}
              role="button"
              aria-pressed={mark !== undefined}
              aria-label={`${day} ${mark === true ? "kan jobba" : mark === false ? "kan inte" : "omarkerad"}`}
              className={`flex aspect-square items-center justify-center border-2 border-black text-lg font-bold ${look} ${
                past ? "opacity-40" : ""
              }`}
            >
              {/* The digit needs a clear ground to sit on when the cell is
                  hatched, or the number is lost in the stripes. */}
              <span className={mark === false ? "bg-white px-1" : undefined}>{day}</span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-base" aria-live="polite">
        {saving ? "Sparar…" : "Sparas automatiskt."}
      </p>

      <div className="mt-6 flex flex-col gap-3 text-base">
        <span className="flex items-center gap-3">
          <span className="inline-block h-10 w-10 border-2 border-black bg-black" />
          Kan jobba
        </span>
        <span className="flex items-center gap-3">
          <span className={`inline-block h-10 w-10 border-2 border-black ${HATCH}`} />
          Kan inte
        </span>
        <span className="flex items-center gap-3">
          <span className="inline-block h-10 w-10 border-2 border-black bg-white" />
          Inte sagt
        </span>
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <MinKalender />
    </AuthGate>
  );
}
