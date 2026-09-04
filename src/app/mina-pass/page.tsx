"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Empty, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, stampToTime, stockholmToday } from "@/lib/dates";

type Shift = {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  project_name: string;
  site_address: string;
  clock_in: string | null;
  clock_out: string | null;
  confirmed_hours: number | null;
  day_confirmed: boolean;
  /** An Arbetsdagbok covering this day has been generated. Until then the
   *  figure can still move, so it is not shown. */
  filed: boolean;
};

/**
 * The worker's whole application, for this slice: their shift, and clocking.
 *
 * Today AND yesterday are shown -- the soft clocking window. A hard same-day
 * rule breaks a night shift that ends at 06:00, and breaks catching up after
 * bad signal on site. Nothing is forbidden at the database level either.
 *
 * Hours are absent until an Arbetsdagbok covering the day has been generated.
 * That is invariant 10 and it is enforced by the my_shift view, not here: a
 * confirmed figure can still be edited at stage two, a filed one cannot, and a
 * number that shrinks when someone corrects it is worse than no number.
 */
function MinaPass() {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ id: string; kind: string; work_date?: string }[]>([]);

  // The fetch returns rows; state settles after the await, never synchronously
  // inside the effect body. `reload` is how an action asks for a refresh.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      const today = stockholmToday();
      const { data, error } = await getSupabase()
        .from("my_shift")
        .select("*")
        .gte("work_date", addDays(today, -1))   // the soft clocking window
        .lte("work_date", addDays(today, 30))
        .order("work_date");

      // In-app only: a message on next load. There is no server to push from,
      // so a deleted shift is told here rather than arriving on the phone.
      const { data: unread } = await getSupabase()
        .from("notification")
        .select("id, kind, payload")
        .is("read_at", null)
        .order("created_at", { ascending: false });

      if (!active) return;
      if (error) setError(error.message);
      else setShifts((data ?? []) as Shift[]);
      setNotes((unread ?? []).map((n) => ({
        id: n.id,
        kind: n.kind,
        work_date: (n.payload as { work_date?: string } | null)?.work_date,
      })));
    })();

    return () => { active = false; };
  }, [reload]);

  async function dismiss(id: string) {
    await getSupabase().from("notification")
      .update({ read_at: new Date().toISOString() }).eq("id", id);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  async function stamp(id: string, dir: "in" | "out") {
    setBusy(id);
    setError(null);
    // The server sets the timestamp. A phone running ten minutes fast would
    // otherwise write ten minutes of error into evidence of hours worked.
    const { error } = await getSupabase().rpc(dir === "in" ? "clock_in" : "clock_out", {
      p_tilldelning: id,
    });
    if (error) setError(error.message);
    setReload((r) => r + 1);
    setBusy(null);
  }

  if (shifts === null) return <Screen title="Mina pass" back="/"><span>Laddar…</span></Screen>;

  return (
    <Screen title="Mina pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      {notes.map((n) => (
        <div key={n.id} className="mb-4 border-2 border-black bg-black p-3 text-white">
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

      {shifts.length === 0 && <Empty>Inga pass just nu.</Empty>}

      <div className="flex flex-col gap-4">
        {shifts.map((s) => (
          <section key={s.id} className="border-2 border-black p-4">
            <p className="text-xl font-bold">{s.work_date}</p>
            <p className="text-lg">{s.project_name}</p>
            <p className="mb-1 text-base text-neutral-700">{s.site_address}</p>
            <p className="mb-4 text-lg font-bold">
              {hhmm(s.start_time)}–{hhmm(s.end_time)}
            </p>

            <dl className="mb-4 text-base">
              <div className="flex justify-between border-t-2 border-black py-2">
                <dt>Stämplade in</dt>
                <dd className="font-bold">{stampToTime(s.clock_in) || "—"}</dd>
              </div>
              <div className="flex justify-between border-t-2 border-black py-2">
                <dt>Stämplade ut</dt>
                <dd className="font-bold">{stampToTime(s.clock_out) || "—"}</dd>
              </div>
              <div className="flex justify-between border-y-2 border-black py-2">
                <dt>Timmar</dt>
                <dd className="font-bold">
                  {/*
                    Three states, and the worker is told which. A blank with no
                    reason reads as a fault; "waiting for the Arbetsdagbok" is
                    a status, and the hours only appear once they can no longer
                    change.
                  */}
                  {s.filed && s.confirmed_hours !== null
                    ? `${String(s.confirmed_hours).replace(".", ",")} h`
                    : s.day_confirmed
                      ? "Väntar på arbetsdagbok"
                      : "Inte bekräftat än"}
                </dd>
              </div>
            </dl>

            {!s.clock_in && (
              <Button onClick={() => stamp(s.id, "in")} disabled={busy === s.id}>
                Stämpla in
              </Button>
            )}
            {s.clock_in && !s.clock_out && (
              <Button onClick={() => stamp(s.id, "out")} disabled={busy === s.id}>
                Stämpla ut
              </Button>
            )}
            {s.clock_in && s.clock_out && (
              <p className="text-center text-lg font-bold">Klart för dagen</p>
            )}
          </section>
        ))}
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <MinaPass />
    </AuthGate>
  );
}
