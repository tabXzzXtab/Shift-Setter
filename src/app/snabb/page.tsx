"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, CountedTextarea, PrimaryButton, Segmented, SoftField, SoftNotice, SoftScreen,
  SoftDone, Stepper,
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

/**
 * An arbetsledare who will be placed on this day by app.sync_leader_day() the
 * moment the pass is written, and whose hours the admin has to accept if the
 * day is being filed straight into the Arbetsdagbok. `touched` is invariant
 * 1's distinction: until somebody types over it the figure follows the span,
 * and afterwards it is theirs and nothing recomputes it.
 */
type Ledare = { worker_id: string; name: string; hours: string; touched: boolean };

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
 * any other row. What it no longer always does is wait for a confirmation:
 * the admin chooses at creation time.
 *
 * EFTER BEKRÄFTELSE is what Snabb Pass has always done -- the day goes to the
 * arbetsledare, who confirms it at stage 1, and the admin approves at stage 2.
 * Right whenever the leader was running the day anyway, and the default in the
 * database (p_direkt omits to false) even though this screen offers Före first.
 *
 * FÖRE BEKRÄFTELSE files the day as the admin states it. That is the case this
 * escape hatch exists for: somebody dropped out at seven, the admin rang a
 * replacement, that person worked alone, and there is no leader who could
 * honestly confirm a day they were not on. It is offered only where the
 * question of whose hours are being locked does not arise -- one pass on the
 * day, a date that has already happened, an account of what was done, and an
 * accepted figure against every arbetsledare the day will place. Each of those
 * is refused by the database too; the screen's job is to say so before the
 * admin has typed a form they cannot submit.
 *
 * If the person is not on the roster, the dropdown offers Ny Arbetare: the same
 * form, the same copy-then-create gate, and then straight back here to finish
 * as though nothing happened.
 *
 * If they already hold an assignment that day, the Snabb Pass wins and the
 * earlier one is released -- in one transaction, so invariant 2 is never
 * momentarily false. The amber panel says so BEFORE the button, which is the
 * handoff's rule for it: an override is explained where the decision is made,
 * not reported once it has happened.
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
  // Which route actually ran, kept apart from the live toggle: the confirmation
  // screen has to describe what happened, and the toggle is still sitting where
  // the admin left it for the next one.
  const [doneDirekt, setDoneDirekt] = useState(false);
  const [reload, setReload] = useState(0);

  // ---- the two modes -------------------------------------------------------
  const [direkt, setDirekt] = useState(true);
  const [gjorde, setGjorde] = useState("");
  const [ledare, setLedare] = useState<Ledare[]>([]);
  // How many passes already stand on this project that date. Not a courtesy
  // count: it is the whole of whether Före is available, because project_day's
  // key is (project, date) and confirming the day confirms everyone on it.
  const [upptagen, setUpptagen] = useState(0);
  const today = stockholmToday();

  /**
   * Why Före is not on offer -- DERIVED, not remembered.
   *
   * It was a piece of state set when the admin pressed the control, and that
   * was wrong twice over. The pass count arrives from the database a moment
   * after the date does, so a quick press was answered before the reason
   * existed and the control simply flipped back with nothing said. And a
   * reason set on one day outlived the move to another.
   *
   * Computed from the day itself, it cannot do either: it appears the instant
   * the day is known to be unavailable, and it is gone the instant it is not.
   */
  const foreHinder =
    upptagen > 0
      ? `Det står redan ${upptagen} pass på projektet den ${date}. En dag som fler personer `
        + "arbetar på bekräftas av arbetsledaren — annars låses deras timmar av någon som inte var där."
      : date > today
        ? `Den ${date} har inte varit än. Arbetsdagboken beskriver arbete som är utfört, `
          + "så ett pass kan bara föras in i den i efterhand."
        : null;

  const foreMojlig = foreHinder === null;
  // What is actually sent. The admin's choice AND the day allowing it -- a
  // toggle left on from a day that allowed it must not follow them to one
  // that does not.
  const direktAktiv = direkt && foreMojlig;

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

  // Is the day already somebody's? Counted rather than fetched: the number is
  // all the screen says, and the day may hold a whole crew.
  // THE LAST RESPONSE IS NOT THE LATEST DAY. Changing the date starts a second
  // count before the first has come back, and two round trips to the same
  // table do not return in the order they were sent. Without this the answer
  // about the day the admin just left could land after the answer about the
  // day they moved to, and foreHinder -- derived, and correct -- would then be
  // derived from a count belonging to a date nobody is looking at any more.
  // The refusal about a shared day reappeared on a clean one, which is the
  // exact failure the comment above foreHinder says it removed: the reason was
  // no longer remembered, but the number it read was.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!projectId || !date) { setUpptagen(0); return; }
      const { count } = await getSupabase()
        .from("pass")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("work_date", date)
        .is("deleted_at", null);
      if (!active) return;
      setUpptagen(count ?? 0);
    })();
    return () => { active = false; };
  }, [projectId, date]);

  /**
   * WHAT THIS PASS WILL TAKE AWAY, if anything -- asked, not assumed.
   *
   * create_snabb_pass releases the worker's shifts that OVERLAP the new one and
   * nothing else (invariant 2): non-leader rows from the day before to the day
   * after, compared as real timestamps, so last night's 22:00-06:00 counts.
   * The screen mirrors that rule so the warning appears exactly when the
   * database will remove something, and says what. The warning used to stand
   * on every Snabb Pass whether or not anything collided.
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

  // The arbetsledare this project will place on the day. Read from
  // project_leader rather than guessed, and filtered to those who HAVE a
  // worker record -- a leader who never works shifts has nothing to place and
  // app.sync_leader_day() skips them, so asking the admin for their hours
  // would be asking about a row that will not exist.
  useEffect(() => {
    void (async () => {
      if (!projectId) { setLedare([]); return; }
      const sb = getSupabase();
      const { data: pl } = await sb
        .from("project_leader").select("account_id").eq("project_id", projectId);
      const ids = (pl ?? []).map((r) => r.account_id);
      if (ids.length === 0) { setLedare([]); return; }

      const { data: ws } = await sb
        .from("worker").select("id, name, account_id")
        .in("account_id", ids).is("deleted_at", null);
      setLedare((ws ?? []).map((w) => ({
        worker_id: w.id, name: w.name, hours: "", touched: false,
      })));
    })();
  }, [projectId]);

  /**
   * A leader's figure: the day's span less the ordinary break until somebody
   * types over it, and theirs afterwards (invariant 1). Derived at render
   * rather than stored, so changing a time cannot leave a stale number behind
   * and there is no effect to keep in step with the two it depends on.
   *
   * The span IS the pass here -- Före only exists on a day with one pass -- so
   * the leader's envelope and the worker's shift are the same hours, and they
   * come off it the same way.
   */
  function ledarTimmar(l: Ledare) {
    return l.touched ? l.hours : defaultHours(start, end);
  }

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
      // p_direkt is always sent, so the route is stated rather than inferred
      // from what is missing. The other two fall away on the Efter route and
      // take their SQL defaults, because there is nothing yet to say -- the
      // leader writes the account of the day and their own figure when they
      // confirm it.
      p_direkt: direktAktiv,
      p_text: direktAktiv ? gjorde.trim() : undefined,
      p_ledare: direktAktiv
        ? ledare.map((l) => ({
            worker: l.worker_id,
            hours: Number(ledarTimmar(l).replace(",", ".")),
          }))
        : [],
    });

    if (error) {
      setError(fel(error, "Snabbpasset kunde inte skapas. Kontakta administratören."));
      setSaving(false);
      return;
    }

    setDoneDirekt(direktAktiv);
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

        {/* WHICH ROUTE RAN, SAID PLAINLY. These two end in different places --
            one day is finished and one is waiting on a person -- and an admin
            who cannot tell them apart from this screen has to go and look. */}
        <p
          className="px-5 pt-[14px] text-[15px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          {doneDirekt
            ? "Dagen är förd till arbetsdagboken med de timmar du angav. Den är klar "
              + "och kan inte ändras — arbetsdagboken kan skrivas ut direkt."
            : "Passet syns som vilket pass som helst och ska bekräftas som vanligt. "
              + "Arbetsledaren har fått en avisering om att dagen väntar på dem."}
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
      // The line follows the mode: filed direkt, the hours are final the
      // moment it is pressed; through the leader, the clash is what goes wrong.
      subtitle={
        direktAktiv
          ? "Kontrollera timmarna innan du för in dagen."
          : "Kontrollera att personen inte redan jobbar då."
      }
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
            {/* Changing this changes whether Före is possible at all, so a
                refusal about the old project must not outlive it. */}
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

      {/* ---- THE TWO ROUTES ---------------------------------------------
          Its own card, below the shift and above the button, because it is
          not a detail of the shift -- it decides whether the day is finished
          when this screen closes or handed to somebody. */}
      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <div
            className="mb-[2px] text-[12px] font-bold uppercase"
            style={{ letterSpacing: ".9px", color: C.text2 }}
          >
            Generera arbetsdagbok direkt
          </div>
          <p className="mb-[10px] text-[14px] font-medium" style={{ color: C.text2 }}>
            Vem som bekräftar dagen.
          </p>

          <Segmented
            label="Generera arbetsdagbok direkt"
            value={direktAktiv ? "fore" : "efter"}
            onChange={(v) => setDirekt(v === "fore")}
            options={[
              { value: "fore", label: "Före bekräftelse" },
              { value: "efter", label: "Efter bekräftelse" },
            ]}
          />

          {/* Shown whenever the admin has asked for Före and the day will not
              give it -- which covers both the press and the day changing under
              a choice already made. The control reads Efter either way; this
              is what keeps that from looking like it ignored them. */}
          {direkt && foreHinder && (
            <div className="pt-[14px]">
              <SoftNotice tone="warn">{foreHinder}</SoftNotice>
            </div>
          )}

          <p
            className="px-1 pt-[14px] text-[15px] font-medium"
            style={{ color: C.text2, textWrap: "pretty" }}
          >
            {direktAktiv
              ? "Dagen förs in i arbetsdagboken med en gång, med de timmar du anger här. "
                + "Ingen arbetsledare bekräftar den och den går inte att ändra efteråt."
              : "Dagen går till arbetsledaren, som bekräftar den som vanligt. Du godkänner "
                + "den sedan i Bekräftelser."}
          </p>

          {direktAktiv && (
            <>
              <div className="pt-[18px]">
                <SoftField label="Vad vi gjorde">
                  <CountedTextarea
                    rows={3}
                    value={gjorde}
                    onChange={(e) => setGjorde(e.target.value)}
                    placeholder="Beskriv kortfattat vad som gjordes."
                  />
                </SoftField>
              </div>

              {/* INVARIANT 1, ITS LAST EDITABLE MOMENT. These rows are created
                  by the database the instant the pass is written, and they are
                  paid. Före closes the day, so there is no later stage in which
                  to correct them -- which is exactly why they are typed here
                  rather than computed behind the admin's back. */}
              {ledare.map((l) => (
                <div key={l.worker_id} className="pt-[18px]">
                  <SoftField label={`Timmar — ${l.name} (arbetsledare)`} htmlFor={`ledare-${l.worker_id}`}>
                    <Stepper
                      id={`ledare-${l.worker_id}`}
                      label={`Timmar — ${l.name} (arbetsledare)`}
                      decLabel={`Färre, ${l.name}`}
                      incLabel={`Fler, ${l.name}`}
                      step={0.25}
                      min={0}
                      max={24}
                      unit="h"
                      value={ledarTimmar(l)}
                      onChange={(v) => setLedare((ls) => ls.map((x) =>
                        x.worker_id === l.worker_id ? { ...x, hours: v, touched: true } : x))}
                    />
                  </SoftField>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>

      {/* Red because it removes real work (notice audit R5) -- and only when
          it will: the overlapping shifts, named. */}
      {krock.length > 0 && (
        <div className="px-4 pt-[14px]">
          <SoftNotice tone="stop" headline="Krockar med ett annat pass">
            {krock.map((k) => `${k.project} ${k.start}–${k.end}${k.date !== date ? ` (${k.date})` : ""}`).join(", ")}
            {" "}tas bort och det här passet gäller i stället.
          </SoftNotice>
        </div>
      )}

      <div className="px-4 pt-[14px]">
        <PrimaryButton
          onClick={save}
          disabled={
            saving || !projectId || !workerId
            || !(Number(hours.replace(",", ".")) > 0)
            // Före cannot be submitted without the day's account: the database
            // refuses it, and a button that fires a request it knows will
            // bounce teaches the admin to distrust the screen.
            || (direktAktiv && gjorde.trim() === "")
          }
        >
          {saving
            ? "Skapar…"
            : direktAktiv ? "Skapa och för in i arbetsdagboken" : "Skapa Snabb Pass"}
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
