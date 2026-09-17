"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, Segmented, SoftField, SoftInput, SoftNotice, SoftScreen,
  SoftSelect, SoftTextarea,
} from "@/components/soft";
import { NyArbetareForm, type CreatedWorker } from "@/components/ny-arbetare";
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
  useEffect(() => {
    void (async () => {
      if (!projectId || !date) { setUpptagen(0); return; }
      const { count } = await getSupabase()
        .from("pass")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("work_date", date)
        .is("deleted_at", null);
      setUpptagen(count ?? 0);
    })();
  }, [projectId, date]);

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
        title="Ny arbetare"
        back="/snabb"
        subtitle="Skapas och läggs sedan direkt på passet."
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
      <SoftScreen title="Snabb Pass skapat" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="live">{done} är inlagd på {date}.</SoftNotice>
        </div>

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
      <SoftScreen title="Snabb Pass" back="/">
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
      title="Snabb Pass"
      back="/"
      subtitle="Går förbi hela turordningen. Används när någon hoppar av i sista stund."
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
            <SoftField label="Projekt">
              {/* Changing either of these changes whether Före is possible at
                  all, so a refusal about the old one must not outlive it. */}
              <SoftSelect
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Välj…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </SoftSelect>
            </SoftField>
          </div>

          <div className="mb-[14px]">
            <SoftField label="Vem?" help="Finns personen inte i listan — välj Ny arbetare.">
              <SoftSelect
                value={workerId}
                onChange={(e) => {
                  if (e.target.value === NEW) { setCreatingWorker(true); return; }
                  setWorkerId(e.target.value);
                }}
              >
                <option value="">Välj…</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
                <option value={NEW}>+ Ny arbetare…</option>
              </SoftSelect>
            </SoftField>
          </div>

          <div className="mb-[14px]">
            <SoftField label="Datum">
              <SoftInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </SoftField>
          </div>

          <div className="mb-[14px] flex gap-[10px]">
            <div className="min-w-0 flex-1">
              <SoftField label="Börjar">
                <SoftInput type="time" value={start} onChange={(e) => setTime("start", e.target.value)} />
              </SoftField>
            </div>
            <div className="min-w-0 flex-1">
              <SoftField label="Slutar">
                <SoftInput type="time" value={end} onChange={(e) => setTime("end", e.target.value)} />
              </SoftField>
            </div>
          </div>

          {/* The biggest thing in the card, because it is the one figure a
              human is answerable for. Prefilled, never derived (invariant 1). */}
          <SoftField
            label="Timmar"
            help="Förifylls som tiden minus 30 min. Ändra om rasten var längre."
            big
          >
            <SoftInput
              inputMode="decimal"
              value={hours}
              onChange={(e) => { setHours(e.target.value); setHoursTouched(true); }}
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
                <SoftField
                  label="Vad vi gjorde"
                  help="Går rakt in i arbetsdagboken. Utan den kan dagen inte föras in."
                >
                  <SoftTextarea
                    rows={3}
                    value={gjorde}
                    onChange={(e) => setGjorde(e.target.value)}
                    placeholder="Rivning av innertak, plan 2."
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
                  <SoftField
                    label={`Timmar — ${l.name} (arbetsledare)`}
                    help="Förifylls som passets tid minus 30 min. Ändra om dagen var en annan."
                  >
                    <SoftInput
                      inputMode="decimal"
                      value={ledarTimmar(l)}
                      onChange={(e) => setLedare((ls) => ls.map((x) =>
                        x.worker_id === l.worker_id
                          ? { ...x, hours: e.target.value, touched: true }
                          : x))}
                    />
                  </SoftField>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>

      <div className="px-4 pt-[14px]">
        <SoftNotice tone="warn">
          Har personen redan ett pass den dagen tas det bort och detta gäller i stället.
        </SoftNotice>
      </div>

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
      <Suspense fallback={<SoftScreen title="Snabb Pass" back="/"><span /></SoftScreen>}>
        <SnabbFromUrl />
      </Suspense>
    </AuthGate>
  );
}
