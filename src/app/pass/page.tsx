"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Empty, Input, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";
import {
  addDays, hhmm, longDayHeading, passEndAt, passStartAt, stockholmToday,
} from "@/lib/dates";

type Pass = {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  headcount: number;
  project_id: string;
  project: { name: string } | null;
};

/**
 * Alla Pass -- every shift, by day.
 *
 * A month at a time, forward from today, because a list of every shift the
 * company has ever run is not a thing anyone scrolls. The calendar is where
 * you go to see shape; this is where you go to read one.
 *
 * Scoped by RLS, not here: an admin sees every project's shifts, an
 * arbetsledare sees the ones on projects they run, and an arbetare sees
 * nothing at all -- which is why this is not in their menu.
 *
 * STÄNG PASS lives here and nowhere else. A pass that is RUNNING is the only
 * one it appears on: one that has not started is a plan and is deleted, one
 * that has finished is a fact and is confirmed. Three different acts, and
 * keeping them on three different screens is what stops the wrong one being
 * reached for.
 */
function AllaPass() {
  const { account } = useAccount();
  const [from, setFrom] = useState(() => stockholmToday());
  const [rows, setRows] = useState<Pass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** The pass whose closing question is open, and the answer being typed. */
  const [closing, setClosing] = useState<Pass | null>(null);
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  /** Re-read on a timer so a pass stops being closable the minute it ends. */
  const [now, setNow] = useState(() => Date.now());

  const to = addDays(from, 30);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("pass")
        .select("id, work_date, start_time, end_time, headcount, project_id, project(name)")
        .is("deleted_at", null)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date")
        .order("start_time");

      if (!live) return;
      if (error) { setError(error.message); setRows([]); return; }
      setRows((data ?? []) as unknown as Pass[]);
    })();
    return () => { live = false; };
  }, [from, to, reload]);

  // A minute is fine here. Unlike Nästa Pass this is a control appearing and
  // disappearing rather than the answer to "where am I next", and close_pass
  // refuses a finished pass anyway -- the timer keeps the screen honest, the
  // database is what keeps it correct.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  /** Started, not finished. The only state Stäng Pass belongs on. */
  const running = (p: Pass) =>
    passStartAt(p.work_date, p.start_time).getTime() <= now &&
    passEndAt(p.work_date, p.start_time, p.end_time).getTime() > now;

  function ask(p: Pass) {
    setNote(null);
    setError(null);
    // Prefilled from what has elapsed, and editable -- invariant 1. A number
    // somebody must accept or correct is not a derived number.
    const worked = (now - passStartAt(p.work_date, p.start_time).getTime()) / 3600000;
    setHours(String(Math.max(0, Math.round(worked * 2) / 2)).replace(".", ","));
    setClosing(p);
  }

  async function close() {
    if (!closing) return;
    setBusy(true);
    setError(null);
    const { error: cErr } = await getSupabase().rpc("close_pass", {
      p_pass: closing.id,
      p_hours: Number(hours.replace(",", ".")),
    });
    setBusy(false);
    if (cErr) { setError(cErr.message); return; }
    setNote(`Passet är stängt. ${hours} h är loggade på alla som stämplade in.`);
    setClosing(null);
    setReload((r) => r + 1);
  }

  const byDate = new Map<string, Pass[]>();
  for (const p of rows ?? []) {
    if (!byDate.has(p.work_date)) byDate.set(p.work_date, []);
    byDate.get(p.work_date)!.push(p);
  }

  return (
    <Screen title="Alla Pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="ok">{note}</Notice>}

      {/*
        The question, over a darkened page, because it is about a shift people
        are standing on right now. It asks for the hours before it does
        anything -- closing without logging them would throw away the only
        record of a day that was half worked.
      */}
      {closing && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Stäng pass"
        >
          <div className="mx-auto w-full max-w-md border-2 border-black bg-white p-4">
            <h2 className="mb-1 text-xl font-bold">
              Vill du logga tiden detta passet har jobbat?
            </h2>
            <p className="mb-4 text-base">
              {closing.project?.name ?? "Projekt"} ·{" "}
              {hhmm(closing.start_time)}–{hhmm(closing.end_time)}
            </p>

            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-bold uppercase tracking-wide">
                Timmar
              </span>
              <span className="mb-1 block text-base text-neutral-700">
                Loggas på alla som stämplade in. De som aldrig kom tas bort från
                passet.
              </span>
              <Input
                center
                inputMode="decimal"
                value={hours}
                aria-label="Timmar passet har jobbat"
                onChange={(e) => setHours(e.target.value)}
              />
            </label>

            <div className="flex flex-col gap-2">
              <Button onClick={close} disabled={busy}>
                {busy ? "Stänger…" : "Stäng passet"}
              </Button>
              <Button variant="outline" onClick={() => setClosing(null)} disabled={busy}>
                Avbryt
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Tidigare"
          onClick={() => setFrom((f) => addDays(f, -30))}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ‹
        </button>
        <span className="text-base font-bold">{from} – {to}</span>
        <button
          type="button"
          aria-label="Senare"
          onClick={() => setFrom((f) => addDays(f, 30))}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ›
        </button>
      </div>

      {rows === null && <p className="text-base">Laddar…</p>}
      {rows !== null && rows.length === 0 && <Empty>Inga pass i den här perioden.</Empty>}

      <div className="flex flex-col gap-6">
        {[...byDate.entries()].map(([date, list]) => (
          <section key={date}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
              {longDayHeading(date)}
            </h2>
            <div className="flex flex-col gap-2">
              {list.map((p) => (
                <div key={p.id} className="border-2 border-black">
                  <Link href={`/dag?datum=${p.work_date}`} className="block p-4">
                    <p className="text-lg font-bold">{p.project?.name ?? "Projekt"}</p>
                    <p className="text-base">
                      {hhmm(p.start_time)}–{hhmm(p.end_time)} · {p.headcount}{" "}
                      {p.headcount === 1 ? "plats" : "platser"}
                      {running(p) && <span className="font-bold"> · Pågår nu</span>}
                    </p>
                  </Link>

                  {/* Admin only, and only while it is actually running. The
                      database refuses it either way -- close_pass checks the
                      clock itself -- so this is the courtesy, not the rule. */}
                  {account?.role === "admin" && running(p) && (
                    <div className="border-t-2 border-black p-3">
                      <button
                        type="button"
                        onClick={() => ask(p)}
                        disabled={busy}
                        className="min-h-[56px] w-full border-2 border-black px-3 text-base font-bold disabled:opacity-30"
                      >
                        Stäng Pass
                      </button>
                    </div>
                  )}
                </div>
              ))}
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
      <AllaPass />
    </AuthGate>
  );
}
