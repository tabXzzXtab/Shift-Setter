"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, EmptyState, SHADOW, SoftNotice, SoftScreen, Tag,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading } from "@/lib/dates";
import { fel } from "@/lib/fel";

type Open = {
  pass_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  planned_hours: number;
  project_name: string;
  site_address: string;
  slots_open: number;
};

type Toast = { tone: "live" | "stop"; text: string };

/**
 * Öppna Pass -- every slot still going spare, including the ones this worker
 * turned down.
 *
 * Acceptera Pass is the cards, and a card answered is a card gone. This is the
 * list behind them, and the difference is deliberate: declining an offer does
 * not block the pass, it only answers the question, so someone whose plans
 * changed on Tuesday can still see the Wednesday they said no to.
 *
 * Every card carries Boka Pass, and it presses the SAME `accept_offer` the
 * cards do -- one route into a slot, not two. The database is the only real
 * boundary (CLAUDE.md), so this screen decides nothing: `accept_offer` takes
 * the pass row lock, checks the offer is still open to this worker, and
 * invariant 2 is the partial unique index underneath it. A refusal comes back
 * as itself, through `fel()`, rather than as a guess made here.
 *
 * WHAT THAT MEANS FOR A SHIFT NOBODY OFFERED THIS WORKER: `accept_offer`
 * requires a `pass_offer` row still in `offered`, and this list is not
 * filtered on one -- it shows every opening, including those already declined
 * or never offered. Pressing Boka Pass on one of those is refused, and the
 * refusal says so in Swedish. The button does not pretend otherwise.
 *
 * Days this worker is already working are left out however many places are
 * open on them: invariant 2 means they could not take one, and a list of
 * things you cannot have is a worse list. That filter lives in the `open_pass`
 * view, which is why a successful booking is followed by a refetch rather than
 * by local bookkeeping -- taking a Wednesday closes every other Wednesday
 * opening to this worker, and the view already knows that.
 *
 * GROUPED BY DAY, per the handoff: a kicker with the day and an `N pass` count
 * on the right, then the cards. The rows arrive ordered by work_date, so the
 * grouping is a fold rather than a sort.
 */
function OppnaPass() {
  const [rows, setRows] = useState<Open[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  /** The pass in flight, so a second thumb cannot start a second accept. */
  const [busy, setBusy] = useState<string | null>(null);

  /** Bumped to refetch. The read stays inside its own effect, as everywhere
   *  else in the app -- a reload is a dependency, not a function call. */
  const [reload, setReload] = useState(0);

  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("open_pass")
        .select("*")
        .order("work_date");
      if (!active) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa de öppna passen. Ladda om sidan."));
        setRows([]);
        return;
      }
      setError(null);
      setRows((data ?? []) as Open[]);
    })();
    return () => { active = false; };
  }, [reload]);

  /**
   * A confirmation is a flash; a refusal is something to read. Only the
   * confirmation is put on a timer -- an error that clears itself before a
   * thumb has come off the button has told nobody anything.
   */
  function say(tone: Toast["tone"], text: string) {
    if (timer.current) clearTimeout(timer.current);
    setToast({ tone, text });
    if (tone === "live") {
      timer.current = setTimeout(() => {
        if (live.current) setToast(null);
      }, 2600);
    }
  }

  async function boka(passId: string) {
    setBusy(passId);
    setToast(null);

    const { error } = await getSupabase().rpc("accept_offer", { p_pass: passId });

    if (!live.current) return;

    if (error) {
      say("stop", fel(error, "Passet kunde inte bokas. Prata med din arbetsledare."));
    } else {
      // The card goes at once, so the press has an answer before the round
      // trip does. The refetch below then lets the view have the last word.
      setRows((r) => (r ?? []).filter((x) => x.pass_id !== passId));
      say("live", "Passet är ditt.");
    }

    setBusy(null);
    setReload((r) => r + 1);
  }

  const byDay = new Map<string, Open[]>();
  for (const o of rows ?? []) {
    if (!byDay.has(o.work_date)) byDay.set(o.work_date, []);
    byDay.get(o.work_date)!.push(o);
  }

  return (
    <SoftScreen
      title="Öppna pass"
      back="/"
      subtitle="Pass som saknar folk. Boka ett pass som passar ditt schema."
    >
      {error && (
        <div className="px-4 pt-2"><SoftNotice tone="stop">{error}</SoftNotice></div>
      )}

      {rows === null && (
        <div className="px-4 pt-5"><EmptyState>Laddar…</EmptyState></div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="px-4 pt-5">
          <EmptyState headline="Inga öppna pass">
            Allt är tillsatt just nu.
          </EmptyState>
        </div>
      )}

      {[...byDay.entries()].map(([date, list]) => (
        <div key={date} className="px-4 pt-5">
          <div className="flex items-baseline justify-between px-1 pb-[10px]">
            <div
              className="text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              {longDayHeading(date)}
            </div>
            <div className="text-[12px] font-bold" style={{ color: C.text2 }}>
              {list.length} pass
            </div>
          </div>

          <div className="flex flex-col gap-[10px]">
            {list.map((o) => (
              <div
                key={o.pass_id}
                data-open-pass={o.pass_id}
                className="rounded-[14px] px-4 pb-[14px] pt-[15px]"
                style={{ background: C.surface, boxShadow: SHADOW.group }}
              >
                <div className="mb-[3px] flex items-baseline justify-between gap-[10px]">
                  <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                    {o.project_name}
                  </div>
                  {/*
                    Typed by a human, never derived from the span -- invariant 1.
                    This is the planned figure the shift was created with, which
                    is what is being offered.
                  */}
                  <div
                    className="whitespace-nowrap text-[15px] font-bold"
                    style={{ color: C.accent }}
                  >
                    {String(o.planned_hours).replace(".", ",")} h
                  </div>
                </div>

                <div className="mb-3 text-[15px] font-medium" style={{ color: C.text2 }}>
                  {o.site_address}
                </div>

                <div className="flex items-center justify-between gap-[10px]">
                  <div className="text-[16px] font-bold" style={{ letterSpacing: "-.2px" }}>
                    {hhmm(o.start_time)}–{hhmm(o.end_time)}
                  </div>
                  <Tag tone="quiet">
                    {o.slots_open} {o.slots_open === 1 ? "plats" : "platser"} kvar
                  </Tag>
                </div>

                {/* Same height and same fill as Acceptera on the cards: it is
                    the same act, so it should not look like a lesser one. */}
                <button
                  type="button"
                  onClick={() => void boka(o.pass_id)}
                  disabled={busy !== null}
                  className="press-scale mt-[14px] h-[54px] w-full rounded-[10px] text-[17px] font-bold text-white transition-transform duration-[120ms] hover:bg-[#12206b] active:scale-[.985] disabled:opacity-60"
                  style={{ letterSpacing: "-.2px", background: C.accent }}
                >
                  {busy === o.pass_id ? "Bokar…" : "Boka Pass"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Anchored to the thumb rather than to the top of a scrolled list: the
          press happened down here, and so should its answer. */}
      {toast && (
        <div
          data-toast={toast.tone}
          className="fixed bottom-[22px] left-1/2 z-50 w-[calc(100%-32px)] max-w-[358px] -translate-x-1/2"
          style={{ borderRadius: 12, boxShadow: SHADOW.hero }}
        >
          <SoftNotice tone={toast.tone}>{toast.text}</SoftNotice>
        </div>
      )}
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <OppnaPass />
    </AuthGate>
  );
}
