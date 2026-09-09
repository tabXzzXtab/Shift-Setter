"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, EmptyState, PrimaryButton, SecondaryButton, SHADOW, SoftDialog, SoftField,
  SoftInput, SoftNotice, SoftScreen, Tag,
} from "@/components/soft";
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
 *
 * SCOPED TO ONE PROJECT by ?projekt=, which is how Alla Projekt's "Kolla pass"
 * opens it. That is a filter and not a boundary: RLS already decides which
 * shifts exist for the caller, and narrowing a list the database has already
 * narrowed cannot widen it. Without the parameter it is every project, as
 * before -- the screen is the same screen either way, which is why it is not
 * a second page.
 */
function AllaPass({ askedProject }: { askedProject: string | null }) {
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
      let q = getSupabase()
        .from("pass")
        .select("id, work_date, start_time, end_time, headcount, project_id, project(name)")
        .is("deleted_at", null)
        .gte("work_date", from)
        .lte("work_date", to);

      if (askedProject) q = q.eq("project_id", askedProject);

      const { data, error } = await q.order("work_date").order("start_time");

      if (!live) return;
      if (error) { setError(error.message); setRows([]); return; }
      setRows((data ?? []) as unknown as Pass[]);
    })();
    return () => { live = false; };
  }, [from, to, reload, askedProject]);

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

  /** The 40px pale arrow the period pager is steered with. */
  const arrow = (dir: -1 | 1, label: string) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => setFrom((f) => addDays(f, dir * 30))}
      className="press-scale flex h-10 w-10 items-center justify-center rounded-[9px] p-0 transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
      style={{ background: C.panel2 }}
    >
      <svg width="8" height="14" viewBox="0 0 9 15" fill="none" aria-hidden>
        <path
          d={dir === -1 ? "M7.5 1.5 2 7.5l5.5 6" : "M1.5 1.5 7 7.5l-5.5 6"}
          stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  return (
    <SoftScreen
      title={askedProject ? (rows?.[0]?.project?.name ?? "Pass") : "Alla Pass"}
      back={askedProject ? "/projekt" : "/"}
      subtitle={askedProject ? "Pass i det här projektet." : undefined}
    >
      {(error || note) && (
        <div className="px-4 pb-[10px] pt-[2px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {note && !error && <SoftNotice tone="live">{note}</SoftNotice>}
        </div>
      )}

      {/*
        The question, over the scrim, because it is about a shift people are
        standing on right now. It asks for the hours before it does anything --
        closing without logging them would throw away the only record of a day
        that was half worked.

        Not in the handoff, which draws no dialog anywhere. Drawn in its
        language instead: the sheet's scrim, a white card, the 64px primary.
      */}
      {closing && (
        <SoftDialog label="Stäng pass">
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Vill du logga tiden detta passet har jobbat?
          </h2>
          <p className="mb-[14px] mt-1 text-[15px] font-medium" style={{ color: C.text2 }}>
            {closing.project?.name ?? "Projekt"} ·{" "}
            {hhmm(closing.start_time)}–{hhmm(closing.end_time)}
          </p>

          <div className="mb-[18px]">
            <SoftField
              label="Timmar"
              help="Loggas på alla som stämplade in. De som aldrig kom tas bort från passet."
              big
            >
              <SoftInput
                inputMode="decimal"
                value={hours}
                aria-label="Timmar passet har jobbat"
                onChange={(e) => setHours(e.target.value)}
              />
            </SoftField>
          </div>

          <div className="mb-[10px]">
            <PrimaryButton onClick={close} disabled={busy}>
              {busy ? "Stänger…" : "Stäng passet"}
            </PrimaryButton>
          </div>
          <SecondaryButton onClick={() => setClosing(null)} disabled={busy}>
            Avbryt
          </SecondaryButton>
        </SoftDialog>
      )}

      {/* ---- the period pager ---------------------------------------------- */}
      <div className="px-4 pt-[2px]">
        <div
          className="flex items-center gap-[10px] rounded-[12px] p-[6px]"
          style={{ background: C.surface, boxShadow: SHADOW.flat }}
        >
          {arrow(-1, "Tidigare")}
          <span className="flex-1 text-center text-[14px] font-bold" style={{ letterSpacing: ".2px" }}>
            {from} – {to}
          </span>
          {arrow(1, "Senare")}
        </div>
      </div>

      {rows === null && (
        <p className="px-5 pt-[14px] text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      )}
      {rows !== null && rows.length === 0 && (
        <div className="px-4 pt-[22px]">
          <EmptyState>Inga pass i den här perioden.</EmptyState>
        </div>
      )}

      {[...byDate.entries()].map(([date, list]) => (
        <section key={date} className="px-4 pt-[22px]">
          <div className="flex items-baseline justify-between px-1 pb-[10px]">
            <h2 className="text-[12px] font-bold uppercase" style={{ letterSpacing: "1px", color: C.text2 }}>
              {longDayHeading(date)}
            </h2>
            <span className="text-[12px] font-bold" style={{ color: C.text2 }}>
              {list.length} pass
            </span>
          </div>

          <div
            className="overflow-hidden rounded-[14px]"
            style={{ background: C.surface, boxShadow: SHADOW.group }}
          >
            {list.map((p, i) => (
              <div key={p.id} data-pass={p.id}>
                {i > 0 && <div className="ml-4 h-px" style={{ background: C.hairline }} />}
                <Link
                  href={`/dag?datum=${p.work_date}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#f6f9ff]"
                  style={{ color: C.ink }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-bold" style={{ letterSpacing: "-.3px" }}>
                      {p.project?.name ?? "Projekt"}
                    </span>
                    <span className="block text-[14px] font-medium" style={{ color: C.text2 }}>
                      {hhmm(p.start_time)}–{hhmm(p.end_time)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-[6px]">
                    {/* Colour is never the only carrier: the running pass gets
                        the live pair AND the word. */}
                    {running(p) && <Tag tone="live">Pågår nu</Tag>}
                    <Tag tone="quiet">
                      {p.headcount} {p.headcount === 1 ? "plats" : "platser"}
                    </Tag>
                  </span>
                </Link>

                {/* Admin only, and only while it is actually running. The
                    database refuses it either way -- close_pass checks the
                    clock itself -- so this is the courtesy, not the rule. */}
                {account?.role === "admin" && running(p) && (
                  <div className="px-4 pb-[14px] pt-1">
                    <button
                      type="button"
                      onClick={() => ask(p)}
                      disabled={busy}
                      className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985] disabled:opacity-40"
                      style={{ background: C.panel2, color: C.inkHover }}
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
    </SoftScreen>
  );
}

/**
 * The project arrives as ?projekt=. useSearchParams needs a Suspense boundary
 * in a statically exported app -- the query string is not known when the page
 * is prerendered, only when a browser opens it.
 *
 * Shape-checked before it is used: a uuid, or nothing.
 */
function AllaPassFromUrl() {
  const asked = useSearchParams().get("projekt");
  return <AllaPass askedProject={asked && /^[0-9a-f-]{36}$/i.test(asked) ? asked : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <SoftScreen title="Alla Pass" back="/">
            <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
          </SoftScreen>
        }
      >
        <AllaPassFromUrl />
      </Suspense>
    </AuthGate>
  );
}
