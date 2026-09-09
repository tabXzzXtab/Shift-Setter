"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, EmptyState, PrimaryButton, SecondaryButton, SoftField, SoftInput,
  SoftNotice, SoftScreen, SoftTextarea, Tag,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading, stampToTime } from "@/lib/dates";
import { reviewDays } from "@/lib/review-days";

type Row = {
  /** Step 4b: an auto-assigned arbetsledare, whose span lives on their row. */
  is_leader: boolean;
  tilldelning_id: string;
  pass_id: string;
  worker_name: string;
  start: string;
  end: string;
  hours: number | null;
  clock_in: string | null;
  clock_out: string | null;
};

type Day = {
  project_id: string;
  project_name: string;
  work_date: string;
  vad_vi_gjorde: string;
  came_back: boolean;
  /** Step 5c: 'worker_ansvarig' or 'ingen_ledare'. Null on an ordinary day. */
  flagged_as: string | null;
  rows: Row[];
};

type Edit = { start: string; end: string; hours: string };

/**
 * Granska Pass -- stage 2, and the whole of what the admin may do with a
 * confirmation.
 *
 * Three outcomes and no fourth: approve, edit and approve, reject and send it
 * back with a note. Rejection is the only thing that reopens a day.
 *
 * REVIEWING A CLAIM IS NOT MAKING ONE. Nothing on this screen writes a stage 1
 * confirmation -- the day already carries one, made by the leader who was
 * there, and it stays in their name whichever button is pressed. That is
 * enforced in the database; this screen only refrains from pretending
 * otherwise.
 *
 * Oldest first, one day at a time, the same shape as the leader's queue. An
 * owner reviewing a fortnight of days should not have to decide where to look.
 *
 * A day may be ASKED FOR by name, as ?projekt=&datum=, the same way Bekräfta
 * Pass takes one. The ask is a preference, never a permission: the day still
 * has to be in the queue this builds, so naming one that is approved, surveyed
 * or not yet confirmed falls back to the head of the queue rather than opening
 * it. Nothing here decides who may write; the database does that.
 */
