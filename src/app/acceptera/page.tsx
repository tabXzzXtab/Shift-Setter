"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Empty, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm } from "@/lib/dates";

type Offer = {
  pass_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  planned_hours: number;
  project_name: string;
  site_address: string;
};

/**
 * Acceptera Pass -- Tier 3.
 *
 * The card carries date, project, address, times and hours, because that is
 * everything needed to answer without asking anyone.
 *
 * First accepted wins and the slot closes instantly. Losing is normal here, so
 * the refusal is worded as a fact rather than an error: someone else was
 * quicker. The decision itself is the database's -- accept_offer takes the
 * pass row lock, and exactly one of two simultaneous accepts survives it.
 *
 * The my_offer view already applies the exclusion filter, so a shift on a date
 * this worker is already booked for never appears at all.
 */
function Acceptera() {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("my_offer")
        .select("*")
        .order("work_date");
      if (!active) return;
      if (error) setError(error.message);
      else setOffers((data ?? []) as Offer[]);
    })();
    return () => { active = false; };
  }, [reload]);

  async function respond(passId: string, take: boolean) {
    setBusy(passId);
    setError(null);
    setNote(null);

    const { error } = await getSupabase()
      .rpc(take ? "accept_offer" : "decline_offer", { p_pass: passId });

    if (error) {
      // Not an error the worker did anything about.
      setNote(
        /full|not offered/i.test(error.message)
          ? "Någon annan hann först. Passet är taget."
          : error.message,
      );
    } else if (take) {
      setNote("Passet är ditt.");
    }

    setReload((r) => r + 1);
    setBusy(null);
  }

  if (offers === null) {
    return <Screen title="Acceptera pass" back="/"><span>Laddar…</span></Screen>;
  }

  return (
    <Screen title="Acceptera pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="info">{note}</Notice>}

      {offers.length === 0 && <Empty>Inga pass erbjuds just nu.</Empty>}

      <div className="flex flex-col gap-4">
        {offers.map((o) => (
          <section key={o.pass_id} className="border-2 border-black p-4">
            <p className="text-2xl font-bold">{o.work_date}</p>
            <p className="text-lg">{o.project_name}</p>
            <p className="mb-3 text-base text-neutral-700">{o.site_address}</p>

            <dl className="mb-4 text-base">
              <div className="flex justify-between border-t-2 border-black py-2">
                <dt>Tider</dt>
                <dd className="font-bold">{hhmm(o.start_time)}–{hhmm(o.end_time)}</dd>
              </div>
              <div className="flex justify-between border-y-2 border-black py-2">
                <dt>Timmar</dt>
                <dd className="font-bold">{String(o.planned_hours).replace(".", ",")} h</dd>
              </div>
            </dl>

            <div className="flex flex-col gap-2">
              <Button onClick={() => respond(o.pass_id, true)} disabled={busy === o.pass_id}>
                Ta passet
              </Button>
              <Button variant="outline" onClick={() => respond(o.pass_id, false)} disabled={busy === o.pass_id}>
                Nej tack
              </Button>
            </div>
          </section>
        ))}
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Acceptera />
    </AuthGate>
  );
}
