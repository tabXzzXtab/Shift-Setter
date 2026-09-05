"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Notice, Screen } from "@/components/ui";
import { OfferStack, type Offer } from "@/components/offer-stack";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Acceptera Pass -- Tier 3, on its own page.
 *
 * The same stack the landing page shows, from the same component: an offer
 * must not look like two different things depending on how it was reached.
 * This page exists because the landing page is a phone screen and a worker
 * with eight offers should be able to give them a screen of their own.
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
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("my_offer")
        .select("*")
        .order("work_date");
      if (!active) return;
      if (error) { setError(error.message); setOffers([]); return; }
      setOffers((data ?? []) as Offer[]);
    })();
    return () => { active = false; };
  }, [reload]);

  async function respond(passId: string, take: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);

    const { error } = await getSupabase()
      .rpc(take ? "accept_offer" : "decline_offer", { p_pass: passId });

    if (error) {
      setNote(
        /full|not offered/i.test(error.message)
          ? "Någon annan hann först. Passet är taget."
          : error.message,
      );
    } else if (take) {
      setNote("Passet är ditt.");
    } else {
      setNote("Passet ligger kvar under Öppna Pass om du ändrar dig.");
    }

    setBusy(false);
    setReload((r) => r + 1);
  }

  if (offers === null) {
    return <Screen title="Acceptera pass" back="/"><span>Laddar…</span></Screen>;
  }

  return (
    <Screen title="Acceptera pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="info">{note}</Notice>}

      <OfferStack offers={offers} busy={busy} onRespond={respond} />
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
