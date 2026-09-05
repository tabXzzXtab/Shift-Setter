"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Empty, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading } from "@/lib/dates";

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
      if (error) { setError(error.message); setRows([]); return; }
      setRows((data ?? []) as Open[]);
    })();
    return () => { live = false; };
  }, []);

  if (rows === null) {
    return <Screen title="Öppna pass" back="/"><span>Laddar…</span></Screen>;
  }

  return (
    <Screen title="Öppna pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-4 text-base text-neutral-700">
        Pass som fortfarande saknar folk. Prata med din arbetsledare om du vill
        ta ett.
      </p>

      {rows.length === 0 && <Empty>Inga öppna pass just nu.</Empty>}

      <div className="flex flex-col gap-3">
        {rows.map((o) => (
          <section key={o.pass_id} className="border-2 border-black p-4">
            <p className="text-base font-bold uppercase tracking-wide">
              {longDayHeading(o.work_date)}
            </p>
            <p className="text-xl font-bold">{o.project_name}</p>
            <p className="text-base">{o.site_address}</p>
            <p className="mt-2 text-base text-neutral-700">
              {hhmm(o.start_time)}–{hhmm(o.end_time)} ·{" "}
              {String(o.planned_hours).replace(".", ",")} h
            </p>
            <p className="mt-2 text-base font-bold">
              {o.slots_open} {o.slots_open === 1 ? "plats" : "platser"} kvar
            </p>
          </section>
        ))}
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <OppnaPass />
    </AuthGate>
  );
}
