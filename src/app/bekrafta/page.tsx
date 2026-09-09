"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SHADOW, SoftField, SoftInput, SoftNotice, SoftScreen, Tag,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading, stampToTime } from "@/lib/dates";
import { pendingDays } from "@/lib/pending-days";
import { spanHours } from "@/lib/hours";

type Row = {
  tilldelning_id: string;
  worker_name: string;
  pass_id: string;
  start: string;
  end: string;
  planned_hours: number;
  clock_in: string | null;
  clock_out: string | null;
  confirmed_hours: number | null;
  /** Step 4b: an auto-assigned arbetsledare. Their times are the workers'
   *  envelope carried on the row itself, not the times of whichever pass the
   *  row hangs on, and correcting them writes back to the row rather than
   *  moving everybody's shift. */
  is_leader: boolean;
};

type Day = {
  project_id: string;
  project_name: string;
  site_address: string;
  work_date: string;
  /** Set when the admin sent this day back. The reason he gave, verbatim. */
  rejection_note: string | null;
  rows: Row[];
};

/**
 * Bekräfta Pass -- the mechanism the whole system depends on.
 *
 * A day appears here only once its last shift has ENDED by the clock, not at
 * midnight and not the next morning. Days are oldest first, so the leader
 * never scrolls to find what is overdue, and each day is split by project:
 * one leader may run several sites and each needs its own account of what
 * happened.
 *
 * Every field on a row is editable. If any of the three is changed, that row is
 * marked late ONCE -- three corrections to one person's shift is one deviation,
 * not three, and the demotion moves them one position, not three.
 *
 * Confirmation is final for the leader. The one thing that puts a day back in
 * their hands is the admin rejecting it at stage 2 -- and such a day returns
 * here flagged, carrying the reason he gave, with the text and the figures as
 * they were left so the correction is a correction and not a re-typing.
 *
 * The database enforces the finality; this screen says so.
 *
 * A day may be ASKED FOR by name -- Bekräftelser' "Att bekräfta" list points at
 * one. The ask is a preference, never a permission: the day still has to be in
 * the queue pendingDays() returns, so naming a day that is confirmed, flagged,
 * or somebody else's falls back to the oldest waiting one rather than opening
 * it. Nothing here decides who may write; the guard does that.
 */
