"use client";

import { useEffect, useState } from "react";
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

/**
 * Öppna Pass -- every slot still going spare, including the ones this worker
 * turned down.
 *
 * Acceptera Pass is the cards, and a card answered is a card gone. This is the
 * list behind them, and the difference is deliberate: declining an offer does
 * not block the pass, it only answers the question, so someone whose plans
 * changed on Tuesday can still see the Wednesday they said no to.
 *
 * A list, not more cards, and nothing to press. Taking a shift back is a
 * conversation with the leader who then creates it -- the card was the offer,
 * and it has already been answered.
 *
 * Days this worker is already working are left out however many places are
 * open on them: invariant 2 means they could not take one, and a list of
 * things you cannot have is a worse list.
 *
 * GROUPED BY DAY, per the handoff: a kicker with the day and an `N pass` count
 * on the right, then the cards. The rows arrive ordered by work_date, so the
 * grouping is a fold rather than a sort.
 */
function OppnaPass() {
  const [rows, setRows] = useState<Open[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("open_pass")
        .select("*")
        .order("work_date");
      if (!live) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa de öppna passen. Ladda om sidan."));
        setRows([]);
        return;
      }
      setRows((data ?? []) as Open[]);
    })();
    return () => { live = false; };
  }, []);

  const byDay = new Map<string, Open[]>();
  for (const o of rows ?? []) {
    if (!byDay.has(o.work_date)) byDay.set(o.work_date, []);
    byDay.get(o.work_date)!.push(o);
  }

  return (
    <SoftScreen
      title="Öppna pass"
      back="/"
      subtitle="Pass som saknar folk. Prata med din arbetsledare om du vill ta ett."
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
              </div>
            ))}
          </div>
        </div>
      ))}
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
