"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AppBar, type MenuItem } from "./app-bar";
import { ActionLink, Landing, Notice } from "./ui";
import { PinIcon } from "./icons";
import { getSupabase } from "@/lib/supabase/client";
import { pendingDays } from "@/lib/pending-days";
import { addDays, longDayHeading, stockholmToday } from "@/lib/dates";

// Leaflet reaches for `window` on import, and this app is prerendered at build
// time. Loaded only in the browser, and only once there is an address to show.
const ProjectMap = dynamic(() => import("./project-map"), { ssr: false });

const MENU: MenuItem[] = [
  { href: "/min-kalender", label: "Min Pass Kalender" },
  { href: "/mina-pass", label: "Mina Pass" },
  // Both roles read the log, scoped to the projects they are on -- day_history
  // answers the same question for the leader and the owner, so this is the
  // same page the admin opens and not a second version of it.
  { href: "/historik", label: "Bekräftelse Historik" },
];

type Waiting = { key: string; date: string; workers: string[]; hours: number };
type Next = { project: string; address: string; date: string } | null;

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
  const [next, setNext] = useState<Next | undefined>(undefined);
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

    void (async () => {
      // A leader is also a worker and holds shifts, so their next one is read
      // from the same view a worker reads. site_address is the PROJECT's
      // address -- where the work is -- and not the beställare's, which is
      // where the invoice goes.
      const today = stockholmToday();
      const { data } = await getSupabase()
        .from("my_shift")
        .select("project_name, site_address, work_date")
        .gte("work_date", today)
        .lte("work_date", addDays(today, 365))
        .order("work_date")
        .limit(1);

      if (!live) return;
      const s = (data ?? [])[0];
      setNext(s ? { project: s.project_name ?? "Projekt", address: s.site_address ?? "", date: s.work_date! } : null);
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

      {/* ---- Nästa Pass ---------------------------------------------------- */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Nästa Pass</h2>

      {next === undefined && <p className="text-base">Laddar…</p>}
      {next === null && (
        <p className="border-2 border-dashed border-black p-6 text-center text-base">
          Inga kommande pass.
        </p>
      )}

      {next && (
        // The whole card is the link. Tapping it hands the address to whatever
        // the phone uses for navigation rather than trying to be a map itself.
        <a
          href={`https://maps.google.com/maps?q=${encodeURIComponent(next.address)}`}
          target="_blank"
          rel="noreferrer"
          className="block border-2 border-black"
        >
          {next.address && <ProjectMap address={next.address} />}
          <div className="p-4">
            <p className="text-xl font-bold">{next.project}</p>
            <p className="flex items-start gap-2 text-base">
              <span className="mt-[2px] shrink-0"><PinIcon /></span>
              <span>{next.address}</span>
            </p>
            <p className="mt-2 text-base font-bold">{longDayHeading(next.date)}</p>
          </div>
        </a>
      )}
    </Landing>
  );
}
