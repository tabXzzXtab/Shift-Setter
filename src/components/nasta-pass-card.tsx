"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PinIcon } from "./icons";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, longDayHeading, stockholmToday } from "@/lib/dates";

// Leaflet reaches for `window` on import, and this app is prerendered at build
// time. Loaded only in the browser, and only once there is an address to show.
const ProjectMap = dynamic(() => import("./project-map"), { ssr: false });

type Next = { project: string; address: string; date: string } | null;

/**
 * Nästa Pass -- where this person is next, for whichever role is looking.
 *
 * One component and one query, because "my next shift" is one question. An
 * arbetsledare is also a worker who holds shifts, so both roles read it from
 * my_shift and neither can end up with its own slightly different answer.
 *
 * READ ONLY, and that is a decision rather than an omission. A leader's days
 * are auto-assigned so there is nothing to accept; a worker's next shift is
 * one they already hold. A button that only ever agrees with what is already
 * true teaches people to press without reading.
 *
 * site_address is the PROJECT's address -- where the work is -- and never the
 * beställare's, which is where the invoice goes.
 */
export function NastaPassCard() {
  const [next, setNext] = useState<Next | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
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
      setNext(
        s
          ? {
              project: s.project_name ?? "Projekt",
              address: s.site_address ?? "",
              date: s.work_date!,
            }
          : null,
      );
    })();
    return () => { live = false; };
  }, []);

  return (
    <>
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
    </>
  );
}
