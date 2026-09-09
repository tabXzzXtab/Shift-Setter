"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { C, Card, Segmented, SoftNotice, SoftScreen } from "@/components/soft";
import { PaintCalendar } from "@/components/paint-calendar";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";

type Mark = boolean; // true = can work, false = cannot
type Marks = Record<string, Mark>;

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
      // SCOPED TO THIS WORKER, explicitly.
      //
      // RLS on forval reads "app.is_staff() OR worker_id = current_worker_id()",
      // which for an arbetare narrows this to their own rows and hid the
      // missing filter completely. An arbetsledare IS staff and is also a
      // worker who holds shifts -- so their own calendar came back holding
      // every worker's availability, drawn as if it were theirs. Painting then
      // toggled a day that looked marked because a colleague had marked it,
      // and the leader could not mark themselves available at all.
      const { data, error } = await getSupabase()
        .from("forval")
        .select("work_date, can_work")
        .eq("worker_id", workerId)
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
      <SoftScreen title="Min kalender" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">Ditt konto har ingen arbetarprofil.</SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  const yesCount = Object.values(marks).filter((v) => v === true).length;
  const noCount = Object.values(marks).filter((v) => v === false).length;

  return (
    <SoftScreen
      title="Min kalender"
      back="/"
      subtitle="Tryck på en dag, eller dra över flera."
    >
      {error && <div className="px-4 pb-[4px] pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {/* The mode switch decides what a tap WRITES; tapping a day already in
          that state clears it back to "Inte sagt". Three states, one gesture. */}
      <div className="px-4 pt-[14px]">
        <Segmented
          label="Vad en tryckning betyder"
          value={mode ? "yes" : "no"}
          onChange={(v) => setMode(v === "yes")}
          options={[
            { value: "yes", label: "Kan jobba" },
            { value: "no", label: "Kan inte" },
          ]}
        />
      </div>

      <div className="px-4 pt-[14px]">
        <PaintCalendar
          month={month}
          onMonthChange={setMonth}
          onPaint={paint}
          onPaintEnd={() => setPendingWrite(true)}
          look={(date) => {
            const mark = marks[date];
            const past = date < today;
            return {
              className: mark === undefined ? "font-semibold" : "font-extrabold",
              style: {
                background: past
                  ? "transparent"
                  : mark === true ? C.accent
                    : mark === false ? C.stopBg
                      : C.panel2,
                // The unavailable day gets a ring as well as a fill, so it is
                // not a colour alone that separates it from an unmarked one.
                boxShadow: !past && mark === false ? "inset 0 0 0 1.5px #f0cdd2" : undefined,
                color: past
                  ? C.chevron
                  : mark === true ? C.surface
                    : mark === false ? C.stopInk
                      : C.ink,
                cursor: past ? "default" : "pointer",
              },
              label: `${Number(date.slice(8))} ${
                mark === true ? "kan jobba" : mark === false ? "kan inte" : "omarkerad"
              }`,
            };
          }}
        />
      </div>

      {/* Availability is advisory and autosaves -- so the screen says so in
          the live pair rather than making anybody look for a Spara. */}
      <div className="px-4 pt-[14px]">
        <div
          className="flex items-center gap-2 rounded-[12px] px-4 py-3"
          style={{ background: C.liveBg }}
          aria-live="polite"
        >
          {!saving && (
            <svg width="13" height="10" viewBox="0 0 11 9" fill="none" aria-hidden>
              <path d="M1 4.6 4 7.6 10 1.4" stroke={C.liveInk} strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className="text-[15px] font-semibold" style={{ color: C.liveInk }}>
            {saving ? "Sparar…" : "Sparas automatiskt"}
          </span>
        </div>
      </div>

      {/*
        Colour is never the only carrier: "Kan inte" pairs its fill with an ✕,
        and every row is named in words. The counts are live, because the
        question this screen answers is "how many days have I said yes to".
      */}
      <div className="px-4 pt-[14px]">
        <Card radius={14} pad="px-4 py-[14px]" className="flex flex-col gap-3">
          <div className="flex items-center gap-[10px]">
            <span
              className="h-[22px] w-[22px] shrink-0 rounded-[7px]"
              style={{ background: C.accent }}
            />
            <span className="text-[15px] font-semibold">Kan jobba</span>
            <span className="ml-auto text-[15px] font-bold" style={{ color: C.text2 }}>
              {yesCount}
            </span>
          </div>

          <div className="flex items-center gap-[10px]">
            <span
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
              style={{ background: C.stopBg, boxShadow: "inset 0 0 0 1.5px #f0cdd2" }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M1.6 1.6l6.8 6.8M8.4 1.6l-6.8 6.8" stroke={C.stopInk}
                  strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold">Kan inte</span>
            <span className="ml-auto text-[15px] font-bold" style={{ color: C.text2 }}>
              {noCount}
            </span>
          </div>

          <div className="flex items-center gap-[10px]">
            <span
              className="h-[22px] w-[22px] shrink-0 rounded-[7px]"
              style={{ background: C.panel2 }}
            />
            <span className="text-[15px] font-semibold" style={{ color: C.text2 }}>
              Inte sagt
            </span>
          </div>
        </Card>
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <MinKalender />
    </AuthGate>
  );
}
