"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppBar, type MenuItem } from "./app-bar";
import { NastaPassCard } from "./nasta-pass-card";
import { OfferStack, type Offer } from "./offer-stack";
import { Landing, Notice } from "./ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, stockholmToday } from "@/lib/dates";

const MENU: MenuItem[] = [{ href: "/oppna-pass", label: "Öppna Pass" }];

type Shift = {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  project_name: string;
  clock_in: string | null;
  clock_out: string | null;
};

type Note = { id: string; kind: string; work_date?: string };

/**
 * The arbetare's landing page: the one thing they do most, then everything
 * else.
 *
 * Clocking is the whole top of the screen because it is the only thing anyone
 * does standing in the rain with one glove off. Everything else can be two
 * presses away; this cannot be one.
 *
 * THE STAMP IS THE SERVER'S. clock_in() and clock_out() write now() in the
 * database and this screen sends no time at all -- a phone running ten minutes
 * fast would otherwise write ten minutes of error into evidence of hours
 * worked, and nobody would notice.
 */
export function HomeArbetare() {
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;

    void (async () => {
      const sb = getSupabase();
      const today = stockholmToday();

      // Yesterday too: the clocking window is soft, because a night shift ends
      // at 06:00 and bad signal on site is normal.
      const [{ data: shifts }, { data: offered }, { data: unread }] = await Promise.all([
        sb.from("my_shift")
          .select("id, work_date, start_time, end_time, project_name, clock_in, clock_out")
          .gte("work_date", addDays(today, -1))
          .lte("work_date", today)
          .order("work_date"),
        sb.from("my_offer").select("*").order("work_date"),
        sb.from("notification").select("id, kind, payload").is("read_at", null)
          .order("created_at", { ascending: false }),
      ]);

      if (!live) return;

      // The one to act on: a shift already running beats one not started, and
      // a day finished with is not offered a button at all.
      const rows = (shifts ?? []) as Shift[];
      const running = rows.find((s) => s.clock_in && !s.clock_out);
      const fresh = rows.find((s) => !s.clock_in && s.work_date === today);
      setShift(running ?? fresh ?? null);

      setOffers((offered ?? []) as Offer[]);
      setNotes((unread ?? []).map((n) => ({
        id: n.id,
        kind: n.kind,
        work_date: (n.payload as { work_date?: string } | null)?.work_date,
      })));
    })();

    return () => { live = false; };
  }, [reload]);

  async function stamp(dir: "in" | "out") {
    if (!shift) return;
    setBusy(true);
    setError(null);
    const { error } = await getSupabase()
      .rpc(dir === "in" ? "clock_in" : "clock_out", { p_tilldelning: shift.id });
    if (error) setError(error.message);
    setBusy(false);
    setReload((r) => r + 1);
  }

  async function respond(passId: string, take: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    const { error } = await getSupabase()
      .rpc(take ? "accept_offer" : "decline_offer", { p_pass: passId });

    if (error) {
      // Losing a race is normal here, so it is worded as a fact, not a fault.
      setNote(/full|not offered/i.test(error.message)
        ? "Någon annan hann först. Passet är taget."
        : error.message);
    } else if (take) {
      setNote("Passet är ditt.");
    } else {
      setNote("Passet ligger kvar under Öppna Pass om du ändrar dig.");
    }
    setBusy(false);
    setReload((r) => r + 1);
  }

  async function dismiss(id: string) {
    await getSupabase().from("notification")
      .update({ read_at: new Date().toISOString() }).eq("id", id);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  const clockedIn = Boolean(shift?.clock_in && !shift.clock_out);

  return (
    <Landing>
      <AppBar title="Arbetare" menu={MENU} />

      {error && <Notice kind="error">{error}</Notice>}

      {/* ---- the stamp ------------------------------------------------------ */}
      {shift === undefined && <p className="text-base">Laddar…</p>}

      {shift === null && (
        <p className="border-2 border-dashed border-black p-8 text-center text-lg">
          Inget pass att stämpla just nu.
        </p>
      )}

      {shift && (
        <>
          <button
            type="button"
            onClick={() => stamp(clockedIn ? "out" : "in")}
            disabled={busy}
            className={`flex min-h-[140px] w-full flex-col items-center justify-center gap-1 border-4 border-black px-4 text-center disabled:opacity-40 ${
              clockedIn ? "bg-white text-black" : "bg-black text-white"
            }`}
          >
            <span className="text-3xl font-bold">
              {clockedIn ? "Stämpla Ut" : "Stämpla In"}
            </span>
            <span className="text-base font-normal">
              {shift.project_name} · {hhmm(shift.start_time)}–{hhmm(shift.end_time)}
            </span>
          </button>
          <p className="mb-6 mt-2 text-center text-base text-neutral-700">
            {clockedIn ? "Du är instämplad." : "Du har inte stämplat in."}
          </p>
        </>
      )}

      {/* ---- the badge, directly below the stamp ---------------------------- */}
      {notes.map((n) => (
        <div key={n.id} className="mb-3 border-2 border-black bg-black p-3 text-white">
          <p className="mb-3 text-base">
            {n.kind === "shift_deleted"
              ? `Ditt pass ${n.work_date ?? ""} är borttaget.`
              : "Du har en ny notis."}
          </p>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            className="min-h-[44px] w-full border-2 border-white px-3 text-base font-bold"
          >
            Okej
          </button>
        </div>
      ))}

      {/* ---- the two buttons ------------------------------------------------ */}
      <div className="mb-8 mt-6 flex flex-col gap-3">
        <Link
          href="/mina-pass"
          className="flex min-h-[64px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold"
        >
          <span>Mina Pass</span>
          <span aria-hidden className="text-2xl">→</span>
        </Link>
        {/* Arbetsdagar is Min Kalender under the name the people using it use:
            same page, same gesture, and the days they can work is what they
            think they are answering. */}
        <Link
          href="/min-kalender"
          className="flex min-h-[64px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold"
        >
          <span>Arbetsdagar</span>
          <span aria-hidden className="text-2xl">→</span>
        </Link>
      </div>

      {/* ---- Nästa Pass ---------------------------------------------------- */}
      <div className="mb-8">
        <NastaPassCard />
      </div>

      {/* ---- Acceptera Pass, as a stack ------------------------------------- */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Acceptera Pass</h2>
      {note && <Notice kind="info">{note}</Notice>}

      {offers === null ? (
        <p className="text-base">Laddar…</p>
      ) : (
        <OfferStack offers={offers} busy={busy} onRespond={respond} />
      )}
    </Landing>
  );
}
