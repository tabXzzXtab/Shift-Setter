"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Empty, Field, Input, Notice, Screen, Textarea } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading, stampToTime } from "@/lib/dates";

type Row = {
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
 */
function Granska() {
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

      // The queue is exactly the days sitting at stage 1. A surveyed day and a
      // day already approved are not in it, and never were.
      const { data: days, error: dErr } = await sb
        .from("project_day")
        .select("project_id, work_date, vad_vi_gjorde, rejected_at, project(name)")
        .eq("stage", "leader_confirmed")
        .order("work_date");

      if (!active) return;
      if (dErr) { setError(dErr.message); setDay(null); return; }
      if (!days || days.length === 0) { setDay(null); return; }

      const first = days[0]!;

      const { data: passes, error: pErr } = await sb
        .from("pass")
        .select("id, start_time, end_time, planned_hours")
        .eq("project_id", first.project_id)
        .eq("work_date", first.work_date);

      if (!active) return;
      if (pErr) { setError(pErr.message); setDay(null); return; }

      const { data: assignments, error: aErr } = await sb
        .from("tilldelning")
        .select("id, pass_id, worker_id, clock_in, clock_out, confirmed_hours")
        .in("pass_id", (passes ?? []).map((p) => p.id))
        .is("released_at", null);

      if (!active) return;
      if (aErr) { setError(aErr.message); setDay(null); return; }

      const { data: roster } = await sb.from("worker_roster").select("id, name");
      if (!active) return;
      const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

      const rows: Row[] = (assignments ?? []).map((a) => {
        const p = (passes ?? []).find((x) => x.id === a.pass_id)!;
        return {
          tilldelning_id: a.id,
          pass_id: a.pass_id,
          worker_name: names.get(a.worker_id) ?? "Okänd",
          start: hhmm(p.start_time),
          end: hhmm(p.end_time),
          hours: a.confirmed_hours === null ? null : Number(a.confirmed_hours),
          clock_in: a.clock_in,
          clock_out: a.clock_out,
        };
      });

      setDay({
        project_id: first.project_id,
        project_name: (first.project as { name: string } | null)?.name ?? "Projekt",
        work_date: first.work_date,
        vad_vi_gjorde: first.vad_vi_gjorde ?? "",
        came_back: first.rejected_at !== null,
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
      setGjorde(first.vad_vi_gjorde ?? "");
      setNote("");
      setRejecting(false);
    })();

    return () => { active = false; };
  }, [reload]);

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
      if (e.start !== r.start || e.end !== r.end) {
        row.pass = r.pass_id;
        row.start = e.start;
        row.end = e.end;
      }
      return row;
    });

    const { error: rErr } = await getSupabase().rpc("approve_day", {
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
    return <Screen title="Granska pass" back="/"><span>Laddar…</span></Screen>;
  }

  if (day === null) {
    return (
      <Screen title="Granska pass" back="/">
        {error && <Notice kind="error">{error}</Notice>}
        <Empty>Inget att granska.</Empty>
      </Screen>
    );
  }

  return (
    <Screen title="Granska pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-1 text-2xl font-bold">{longDayHeading(day.work_date)}</p>
      <p className="mb-4 text-lg">{day.project_name}</p>

      <p className="mb-6 text-base text-neutral-700">
        Arbetsledaren har bekräftat dagen. Du godkänner, rättar och godkänner,
        eller skickar tillbaka.
      </p>

      {day.came_back && (
        <Notice kind="info">Den här dagen har varit återsänd en gång tidigare.</Notice>
      )}

      <div className="flex flex-col gap-4">
        {day.rows.map((r) => {
          const e = edits[r.tilldelning_id]!;
          return (
            <section key={r.tilldelning_id} className="border-2 border-black p-4">
              <p className="mb-3 text-xl font-bold">{r.worker_name}</p>

              <p className="mb-3 text-base text-neutral-700">
                Stämplade {stampToTime(r.clock_in) || "—"} till {stampToTime(r.clock_out) || "—"}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Börjar">
                  <Input
                    type="time"
                    value={e.start}
                    onChange={(ev) =>
                      setEdits((p) => ({ ...p, [r.tilldelning_id]: { ...e, start: ev.target.value } }))
                    }
                  />
                </Field>
                <Field label="Slutar">
                  <Input
                    type="time"
                    value={e.end}
                    onChange={(ev) =>
                      setEdits((p) => ({ ...p, [r.tilldelning_id]: { ...e, end: ev.target.value } }))
                    }
                  />
                </Field>
              </div>

              <Field label="Timmar" hint="0 om personen inte kom.">
                <Input
                  inputMode="decimal"
                  value={e.hours}
                  onChange={(ev) =>
                    setEdits((p) => ({ ...p, [r.tilldelning_id]: { ...e, hours: ev.target.value } }))
                  }
                />
              </Field>
            </section>
          );
        })}
      </div>

      <div className="mt-6">
        <Field label="Vad vi gjorde" hint="Arbetsledarens text. Rätta den om den inte stämmer.">
          <Textarea value={gjorde} onChange={(e) => setGjorde(e.target.value)} />
        </Field>
      </div>

      <Notice kind="info">Godkänt är slutgiltigt. Efter det ändras ingenting.</Notice>

      <div className="flex flex-col gap-3">
        <Button onClick={approve} disabled={busy || gjorde.trim() === ""}>
          {busy ? "Sparar…" : "Godkänn"}
        </Button>

        {!rejecting ? (
          <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
            Underkänn
          </Button>
        ) : (
          <section className="border-2 border-black p-4">
            <Field
              label="Varför skickas dagen tillbaka?"
              hint="Krävs. Arbetsledaren ser den här texten."
            >
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button variant="outline" onClick={reject} disabled={busy || note.trim() === ""}>
              Skicka tillbaka till arbetsledaren
            </Button>
          </section>
        )}
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Granska />
    </AuthGate>
  );
}
