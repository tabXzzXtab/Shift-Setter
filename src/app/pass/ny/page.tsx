"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Field, Group, Input, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";

type Project = { id: string; name: string };
type Worker = { id: string; name: string };
type Result = { filled: number; slots: number; offered: number };

/**
 * Skapa Pass -- a demand for people, not a list of names.
 *
 * The leader sets how many are needed. Who fills the slots is the priority
 * list's business, walked in the database by fill_passes: exclusion filter
 * first, then hand-picked pre-pickers, then everyone else who pre-picked
 * ordered by fewest shifts that week, then Acceptera Pass.
 *
 * Hand-picking does NOT assign. It is a ranking modifier for this batch: the
 * förval is the entry ticket, so a pick who never marked the day simply is not
 * on the list, and that is not a mistake worth warning about.
 *
 * The shortfall warning is the one thing worth saying at creation time --
 * anything short of coverage is worth knowing about while the schedule can
 * still be changed. It warns; it never blocks.
 */
function NyttPass() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(stockholmToday());
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("16:00");
  const [hours, setHours] = useState("8");
  const [headcount, setHeadcount] = useState(1);
  const [handpicked, setHandpicked] = useState<string[]>([]);
  const [available, setAvailable] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    void (async () => {
      const { data: p } = await sb.from("project").select("id, name").order("name");
      const rows = (p ?? []).map((x) => ({ id: x.id, name: x.name }));
      setProjects(rows);
      if (rows.length === 1) setProjectId(rows[0]!.id);

      // Names only. A leader has no business seeing a colleague's personnummer.
      const { data: w } = await sb.from("worker_roster").select("id, name").order("name");
      setWorkers((w ?? []).flatMap((x) => (x.id && x.name ? [{ id: x.id, name: x.name }] : [])));
    })();
  }, []);

  // How many people have pre-picked this day and are still free on it.
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await getSupabase().rpc("forval_coverage", { p_dates: [date] });
      if (!active) return;
      setAvailable(data?.[0]?.available ?? 0);
    })();
    return () => { active = false; };
  }, [date]);

  const shortfall = available !== null && available < headcount;

  function toggle(id: string) {
    setHandpicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const sb = getSupabase();
    const me = (await sb.auth.getUser()).data.user!.id;

    // The batch is what hand-picking is scoped to: "top-ranked for this batch".
    const { data: batch, error: bErr } = await sb
      .from("pass_batch")
      .insert({ project_id: projectId, created_by: me })
      .select("id")
      .single();
    if (bErr || !batch) { setError(bErr?.message ?? "Kunde inte skapa passet."); setSaving(false); return; }

    if (handpicked.length) {
      const { error: hErr } = await sb.from("pass_batch_handpick").insert(
        handpicked.map((worker_id) => ({ batch_id: batch.id, worker_id })),
      );
      if (hErr) { setError(hErr.message); setSaving(false); return; }
    }

    const { error: pErr } = await sb.from("pass").insert({
      project_id: projectId,
      batch_id: batch.id,
      work_date: date,
      start_time: start,
      end_time: end,
      planned_hours: Number(hours.replace(",", ".")),
      headcount,
      created_by: me,
    });
    if (pErr) { setError(pErr.message); setSaving(false); return; }

    // The walk down the tiers. Not done here -- the browser is not a boundary.
    const { data: filled, error: fErr } = await sb.rpc("fill_passes", { p_batch: batch.id });
    if (fErr) { setError(fErr.message); setSaving(false); return; }

    const row = filled?.[0];
    setResult({
      filled: row?.filled ?? 0,
      slots: row?.slots ?? headcount,
      offered: row?.offered ?? 0,
    });
    setSaving(false);
  }

  if (result) {
    return (
      <Screen title="Passet är skapat" back="/">
        <p className="mb-4 text-2xl font-bold">
          {result.filled} av {result.slots} platser tillsatta
        </p>
        {result.offered > 0 && (
          <Notice kind="info">
            {result.slots - result.filled} plats(er) kvar. {result.offered} arbetare har
            fått passet i Acceptera Pass.
          </Notice>
        )}
        {result.filled === result.slots && (
          <Notice kind="ok">Passet är fullt.</Notice>
        )}
        <div className="mt-6 flex flex-col gap-3">
          <Button onClick={() => { setResult(null); setHandpicked([]); }}>Skapa ett till</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Skapa pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      {projects.length === 0 && (
        <Notice kind="info">
          Du är inte tilldelad något projekt. Administratören lägger till dig.
        </Notice>
      )}

      <Field label="Projekt">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Välj…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Datum">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Börjar">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Slutar">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      <Field label="Timmar" hint="Skrivs för hand. Rasten räknas inte.">
        <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
      </Field>

      <Group label="Hur många behövs?">
        <div className="flex items-stretch gap-3">
          <button
            type="button"
            aria-label="Färre"
            onClick={() => setHeadcount((h) => Math.max(1, h - 1))}
            className="h-[56px] w-[72px] border-2 border-black text-3xl font-bold"
          >
            −
          </button>
          <output className="flex h-[56px] flex-1 items-center justify-center border-2 border-black text-2xl font-bold">
            {headcount}
          </output>
          <button
            type="button"
            aria-label="Fler"
            onClick={() => setHeadcount((h) => Math.min(20, h + 1))}
            className="h-[56px] w-[72px] border-2 border-black text-3xl font-bold"
          >
            +
          </button>
        </div>
      </Group>

      {available !== null && (
        shortfall ? (
          <Notice kind="info">
            Bara {available} arbetare har markerat den dagen. Du behöver {headcount}.
            Resten går ut som Acceptera Pass.
          </Notice>
        ) : (
          <p className="mb-4 text-base">
            {available} arbetare har markerat den dagen.
          </p>
        )
      )}

      <Group
        label={`Handplocka (${handpicked.length})`}
        hint="Frivilligt. Ger förtur — men bara till dem som markerat dagen."
      >
        <div className="flex flex-col gap-2">
          {workers.map((w) => {
            const on = handpicked.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(w.id)}
                className={`flex min-h-[56px] items-center justify-between border-2 border-black px-4 text-lg font-bold ${
                  on ? "bg-black text-white" : "bg-white text-black"
                }`}
              >
                <span>{w.name}</span>
                <span aria-hidden className="text-2xl">{on ? "✓" : "+"}</span>
              </button>
            );
          })}
          {workers.length === 0 && (
            <p className="text-base text-neutral-600">Inga arbetare att välja.</p>
          )}
        </div>
      </Group>

      <div className="mt-6">
        <Button onClick={save} disabled={saving || !projectId || hours.trim() === ""}>
          {saving ? "Skapar…" : "Skapa pass"}
        </Button>
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyttPass />
    </AuthGate>
  );
}
