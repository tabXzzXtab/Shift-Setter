"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Empty, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading } from "@/lib/dates";

type Act = { action: string; note: string | null; acted_at: string };

type Row = { worker_name: string; tider: string; hours: number | null };

type Day = {
  key: string;
  project_id: string;
  project_name: string;
  work_date: string;
  vad_vi_gjorde: string;
  stage: string | null;
  route: string | null;
  confirmed_by_name: string | null;
  reviewed_by_name: string | null;
  filed: boolean;
  rows: Row[];
  log: Act[];
};

/** How a day was closed, in the words the record actually distinguishes. */
function routeLabel(route: string | null, reviewer: string | null): string {
  if (route === "bristsurvey") return "Bristsurvey — admin rekonstruerade dagen";
  if (reviewer) return "Bekräftad av arbetsledaren, godkänd av admin";
  return "Bekräftad av arbetsledaren";
}

/**
 * Bekräftelse Historik -- the readable log of days that are finished with.
 *
 * A day arrives here by either of two routes and can arrive by both: the admin
 * approved it at stage 2, or an Arbetsdagbok was generated over it, which
 * consumes a day whatever stage it had reached.
 *
 * WHAT IS SHOWN IS CURRENT, NOT PRINTED. If the admin edited a day at stage 2
 * after the document was produced, the new figures show here and the PDF does
 * not change -- it is a snapshot of the moment it was made, and regenerating
 * the range is how a corrected document is obtained. The two disagreeing is
 * intended.
 *
 * Admin and arbetsledare both read it. The scoping is the database's:
 * public.day_history answers the same question for both, so a leader and the
 * owner can never be looking at two different versions of the same log.
 */
function Historik() {
  const [days, setDays] = useState<Day[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const sb = getSupabase();

      const { data: history, error: hErr } = await sb
        .from("day_history")
        .select("*")
        .order("work_date", { ascending: false })
        .limit(60);

      if (!active) return;
      if (hErr) { setError(hErr.message); setDays([]); return; }
      if (!history || history.length === 0) { setDays([]); return; }

      const projectIds = [...new Set(history.map((h) => h.project_id!).filter(Boolean))];
      const dates = [...new Set(history.map((h) => h.work_date!).filter(Boolean))];

      // Two coarse filters and an exact match in the browser. PostgREST has no
      // tuple IN, and asking per day would be one round trip per row.
      const { data: passes } = await sb
        .from("pass")
        .select("id, project_id, work_date, start_time, end_time")
        .in("project_id", projectIds)
        .in("work_date", dates);

      const { data: assignments } = await sb
        .from("tilldelning")
        .select("id, pass_id, worker_id, confirmed_hours")
        .in("pass_id", (passes ?? []).map((p) => p.id))
        .is("released_at", null);

      const { data: roster } = await sb.from("worker_roster").select("id, name");

      const { data: log } = await sb
        .from("day_review")
        .select("project_id, work_date, action, note, acted_at")
        .in("project_id", projectIds)
        .in("work_date", dates)
        .order("acted_at");

      if (!active) return;

      const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));
      const passById = new Map((passes ?? []).map((p) => [p.id, p]));

      setDays(
        history.map((h) => {
          const key = `${h.project_id}|${h.work_date}`;

          const rows: Row[] = (assignments ?? [])
            .filter((a) => {
              const p = passById.get(a.pass_id);
              return p && p.project_id === h.project_id && p.work_date === h.work_date;
            })
            .map((a) => {
              const p = passById.get(a.pass_id)!;
              return {
                worker_name: names.get(a.worker_id) ?? "Okänd",
                tider: `${hhmm(p.start_time)}–${hhmm(p.end_time)}`,
                hours: a.confirmed_hours === null ? null : Number(a.confirmed_hours),
              };
            })
            .sort((a, b) => a.worker_name.localeCompare(b.worker_name, "sv"));

          return {
            key,
            project_id: h.project_id!,
            project_name: h.project_name ?? "Projekt",
            work_date: h.work_date!,
            vad_vi_gjorde: h.vad_vi_gjorde ?? "",
            stage: h.stage,
            route: h.confirmed_via,
            confirmed_by_name: h.confirmed_by_name,
            reviewed_by_name: h.reviewed_by_name,
            filed: h.filed ?? false,
            rows,
            log: (log ?? [])
              .filter((l) => `${l.project_id}|${l.work_date}` === key)
              .map((l) => ({ action: l.action, note: l.note, acted_at: l.acted_at })),
          };
        }),
      );
    })();

    return () => { active = false; };
  }, []);

  if (days === undefined) {
    return <Screen title="Bekräftelse historik" back="/"><span>Laddar…</span></Screen>;
  }

  return (
    <Screen title="Bekräftelse historik" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      {days.length === 0 ? (
        <Empty>Inga avslutade dagar än.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((d) => (
            <section key={d.key} className="border-2 border-black p-4">
              <p className="text-xl font-bold">{longDayHeading(d.work_date)}</p>
              <p className="mb-3 text-lg">{d.project_name}</p>

              <p className="mb-1 text-base">
                {d.stage === "admin_confirmed" ? "Godkänd" : "Bekräftad"} ·{" "}
                {routeLabel(d.route, d.reviewed_by_name)}
              </p>
              <p className="mb-3 text-sm text-neutral-600">
                {d.confirmed_by_name ?? "—"}
                {d.reviewed_by_name ? ` · godkänd av ${d.reviewed_by_name}` : ""}
                {d.filed ? " · arkiverad i en arbetsdagbok" : ""}
              </p>

              <ul className="mb-3 flex flex-col gap-1">
                {d.rows.map((r, i) => (
                  <li key={i} className="flex justify-between border-b border-neutral-300 py-1 text-base">
                    <span>{r.worker_name}</span>
                    <span className="tabular-nums">
                      {r.tider} · {r.hours === null ? "—" : String(r.hours).replace(".", ",")} h
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-base">{d.vad_vi_gjorde}</p>

              {d.log.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 border-t-2 border-black pt-2">
                  {d.log.map((a, i) => (
                    <li key={i} className="text-sm text-neutral-700">
                      {a.action === "rejected" ? "Underkänd" : "Godkänd"}{" "}
                      {a.acted_at.slice(0, 10)}
                      {a.note ? ` — ${a.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Historik />
    </AuthGate>
  );
}
