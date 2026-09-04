"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Empty, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, longDayHeading, stockholmToday } from "@/lib/dates";

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
 */
function AllaPass() {
  const [from, setFrom] = useState(() => stockholmToday());
  const [rows, setRows] = useState<Pass[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [from, to]);

  const byDate = new Map<string, Pass[]>();
  for (const p of rows ?? []) {
    if (!byDate.has(p.work_date)) byDate.set(p.work_date, []);
    byDate.get(p.work_date)!.push(p);
  }

  return (
    <Screen title="Alla Pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}

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
                <Link
                  key={p.id}
                  href={`/dag?datum=${p.work_date}`}
                  className="block border-2 border-black p-4"
                >
                  <p className="text-lg font-bold">{p.project?.name ?? "Projekt"}</p>
                  <p className="text-base">
                    {hhmm(p.start_time)}–{hhmm(p.end_time)} · {p.headcount}{" "}
                    {p.headcount === 1 ? "plats" : "platser"}
                  </p>
                </Link>
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
