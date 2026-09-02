"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Notice, Screen } from "@/components/ui";
import { PaintCalendar } from "@/components/paint-calendar";
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
 * The grid and the gesture come from PaintCalendar, shared with the leader's
 * day picker: one interaction, so one place it can be wrong.
 *
 * Black and white throughout. The three states are told apart by fill, not by
 * colour: solid is can-work, hatched is cannot, empty is unsaid.
 */
function MinKalender() {
  const { account } = useAccount();
  const [month, setMonth] = useState(() => stockholmToday().slice(0, 7));
  const [marks, setMarks] = useState<Marks>({});
  const [mode, setMode] = useState<Mark>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // What the current gesture touched, so only those days are written.
  const touched = useRef<Set<string>>(new Set());
  // The write happens in an effect rather than in the pointer-up handler: the
  // handler's closure holds the marks from before the gesture settled, and a
  // ref cannot be read during render to get around that.
  const [pendingWrite, setPendingWrite] = useState(false);

  const workerId = account?.worker_id ?? null;
  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
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

  function paint(date: string) {
    touched.current.add(date);
    setMarks((m) => {
      const next = { ...m };
      if (next[date] === mode) delete next[date];   // over it again to clear
      else next[date] = mode;
      return next;
    });
  }

  async function commit(now: Marks) {
    if (!workerId || touched.current.size === 0) return;
    setSaving(true);
    setError(null);
    const sb = getSupabase();

    // Take the gesture's days AND clear immediately. Clearing after the await
    // swallows a second gesture that starts while this write is in flight --
    // the days it painted would be wiped from the set before they were saved,
    // and the calendar would silently forget them.
    const changed = [...touched.current];
    touched.current.clear();

    const toSet = changed.filter((d) => now[d] !== undefined);
    const toClear = changed.filter((d) => now[d] === undefined);

    if (toSet.length) {
      const { error } = await sb.from("forval").upsert(
        toSet.map((work_date) => ({ worker_id: workerId, work_date, can_work: now[work_date]! })),
        { onConflict: "worker_id,work_date" },
      );
      if (error) setError(error.message);
    }
    if (toClear.length) {
      const { error } = await sb.from("forval").delete()
        .eq("worker_id", workerId).in("work_date", toClear);
      if (error) setError(error.message);
    }

    setSaving(false);
  }

  useEffect(() => {
    if (!pendingWrite) return;
    let active = true;
    void (async () => {
      await commit(marks);
      if (active) setPendingWrite(false);
    })();
    return () => { active = false; };
    // marks is settled by the time pendingWrite flips, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWrite]);


  if (!workerId) {
    return (
      <Screen title="Min kalender" back="/">
        <Notice kind="info">Ditt konto har ingen arbetarprofil.</Notice>
      </Screen>
    );
  }

  return (
    <Screen title="Min kalender" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-4 text-base">Tryck på en dag, eller dra över flera.</p>

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

      <PaintCalendar
        month={month}
        onMonthChange={setMonth}
        onPaint={paint}
        onPaintEnd={() => setPendingWrite(true)}
        look={(date) => {
          const mark = marks[date];
          const past = date < today;
          return {
            className:
              (mark === true ? "bg-black text-white"
                : mark === false ? `text-black ${HATCH}`
                : "bg-white text-black") + (past ? " opacity-40" : ""),
            label: `${Number(date.slice(8))} ${
              mark === true ? "kan jobba" : mark === false ? "kan inte" : "omarkerad"
            }`,
          };
        }}
        cellContent={(date, day) => (
          <span className={marks[date] === false ? "bg-white px-1" : undefined}>{day}</span>
        )}
      />

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
