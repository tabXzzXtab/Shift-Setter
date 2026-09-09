"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SecondaryButton, SHADOW, SoftField, SoftInput,
  SoftNotice, SoftScreen, SoftSelect,
} from "@/components/soft";
import { PaintCalendar } from "@/components/paint-calendar";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";
import { defaultHours } from "@/lib/hours";

type Project = { id: string; name: string };
type Worker = { id: string; name: string };
type Row = {
  headcount: number;
  start: string;
  end: string;
  hours: string;
  /** Set once the leader types their own figure. From then on the field is
   *  theirs and the span stops touching it. */
  hoursTouched: boolean;
};
type Short = { work_date: string; available: number; slots: number; short: number };

const newRow = (): Row => ({
  headcount: 1,
  start: "07:00",
  end: "16:00",
  hours: defaultHours("07:00", "16:00"),
  hoursTouched: false,
});

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
 * Handplocka lists ARBETARE. An arbetsledare is placed by Step 4b the moment a
 * worker holds a slot on their project, so a leader in this list would be the
 * screen offering the wrong thing under the right name -- and Step 4b skips a
 * leader already holding an ordinary assignment, so picking one is precisely
 * how a day loses the person answerable for it. The database refuses it; the
 * list not showing it is the courtesy.
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
      // Handplocka fills the slots the pass DEMANDED, and an arbetsledare never
      // occupies one -- Step 4b places them the moment a worker holds a slot.
      // Picking one onto a worker slot is how Step 4b then skips them and the
      // day loses whoever was answerable for it, so the database refuses it.
      // This is why the list never offers the refusal.
      const { data: w } = await sb
        .from("worker_roster").select("id, name").eq("role", "arbetare").order("name");
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

  /**
   * Changing a time re-suggests the hours -- but only while the leader has not
   * typed their own. Overwriting a figure someone entered because they nudged
   * an end time by five minutes would be the app arguing with them.
   */
  function setTime(i: number, key: "start" | "end", value: string) {
    setRows((p) => p.map((x, j) => {
      if (j !== i) return x;
      const next = { ...x, [key]: value };
      if (!x.hoursTouched) next.hours = defaultHours(next.start, next.end);
      return next;
    }));
  }

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
      <SoftScreen title="Passen är skapade" back="/">
        <div className="px-4 pt-[2px]">
          <Card radius={16} shadow={SHADOW.hero} pad="px-5 pb-5 pt-[18px]">
            <div
              className="mb-[2px] text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Skapade
            </div>
            <div className="text-[34px] font-extrabold leading-[1.05]" style={{ letterSpacing: "-1.4px" }}>
              {result.passes} pass
            </div>
            <div className="mt-1 text-[15px] font-medium" style={{ color: C.text2 }}>
              {result.filled} av {result.slots} platser tillsatta
            </div>
          </Card>
        </div>

        {result.slots > result.filled && (
          <div className="px-4 pt-[14px]">
            <SoftNotice tone="warn">
              {result.slots - result.filled} plats(er) kvar. De har gått ut som Acceptera Pass.
            </SoftNotice>
          </div>
        )}

        <div className="px-4 pt-[22px]">
          <PrimaryButton
            onClick={() => {
              setResult(null); setDays([]); setRows([newRow()]);
              setHandpicked([]); setStep("days");
            }}
          >
            Skapa fler
          </PrimaryButton>
        </div>
      </SoftScreen>
    );
  }

  // ---- step 1: which days ---------------------------------------------------
  //
  // A SUB-SCREEN, not a full-bleed overlay with a floating confirm. The
  // handoff's picker is 44px cells at a 2px gap, so a six-week month, the
  // count panel and Fortsätt all fit on a phone without scrolling -- which is
  // the only thing the fixed corner button was solving. The button that leaves
  // this step is now where every other screen's is: at the bottom, after the
  // thing it is confirming.
  if (step === "days") {
    return (
      <SoftScreen
        title="Vilka dagar?"
        back="/"
        subtitle="Tryck på en dag, eller dra över flera."
      >
        <div className="px-4 pt-[14px]">
          <PaintCalendar
            soft
            month={month}
            onMonthChange={setMonth}
            onPaint={toggleDay}
            look={(date) => {
              const on = days.includes(date);
              const past = date < today;
              return {
                className: on ? "font-extrabold" : "font-semibold",
                style: {
                  background: past ? "transparent" : on ? C.accent : C.panel2,
                  color: past ? C.chevron : on ? C.surface : C.ink,
                  cursor: past ? "default" : "pointer",
                },
                label: `${Number(date.slice(8))} ${on ? "vald" : "inte vald"}`,
              };
            }}
          />
        </div>

        <div className="px-4 pt-[22px]">
          <div
            className="flex items-center justify-between gap-3 rounded-[12px] px-4 py-[14px]"
            style={{ background: C.panel2 }}
          >
            <span className="text-[15px] font-semibold" style={{ color: C.text2 }}>
              Valda dagar
            </span>
            {/* The one number on the screen, and the thing Fortsätt is waiting
                for -- announced when it changes, because a count that only
                exists as a numeral is invisible to a screen reader mid-drag. */}
            <span
              data-picked-count={days.length}
              aria-live="polite"
              aria-label={`${days.length} dagar valda`}
              className="text-[20px] font-extrabold"
              style={{ letterSpacing: "-.5px" }}
            >
              {days.length}
            </span>
          </div>
        </div>

        <div className="px-4 pt-[14px]">
          <PrimaryButton onClick={() => setStep("detail")} disabled={days.length === 0}>
            Fortsätt
          </PrimaryButton>
        </div>
      </SoftScreen>
    );
  }

  // ---- step 2: what each day needs ------------------------------------------
  //
  // The handoff draws no screen for this one -- it stops at Vilka dagar. Built
  // out of the same pieces anyway, because a wizard that changes language
  // between its two steps reads as two different apps.
  return (
    <SoftScreen title="Vad behövs?" back="/">
      {error && <div className="px-4 pb-[10px] pt-[2px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <div className="px-4 pt-[2px]">
        <button
          type="button"
          onClick={() => setStep("days")}
          className="press-scale flex h-[60px] w-full items-center justify-between rounded-[12px] px-4 text-[17px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
          style={{ letterSpacing: "-.2px", background: C.panel2, color: C.inkHover }}
        >
          <span>{days.length} dag(ar) valda</span>
          <span aria-hidden className="text-[15px] font-bold">Ändra</span>
        </button>
      </div>

      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <SoftField label="Projekt">
            <SoftSelect value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Välj…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </SoftSelect>
          </SoftField>
        </Card>
      </div>

      {/*
        fieldset/legend, not a label: a label may only name one control, and
        wrapping a whole row of them in one makes its text part of the first
        control's accessible name.
      */}
      <fieldset className="block border-0 p-0 px-4 pt-[26px]">
        <legend
          className="px-1 pb-1 text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          Pass per dag
        </legend>
        <p
          className="px-1 pb-[10px] text-[14px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          Varje rad skapas på varje vald dag. Timmar förifylls som tiden minus 30 min — ändra om rasten var längre.
        </p>

        <div className="flex flex-col gap-[14px]">
          {rows.map((r, i) => (
            <Card key={i} radius={16} pad="p-[18px]">
              <div className="mb-[14px] flex items-center justify-between">
                <span className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                  Rad {i + 1}
                </span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Ta bort rad ${i + 1}`}
                    onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                    className="press-scale h-11 rounded-[10px] px-[14px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#f6d8dd] active:scale-[.985]"
                    style={{ background: C.stopBg, color: C.stopInk }}
                  >
                    Ta bort
                  </button>
                )}
              </div>

              {/* The headcount stepper: minus, the number, plus. */}
              <div className="mb-[14px] flex items-stretch gap-[10px]">
                <button
                  type="button"
                  aria-label={`Färre på rad ${i + 1}`}
                  onClick={() => setRows((p) => p.map((x, j) => j === i ? { ...x, headcount: Math.max(1, x.headcount - 1) } : x))}
                  className="press-scale h-[52px] w-16 rounded-[10px] text-[24px] font-extrabold leading-none transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
                  style={{ background: C.panel2, color: C.inkHover }}
                >
                  −
                </button>
                <output
                  className="flex h-[52px] flex-1 items-center justify-center rounded-[10px] text-[26px] font-extrabold"
                  style={{ letterSpacing: "-.6px", background: C.panel2 }}
                >
                  {r.headcount}
                </output>
                <button
                  type="button"
                  aria-label={`Fler på rad ${i + 1}`}
                  onClick={() => setRows((p) => p.map((x, j) => j === i ? { ...x, headcount: Math.min(20, x.headcount + 1) } : x))}
                  className="press-scale h-[52px] w-16 rounded-[10px] text-[24px] font-extrabold leading-none transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
                  style={{ background: C.panel2, color: C.inkHover }}
                >
                  +
                </button>
              </div>

              <div className="flex gap-[10px]">
                <div className="min-w-0 flex-1">
                  <SoftField label="Börjar">
                    <SoftInput
                      type="time" value={r.start}
                      onChange={(e) => setTime(i, "start", e.target.value)}
                    />
                  </SoftField>
                </div>
                <div className="min-w-0 flex-1">
                  <SoftField label="Slutar">
                    <SoftInput
                      type="time" value={r.end}
                      onChange={(e) => setTime(i, "end", e.target.value)}
                    />
                  </SoftField>
                </div>
                <div className="min-w-0 flex-1">
                  <SoftField label="Timmar">
                    <SoftInput
                      inputMode="decimal" value={r.hours}
                      aria-label={`Timmar på rad ${i + 1}`}
                      onChange={(e) => setRows((p) => p.map((x, j) =>
                        j === i ? { ...x, hours: e.target.value, hoursTouched: true } : x))}
                    />
                  </SoftField>
                </div>
              </div>
            </Card>
          ))}

          <SecondaryButton onClick={() => setRows((p) => [...p, newRow()])}>
            + Lägg till rad
          </SecondaryButton>
        </div>
      </fieldset>

      <div className="px-4 pt-[22px]">
        <div
          className="rounded-[12px] px-4 py-[14px] text-[15px] font-semibold"
          style={{ background: C.panel2, color: C.inkHover }}
        >
          {rows.length} rad(er) × {days.length} dag(ar) = {totalPasses} pass, {totalSlots} platser
        </div>
      </div>

      {shortTotal > 0 && (
        <div className="px-4 pt-[14px]">
          <SoftNotice tone="warn">
            {shortTotal} plats(er) saknar folk som markerat dagen
            {shortDays.length > 0 && (
              <> — sämst {shortDays[0]!.work_date} ({shortDays[0]!.available} av {shortDays[0]!.slots})</>
            )}
            . Resten går ut som Acceptera Pass.
          </SoftNotice>
        </div>
      )}

      <fieldset className="block border-0 p-0 px-4 pt-[26px]">
        <legend
          className="px-1 pb-1 text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          Handplocka ({handpicked.length})
        </legend>
        <p
          className="px-1 pb-[10px] text-[14px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          Frivilligt. Ger förtur — men bara till dem som markerat dagen. Arbetsledare står inte i listan, de placeras automatiskt.
        </p>

        <div
          className="overflow-hidden rounded-[14px]"
          style={{ background: C.surface, boxShadow: SHADOW.group }}
        >
          {workers.map((w, i) => {
            const on = handpicked.includes(w.id);
            return (
              <div key={w.id}>
                {i > 0 && <div className="ml-[18px] h-px" style={{ background: C.hairline }} />}
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setHandpicked((p) => on ? p.filter((x) => x !== w.id) : [...p, w.id])}
                  className="flex h-[60px] w-full items-center justify-between px-[18px] text-[17px] font-bold hover:bg-[#f6f9ff]"
                  style={{ letterSpacing: "-.2px", background: on ? C.panel2 : undefined }}
                >
                  <span>{w.name}</span>
                  {/* Colour is never the only carrier: a chosen row is a tint
                      AND a check, and aria-pressed says it out loud. */}
                  {on ? (
                    <svg width="15" height="12" viewBox="0 0 11 9" fill="none" aria-hidden>
                      <path d="M1 4.6 4 7.6 10 1.4" stroke={C.accent} strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden>
                      <path d="M7.5 1v13M1 7.5h13" stroke={C.chevron} strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="px-4 pt-[26px]">
        <PrimaryButton
          onClick={generate}
          disabled={
            saving || !projectId || days.length === 0 ||
            rows.some((r) => !(Number(r.hours.replace(",", ".")) > 0))
          }
        >
          {saving ? `Skapar ${totalPasses} pass…` : `Skapa ${totalPasses} pass`}
        </PrimaryButton>
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyttPass />
    </AuthGate>
  );
}
