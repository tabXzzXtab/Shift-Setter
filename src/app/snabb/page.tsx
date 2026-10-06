"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SoftField, SoftNotice, SoftScreen, SoftDone, Stepper,
} from "@/components/soft";
import { NyArbetareForm, type CreatedWorker } from "@/components/ny-arbetare";
import { DateField } from "@/components/date-field";
import { PickField } from "@/components/pick-field";
import { TimeField } from "@/components/time-wheel";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";
import { defaultHours } from "@/lib/hours";
import { useAccount } from "@/lib/account";
import { fel } from "@/lib/fel";

type Project = { id: string; name: string };
type Worker = { id: string; name: string };

const NEW = "__ny__";

/**
 * Snabb Pass -- the escape hatch. ADMIN ONLY.
 *
 * Creating one is inseparable from putting someone on a shift who may not be
 * on the roster, and adding them creates an account. That is the admin's
 * power, so this whole screen is.
 *
 * Bypasses the entire priority list: no förval, no acceptance, no headcount
 * check, no priolista. For last-second dropouts, verbal arrangements, covering
 * a no-show. The leader has already decided; this only records it.
 *
 * On paper it is an ordinary shift. It prints in the Arbetsdagbok exactly like
 * any other row, and the day goes to the arbetsledare to confirm and then to
 * stage 2, as every day does. The "Generera arbetsdagbok direkt" choice (Före
 * bekräftelse, filing the day at creation) is gone from this screen -- the
 * owner's decision, 2026-10-06. The database still has the route; nothing
 * sends p_direkt any more, and it defaults to false.
 *
 * If the person is not on the roster, the dropdown offers Ny Arbetare: the same
 * form, the same copy-then-create gate, and then straight back here to finish
 * as though nothing happened.
 *
 * A CLASH IS REFUSED, NOT RESOLVED (owner's decision, 2026-10-06). If the
 * person already holds a shift whose hours overlap these, nothing replaces it:
 * the screen names the shift in the way and keeps Skapa disabled, and
 * create_snabb_pass refuses it too (20261006100000). A second shift that does
 * NOT overlap -- an afternoon after a morning -- is allowed (invariant 2).
 */