function Granska({ askedProject, askedDate }: { askedProject: string | null; askedDate: string | null }) {
  const [day, setDay] = useState<Day | null | undefined>(undefined);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [gjorde, setGjorde] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      const sb = getSupabase();

      // WHICH days are waiting is defined once, in lib/review-days, and the
      // "Att bekräfta" list an admin opens this from reads the same function.
      // A queue that disagrees with the page it opens is worse than no queue.
      let queue;
      try {
        queue = await reviewDays();
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Kunde inte läsa dagarna.");
        setDay(null);
        return;
      }

      if (!active) return;
      if (queue.length === 0) { setDay(null); return; }

      const first =
        (askedProject !== null && askedDate !== null
          ? queue.find((d) => d.project_id === askedProject && d.work_date === askedDate)
          : undefined) ?? queue[0]!;

      const { data: passes, error: pErr } = await sb
        .from("pass")
        .select("id, start_time, end_time, planned_hours")
        .eq("project_id", first.project_id)
        .eq("work_date", first.work_date);

      if (!active) return;
      if (pErr) { setError(pErr.message); setDay(null); return; }

      const { data: assignments, error: aErr } = await sb
        .from("tilldelning")
        .select("id, pass_id, worker_id, clock_in, clock_out, confirmed_hours, source, own_start, own_end")
        .in("pass_id", (passes ?? []).map((p) => p.id))
        .is("released_at", null);

      if (!active) return;
      if (aErr) { setError(aErr.message); setDay(null); return; }

      const { data: roster } = await sb.from("worker_roster").select("id, name");
      if (!active) return;
      const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

      const rows: Row[] = (assignments ?? []).map((a) => {
        const p = (passes ?? []).find((x) => x.id === a.pass_id)!;
        // Step 4b: an auto-assigned arbetsledare's span is the workers'
        // envelope carried on their OWN row, not the times of whichever pass
        // the row hangs on. Reading the pass here would show the admin a span
        // the leader never claimed, and correcting it would move everybody.
        const leader = a.source === "ledare";
        return {
          tilldelning_id: a.id,
          pass_id: a.pass_id,
          worker_name: names.get(a.worker_id) ?? "Okänd",
          start: hhmm(leader && a.own_start ? a.own_start : p.start_time),
          end: hhmm(leader && a.own_end ? a.own_end : p.end_time),
          hours: a.confirmed_hours === null ? null : Number(a.confirmed_hours),
          clock_in: a.clock_in,
          clock_out: a.clock_out,
          is_leader: leader,
        };
      });

      setDay({
        project_id: first.project_id,
        project_name: first.project_name,
        work_date: first.work_date,
        vad_vi_gjorde: first.vad_vi_gjorde,
        came_back: first.came_back,
        flagged_as: first.flagged_as,
        rows,
      });
      setEdits(
        Object.fromEntries(
          rows.map((r) => [
            r.tilldelning_id,
            {
              start: r.start,
              end: r.end,
              hours: r.hours === null ? "" : String(r.hours).replace(".", ","),
            },
          ]),
        ),
      );
      setGjorde(first.vad_vi_gjorde);
      setNote("");
      setRejecting(false);
    })();

    return () => { active = false; };
  }, [reload, askedProject, askedDate]);

  /**
   * Approve, with whatever the admin corrected. One call, because "edit and
   * approve" is one outcome: an approval that committed while the corrections
   * behind it did not would put figures in the document nobody approved.
   */
  async function approve() {
    if (!day) return;
    setBusy(true);
    setError(null);

    const rows = day.rows.map((r) => {
      const e = edits[r.tilldelning_id]!;
      const row: Record<string, string | number> = {
        tilldelning: r.tilldelning_id,
        hours: Number(e.hours.replace(",", ".")),
      };
      // Only when they moved: two people can share a pass, and writing an
      // untouched row's times would put the stale copy back.
      //
      // A LEADER'S ROW CARRIES NO `pass` KEY, because its times are not the
      // pass's. approve_day() decides the destination from the row's own
      // source rather than from anything sent here -- so this omission is a
      // courtesy to a reader of the payload, not the thing that makes it
      // safe. Sending the key would change nothing.
      if (e.start !== r.start || e.end !== r.end) {
        if (!r.is_leader) row.pass = r.pass_id;
        row.start = e.start;
        row.end = e.end;
      }
      return row;
    });

    // A flagged day is confirmed, not approved: there is no claim behind it,
    // so nothing is being signed off and the review axis stays empty.
    const { error: rErr } = day.flagged_as
      ? await getSupabase().rpc("confirm_flagged_day", {
          p_project: day.project_id,
          p_work_date: day.work_date,
          p_text: gjorde.trim(),
          p_rows: rows,
        })
      : await getSupabase().rpc("approve_day", {
          p_project: day.project_id,
          p_work_date: day.work_date,
          p_text: gjorde.trim(),
          p_rows: rows,
        });

    setBusy(false);
    if (rErr) { setError(rErr.message); return; }
    setReload((r) => r + 1);
  }

  async function reject() {
    if (!day) return;
    setBusy(true);
    setError(null);

    const { error: rErr } = await getSupabase().rpc("reject_day", {
      p_project: day.project_id,
      p_work_date: day.work_date,
      p_note: note.trim(),
    });

    setBusy(false);
    if (rErr) { setError(rErr.message); return; }
    setReload((r) => r + 1);
  }

  if (day === undefined) {
    return (
      <SoftScreen title="Granska pass" back="/">
        <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </SoftScreen>
    );
  }

  if (day === null) {
    return (
      <SoftScreen title="Granska pass" back="/">
        <div className="px-4 pt-[2px]">
          {error && <div className="pb-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}
          <EmptyState headline="Inget att granska">
            Dagar arbetsledaren har bekräftat hamnar här.
          </EmptyState>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Granska pass" back="/">
      {error && <div className="px-4 pb-[10px] pt-[2px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {/* Day kicker, project at 26/800 -- the same head the leader's screen
          wears, because it is the same day seen from the other side. */}
      <div className="px-4 pt-[2px]">
        <div
          className="px-1 pb-[2px] text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          {longDayHeading(day.work_date)}
        </div>
        <div className="px-1 pb-[14px] text-[26px] font-extrabold" style={{ letterSpacing: "-.9px" }}>
          {day.project_name}
        </div>

        {/*
          The amber panel is why this screen exists for a flagged day: there is
          no arbetsledare behind it and there cannot be, so admin is not
          reviewing a claim -- he is making the only one there will ever be.
          flagged_as keeps the two admissions apart, because a day covered by a
          worker and a day nobody stood on are different things to write down.
        */}
        {day.flagged_as ? (
          <SoftNotice
            tone="warn"
            headline={
              day.flagged_as === "ingen_ledare"
                ? "Dagen kördes utan arbetsledare."
                : "Dagen kördes med en arbetare som ansvarig."
            }
          >
            Ingen arbetsledare har bekräftat den och ingen kan. Du skriver
            dagens redogörelse och timmarna, och bara du kan bekräfta den.
          </SoftNotice>
        ) : (
          <p
            className="px-1 text-[15px] font-medium"
            style={{ color: C.text2, textWrap: "pretty" }}
          >
            Arbetsledaren har bekräftat dagen. Du godkänner, rättar och godkänner,
            eller skickar tillbaka.
          </p>
        )}
      </div>

      {day.came_back && (
        <div className="px-4 pt-[14px]">
          <SoftNotice tone="quiet">Den här dagen har varit återsänd en gång tidigare.</SoftNotice>
        </div>
      )}

      {day.rows.map((r) => {
        const e = edits[r.tilldelning_id]!;
        return (
          <div key={r.tilldelning_id} className="px-4 pt-[14px]">
            <Card>
              <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                {r.worker_name}
              </div>

              {/* THIS IS THE ONLY SCREEN THAT EDITS A LEADER'S SPAN. It is
                  read-only on Bekräfta Pass, because a person stating when
                  they were personally on site, on the row that pays them, is
                  the conflict of interest the two stages exist to hold. The
                  tag says whose row this is, and the line under it says which
                  span is being corrected -- their own envelope, not the pass,
                  so moving it moves nobody else. */}
              {r.is_leader && (
                <div className="pt-[6px]"><Tag tone="quiet">Arbetsledare</Tag></div>
              )}

              {/* The stamps are CONTEXT, not the figure. They are read-only
                  copy here and typed hours sit below them, because nothing in
                  this app derives an hour from a clock (invariant 1). */}
              <div className="mb-[14px] mt-[2px] text-[14px] font-medium" style={{ color: C.text2 }}>
                Stämplade {stampToTime(r.clock_in) || "—"} till {stampToTime(r.clock_out) || "—"}
                {r.is_leader && (
                  <span className="mt-[2px] block">
                    Arbetsledarens egna tider. Ändras här och flyttar inte passet.
                  </span>
                )}
              </div>

              <div className="mb-[14px] flex gap-[10px]">
                <div className="min-w-0 flex-1">
                  <SoftField label="Börjar">
                    <SoftInput
                      type="time"
                      value={e.start}
                      onChange={(ev) =>
                        setEdits((p) => ({ ...p, [r.tilldelning_id]: { ...e, start: ev.target.value } }))
                      }
                    />
                  </SoftField>
                </div>
                <div className="min-w-0 flex-1">
                  <SoftField label="Slutar">
                    <SoftInput
                      type="time"
                      value={e.end}
                      onChange={(ev) =>
                        setEdits((p) => ({ ...p, [r.tilldelning_id]: { ...e, end: ev.target.value } }))
                      }
                    />
                  </SoftField>
                </div>
              </div>

              <SoftField label="Timmar" help="0 om personen inte kom." big>
                <SoftInput
                  inputMode="decimal"
                  value={e.hours}
                  onChange={(ev) =>
                    setEdits((p) => ({ ...p, [r.tilldelning_id]: { ...e, hours: ev.target.value } }))
                  }
                  style={{ letterSpacing: "-.6px" }}
                />
              </SoftField>
            </Card>
          </div>
        );
      })}

      <div className="px-4 pt-[14px]">
        <Card>
          <div className="flex items-baseline justify-between gap-[10px]">
            {/* htmlFor, not a wrapping <label>: the handoff puts the marker on
                the same baseline as the label, and a <label> containing both
                would make it part of the field's accessible name. */}
            <label
              htmlFor="vad-vi-gjorde"
              className="text-[12px] font-bold uppercase"
              style={{ letterSpacing: ".9px", color: C.text2 }}
            >
              Vad vi gjorde
            </label>
            <div className="text-[12px] font-bold" style={{ letterSpacing: ".4px", color: C.stopInk }}>
              Krävs
            </div>
          </div>
          <div className="mb-2 mt-[2px] text-[14px] font-medium" style={{ color: C.text2 }}>
            {day.flagged_as
              ? "Din redogörelse. Skrivs ut på varje rad i arbetsdagboken."
              : "Arbetsledarens text. Rätta den om den inte stämmer."}
          </div>
          <SoftTextarea
            id="vad-vi-gjorde"
            rows={4}
            value={gjorde}
            onChange={(e) => setGjorde(e.target.value)}
          />
        </Card>
      </div>

      <div className="px-4 pt-[14px]">
        <SoftNotice tone="quiet">
          {day.flagged_as
            ? "Bekräftat är slutgiltigt. Efter det ändras ingenting."
            : "Godkänt är slutgiltigt. Efter det ändras ingenting."}
        </SoftNotice>
      </div>

      <div className="px-4 pt-[14px]">
        <PrimaryButton onClick={approve} disabled={busy || gjorde.trim() === ""}>
          {busy ? "Sparar…" : day.flagged_as ? "Bekräfta dagen" : "Godkänn"}
        </PrimaryButton>
      </div>

      {/* Nothing to send back: a flagged day has no claim in it, and there is
          no arbetsledare it could be returned to. */}
      {day.flagged_as ? null : (
        <div className="px-4 pt-[14px]">
          {!rejecting ? (
            <SecondaryButton onClick={() => setRejecting(true)} disabled={busy}>
              Underkänn
            </SecondaryButton>
          ) : (
            <Card>
              {/* An ordinary wrapping field, unlike "Vad vi gjorde" above:
                  there is no marker to put on the label's baseline here, so
                  the label owns its control directly. */}
              <SoftField
                label="Varför skickas dagen tillbaka?"
                help="Krävs. Arbetsledaren ser den här texten."
              >
                <SoftTextarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </SoftField>
              <div className="pt-[14px]">
                <SecondaryButton onClick={reject} disabled={busy || note.trim() === ""}>
                  Skicka tillbaka till arbetsledaren
                </SecondaryButton>
              </div>
            </Card>
          )}
        </div>
      )}
    </SoftScreen>
  );
}

/**
 * The day arrives as ?projekt=&datum=. useSearchParams needs a Suspense
 * boundary in a statically exported app -- the query string is not known when
 * the page is prerendered, only when a browser opens it.
 *
 * Shape-checked before it is used: a uuid and a date, or nothing.
 */
function GranskaFromUrl() {
  const q = useSearchParams();
  const projekt = q.get("projekt");
  const datum = q.get("datum");
  const ok =
    projekt !== null &&
    datum !== null &&
    /^[0-9a-f-]{36}$/i.test(projekt) &&
    /^\d{4}-\d{2}-\d{2}$/.test(datum);
  return <Granska askedProject={ok ? projekt : null} askedDate={ok ? datum : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Granska pass" back="/"><span /></SoftScreen>}>
        <GranskaFromUrl />
      </Suspense>
    </AuthGate>
  );
}