function Bekrafta({ askedProject, askedDate }: { askedProject: string | null; askedDate: string | null }) {
  const [day, setDay] = useState<Day | null | undefined>(undefined);
  const [edits, setEdits] = useState<Record<string, { start: string; end: string; hours: string }>>({});
  const [gjorde, setGjorde] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Everything settles after an await: no synchronous setState in the effect
  // body. `reload` is how confirming asks for the next day.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      const sb = getSupabase();

      // WHICH days are waiting is defined once, in lib/pending-days, and the
      // landing page's widget reads the same function. A preview that
      // disagreed with the page it opens would be worse than no preview.
      let open;
      try {
        open = await pendingDays();
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Kunde inte läsa passen.");
        setDay(null);
        return;
      }

      if (!active) return;
      if (open.length === 0) { setDay(null); return; }

      // Oldest first unless a specific day was asked for and is still waiting.
      const first =
        (askedProject !== null && askedDate !== null
          ? open.find((d) => d.project_id === askedProject && d.work_date === askedDate)
          : undefined) ?? open[0];
      const samePasses = first.passes;

      const { data: assignments, error: aErr } = await sb
        .from("tilldelning")
        .select("id, pass_id, worker_id, clock_in, clock_out, confirmed_hours, source, own_start, own_end")
        .in("pass_id", samePasses.map((p) => p.id))
        .is("released_at", null);

      if (!active) return;
      if (aErr) { setError(aErr.message); setDay(null); return; }

      const { data: roster } = await sb.from("worker_roster").select("id, name");
      if (!active) return;
      const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

      const rows: Row[] = (assignments ?? []).map((a) => {
        const p = samePasses.find((x) => x.id === a.pass_id)!;
        const leader = a.source === "ledare";
        const start = hhmm(leader && a.own_start ? a.own_start : p.start_time);
        const end = hhmm(leader && a.own_end ? a.own_end : p.end_time);
        return {
          tilldelning_id: a.id,
          worker_name: names.get(a.worker_id) ?? "Okänd",
          pass_id: a.pass_id,
          start,
          end,
          // A leader's figure is prefilled from the envelope, with no break
          // taken off: lunch is theirs to subtract. A worker's is the pass's
          // planned number.
          planned_hours: leader
            ? Number(spanHours(start, end).replace(",", "."))
            : Number(p.planned_hours),
          clock_in: a.clock_in,
          clock_out: a.clock_out,
          confirmed_hours: a.confirmed_hours === null ? null : Number(a.confirmed_hours),
          is_leader: leader,
        };
      });

      setDay({
        project_id: first.project_id,
        project_name: first.project_name,
        site_address: first.site_address,
        work_date: first.work_date,
        rejection_note: first.rejection_note,
        rows,
      });
      setEdits(
        Object.fromEntries(
          rows.map((r) => [
            r.tilldelning_id,
            {
              start: r.start,
              end: r.end,
              // A figure already typed is the one to correct. Only a day that
              // has never been confirmed falls back to the planned number.
              hours: String(r.confirmed_hours ?? r.planned_hours).replace(".", ","),
            },
          ]),
        ),
      );
      setGjorde(first.vad_vi_gjorde);
    })();

    return () => { active = false; };
  }, [reload, askedProject, askedDate]);

  async function confirm() {
    if (!day) return;
    setSaving(true);
    setError(null);
    const sb = getSupabase();

    for (const row of day.rows) {
      const e = edits[row.tilldelning_id]!;
      const hours = Number(e.hours.replace(",", "."));
      const timesChanged = e.start !== row.start || e.end !== row.end;
      const hoursChanged = hours !== (row.confirmed_hours ?? row.planned_hours);

      if (timesChanged) {
        // A leader's span belongs to their row. Writing it to the pass would
        // move every worker on that shift, and the leader was correcting when
        // THEY were there, not when the job ran.
        const { error: tErr } = row.is_leader
          ? await sb
              .from("tilldelning")
              .update({ own_start: e.start, own_end: e.end })
              .eq("id", row.tilldelning_id)
          : await sb
              .from("pass")
              .update({ start_time: e.start, end_time: e.end })
              .eq("id", row.pass_id);
        if (tErr) { setError(tErr.message); setSaving(false); return; }
      }

      // One row, one late mark, however many fields were edited.
      const { error: aErr } = await sb
        .from("tilldelning")
        .update({ confirmed_hours: hours, late: timesChanged || hoursChanged })
        .eq("id", row.tilldelning_id);
      if (aErr) { setError(aErr.message); setSaving(false); return; }
    }

    // The day record and the confirmation are one write. The database refuses
    // a confirmation whose "Vad Vi Gjorde" is blank, and refuses it from anyone
    // who is not the assigned arbetsledare.
    // Upsert, not insert: a day the admin sent back already has its row, with
    // the rejection recorded on it. That record is not the leader's to clear
    // and the guard keeps it whatever this write says.
    const { error: dErr } = await sb.from("project_day").upsert(
      {
        project_id: day.project_id,
        work_date: day.work_date,
        vad_vi_gjorde: gjorde.trim(),
        confirmed_at: new Date().toISOString(),
        confirmed_by: (await sb.auth.getUser()).data.user!.id,
        confirmed_via: "leader",
      },
      { onConflict: "project_id,work_date" },
    );

    if (dErr) { setError(dErr.message); setSaving(false); return; }

    setSaving(false);
    setReload((r) => r + 1);
  }

  if (day === undefined) {
    return (
      <SoftScreen title="Bekräfta pass" back="/">
        <div className="px-4 pt-2 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</div>
      </SoftScreen>
    );
  }

  // The handoff's empty state: a check glyph in a white 46px tile, then the
  // headline and the line under it.
  if (day === null) {
    return (
      <SoftScreen title="Bekräfta pass" back="/">
        <div className="px-4 pt-[2px]">
          {error && <div className="pb-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}
          <div className="rounded-[14px] px-[22px] py-[34px] text-center" style={{ background: C.panel }}>
            <div
              className="mx-auto mb-[14px] flex h-[46px] w-[46px] items-center justify-center rounded-[14px]"
              style={{ background: C.surface, boxShadow: SHADOW.flat }}
            >
              <svg width="20" height="16" viewBox="0 0 11 9" fill="none" aria-hidden>
                <path d="M1 4.6 4 7.6 10 1.4" stroke={C.liveInk} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="mb-1 text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
              Inget att bekräfta
            </div>
            <div className="text-[15px] font-medium" style={{ color: C.text2 }}>
              Dagar som behöver dig hamnar här.
            </div>
          </div>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Bekräfta pass" back="/">
      {error && <div className="px-4 pb-[10px] pt-[2px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {/* Day kicker, project at 26/800, the site under it. */}
      <div className="px-4 pt-[2px]">
        <div
          className="px-1 pb-[2px] text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          {longDayHeading(day.work_date)}
        </div>
        <div className="px-1 text-[26px] font-extrabold" style={{ letterSpacing: "-.9px" }}>
          {day.project_name}
        </div>
        {day.site_address && (
          <div className="px-1 pt-[2px] text-[15px] font-medium" style={{ color: C.text2 }}>
            {day.site_address}
          </div>
        )}
      </div>

      {day.rejection_note !== null && (
        <div className="px-4 pt-[14px]">
          <SoftNotice tone="stop">Återsänd av admin: {day.rejection_note}</SoftNotice>
        </div>
      )}

      {day.rows.map((r) => {
        const e = edits[r.tilldelning_id]!;
        return (
          <div key={r.tilldelning_id} className="px-4 pt-[14px]">
            <Card>
              <div className="flex items-baseline justify-between gap-[10px]">
                <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                  {r.worker_name}
                </div>
                {/* The handoff draws two: stamped out, and clocked in but not
                    out. A row with no stamp at all is a third thing and gets a
                    quiet tag rather than an amber one -- nothing is unfinished,
                    nobody started. */}
                <Tag tone={r.clock_out ? "live" : r.clock_in ? "warn" : "quiet"}>
                  {r.clock_out ? "Stämplad ut" : r.clock_in ? "Ej utstämplad" : "Ej stämplad"}
                </Tag>
              </div>

              {/* Step 4b: placed because their people were there, not by the
                  priority list. Saying so is why the span looks unlike anyone
                  else's on the day. */}
              {r.is_leader && (
                <div className="pt-[6px]"><Tag tone="quiet">Arbetsledare</Tag></div>
              )}

              <div className="mb-[14px] mt-[2px] text-[14px] font-medium" style={{ color: C.text2 }}>
                Stämplade {stampToTime(r.clock_in) || "—"} till {stampToTime(r.clock_out) || "—"}
              </div>

              <div className="mb-[14px] flex gap-[10px]">
                <div className="flex-1">
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
                <div className="flex-1">
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
            {/* htmlFor, not a wrapping <label>: the handoff puts "Krävs" on the
                same baseline as the label, and a <label> containing both would
                make the marker part of the field's accessible name. */}
            <label
              htmlFor="vad-vi-gjorde"
              className="text-[12px] font-bold uppercase"
              style={{ letterSpacing: ".9px", color: C.text2 }}
            >
              Vad vi gjorde
            </label>
            {/* Krävs, in the stop ink, because it is the one field the database
                refuses a confirmation without. */}
            <div
              className="text-[12px] font-bold"
              style={{ letterSpacing: ".4px", color: C.stopInk }}
            >
              Krävs
            </div>
          </div>
          <div className="mb-2 mt-[2px] text-[14px] font-medium" style={{ color: C.text2 }}>
            Skrivs ut på varje rad i arbetsdagboken.
          </div>
          <textarea
            id="vad-vi-gjorde"
            rows={4}
            value={gjorde}
            onChange={(e) => setGjorde(e.target.value)}
            className="w-full resize-y rounded-[10px] border-0 p-[14px] text-[16px] font-medium leading-[1.45] outline-none focus:bg-white focus:outline-2 focus:outline-[#1b2cc1]"
            style={{ background: C.panel2, color: C.ink }}
          />
        </Card>
      </div>

      <div className="px-4 pt-[14px]">
        <div
          className="rounded-[12px] px-4 py-[14px] text-[15px] font-semibold"
          style={{ background: C.panel2, color: C.inkHover, textWrap: "pretty" }}
        >
          Bekräftat är slutgiltigt. Det går inte att ändra efteråt.
        </div>
      </div>

      <div className="px-4 pt-[14px]">
        <PrimaryButton onClick={confirm} disabled={saving || gjorde.trim() === ""}>
          {saving ? "Bekräftar…" : "Bekräfta dagen"}
        </PrimaryButton>
      </div>
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
function BekraftaFromUrl() {
  const q = useSearchParams();
  const projekt = q.get("projekt");
  const datum = q.get("datum");
  const ok =
    projekt !== null &&
    datum !== null &&
    /^[0-9a-f-]{36}$/i.test(projekt) &&
    /^\d{4}-\d{2}-\d{2}$/.test(datum);
  return <Bekrafta askedProject={ok ? projekt : null} askedDate={ok ? datum : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Bekräfta pass" back="/"><span /></SoftScreen>}>
        <BekraftaFromUrl />
      </Suspense>
    </AuthGate>
  );
}
