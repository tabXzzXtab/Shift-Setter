"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Field, Group, Input, Notice, Screen, Select } from "@/components/ui";
import { PaintCalendar } from "@/components/paint-calendar";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";

type Project = { id: string; name: string };
type Worker = { id: string; name: string };
type Row = { headcount: number; start: string; end: string; hours: string };
type Short = { work_date: string; available: number; slots: number; short: number };

const newRow = (): Row => ({ headcount: 1, start: "07:00", end: "16:00", hours: "8" });

/**
 * Skapa Pass -- a month's worth of demand in one pass of the thumb.
 *
 * Two steps, because they are two decisions:
 *
 *   1. WHICH DAYS. A full-screen calendar, the same paint gesture the worker's
 *      förval calendar uses -- tap one day, or drag across many, and drag back
 *      over a day to drop it. The check control is fixed in the corner so it is
 *      reachable without scrolling back up a long month.
 *
 *   2. WHAT EACH DAY NEEDS. One or more template rows, each a headcount and a
 *      span and an hours figure. EVERY row applies to EVERY selected day: two
 *      rows across twelve days is twenty-four passes.
 *
 * Hours are typed, never derived from the span. 07:00-16:00 with an unpaid
 * lunch is eight hours, not nine, and that is the normal case (invariant 1).
 *
 * What comes out is twenty-four independent passes, not one repeating thing.
 * Editing or cancelling a Tuesday must leave every other Tuesday alone, so
 * there is no series object to accidentally edit through.
 */
