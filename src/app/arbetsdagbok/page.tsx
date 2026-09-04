"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { ArbetsdagbokDocument } from "@/components/arbetsdagbok-document";
import { Button, Field, Input, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, stampToTime, stockholmToday } from "@/lib/dates";
import { Bristsurvey, fetchGaps, hasGaps, type Gaps } from "@/components/bristsurvey";
import type { DocDay, DocPayload } from "@/lib/doc/arbetsdagbok";
import { arbetsdagbokFilename, buildArbetsdagbokPdf } from "@/lib/doc/pdf";

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
 * The no-empty-cells rule is not decided here. Inserting the arbetsdagbok row
 * IS the generation and the database refuses it outright; what this screen
 * does first is ASK the database what is in the way, and open the bristsurvey
 * on the answer. Same source of truth, a different question -- working it out
 * in the browser would be a second opinion that could disagree with the only
 * one that matters.
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
  const [downloading, setDownloading] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [gaps, setGaps] = useState<Gaps | null>(null);

  useEffect(() => {
    getSupabase()
      .from("project")
      .select("id, name, bestallare_address, bestallare_bolag, bestallare_orgnr")
      .order("name")
      .then(({ data }) => {
        const rows = (data ?? []) as Project[];
        setProjects(rows);
        // The document lives inside the project (spec Section 1), so the admin
        // arrives here by pressing a project row and should not have to pick it
        // again. Read from location rather than useSearchParams: this is a
        // static export, and the value is only needed once, after mount.
        const asked = new URLSearchParams(window.location.search).get("projekt");
        if (asked && rows.some((r) => r.id === asked)) setProjectId(asked);
        else if (rows.length === 1) setProjectId(rows[0]!.id);
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

  /**
   * Stopped before generation, not after: the spec's warning is about what is
   * ABOUT to be booked, and a failed insert would already have been an attempt
   * to book it.
   */
  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const found = await fetchGaps(projectId, from, to);
      if (hasGaps(found)) { setGaps(found); setBusy(false); return; }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunde inte läsa vad som saknas.");
      setBusy(false);
      return;
    }
    await produce();
  }

  async function produce() {
    setBusy(true);
    setError(null);
    const sb = getSupabase();

    // The database is still the gate. If anything is missing this fails, and
    // the message says what.
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
      .select("pass_id, worker_id, confirmed_hours, clock_in, clock_out")
      .in("pass_id", (passes ?? []).map((p) => p.id))
      .is("released_at", null);

    const { data: roster } = await sb.from("worker_roster").select("id, name");
    const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

    const { data: days } = await sb
      .from("project_day")
      .select("work_date, vad_vi_gjorde, confirmed_via")
      .eq("project_id", projectId)
      .gte("work_date", from)
      .lte("work_date", to);

    const gjorde = new Map((days ?? []).map((d) => [d.work_date, d.vad_vi_gjorde ?? ""]));
    // On a surveyed day the times printed are the ones that were REGISTERED --
    // the stamps where a worker made them, the planned span where they did not.
    // A leader-confirmed day prints the planned span, because a leader stood
    // behind those times; on a surveyed day nobody did.
    const surveyed = new Set(
      (days ?? []).filter((d) => d.confirmed_via === "bristsurvey").map((d) => d.work_date),
    );

    const byDate = new Map<string, DocDay>();
    for (const p of passes ?? []) {
      const day = byDate.get(p.work_date) ?? { date: p.work_date, rows: [] };
      for (const a of (assignments ?? []).filter((x) => x.pass_id === p.id)) {
        day.rows.push({
          arbetare: names.get(a.worker_id) ?? "",
          hours: String(a.confirmed_hours ?? "").replace(".", ","),
          passTider:
            surveyed.has(p.work_date) && a.clock_in && a.clock_out
              ? `${stampToTime(a.clock_in)}–${stampToTime(a.clock_out)}`
              : `${hhmm(p.start_time)}–${hhmm(p.end_time)}`,
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

  /**
   * One tap, one file. The PDF is built here and handed to the browser as a
   * blob through an anchor with `download` -- no print dialog, because
   * window.print() cannot be told to save a file and always opens one.
   */
  async function download() {
    if (!payload) return;
    setDownloading(true);
    setError(null);
    try {
      const bytes = await buildArbetsdagbokPdf(payload);
      const name = arbetsdagbokFilename(from, to, payload.cover.project);
      // Uint8Array -> ArrayBuffer slice keeps TypeScript and the Blob
      // constructor agreed about the backing buffer.
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick: Safari needs the URL to still resolve when
      // the click is handled.
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      setSaved(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunde inte skapa PDF-filen.");
    }
    setDownloading(false);
  }

  if (payload) {
    return (
      <>
        <div className="no-print mx-auto w-full max-w-md p-4">
          {error && <Notice kind="error">{error}</Notice>}
          {saved && <Notice kind="ok">Nedladdad: {saved}</Notice>}
          <Button onClick={download} disabled={downloading}>
            {downloading ? "Skapar PDF…" : "Ladda ner PDF"}
          </Button>
          <div className="mt-3">
            <Button
              variant="outline"
              onClick={() => { setPayload(null); setSaved(null); }}
            >
              Tillbaka
            </Button>
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
      {gaps && (
        <Bristsurvey
          gaps={gaps}
          from={from}
          to={to}
          onAbandon={() => setGaps(null)}
          onDone={() => { setGaps(null); void produce(); }}
        />
      )}

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
