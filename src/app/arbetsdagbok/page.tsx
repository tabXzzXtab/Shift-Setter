"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { ArbetsdagbokDocument } from "@/components/arbetsdagbok-document";
import { Button, Field, Input, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, stockholmToday } from "@/lib/dates";
import type { DocDay, DocPayload } from "@/lib/doc/arbetsdagbok";

type Project = {
  id: string;
  name: string;
  bestallare_address: string;
  bestallare_bolag: string;
  bestallare_orgnr: string;
};

/**
 * Generera Arbetsdagbok.
 *
 * The date range is chosen per export, because a project runs open-ended and
 * the admin logs it in slices. Generated ranges are remembered, so an overlap
 * is warned about -- a warning, not a block: re-issuing a document is
 * legitimate, it just must never happen unknowingly.
 *
 * The no-empty-cells rule is NOT checked here. Inserting the arbetsdagbok row
 * IS the generation, and the database refuses it with a message naming exactly
 * what is missing. Checking in the client as well would be a second opinion
 * that could disagree with the only one that matters.
 */
function Arbetsdagbok() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState(addDays(stockholmToday(), -7));
  const [to, setTo] = useState(stockholmToday());
  const [overlap, setOverlap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<DocPayload | null>(null);

  useEffect(() => {
    getSupabase()
      .from("project")
      .select("id, name, bestallare_address, bestallare_bolag, bestallare_orgnr")
      .order("name")
      .then(({ data }) => {
        const rows = (data ?? []) as Project[];
        setProjects(rows);
        if (rows.length === 1) setProjectId(rows[0]!.id);
      });
  }, []);

  // Half-open [from, to+1). Invariant 9: adjacent documents abut without
  // overlapping by a day, and the picker stays inclusive for the human.
  const covered = `[${from},${addDays(to, 1)})`;

  useEffect(() => {
    if (!projectId) return;
    let active = true;

    void (async () => {
      const { data } = await getSupabase()
        .from("arbetsdagbok")
        .select("covered")
        .eq("project_id", projectId);

      if (!active) return;
      const hit = (data ?? []).find((r) => {
        const m = /^\[(.+),(.+)\)$/.exec(String(r.covered));
        if (!m) return false;
        return m[1]! < addDays(to, 1) && from < m[2]!;
      });
      setOverlap(hit ? String(hit.covered).replace(/[[)]/g, "").replace(",", " – ") : null);
    })();

    return () => { active = false; };
  }, [projectId, from, to]);

  async function generate() {
    setBusy(true);
    setError(null);
    const sb = getSupabase();

    // The database is the gate. If anything is missing this fails, and the
    // message says what.
    const { error: gErr } = await sb.from("arbetsdagbok").insert({
      project_id: projectId,
      covered,
      generated_by: (await sb.auth.getUser()).data.user!.id,
    });

    if (gErr) { setError(gErr.message); setBusy(false); return; }

    const project = projects.find((p) => p.id === projectId)!;

    const { data: passes } = await sb
      .from("pass")
      .select("id, work_date, start_time, end_time")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date");

    const { data: assignments } = await sb
      .from("tilldelning")
      .select("pass_id, worker_id, confirmed_hours")
      .in("pass_id", (passes ?? []).map((p) => p.id))
      .is("released_at", null);

    const { data: roster } = await sb.from("worker_roster").select("id, name");
    const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

    const { data: days } = await sb
      .from("project_day")
      .select("work_date, vad_vi_gjorde")
      .eq("project_id", projectId)
      .gte("work_date", from)
      .lte("work_date", to);

    const gjorde = new Map((days ?? []).map((d) => [d.work_date, d.vad_vi_gjorde ?? ""]));

    const byDate = new Map<string, DocDay>();
    for (const p of passes ?? []) {
      const day = byDate.get(p.work_date) ?? { date: p.work_date, rows: [] };
      for (const a of (assignments ?? []).filter((x) => x.pass_id === p.id)) {
        day.rows.push({
          arbetare: names.get(a.worker_id) ?? "",
          hours: String(a.confirmed_hours ?? "").replace(".", ","),
          passTider: `${hhmm(p.start_time)}–${hhmm(p.end_time)}`,
          // Written once per day, repeated down every row of that day's table.
          vadViGjorde: gjorde.get(p.work_date) ?? "",
        });
      }
      byDate.set(p.work_date, day);
    }

    setPayload({
      cover: {
        adress: project.bestallare_address,
        bolag: project.bestallare_bolag,
        orgnr: project.bestallare_orgnr,
        project: project.name,
      },
      days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    });
    setBusy(false);
  }

  if (payload) {
    return (
      <>
        <div className="no-print mx-auto w-full max-w-md p-4">
          <Button onClick={() => window.print()}>Skriv ut / Spara som PDF</Button>
          <div className="mt-3">
            <Button variant="outline" onClick={() => setPayload(null)}>Tillbaka</Button>
          </div>
        </div>
        <div className="ad-doc mx-auto w-full max-w-[210mm]">
          <ArbetsdagbokDocument payload={payload} />
        </div>
      </>
    );
  }

  return (
    <Screen title="Arbetsdagbok" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <Field label="Projekt">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Välj…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Från och med">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>

      <Field label="Till och med">
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>

      {overlap && (
        <Notice kind="info">
          Du har redan gjort en arbetsdagbok som dokumenterar {overlap}. Vill du gå vidare?
        </Notice>
      )}

      <div className="mt-6">
        <Button onClick={generate} disabled={busy || !projectId || to < from}>
          {busy ? "Genererar…" : "Generera Arbetsdagbok"}
        </Button>
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Arbetsdagbok />
    </AuthGate>
  );
}