function SnabbPass({ asked }: { asked: string | null }) {
  const { account } = useAccount();
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workerId, setWorkerId] = useState("");
  // The day page hands the date over in ?datum= so the admin does not press a
  // day and then type it again. Today when it did not, which is what somebody
  // arriving from the menu wants. Editable either way: every gate on this
  // screen is computed from `date`, not from where it came from.
  const [date, setDate] = useState(asked ?? stockholmToday());
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("16:00");
  const [hours, setHours] = useState(() => defaultHours("07:00", "16:00"));
  // Once the admin types their own figure the field is theirs, and changing a
  // time stops touching it.
  const [hoursTouched, setHoursTouched] = useState(false);
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [credentials, setCredentials] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    void (async () => {
      const { data: p } = await sb.from("project").select("id, name").order("name");
      const list = (p ?? []).map((x) => ({ id: x.id, name: x.name }));
      setProjects(list);
      if (list.length === 1) setProjectId((cur) => cur || list[0]!.id);

      const { data: w } = await sb.from("worker_roster").select("id, name").order("name");
      setWorkers((w ?? []).flatMap((x) => (x.id && x.name ? [{ id: x.id, name: x.name }] : [])));
    })();
  }, [reload]);

  /**
   * WHAT IS IN THE WAY, if anything -- asked, not assumed.
   *
   * create_snabb_pass refuses a pass whose hours OVERLAP one of the worker's
   * shifts (invariant 2): non-leader rows from the day before to the day after,
   * compared as real timestamps, so last night's 22:00-06:00 counts. The
   * screen mirrors that rule exactly, so the refusal is on screen -- naming the
   * shift -- before Skapa is pressed, and Skapa stays disabled while it is.
   */
  const [krock, setKrock] = useState<{ project: string; start: string; end: string; date: string }[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!workerId || workerId === NEW || !date || !start || !end) { setKrock([]); return; }
      const shift = (d: string, n: number) => {
        const t = new Date(`${d}T00:00:00Z`);
        t.setUTCDate(t.getUTCDate() + n);
        return t.toISOString().slice(0, 10);
      };
      const { data } = await getSupabase()
        .from("tilldelning")
        .select("work_date, pass:pass_id(start_time, end_time, deleted_at, project:project_id(name))")
        .eq("worker_id", workerId)
        .is("released_at", null)
        .neq("source", "ledare")
        .gte("work_date", shift(date, -1))
        .lte("work_date", shift(date, 1));
      if (!active) return;
      // app.pass_start_at / pass_end_at: an end at or before the start is the next morning.
      const span = (d: string, a: string, b: string) => {
        const s0 = Date.parse(`${d}T${a.slice(0, 5)}:00Z`);
        let e0 = Date.parse(`${d}T${b.slice(0, 5)}:00Z`);
        if (b.slice(0, 5) <= a.slice(0, 5)) e0 += 86_400_000;
        return [s0, e0] as const;
      };
      const [ns, ne] = span(date, start, end);
      type Joined = { start_time: string; end_time: string; deleted_at: string | null; project: { name: string } | null };
      setKrock((data ?? []).flatMap((t) => {
        const ps = t.pass as unknown as Joined | null;
        if (!ps || ps.deleted_at) return [];
        const [os, oe] = span(t.work_date, ps.start_time, ps.end_time);
        return os < ne && ns < oe
          ? [{ project: ps.project?.name ?? "", start: ps.start_time.slice(0, 5), end: ps.end_time.slice(0, 5), date: t.work_date }]
          : [];
      }));
    })();
    return () => { active = false; };
  }, [workerId, date, start, end]);

  async function save() {
    setSaving(true);
    setError(null);

    const { error } = await getSupabase().rpc("create_snabb_pass", {
      p_project: projectId,
      p_worker: workerId,
      p_date: date,
      p_start: start,
      p_end: end,
      p_hours: Number(hours.replace(",", ".")),
    });

    if (error) {
      setError(fel(error, "Snabbpasset kunde inte skapas. Kontakta administratören."));
      setSaving(false);
      return;
    }

    setDone(workers.find((w) => w.id === workerId)?.name ?? "Arbetaren");
    setSaving(false);
  }

  function setTime(key: "start" | "end", value: string) {
    const next = { start, end, [key]: value } as { start: string; end: string };
    if (key === "start") setStart(value); else setEnd(value);
    if (!hoursTouched) setHours(defaultHours(next.start, next.end));
  }

  // ---- Ny Arbetare, from inside the dropdown --------------------------------
  if (creatingWorker) {
    return (
      <SoftScreen
        title="Skapa ett konto"
        back="/snabb"
        subtitle="Kopiera inloggningen innan du skapar kontot."
      >
        <div className="px-4 pt-[14px]">
          <NyArbetareForm
            allowRoleChoice={false}
            onCancel={() => { setCreatingWorker(false); setWorkerId(""); }}
            onCreated={(w: CreatedWorker, block) => {
              // Straight back to the shift, with them selected.
              setWorkers((list) => [...list, { id: w.worker_id, name: w.name }]);
              setWorkerId(w.worker_id);
              setCredentials(block);
              setCreatingWorker(false);
              setReload((n) => n + 1);
            }}
          />
        </div>
      </SoftScreen>
    );
  }

  if (done) {
    return (
      <SoftScreen title="" back="/">
        <SoftDone title="Passet är inlagt" line={`${done} är inlagd på ${date}.`} />

        <p
          className="px-5 pt-[14px] text-[15px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          Passet syns som vilket pass som helst och ska bekräftas som vanligt.
          Arbetsledaren har fått en avisering om att dagen väntar på dem.
        </p>

        {credentials && (
          <div className="px-4 pt-[22px]">
            <Card radius={16} pad="p-[18px]">
              <div
                className="mb-3 text-[12px] font-bold uppercase"
                style={{ letterSpacing: "1px", color: C.text2 }}
              >
                Inloggning att lämna över
              </div>
              {/* A <pre>, because these are credentials: the line breaks are
                  the format, and a proportional wrap turns a password into a
                  guess. */}
              <pre
                className="whitespace-pre-wrap rounded-[10px] p-[14px] text-[15px] font-semibold"
                style={{ background: C.panel2, fontFamily: "inherit" }}
              >
                {credentials}
              </pre>
            </Card>
          </div>
        )}

        <div className="px-4 pt-[22px]">
          <PrimaryButton
            onClick={() => { setDone(null); setCredentials(null); setWorkerId(""); }}
          >
            Skapa ett till
          </PrimaryButton>
        </div>
      </SoftScreen>
    );
  }

  // A courtesy, not a boundary: create_snabb_pass refuses anyone but an admin,
  // and would do so whatever this screen showed. Saying it plainly beats a form
  // whose every button fails.
  if (account && account.role !== "admin") {
    return (
      <SoftScreen title="Sätt in någon på ett pass" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">
            Endast administratören kan skapa Snabb Pass.
          </SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen
      title="Sätt in någon på ett pass"
      back="/"
      subtitle="Kontrollera att personen inte redan jobbar då."
    >
      {(error || projects.length === 0) && (
        <div className="px-4 pb-[4px] pt-[10px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {!error && projects.length === 0 && (
            <SoftNotice tone="quiet">Du är inte tilldelad något projekt.</SoftNotice>
          )}
        </div>
      )}

      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <div className="mb-[14px]">
            <PickField
              label="Projekt"
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>

          <div className="mb-[14px]">
            {/* The same picker as Arbetsledare on Skapa ett projekt: a card of
                people with initials, not the phone's wheel. Ny arbetare is its
                last row and opens the form rather than choosing anybody. */}
            <PickField
              label="Vem?"
              people
              value={workerId}
              onChange={setWorkerId}
              options={workers.map((w) => ({ value: w.id, label: w.name }))}
              action={{ value: NEW, label: "Ny arbetare", onPick: () => setCreatingWorker(true) }}
            />
          </div>

          <div className="mb-[14px]">
            {/* Startdatum's calendar card from Skapa ett projekt. */}
            <DateField label="Datum" value={date} onChange={setDate} />
          </div>

          <div className="relative mb-[14px] flex gap-[10px]">
            <div className="min-w-0 flex-1">
              <TimeField label="Börjar" value={start} onChange={(v) => setTime("start", v)} />
            </div>
            <div className="min-w-0 flex-1">
              <TimeField label="Slutar" value={end} onChange={(v) => setTime("end", v)} />
            </div>
          </div>

          {/* The biggest thing in the card, because it is the one figure a
              human is answerable for. Prefilled, never derived (invariant 1). */}
          <SoftField label="Timmar" htmlFor="snabb-timmar">
            <Stepper
              id="snabb-timmar"
              label="Timmar"
              decLabel="Färre timmar"
              incLabel="Fler timmar"
              step={0.25}
              min={0}
              max={24}
              unit="h"
              value={hours}
              onChange={(v) => { setHours(v); setHoursTouched(true); }}
            />
          </SoftField>
        </Card>
      </div>

      {/* Red because it blocks the pass -- and only when something is really
          in the way: the overlapping shifts, named. Nothing is replaced; the
          admin changes the times or picks somebody else. */}
      {krock.length > 0 && (
        <div className="px-4 pt-[14px]">
          <SoftNotice tone="stop" headline="Krockar med ett annat pass">
            {workers.find((w) => w.id === workerId)?.name ?? "Personen"} jobbar redan{" "}
            {krock.map((k) => `${k.project} ${k.start}–${k.end}${k.date !== date ? ` (${k.date})` : ""}`).join(", ")}.
            {" "}Ändra tiderna eller välj en annan person.
          </SoftNotice>
        </div>
      )}

      <div className="px-4 pt-[14px]">
        <PrimaryButton
          onClick={save}
          disabled={
            saving || !projectId || !workerId
            || !(Number(hours.replace(",", ".")) > 0)
            // A clash is refused by the database; a button that fires a
            // request it knows will bounce teaches the admin to distrust it.
            || krock.length > 0
          }
        >
          {saving ? "Skapar…" : "Skapa Snabb Pass"}
        </PrimaryButton>
      </div>
    </SoftScreen>
  );
}

/**
 * The day arrives as ?datum=. useSearchParams needs a Suspense boundary in a
 * statically exported app -- the query string is not known when the page is
 * prerendered, only when a browser opens it.
 *
 * Shape-checked before it is used, exactly as Öppna dag checks it: the value
 * reaches a date input, a where-clause and every gate on this screen, and
 * anything that is not a date belongs in none of them.
 */
function SnabbFromUrl() {
  const asked = useSearchParams().get("datum");
  return <SnabbPass asked={asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Sätt in någon på ett pass" back="/"><span /></SoftScreen>}>
        <SnabbFromUrl />
      </Suspense>
    </AuthGate>
  );
}
