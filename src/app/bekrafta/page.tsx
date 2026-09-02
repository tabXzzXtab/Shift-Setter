"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Empty, Field, Input, Notice, Screen, Textarea } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading, passEndAt, stampToTime } from "@/lib/dates";

type Row = {
  tilldelning_id: string;
  worker_name: string;
  pass_id: string;
  start: string;
  end: string;
  planned_hours: number;
  clock_in: string | null;
  clock_out: string | null;
};

type Day = {
  project_id: string;
  project_name: string;
  work_date: string;
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
 * Confirmation is final. The database enforces that; this screen says so.
 */
function Bekrafta() {
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

      // Passes on the leader's own projects (RLS does the scoping), already over.
      const { data: passes, error: pErr } = await sb
        .from("pass")
        .select("id, project_id, work_date, start_time, end_time, planned_hours, project(name)")
        .order("work_date");

      if (!active) return;
      if (pErr) { setError(pErr.message); setDay(null); return; }

      const now = Date.now();
      const ended = (passes ?? []).filter(
        (p) => passEndAt(p.work_date, p.start_time, p.end_time).getTime() <= now,
      );
      if (ended.length === 0) { setDay(null); return; }

      const { data: days } = await sb
        .from("project_day")
        .select("project_id, work_date, confirmed_at");

      if (!active) return;
      const done = new Set(
        (days ?? []).filter((d) => d.confirmed_at).map((d) => `${d.project_id}|${d.work_date}`),
      );

      const open = ended.filter((p) => !done.has(`${p.project_id}|${p.work_date}`));
      if (open.length === 0) { setDay(null); return; }

      // Oldest first, then whichever project comes first on that date.
      open.sort((a, b) => a.work_date.localeCompare(b.work_date) || a.project_id.localeCompare(b.project_id));
      const first = open[0]!;
      const samePasses = open.filter(
        (p) => p.project_id === first.project_id && p.work_date === first.work_date,
      );

      const { data: assignments, error: aErr } = await sb
        .from("tilldelning")
        .select("id, pass_id, worker_id, clock_in, clock_out")
        .in("pass_id", samePasses.map((p) => p.id))
        .is("released_at", null);

      if (!active) return;
      if (aErr) { setError(aErr.message); setDay(null); return; }

      const { data: roster } = await sb.from("worker_roster").select("id, name");
      if (!active) return;
      const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

      const rows: Row[] = (assignments ?? []).map((a) => {
        const p = samePasses.find((x) => x.id === a.pass_id)!;
        return {
          tilldelning_id: a.id,
          worker_name: names.get(a.worker_id) ?? "Okänd",
          pass_id: a.pass_id,
          start: hhmm(p.start_time),
          end: hhmm(p.end_time),
          planned_hours: Number(p.planned_hours),
          clock_in: a.clock_in,
          clock_out: a.clock_out,
        };
      });

      setDay({
        project_id: first.project_id,
        project_name: (first.project as { name: string } | null)?.name ?? "Projekt",
        work_date: first.work_date,
        rows,
      });
      setEdits(
        Object.fromEntries(
          rows.map((r) => [
            r.tilldelning_id,
            { start: r.start, end: r.end, hours: String(r.planned_hours).replace(".", ",") },
          ]),
        ),
      );
      setGjorde("");
    })();

    return () => { active = false; };
  }, [reload]);

  async function confirm() {
    if (!day) return;
    setSaving(true);
    setError(null);
    const sb = getSupabase();

    for (const row of day.rows) {
      const e = edits[row.tilldelning_id]!;
      const hours = Number(e.hours.replace(",", "."));
      const timesChanged = e.start !== row.start || e.end !== row.end;
      const hoursChanged = hours !== row.planned_hours;

      if (timesChanged) {
        const { error: tErr } = await sb
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
    const { error: dErr } = await sb.from("project_day").insert({
      project_id: day.project_id,
      work_date: day.work_date,
      vad_vi_gjorde: gjorde.trim(),
      confirmed_at: new Date().toISOString(),
      confirmed_by: (await sb.auth.getUser()).data.user!.id,
      confirmed_via: "leader",
    });

    if (dErr) { setError(dErr.message); setSaving(false); return; }

    setSaving(false);
    setReload((r) => r + 1);
  }

  if (day === undefined) return <Screen title="Bekräfta pass" back="/"><span>Laddar…</span></Screen>;

  if (day === null) {
    return (
      <Screen title="Bekräfta pass" back="/">
        {error && <Notice kind="error">{error}</Notice>}
        <Empty>Inget att bekräfta.</Empty>
      </Screen>
    );
  }

  return (
    <Screen title="Bekräfta pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-1 text-2xl font-bold">{longDayHeading(day.work_date)}</p>
      <p className="mb-6 text-lg">{day.project_name}</p>

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
        <Field label="Vad vi gjorde" hint="Krävs. Skrivs ut på varje rad i Arbetsdagboken.">
          <Textarea value={gjorde} onChange={(e) => setGjorde(e.target.value)} />
        </Field>
      </div>

      <Notice kind="info">Bekräftat är slutgiltigt. Det går inte att ändra efteråt.</Notice>

      <Button onClick={confirm} disabled={saving || gjorde.trim() === ""}>
        {saving ? "Bekräftar…" : "Bekräfta dagen"}
      </Button>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Bekrafta />
    </AuthGate>
  );
}
