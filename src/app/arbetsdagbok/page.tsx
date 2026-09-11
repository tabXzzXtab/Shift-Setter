"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AuthGate } from "@/components/auth-gate";
import { ArbetsdagbokDocument } from "@/components/arbetsdagbok-document";
import {
  C, Card, PrimaryButton, SecondaryButton, SoftField, SoftInput, SoftNotice,
  SoftScreen, SoftSelect,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, hhmm, stampToTime, stockholmToday } from "@/lib/dates";
import { Bristsurvey, fetchGaps, hasGaps, type Gaps } from "@/components/bristsurvey";
import type { DocDay, DocPayload } from "@/lib/doc/arbetsdagbok";
import { arbetsdagbokFilename, buildArbetsdagbokPdf } from "@/lib/doc/pdf";
import { fel } from "@/lib/fel";

/**
 * The marker on the date rail. Filled rather than outlined, because it is not
 * an icon the admin can press -- it is a point on a line, and an outline here
 * would read as a third control between the two dates.
 */
const RailPin = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden focusable="false">
    <path
      d="M12 23.5c0 0 7.6-8.7 7.6-14.4a7.6 7.6 0 1 0-15.2 0C4.4 14.8 12 23.5 12 23.5z"
      fill={C.accent}
    />
    <circle cx="12" cy="9" r="2.8" fill={C.surface} />
  </svg>
);

/**
 * One leg of the rail: the marker, the dashed line that reaches the next one,
 * and the field itself at full width.
 *
 * The line is anchored to the INPUT, never to the row -- 13px is half a marker,
 * 39px is half a marker plus the 26px that sits above the input's centre -- so
 * a label that wraps to two lines moves the field and the marker together and
 * the dashes still meet.
 */
function RailLeg({
  label, first, children,
}: {
  label: string;
  /** The first leg's line runs downward out of its marker; the second's runs
   *  upward into it, across the 12px gap between them. */
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex gap-[12px] ${first ? "" : "mt-[12px]"}`}>
      <div className="relative w-[26px] shrink-0">
        <span
          aria-hidden
          className={`absolute w-0 border-l-2 border-dashed ${
            first ? "bottom-0 h-[13px]" : "-top-[12px] bottom-[39px]"
          }`}
          style={{ left: "12px", borderColor: C.chevron }}
        />
        <span className="absolute bottom-[13px] left-0">
          <RailPin />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <SoftField label={label}>{children}</SoftField>
      </div>
    </div>
  );
}

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
      setError(fel(e, "Kunde inte läsa vad som saknas i perioden. Ladda om sidan, eller kontakta administratören."));
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

    if (gErr) {
      setError(fel(gErr, "Arbetsdagboken kunde inte skapas. Kontakta administratören."));
      setBusy(false);
      return;
    }

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
      .select("pass_id, worker_id, confirmed_hours, clock_in, clock_out, source, own_start, own_end")
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
          // An auto-assigned arbetsledare's day is the workers' envelope, not
          // the times of whichever pass their row hangs on (Step 4b). The
          // document does not mark the row as different -- the customer is
          // buying hours on their site -- but the times have to be the ones
          // that person was actually there for.
          passTider:
            surveyed.has(p.work_date) && a.clock_in && a.clock_out
              ? `${stampToTime(a.clock_in)}–${stampToTime(a.clock_out)}`
              : a.source === "ledare" && a.own_start && a.own_end
                ? `${hhmm(a.own_start)}–${hhmm(a.own_end)}`
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
      setError(fel(e, "PDF-filen kunde inte skapas. Försök igen, eller kontakta administratören."));
    }
    setDownloading(false);
  }

  if (payload) {
    return (
      <>
        {/* The toolbar is the app; the sheet below it is the document. Only
            the toolbar gets the design language -- the preview must not drift
            from the PDF, which is the thing that actually leaves the building
            (CLAUDE.md, "The Arbetsdagbok has two renderers"). */}
        <div
          className="no-print mx-auto w-full max-w-[390px] px-4 py-4"
          style={{
            background: C.ground,
            color: C.ink,
            fontFamily: "var(--font-inter), system-ui, sans-serif",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {error && <div className="pb-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}
          {saved && !error && (
            <div className="pb-[10px]"><SoftNotice tone="live">Nedladdad: {saved}</SoftNotice></div>
          )}
          <PrimaryButton onClick={download} disabled={downloading}>
            {downloading ? "Skapar PDF…" : "Ladda ner PDF"}
          </PrimaryButton>
          <div className="pt-[10px]">
            <SecondaryButton onClick={() => { setPayload(null); setSaved(null); }}>
              Tillbaka
            </SecondaryButton>
          </div>
        </div>
        <div className="ad-doc mx-auto w-full max-w-[210mm]">
          <ArbetsdagbokDocument payload={payload} />
        </div>
      </>
    );
  }

  return (
    <SoftScreen
      title="Arbetsdagbok"
      back="/"
      subtitle="En period i taget. Perioden skrivs på dokumentets försättsblad."
    >
      {gaps && (
        <Bristsurvey
          gaps={gaps}
          from={from}
          to={to}
          onAbandon={() => setGaps(null)}
          onDone={() => { setGaps(null); void produce(); }}
        />
      )}

      {error && <div className="px-4 pb-[4px] pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <div className="mb-[14px]">
            <SoftField label="Projekt">
              <SoftSelect value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Välj…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </SoftSelect>
            </SoftField>
          </div>

          {/* From and to are one period, not two independent fields, so they are
              drawn as a route: two markers on one dashed line. Side by side
              they also broke the card -- a native date control keeps the width
              its own text needs and runs out of anything narrower (SoftInput),
              and half a phone is narrower. Down the rail each date gets the
              full width it wanted. */}
          <RailLeg label="Från och med" first>
            <SoftInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </RailLeg>
          <RailLeg label="Till och med">
            <SoftInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </RailLeg>
        </Card>
      </div>

      {/* A warning, not a block. Re-issuing a document is legitimate -- it just
          must never happen unknowingly. */}
      {overlap && (
        <div className="px-4 pt-[14px]">
          <SoftNotice tone="warn">
            Du har redan gjort en arbetsdagbok som dokumenterar {overlap}. Vill du gå vidare?
          </SoftNotice>
        </div>
      )}

      <div className="px-4 pt-[22px]">
        <PrimaryButton onClick={generate} disabled={busy || !projectId || to < from}>
          {busy ? "Genererar…" : "Generera Arbetsdagbok"}
        </PrimaryButton>
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Arbetsdagbok />
    </AuthGate>
  );
}
