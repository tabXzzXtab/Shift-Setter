"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppBar, type MenuItem } from "./app-bar";
import { NastaPassCard } from "./nasta-pass-card";
import { ActionLink, Landing, Notice } from "./ui";
import { getSupabase } from "@/lib/supabase/client";
import { pendingDays } from "@/lib/pending-days";
import { longDayHeading } from "@/lib/dates";

const MENU: MenuItem[] = [
  { href: "/min-kalender", label: "Min Pass Kalender" },
  { href: "/mina-pass", label: "Mina Pass" },
  // Both roles read the log, scoped to the projects they are on -- day_history
  // answers the same question for the leader and the owner, so this is the
  // same page the admin opens and not a second version of it.
  { href: "/historik", label: "Bekräftelse Historik" },
];

type Waiting = { key: string; date: string; workers: string[]; hours: number };

/** Swedish decimal comma, and no trailing ",0" on a whole number. */
const hh = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};

/**
 * The arbetsledare's landing page.
 *
 * One button, one widget and one card. Bekräfta Pass is a widget rather than a
 * link because a leader should see the size of the debt without pressing
 * anything -- a list that says "3 dagar väntar" and names them is a different
 * thing from a menu entry that might be empty.
 *
 * Nästa Pass is READ ONLY, and that is a decision rather than an omission: a
 * leader's days are auto-assigned (Step 4b), so there is nothing to accept,
 * and a button that only ever agrees with what is already true teaches people
 * to press without reading.
 *
 * Alla Projekt and Alla Arbetare are not in the menu. They stay reachable from
 * the project rows, and neither is a leader's daily work.
 */
export function HomeArbetsledare() {
  const [waiting, setWaiting] = useState<Waiting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        // The same definition the Bekräfta Pass page uses, so the preview and
        // the page it opens can never disagree about what is waiting.
        const days = await pendingDays();
        const shown = days.slice(0, 3);

        const sb = getSupabase();
        const passIds = shown.flatMap((d) => d.passes.map((p) => p.id));

        const [{ data: assignments }, { data: roster }] = await Promise.all([
          passIds.length
            ? sb.from("tilldelning")
                .select("pass_id, worker_id")
                .in("pass_id", passIds)
                .is("released_at", null)
            : Promise.resolve({ data: [] as { pass_id: string; worker_id: string }[] }),
          sb.from("worker_roster").select("id, name"),
        ]);

        if (!live) return;

        const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));
        setWaiting(
          shown.map((d) => {
            const ids = new Set(d.passes.map((p) => p.id));
            const here = (assignments ?? []).filter((a) => ids.has(a.pass_id));
            return {
              key: `${d.project_id}|${d.work_date}`,
              date: d.work_date,
              workers: [...new Set(here.map((a) => names.get(a.worker_id) ?? "Okänd"))]
                .sort((a, b) => a.localeCompare(b, "sv")),
              hours: d.passes.reduce((s, p) => s + p.planned_hours, 0),
            };
          }),
        );
      } catch (e) {
        if (live) { setError(e instanceof Error ? e.message : "Kunde inte läsa passen."); setWaiting([]); }
      }
    })();

    return () => { live = false; };
  }, []);

  const pending = (waiting ?? []).length > 0;

  return (
    <Landing>
      <AppBar title="Arbetsledare" menu={MENU} />

      {error && <Notice kind="error">{error}</Notice>}

      <div className="mb-8">
        <ActionLink href="/pass/ny">Skapa Pass</ActionLink>
      </div>

      {/* ---- Bekräfta Pass, as a widget ------------------------------------ */}
      <Link href="/bekrafta" className="mb-8 block border-2 border-black">
        <div className="flex items-center justify-between gap-3 border-b-2 border-black p-4">
          <span className="text-lg font-bold">Bekräfta Pass</span>
          {/* The one red thing in the app, and it is carrying meaning: there is
              work outstanding and it is this leader's. */}
          {pending && (
            <span
              role="status"
              aria-label={`${waiting!.length} dagar väntar på bekräftelse`}
              className="h-4 w-4 shrink-0 rounded-full bg-[#d62728]"
            />
          )}
        </div>

        {waiting === null && <p className="p-4 text-base">Laddar…</p>}

        {waiting !== null && waiting.length === 0 && (
          <p className="p-4 text-base">Inget väntar på dig.</p>
        )}

        {(waiting ?? []).map((d) => (
          <div key={d.key} className="border-b border-neutral-300 p-4 last:border-b-0">
            <p className="text-base font-bold">{longDayHeading(d.date)}</p>
            <p className="text-base">
              {d.workers.length > 0 ? d.workers.join(", ") : "Ingen tilldelad"}
            </p>
            <p className="text-base text-neutral-700">{hh(d.hours)} h</p>
          </div>
        ))}
      </Link>

      <NastaPassCard />
    </Landing>
  );
}