function NyttPass() {
  const [step, setStep] = useState<"days" | "detail">("days");
  const [month, setMonth] = useState(() => stockholmToday().slice(0, 7));
  const [days, setDays] = useState<string[]>([]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [handpicked, setHandpicked] = useState<string[]>([]);
  const [shortfall, setShortfall] = useState<Short[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ passes: number; filled: number; slots: number; offered: number } | null>(null);

  const today = stockholmToday();
  const slotsPerDay = rows.reduce((n, r) => n + r.headcount, 0);
  const totalPasses = days.length * rows.length;
  const totalSlots = days.length * slotsPerDay;

  useEffect(() => {
    const sb = getSupabase();
    void (async () => {
      const { data: p } = await sb.from("project").select("id, name").order("name");
      const list = (p ?? []).map((x) => ({ id: x.id, name: x.name }));
      setProjects(list);
      if (list.length === 1) setProjectId(list[0]!.id);
      const { data: w } = await sb.from("worker_roster").select("id, name").order("name");
      setWorkers((w ?? []).flatMap((x) => (x.id && x.name ? [{ id: x.id, name: x.name }] : [])));
    })();
  }, []);

  // Coverage across the WHOLE batch. Capacity does not pool: someone free on
  // Monday cannot also cover Tuesday, so it is counted per day and summed.
  useEffect(() => {
    if (step !== "detail" || days.length === 0) return;
    let active = true;
    void (async () => {
      const { data } = await getSupabase()
        .rpc("batch_shortfall", { p_dates: days, p_slots_per_day: slotsPerDay });
      if (active) setShortfall((data ?? []) as Short[]);
    })();
    return () => { active = false; };
  }, [step, days, slotsPerDay]);

  const shortDays = (shortfall ?? []).filter((s) => s.short > 0);
  const shortTotal = shortDays.reduce((n, s) => n + s.short, 0);

  function toggleDay(date: string) {
    setDays((d) => (d.includes(date) ? d.filter((x) => x !== date) : [...d, date]));
  }

  async function generate() {
    setSaving(true);
    setError(null);
    const sb = getSupabase();
    const me = (await sb.auth.getUser()).data.user!.id;

    const { data: batch, error: bErr } = await sb
      .from("pass_batch").insert({ project_id: projectId, created_by: me })
      .select("id").single();
    if (bErr || !batch) { setError(bErr?.message ?? "Kunde inte skapa passen."); setSaving(false); return; }

    if (handpicked.length) {
      const { error: hErr } = await sb.from("pass_batch_handpick")
        .insert(handpicked.map((worker_id) => ({ batch_id: batch.id, worker_id })));
      if (hErr) { setError(hErr.message); setSaving(false); return; }
    }

    // Every row on every day. Each one an independent pass from here on.
    const toInsert = days.flatMap((work_date) =>
      rows.map((r) => ({
        project_id: projectId,
        batch_id: batch.id,
        work_date,
        start_time: r.start,
        end_time: r.end,
        planned_hours: Number(r.hours.replace(",", ".")),
        headcount: r.headcount,
        created_by: me,
      })),
    );

    const { error: pErr } = await sb.from("pass").insert(toInsert);
    if (pErr) { setError(pErr.message); setSaving(false); return; }

    const { data: filled, error: fErr } = await sb.rpc("fill_passes", { p_batch: batch.id });
    if (fErr) { setError(fErr.message); setSaving(false); return; }

    setResult({
      passes: filled?.length ?? toInsert.length,
      filled: (filled ?? []).reduce((n, r) => n + (r.filled ?? 0), 0),
      slots: (filled ?? []).reduce((n, r) => n + (r.slots ?? 0), 0),
      offered: (filled ?? []).reduce((n, r) => n + (r.offered ?? 0), 0),
    });
    setSaving(false);
  }

  // ---- result ---------------------------------------------------------------
  if (result) {
    return (
      <Screen title="Passen är skapade" back="/">
        <p className="mb-2 text-3xl font-bold">{result.passes} pass</p>
        <p className="mb-6 text-xl">
          {result.filled} av {result.slots} platser tillsatta
        </p>
        {result.slots > result.filled && (
          <Notice kind="info">
            {result.slots - result.filled} plats(er) kvar. De har gått ut som Acceptera Pass.
          </Notice>
        )}
        <div className="mt-6 flex flex-col gap-3">
          <Button
            onClick={() => {
              setResult(null); setDays([]); setRows([newRow()]);
              setHandpicked([]); setStep("days");
            }}
          >
            Skapa fler
          </Button>
        </div>
      </Screen>
    );
  }

  // ---- step 1: which days ---------------------------------------------------
  if (step === "days") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
        {/* Fixed in the corner: on a long month the confirm must be reachable
            without scrolling back to the top. */}
        <button
          type="button"
          onClick={() => setStep("detail")}
          disabled={days.length === 0}
          aria-label={`Klar, ${days.length} dagar valda`}
          className="fixed right-4 top-4 z-10 flex h-16 min-w-[64px] items-center justify-center gap-2 border-2 border-black bg-black px-4 text-2xl font-bold text-white disabled:opacity-30"
        >
          {days.length > 0 && <span className="text-lg">{days.length}</span>}
          <span aria-hidden>✓</span>
        </button>

        <div className="mx-auto w-full max-w-md px-4 pb-8 pt-4">
          <div className="mb-6 flex items-center gap-3 pr-24">
            <a
              href="./"
              aria-label="Tillbaka"
              className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-black text-2xl leading-none"
            >
              ←
            </a>
            <h1 className="text-2xl font-bold leading-tight">Vilka dagar?</h1>
          </div>

          <p className="mb-4 text-base">Tryck på en dag, eller dra över flera.</p>

          <PaintCalendar
            month={month}
            onMonthChange={setMonth}
            onPaint={toggleDay}
            look={(date) => {
              const on = days.includes(date);
              const past = date < today;
              return {
                className:
                  (on ? "bg-black text-white" : "bg-white text-black") +
                  (past ? " opacity-40" : ""),
                label: `${Number(date.slice(8))} ${on ? "vald" : "inte vald"}`,
              };
            }}
          />

          <p className="mt-4 text-base" aria-live="polite">
            {days.length} dag(ar) valda
          </p>
        </div>
      </div>
    );
  }

  // ---- step 2: what each day needs ------------------------------------------
  return (
    <Screen title="Vad behövs?" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <button
        type="button"
        onClick={() => setStep("days")}
        className="mb-4 flex min-h-[56px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold"
      >
        <span>{days.length} dag(ar) valda</span>
        <span aria-hidden className="text-base">Ändra</span>
      </button>

      <Field label="Projekt">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Välj…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Group label="Pass per dag" hint="Varje rad skapas på varje vald dag.">
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="border-2 border-black p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-base font-bold">Rad {i + 1}</span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Ta bort rad ${i + 1}`}
                    onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                    className="h-12 min-w-[56px] border-2 border-black px-3 text-base font-bold"
                  >
                    Ta bort
                  </button>
                )}
              </div>

              <div className="mb-3 flex items-stretch gap-2">
                <button
                  type="button"
                  aria-label={`Färre på rad ${i + 1}`}
                  onClick={() => setRows((p) => p.map((x, j) => j === i ? { ...x, headcount: Math.max(1, x.headcount - 1) } : x))}
                  className="h-[56px] w-[64px] border-2 border-black text-3xl font-bold"
                >
                  −
                </button>
                <output className="flex h-[56px] flex-1 items-center justify-center border-2 border-black text-2xl font-bold">
                  {r.headcount}
                </output>
                <button
                  type="button"
                  aria-label={`Fler på rad ${i + 1}`}
                  onClick={() => setRows((p) => p.map((x, j) => j === i ? { ...x, headcount: Math.min(20, x.headcount + 1) } : x))}
                  className="h-[56px] w-[64px] border-2 border-black text-3xl font-bold"
                >
                  +
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase">Börjar</span>
                  <Input
                    type="time" value={r.start}
                    onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, start: e.target.value } : x))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase">Slutar</span>
                  <Input
                    type="time" value={r.end}
                    onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, end: e.target.value } : x))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase">Timmar</span>
                  <Input
                    center
                    inputMode="decimal" value={r.hours}
                    aria-label={`Timmar på rad ${i + 1}`}
                    onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, hours: e.target.value } : x))}
                  />
                </label>
              </div>
            </div>
          ))}

          <Button variant="outline" onClick={() => setRows((p) => [...p, newRow()])}>
            + Lägg till rad
          </Button>
        </div>
      </Group>

      <p className="mb-4 text-lg font-bold">
        {rows.length} rad(er) × {days.length} dag(ar) = {totalPasses} pass, {totalSlots} platser
      </p>

      {shortTotal > 0 && (
        <Notice kind="info">
          {shortTotal} plats(er) saknar folk som markerat dagen
          {shortDays.length > 0 && (
            <> — sämst {shortDays[0]!.work_date} ({shortDays[0]!.available} av {shortDays[0]!.slots})</>
          )}
          . Resten går ut som Acceptera Pass.
        </Notice>
      )}

      <Group label={`Handplocka (${handpicked.length})`} hint="Frivilligt. Ger förtur — men bara till dem som markerat dagen.">
        <div className="flex flex-col gap-2">
          {workers.map((w) => {
            const on = handpicked.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                aria-pressed={on}
                onClick={() => setHandpicked((p) => on ? p.filter((x) => x !== w.id) : [...p, w.id])}
                className={`flex min-h-[56px] items-center justify-between border-2 border-black px-4 text-lg font-bold ${
                  on ? "bg-black text-white" : "bg-white text-black"
                }`}
              >
                <span>{w.name}</span>
                <span aria-hidden className="text-2xl">{on ? "✓" : "+"}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <div className="mt-6">
        <Button
          onClick={generate}
          disabled={saving || !projectId || days.length === 0 || rows.some((r) => r.hours.trim() === "")}
        >
          {saving ? `Skapar ${totalPasses} pass…` : `Skapa ${totalPasses} pass`}
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
