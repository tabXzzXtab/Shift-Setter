"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { Button, Field, Group, Input, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";

type Project = { id: string; name: string };
type Worker = { id: string; name: string };

/**
 * Skapa Pass, reduced to this slice: one pass, workers picked directly.
 *
 * No förval, no tiers, no Acceptera Pass. Those come after; what stays true
 * here is everything the pass itself has to get right.
 *
 * The project dropdown lists ONLY projects this leader is assigned to. That is
 * not a courtesy -- it is why an unassigned arbetsledare needs no special
 * handling anywhere: their dropdown is empty, so they cannot create work, and
 * the RLS policy behind it refuses the insert regardless.
 *
 * Hours are a typed field, never computed from the span. 07:00-16:00 with an
 * unpaid lunch is 8 hours, not 9, and that is the normal case (invariant 1).
 */
function NyttPass() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(stockholmToday());
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("16:00");
  const [hours, setHours] = useState("8");
  const [headcount, setHeadcount] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    sb.from("project").select("id, name").order("name").then(({ data }) => {
      const rows = (data ?? []).map((p) => ({ id: p.id, name: p.name }));
      setProjects(rows);
      if (rows.length === 1) setProjectId(rows[0]!.id);
    });
    // worker_roster: names only. A leader has no business seeing a colleague's
    // personnummer or bank details, and the view does not expose them.
    sb.from("worker_roster").select("id, name").order("name").then(({ data }) => {
      setWorkers((data ?? []).flatMap((w) => (w.id && w.name ? [{ id: w.id, name: w.name }] : [])));
    });
  }, []);

  function toggle(id: string) {
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= headcount ? p : [...p, id],
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    const sb = getSupabase();

    const { data: pass, error: pErr } = await sb
      .from("pass")
      .insert({
        project_id: projectId,
        work_date: date,
        start_time: start,
        end_time: end,
        planned_hours: Number(hours.replace(",", ".")),
        headcount,
        created_by: (await sb.auth.getUser()).data.user!.id,
      })
      .select("id")
      .single();

    if (pErr || !pass) {
      setError(pErr?.message ?? "Kunde inte skapa passet.");
      setSaving(false);
      return;
    }

    if (picked.length > 0) {
      const { error: tErr } = await sb.from("tilldelning").insert(
        picked.map((worker_id) => ({
          pass_id: pass.id,
          worker_id,
          source: "manuell" as const,
          work_date: date,
        })),
      );
      if (tErr) {
        // Invariant 2 surfaces here: someone already works that date.
        setError(
          /tilldelning_one_per_worker_per_day/.test(tErr.message)
            ? "Någon av de valda arbetar redan den dagen. Ingen får två pass samma datum."
            : tErr.message,
        );
        setSaving(false);
        return;
      }
    }

    router.push("/");
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
        <Input
          inputMode="decimal"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
      </Field>

      <Group label="Antal personer">
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

      <Group label={`Vilka jobbar? (${picked.length}/${headcount})`}>
        <div className="flex flex-col gap-2">
          {workers.map((w) => {
            const on = picked.includes(w.id);
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
        <Button
          onClick={save}
          disabled={saving || !projectId || hours.trim() === "" || picked.length === 0}
        >
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
