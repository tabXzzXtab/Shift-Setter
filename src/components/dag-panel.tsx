"use client";

import { useEffect, useState } from "react";
import {
  C, Card, ChoiceList, DangerButton, EmptyState, SecondaryButton, SHADOW, SoftDialog,
  SoftField, SoftInput, SoftNotice, Tag,
} from "@/components/soft";
import { BytArbetsledare, replacementOptions, type Options } from "./byt-arbetsledare";
import { BytaPlats, swapPartners, type SwapOptions } from "./byta-plats";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading, svDate } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { useMonthColour } from "@/lib/project-palette";
import { fel } from "@/lib/fel";

type Person = {
  tilldelning_id: string; worker_id: string; name: string; source: string;
  /** Step 4b: the workers' envelope, carried on an auto-assigned leader's
   *  own row. Null on a worker's row, which reads the pass. */
  own_start: string | null; own_end: string | null;
  clock_in: string | null; clock_out: string | null; cancelled_at: string | null;
};
type Replacement = { worker_id: string; name: string };

/** A project whose shifts on this date were all deleted. */
type CalledOff = { project_id: string; project_name: string; cancelled_passes: number };

/** What avboka_pass() hands back: who is free, and whether cards went out. */
type Vacancy = {
  pass_id: string;
  work_date: string;
  beyond_five_days: boolean;
  offered: number;
  replacements: Replacement[];
  /** Carried for the popup heading, not from the database. */
  removed: string;
};
type PassRow = {
  id: string;
  project_id: string;
  project_name: string;
  start_time: string;
  end_time: string;
  planned_hours: number;
  headcount: number;
  people: Person[];
};

/**
 * Everything happening on one day, across every project the viewer can see.
 *
 * This is where the shift calendar sends a day. One component, so deletion has
 * exactly one implementation -- and deletion is admin-only, refuses a shift
 * that has started, notifies the people on it and blocks them from being
 * re-offered it, all in the database.
 *
 * ONE PROJECT AT A TIME when the day holds several. The tabs carry the colour
 * that project wears on the calendar, so the stripe someone pressed and the
 * tab they land on are recognisably the same site. Showing every project at
 * once would put the delete and Avboka controls of three sites in one scroll,
 * which is how the wrong day gets edited.
 *
 * Removing a worker is Step 5b: the slot REOPENS and headcount does not drop.
 * If anyone who marked förval is free, Välj Utbyte opens and picking a name
 * fills the slot on the spot -- at any distance from the shift, because
 * choosing a person is manual placement and not an automatic refill. Only when
 * nobody is free do the Acceptera Pass cards go out, and only outside five
 * days. A popup listing nothing would ask a question with no answers in it.
 *
 * Editing a pass here edits THAT pass. A batch generates independent rows, not
 * a series, so changing this Tuesday cannot reach the next one.
 */
export function DagPanel({ date, heading = true, project }: {
  date: string;
  /** One project's day: its passes only, and no tab strip. The day screen's
   *  timeline sends a tapped pass here, so the choice is already made. */
  project?: string;
  /** False where the SCREEN already names the day above its own controls --
   *  the day page puts the heading over the admin's three actions, and the
   *  same string again here would be the second time in four inches. */
  heading?: boolean;
}) {
  const { account } = useAccount();
  const colourOf = useMonthColour(date.slice(0, 7));
  const [passes, setPasses] = useState<PassRow[] | null>(null);
  /** Which project's tab is open. Null means "whichever sorts first". */
  const [openProject, setOpenProject] = useState<string | null>(null);
  /** Days whose every shift was deleted. See public.cancelled_day. */
  const [cancelled, setCancelled] = useState<CalledOff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [vacancy, setVacancy] = useState<Vacancy | null>(null);
  /** The booking whose trash icon was pressed: nothing is cancelled until the
   *  dialog's Bekräfta, because avboka_pass writes on the first call. */
  const [asking, setAsking] = useState<{ pass: PassRow; person: Person } | null>(null);
  // The pass "Ta bort detta pass" was pressed on, waiting for its answer.
  const [deleting, setDeleting] = useState<PassRow | null>(null);
  const [swap, setSwap] = useState<Options | null>(null);
  const [trade, setTrade] = useState<SwapOptions | null>(null);
  /** Admin: confirm before removing a ledare directly. */
  const [removingLedare, setRemovingLedare] = useState<{
    tilldelning_id: string; name: string; pass: PassRow;
  } | null>(null);
  /** Admin: pick a ledare to place on a pass that has none. */
  const [assigningLedare, setAssigningLedare] = useState<PassRow | null>(null);
  const [ledareCandidates, setLedareCandidates] = useState<{ id: string; name: string }[] | null>(null);
  /** Admin: transfer confirmer role to a different worker. */
  const [transferringPass, setTransferringPass] = useState<PassRow | null>(null);
  const [transferCandidates, setTransferCandidates] = useState<{ id: string; name: string }[] | null>(null);
  /** Admin: cancel an in-progress shift. */
  const [cancellingShift, setCancellingShift] = useState<{ tilldelning_id: string; name: string; pass: PassRow } | null>(null);

  /**
   * Two leaders trading the same day. Offered only when the day actually holds
   * a second one on another project -- with nobody to trade with, the button
   * would open a list of nothing.
   */
  async function askWhoToSwapWith(tilldelningId: string) {
    setBusy(tilldelningId);
    setError(null);
    setNote(null);
    try {
      setTrade(await swapPartners(tilldelningId));
    } catch (e) {
      setError(fel(e, "Kunde inte läsa vilka som kan byta. Ladda om sidan."));
    }
    setBusy(null);
  }

  /**
   * Step 5c. avboka_pass refuses a leader's row outright -- a leader is never
   * simply removed -- so pressing Avboka Pass on one opens the question of who
   * takes the day instead.
   */
  async function askWhoTakesOver(tilldelningId: string) {
    setBusy(tilldelningId);
    setError(null);
    setNote(null);
    try {
      setSwap(await replacementOptions(tilldelningId));
    } catch (e) {
      setError(fel(e, "Kunde inte läsa vilka som är lediga. Ladda om sidan."));
    }
    setBusy(null);
  }
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ start: string; end: string; hours: string; headcount: number } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const sb = getSupabase();
      const { data: rows, error } = await sb
        .from("pass")
        // The plain FK, named: pass carries M1's composite one too, and an
        // unhinted embed is ambiguous. See pendingDays() for the whole reason.
        .select("id, project_id, start_time, end_time, planned_hours, headcount, project!pass_project_id_fkey(name)")
        .eq("work_date", date)
        .is("deleted_at", null)
        .order("start_time");
      if (!active) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa dagens pass. Ladda om sidan."));
        setPasses([]);
        return;
      }

      // ONLY WHEN THE DAY LOOKS EMPTY. A day with shifts on it is not
      // cancelled however many were called off, so there is nothing to ask.
      if ((rows ?? []).length === 0) {
        const { data: off } = await sb
          .from("cancelled_day")
          .select("project_id, project_name, cancelled_passes")
          .eq("work_date", date);
        if (!active) return;
        setCancelled((off ?? []).map((c) => ({
          project_id: c.project_id ?? "",
          project_name: c.project_name ?? "Projekt",
          cancelled_passes: c.cancelled_passes ?? 0,
        })));
      } else {
        setCancelled([]);
      }

      const ids = (rows ?? []).map((r) => r.id);
      const { data: assignments } = ids.length
        ? await sb.from("tilldelning")
            .select("id, pass_id, worker_id, source, own_start, own_end, clock_in, clock_out, cancelled_at")
            .in("pass_id", ids).is("released_at", null)
        : { data: [] };

      const { data: roster } = await sb.from("worker_roster").select("id, name");
      const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

      if (!active) return;
      setPasses((rows ?? []).map((r) => ({
        id: r.id,
        project_id: r.project_id,
        project_name: (r.project as { name: string } | null)?.name ?? "Projekt",
        start_time: r.start_time,
        end_time: r.end_time,
        planned_hours: Number(r.planned_hours),
        headcount: r.headcount,
        people: (assignments ?? [])
          .filter((a) => a.pass_id === r.id)
          .map((a) => ({
            tilldelning_id: a.id,
            worker_id: a.worker_id,
            name: names.get(a.worker_id) ?? "Okänd",
            source: a.source,
            own_start: a.own_start,
            own_end: a.own_end,
            clock_in: a.clock_in ?? null,
            clock_out: a.clock_out ?? null,
            cancelled_at: a.cancelled_at ?? null,
          })),
      })));
    })();
    return () => { active = false; };
  }, [date, reload]);

  async function remove(p: PassRow, person: Person) {
    setBusy(person.tilldelning_id);
    setError(null);
    setNote(null);

    const { data, error } = await getSupabase()
      .rpc("avboka_pass", { p_tilldelning: person.tilldelning_id });

    if (error) {
      setError(fel(error, "Avbokningen gick inte igenom. Kontakta administratören."));
    } else {
      const v = { ...(data as unknown as Omit<Vacancy, "removed">), removed: person.name };
      if (v.replacements.length > 0) {
        setVacancy(v);
      } else {
        setNote(
          v.beyond_five_days
            ? `${person.name} är borttagen. Ingen förvald var ledig, så platsen gick ut som Acceptera Pass till ${v.offered}.`
            : `${person.name} är borttagen. Ingen förvald var ledig och passet är inom fem dagar — sätt in någon själv eller använd Snabb Pass.`,
        );
      }
    }
    setReload((n) => n + 1);
    setBusy(null);
  }

  /** Picking a name from Välj Utbyte fills the slot on the spot. */
  async function place(workerId: string, name: string) {
    if (!vacancy) return;
    setBusy(workerId);
    setError(null);

    const { error } = await getSupabase()
      .rpc("place_replacement", { p_pass: vacancy.pass_id, p_worker: workerId });

    if (error) setError(fel(error, "Hela dagen kunde inte tas bort. Kontakta administratören."));
    else setNote(`${name} tog ${vacancy.removed}s plats.`);

    setVacancy(null);
    setReload((n) => n + 1);
    setBusy(null);
  }

  async function saveEdit(p: PassRow) {
    if (!draft) return;
    setBusy(p.id);
    setError(null);
    const { error } = await getSupabase()
      .from("pass")
      .update({
        start_time: draft.start,
        end_time: draft.end,
        planned_hours: Number(draft.hours.replace(",", ".")),
        headcount: draft.headcount,
      })
      .eq("id", p.id);          // this pass, and only this pass
    if (error) setError(fel(error, "Arbetsledaren kunde inte tas bort från dagen. Kontakta administratören."));
    else setNote("Passet är ändrat. Övriga pass är orörda.");
    setEditing(null);
    setDraft(null);
    setReload((n) => n + 1);
    setBusy(null);
  }

  /**
   * The refusals an admin can actually provoke here, in Swedish.
   *
   * These are not faults -- they are the rules working, and a person deleting a
   * shift will meet them routinely. Showing the raw database sentence in
   * English tells them the app broke, when in fact it did exactly its job.
   * Anything unrecognised still comes through verbatim rather than being
   * swallowed by a vague apology.
   */
  async function cancelPass(p: PassRow) {
    setBusy(p.id);
    setError(null);
    const { error } = await getSupabase().rpc("delete_pass", { p_pass: p.id });
    if (error) setError(fel(error, "Passet kunde inte tas bort. Kontakta administratören."));
    else setNote("Passet är borttaget. Övriga pass är orörda.");
    setReload((n) => n + 1);
    setBusy(null);
  }

  /** Admin: directly release a ledare assignment (bypass replace flow). */
  async function adminRemoveLedare(tilldelningId: string) {
    setBusy(tilldelningId);
    setError(null);
    setNote(null);
    const { error } = await getSupabase()
      .rpc("admin_release_leader", { p_tilldelning: tilldelningId });
    if (error) setError(fel(error, "Arbetsledaren kunde inte tas bort. Kontakta administratören."));
    else setNote("Arbetsledaren är borttagen från dagen.");
    setRemovingLedare(null);
    setReload((n) => n + 1);
    setBusy(null);
  }

  /** Admin: soft-delete an in-progress shift (sets cancelled_at). */
  async function cancelShift(tilldelningId: string) {
    setBusy(tilldelningId);
    setError(null);
    setNote(null);
    const { error } = await getSupabase().rpc("cancel_shift", { p_tilldelning: tilldelningId });
    if (error) setError(fel(error, "Skiftet kunde inte avbrytas. Kontakta administratören."));
    else setNote("Skiftet är markerat som avbrutet.");
    setCancellingShift(null);
    setReload((n) => n + 1);
    setBusy(null);
  }

  /** Admin: restore a cancelled shift (clears cancelled_at). */
  async function uncancelShift(tilldelningId: string) {
    setBusy(tilldelningId);
    setError(null);
    setNote(null);
    const { error } = await getSupabase().rpc("uncancel_shift", { p_tilldelning: tilldelningId });
    if (error) setError(fel(error, "Skiftet kunde inte återställas. Kontakta administratören."));
    else setNote("Skiftet är återställt.");
    setReload((n) => n + 1);
    setBusy(null);
  }

  /** Admin: open the ledare picker for a pass that has none. */
  async function openAssignLedare(p: PassRow) {
    setBusy(p.id);
    setError(null);
    setLedareCandidates(null);
    setAssigningLedare(p);
    const { data, error } = await getSupabase()
      .from("worker_roster")
      .select("id, name")
      .eq("role", "arbetsledare");
    if (error) {
      setError(fel(error, "Kunde inte läsa arbetsledarna. Ladda om sidan."));
      setAssigningLedare(null);
    } else {
      setLedareCandidates((data ?? []).map((w) => ({ id: String(w.id), name: (w.name as string | null) ?? "Okänd" })));
    }
    setBusy(null);
  }

  /** Admin: place the chosen ledare on assigningLedare's pass. */
  async function assignLedare(workerId: string, name: string) {
    if (!assigningLedare) return;
    setBusy(workerId);
    setError(null);
    const { error } = await getSupabase()
      .rpc("admin_assign_leader", { p_pass: assigningLedare.id, p_worker: workerId });
    if (error) setError(fel(error, "Arbetelsdaren kunde inte tilldelas. Kontakta administratören."));
    else setNote(`${name} tilldelas som arbetsledare för dagen.`);
    setAssigningLedare(null);
    setLedareCandidates(null);
    setReload((n) => n + 1);
    setBusy(null);
  }

  /** Admin: open the confirmer-transfer dialog for a pass whose day has workers. */
  function openTransferConfirmation(p: PassRow) {
    setError(null);
    setNote(null);
    // Candidates = all workers on this project-day (non-ledare), deduped by worker_id.
    const seen = new Set<string>();
    const candidates: { id: string; name: string }[] = [];
    for (const q of passes ?? []) {
      if (q.project_id !== p.project_id) continue;
      for (const person of q.people) {
        if (person.source === "ledare") continue;
        if (seen.has(person.worker_id)) continue;
        seen.add(person.worker_id);
        candidates.push({ id: person.worker_id, name: person.name });
      }
    }
    setTransferCandidates(candidates);
    setTransferringPass(p);
  }

  /** Admin: execute the transfer to the chosen worker. */
  async function transferConfirmation(workerId: string, name: string) {
    if (!transferringPass) return;
    setBusy(workerId);
    setError(null);
    const { error } = await getSupabase()
      .rpc("transfer_confirmation", { p_pass: transferringPass.id, p_to_worker: workerId });
    if (error) setError(fel(error, "Bytet kunde inte genomföras. Kontakta administratören."));
    else setNote(`${name} är nu ansvarig för dagen.`);
    setTransferringPass(null);
    setTransferCandidates(null);
    setReload((n) => n + 1);
    setBusy(null);
  }

  /**
   * Is there an arbetsledare on ANOTHER project this day? The swap needs
   * somebody who already has a day to trade, which is the difference between
   * this and Step 5c's list of leaders who happen to be free.
   */
  const leadersElsewhere = (projectId: string) =>
    (passes ?? []).some(
      (q) => q.project_id !== projectId && q.people.some((x) => x.source === "ledare"),
    );

  /** The projects working this day, named once each, in tab order. */
  const projectsToday = [
    ...new Map((passes ?? []).map((p) => [p.project_id, p.project_name])),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  /**
   * DERIVED, not stored. Deleting the last pass of the open project, or moving
   * the date picker to a day that project does not run, has to land somewhere
   * real -- an id held in state would go on pointing at a project that is no
   * longer on the day and the panel would render nothing at all.
   */
  const active = project
    ?? projectsToday.find((p) => p.id === openProject)?.id ?? projectsToday[0]?.id ?? null;
  const showing = (passes ?? []).filter((p) => p.project_id === active);

  return (
    <div data-day-panel={date}>
      {/* AVBRYT SKIFT? -- admin cancels an in-progress shift. */}
      {cancellingShift && (
        <SoftDialog label="Avbryt skift?" onDismiss={() => setCancellingShift(null)}>
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Avbryt skift?
          </h2>
          <p className="mb-[18px] mt-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            {cancellingShift.name}s skift markeras som avbrutet. Arbetaren kan fortfarande stämpla ut.
          </p>
          <div className="mb-[10px]">
            <DangerButton
              onClick={() => { const c = cancellingShift; setCancellingShift(null); void cancelShift(c.tilldelning_id); }}
            >
              Avbryt skift
            </DangerButton>
          </div>
          <SecondaryButton onClick={() => setCancellingShift(null)}>Stäng</SecondaryButton>
        </SoftDialog>
      )}

      {/*
        VÄLJ UTBYTE -- Step 5b's popup.
        Over the scrim, because the slot is open right now and the answer is one
        press away. Closing it without picking is allowed and leaves the slot
        open: the cards are the fallback for having nobody to ask, not a
        consolation for indecision, so nothing goes out behind the leader's
        back after they decided to handle it themselves.
      */}
      {vacancy && (
        <SoftDialog label="Välj Utbyte">
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Välj Utbyte
          </h2>
          <p
            className="mb-[14px] mt-1 text-[15px] font-medium"
            style={{ color: C.text2, textWrap: "pretty" }}
          >
            {vacancy.removed} är borttagen. De här har förvalt {svDate(vacancy.work_date)} och
            är lediga.
          </p>

          <div className="mb-3">
            <ChoiceList
              disabled={busy !== null}
              choices={vacancy.replacements.map((r) => ({
                key: r.worker_id,
                label: r.name,
                onClick: () => place(r.worker_id, r.name),
              }))}
            />
          </div>

          <SecondaryButton onClick={() => setVacancy(null)}>
            Ingen av dem
          </SecondaryButton>
        </SoftDialog>
      )}

      {/* AVBOKA BOKNING? -- the one press that cancels somebody's booking, and
          until now it did so on the first tap. One question, the person's
          name in it, and the destructive answer is the tinted one. */}
      {asking && (
        <SoftDialog label="Avboka bokning?" onDismiss={() => setAsking(null)}>
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Avboka bokning?
          </h2>
          <p className="mb-[18px] mt-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            {asking.person.name} tas bort från passet {hhmm(asking.pass.start_time)}–{hhmm(asking.pass.end_time)}.
          </p>
          <div className="mb-[10px]">
            <DangerButton onClick={() => { const a = asking; setAsking(null); void remove(a.pass, a.person); }}>
              Bekräfta
            </DangerButton>
          </div>
          <SecondaryButton onClick={() => setAsking(null)}>Avbryt</SecondaryButton>
        </SoftDialog>
      )}

      {/* TA BORT PASSET? -- deleting a pass released everybody on it on the
          first tap. Same shape as Avboka bokning?: the pass named, what happens
          to the people on it, and the destructive answer first. */}
      {deleting && (
        <SoftDialog label="Ta bort passet?" onDismiss={() => setDeleting(null)}>
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Ta bort passet?
          </h2>
          <p className="mb-[18px] mt-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            Passet {hhmm(deleting.start_time)}–{hhmm(deleting.end_time)} tas bort.
            {deleting.people.length > 0 && " Alla som är bokade får besked."} Det går inte att ångra.
          </p>
          <div className="mb-[10px]">
            <DangerButton onClick={() => { const d = deleting; setDeleting(null); void cancelPass(d); }}>
              Ta bort
            </DangerButton>
          </div>
          <SecondaryButton onClick={() => setDeleting(null)}>Avbryt</SecondaryButton>
        </SoftDialog>
      )}

      {trade && (
        <BytaPlats
          options={trade}
          onClose={() => setTrade(null)}
          onDone={(message) => { setTrade(null); setNote(message); setReload((n) => n + 1); }}
        />
      )}

      {/* TA BORT ARBETSLEDARE? -- admin only; skips the replacement flow. */}
      {removingLedare && (
        <SoftDialog label="Ta bort arbetsledare?" onDismiss={() => setRemovingLedare(null)}>
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Ta bort arbetsledare?
          </h2>
          <p className="mb-[18px] mt-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            {removingLedare.name} tas bort som ansvarig för passet {hhmm(removingLedare.pass.start_time)}–{hhmm(removingLedare.pass.end_time)}.
            Om någon annan ledare är tillgänglig sätts de in automatiskt.
          </p>
          <div className="mb-[10px]">
            <DangerButton
              onClick={() => adminRemoveLedare(removingLedare.tilldelning_id)}
            >
              Ta bort
            </DangerButton>
          </div>
          <SecondaryButton onClick={() => setRemovingLedare(null)}>Avbryt</SecondaryButton>
        </SoftDialog>
      )}

      {/* TILLDELA ARBETSLEDARE -- admin picks a ledare for a pass with none. */}
      {assigningLedare && (
        <SoftDialog label="Tilldela arbetsledare" onDismiss={() => { setAssigningLedare(null); setLedareCandidates(null); }}>
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Tilldela arbetsledare
          </h2>
          <p className="mb-[14px] mt-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            Välj vem som är ansvarig för passet {hhmm(assigningLedare.start_time)}–{hhmm(assigningLedare.end_time)}.
          </p>
          {ledareCandidates === null ? (
            <p className="text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
          ) : ledareCandidates.length === 0 ? (
            <p className="text-[15px] font-medium" style={{ color: C.text2 }}>
              Inga arbetsledare finns registrerade i systemet.
            </p>
          ) : (
            <div className="mb-3">
              <ChoiceList
                disabled={busy !== null}
                choices={ledareCandidates.map((w) => ({
                  key: w.id,
                  label: w.name,
                  onClick: () => assignLedare(w.id, w.name),
                }))}
              />
            </div>
          )}
          <SecondaryButton onClick={() => { setAssigningLedare(null); setLedareCandidates(null); }}>
            Avbryt
          </SecondaryButton>
        </SoftDialog>
      )}

      {/* BYT ANSVARIG -- admin moves the confirmer role to any worker on the day. */}
      {transferringPass && (
        <SoftDialog label="Byt ansvarig" onDismiss={() => { setTransferringPass(null); setTransferCandidates(null); }}>
          <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Byt ansvarig
          </h2>
          <p className="mb-[14px] mt-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            Välj vem som tar över ansvaret för passet {hhmm(transferringPass.start_time)}–{hhmm(transferringPass.end_time)}.
          </p>
          {transferCandidates === null ? (
            <p className="text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
          ) : transferCandidates.length === 0 ? (
            <p className="text-[15px] font-medium" style={{ color: C.text2 }}>
              Inga andra arbetar den här dagen.
            </p>
          ) : (
            <div className="mb-3">
              <ChoiceList
                disabled={busy !== null}
                choices={transferCandidates.map((w) => ({
                  key: w.id,
                  label: w.name,
                  onClick: () => transferConfirmation(w.id, w.name),
                }))}
              />
            </div>
          )}
          <SecondaryButton onClick={() => { setTransferringPass(null); setTransferCandidates(null); }}>
            Avbryt
          </SecondaryButton>
        </SoftDialog>
      )}

      {swap && (
        <BytArbetsledare
          options={swap}
          onClose={() => setSwap(null)}
          onDone={(message) => { setSwap(null); setNote(message); setReload((n) => n + 1); }}
        />
      )}

      {error && <div className="pb-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}
      {note && !error && <div className="pb-[14px]"><SoftNotice tone="quiet">{note}</SoftNotice></div>}

      {/* The day as a kicker, not a headline: longDayHeading returns caps
          because every other screen sets it at 12/700, and the same string at
          22/800 shouts. The picker directly above already says which day this
          is in full. */}
      {heading && (
        <p
          className="mb-[14px] px-1 text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          {longDayHeading(date)}
        </p>
      )}

      {/*
        THE PROJECT TABS. Only when there is a choice to make -- with one
        project on the day a tab strip of one is a control that does nothing.
        Scrolls sideways rather than wrapping: a day with six sites on it would
        otherwise push the shifts off the bottom of a phone.
      */}
      {!project && projectsToday.length > 1 && (
        <>
          <p className="mb-2 px-1 text-[15px] font-medium" style={{ color: C.text2 }}>
            {projectsToday.length} projekt den här dagen. Välj vilket du vill se.
          </p>
          <div className="-mx-4 mb-[14px] flex gap-2 overflow-x-auto px-4 pb-1">
            {projectsToday.map((p) => {
              const colour = colourOf(p.id);
              const on = p.id === active;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-project-tab={p.name}
                  aria-pressed={on}
                  onClick={() => setOpenProject(p.id)}
                  className="press-scale flex h-11 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[15px] font-bold transition-transform duration-[110ms] active:scale-[.985]"
                  style={{
                    letterSpacing: "-.2px",
                    background: on ? C.accent : C.panel2,
                    color: on ? C.onAccent : C.inkHover,
                  }}
                >
                  {/* The same colour the day wore on the calendar. Findable by
                      attribute rather than by carrying a style, so a tab that
                      failed to get a colour is something a test can see and
                      report instead of an element it waits for forever. */}
                  <span
                    aria-hidden
                    data-tab-swatch={p.name}
                    className="inline-block h-[14px] w-[14px] shrink-0 rounded-[4px]"
                    style={colour ? { background: colour } : { background: C.hairline }}
                  />
                  <span className="whitespace-nowrap">{p.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {passes === null && (
        <p className="px-1 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      )}
      {/*
        AN EMPTY DAY AND A CANCELLED ONE ARE DIFFERENT FACTS. Nothing was ever
        planned here, versus what was planned here was called off -- the second
        is a decision somebody made, and an admin scrolling for a gap to fill
        should not have to remember which days he emptied himself.
      */}
      {passes?.length === 0 && (cancelled.length > 0 ? (
        <Card radius={16}>
          <p className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Inställd dag
          </p>
          <p
            className="mt-1 text-[15px] font-medium"
            style={{ color: C.text2, textWrap: "pretty" }}
          >
            Passen är borttagna och ingen jobbar den här dagen. De som stod på
            dem är meddelade.
          </p>
          <ul className="mt-[14px] flex flex-col gap-2">
            {cancelled.map((c) => (
              <li
                key={c.project_id}
                className="rounded-[10px] px-[14px] py-3"
                style={{ background: C.panel2 }}
              >
                <span className="block text-[17px] font-bold" style={{ letterSpacing: "-.3px" }}>
                  {c.project_name}
                </span>
                <span className="text-[15px] font-medium" style={{ color: C.text2 }}>
                  {c.cancelled_passes === 1
                    ? "1 pass borttaget"
                    : `${c.cancelled_passes} pass borttagna`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState>Inga pass den dagen.</EmptyState>
      ))}

      <div className="flex flex-col gap-[14px]">
        {showing.map((p) => (
          // The section IS the card: the project name has to stay a DIRECT
          // child <p> of the section, because that is how the day walkthroughs
          // read which project a block belongs to.
          <section
            key={p.id}
            className="rounded-[16px] p-[18px] pb-5"
            style={{ background: C.surface, boxShadow: SHADOW.group }}
          >
            <p className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                {p.project_name}
              </p>
              <p className="text-[15px] font-medium" style={{ color: C.text2 }}>
                {hhmm(p.start_time)}–{hhmm(p.end_time)} · {String(p.planned_hours).replace(".", ",")} h
              </p>
              {/* Step 4b: the leader's row was never a slot the pass demanded,
                  so it is not counted against the headcount here either.
                  Cancelled shifts (soft-deleted) also don't count. */}
              <p className="mb-[14px] text-[15px] font-bold" style={{ color: C.accentInk }}>
                {p.people.filter((x) => x.source !== "ledare" && !x.cancelled_at).length} av {p.headcount} {p.headcount === 1 ? "plats" : "platser"}
              </p>

              <ul className="mb-[14px] flex flex-col gap-2">
                {p.people.filter((x) => x.source !== "ledare" && !x.cancelled_at).map((person) => (
                  <li key={person.tilldelning_id} className="flex items-stretch gap-2">
                    <span
                      className="flex min-w-0 flex-1 items-center rounded-[10px] px-[14px] text-[17px] font-bold"
                      style={{ letterSpacing: "-.2px", background: C.panel2, minHeight: 52 }}
                    >
                      <span className="truncate">{person.name}</span>
                      {person.clock_in && !person.clock_out && (
                        <span className="ml-2 shrink-0 text-[13px] font-semibold" style={{ color: C.accentInk }}>
                          Incheckad
                        </span>
                      )}
                    </span>
                    {/* Admin only: cancel an in-progress shift */}
                    {account?.role === "admin" && person.clock_in && !person.clock_out && (
                      <button
                        type="button"
                        aria-label={`Avbryt ${person.name}s skift`}
                        onClick={() => setCancellingShift({ tilldelning_id: person.tilldelning_id, name: person.name, pass: p })}
                        disabled={busy === person.tilldelning_id}
                        className="press-scale flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[10px] transition-transform duration-[110ms] hover:bg-[#ebe9e5] active:scale-[.985] disabled:opacity-40"
                        style={{ background: C.stopBg }}
                        title="Avbryt skift"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M2 2L14 14M14 2L2 14" stroke={C.stopInk} strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    )}
                    {(!account || account.role !== "admin" || !person.clock_in || person.clock_out) && (
                      <button
                        type="button"
                        aria-label={`Ta bort ${person.name}`}
                        onClick={() => setAsking({ pass: p, person })}
                        disabled={busy === person.tilldelning_id}
                        className="press-scale flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[10px] transition-transform duration-[110ms] hover:bg-[#ebe9e5] active:scale-[.985] disabled:opacity-40"
                        style={{ background: C.stopBg }}
                      >
                        <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
                          <path d="M1.6 4.2h10.8M5 4.2V2.4h4v1.8M2.8 4.2l.8 9.4h6.8l.8-9.4"
                            stroke={C.stopInk} strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
                {p.people.filter((x) => x.source !== "ledare" && !x.cancelled_at).length === 0 && (
                  <li
                    className="rounded-[10px] p-[14px] text-center text-[15px] font-medium"
                    style={{ background: C.panel, color: C.text2 }}
                  >
                    Ingen tillsatt än.
                  </li>
                )}

                {/* Placed automatically because their people are here, with the
                    span running from the first arrival to the last departure.
                    Admin gets a trash icon -- direct removal without the
                    replacement flow; a non-admin still uses Avboka Pass. */}
                {p.people.filter((x) => x.source === "ledare").map((person) => (
                  <li
                    key={person.tilldelning_id}
                    className="flex items-stretch gap-2"
                  >
                    <span
                      className="flex min-w-0 flex-1 items-center justify-between rounded-[10px] px-[14px] py-3"
                      style={{ background: C.panel2 }}
                    >
                      <span className="min-w-0 truncate text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
                        {person.name}
                      </span>
                      <span className="shrink-0 pl-2 text-right">
                        <Tag tone="warn">Arbetsledare</Tag>
                        {person.own_start && person.own_end && (
                          <span
                            className="mt-1 block text-[14px] font-medium"
                            style={{ color: C.text2 }}
                          >
                            {hhmm(person.own_start)}–{hhmm(person.own_end)}
                          </span>
                        )}
                      </span>
                    </span>
                    {account?.role === "admin" && (
                      <button
                        type="button"
                        aria-label={`Ta bort ${person.name} som arbetsledare`}
                        onClick={() => setRemovingLedare({ tilldelning_id: person.tilldelning_id, name: person.name, pass: p })}
                        disabled={busy === person.tilldelning_id}
                        className="press-scale flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[10px] transition-transform duration-[110ms] hover:bg-[#ebe9e5] active:scale-[.985] disabled:opacity-40"
                        style={{ background: C.stopBg }}
                      >
                        <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
                          <path d="M1.6 4.2h10.8M5 4.2V2.4h4v1.8M2.8 4.2l.8 9.4h6.8l.8-9.4"
                            stroke={C.stopInk} strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}

                {/* Admin: place a ledare when none is assigned yet. */}
                {account?.role === "admin" && p.people.filter((x) => x.source === "ledare").length === 0 && (
                  <li>
                    <button
                      type="button"
                      onClick={() => openAssignLedare(p)}
                      disabled={busy === p.id}
                      className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] px-3 text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985] disabled:opacity-40"
                      style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                    >
                      Tilldela arbetsledare
                    </button>
                  </li>
                )}

                {/* Not a trash icon, and that is the point: this does not take
                    somebody off a day, it asks who is answerable for it instead. */}
                {p.people.filter((x) => x.source === "ledare").map((person) => (
                  <li key={`avboka-${person.tilldelning_id}`} className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => askWhoTakesOver(person.tilldelning_id)}
                      disabled={busy === person.tilldelning_id}
                      className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] px-3 text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985] disabled:opacity-40"
                      style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                    >
                      Avboka Pass — {person.name}
                    </button>

                    {/* Only the admin, and only when the day really does hold a
                        second arbetsledare on another project -- otherwise the
                        button opens a list of nothing. */}
                    {account?.role === "admin" && leadersElsewhere(p.project_id) && (
                      <button
                        type="button"
                        onClick={() => askWhoToSwapWith(person.tilldelning_id)}
                        disabled={busy === person.tilldelning_id}
                        className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] px-3 text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985] disabled:opacity-40"
                        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                      >
                        Byta Plats Med Arbetsledare — {person.name}
                      </button>
                    )}

                    {/* Admin: transfer the confirmer role to any worker on this
                        project-day. Only shown when there is at least one worker
                        to hand the role to -- otherwise it opens an empty list. */}
                    {account?.role === "admin" &&
                      (passes ?? [])
                        .filter((q) => q.project_id === p.project_id)
                        .flatMap((q) => q.people.filter((x) => x.source !== "ledare"))
                        .length > 0 && (
                      <button
                        type="button"
                        onClick={() => openTransferConfirmation(p)}
                        disabled={busy === person.tilldelning_id}
                        className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] px-3 text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985] disabled:opacity-40"
                        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                      >
                        Byt ansvarig
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {/* Avbrutna skift -- collapsed, visible to admin and arbetsledare */}
              {(account?.role === "admin" || account?.role === "arbetsledare") &&
                p.people.filter((x) => x.source !== "ledare" && !!x.cancelled_at).length > 0 && (
                <details className="mb-[10px]">
                  <summary
                    className="cursor-pointer select-none rounded-[8px] px-[14px] py-2 text-[14px] font-semibold"
                    style={{ color: C.text2, background: C.panel }}
                  >
                    {p.people.filter((x) => x.source !== "ledare" && !!x.cancelled_at).length === 1
                      ? "1 avbrutet skift"
                      : `${p.people.filter((x) => x.source !== "ledare" && !!x.cancelled_at).length} avbrutna skift`}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {p.people.filter((x) => x.source !== "ledare" && !!x.cancelled_at).map((person) => (
                      <li key={`cancelled-${person.tilldelning_id}`} className="flex items-stretch gap-2">
                        <span
                          className="flex min-w-0 flex-1 items-center rounded-[10px] px-[14px] text-[17px] font-bold opacity-50"
                          style={{ letterSpacing: "-.2px", background: C.panel2, minHeight: 48, textDecoration: "line-through" }}
                        >
                          <span className="truncate">{person.name}</span>
                        </span>
                        {account?.role === "admin" && (
                          <button
                            type="button"
                            aria-label={`Återställ ${person.name}s skift`}
                            onClick={() => uncancelShift(person.tilldelning_id)}
                            disabled={busy === person.tilldelning_id}
                            className="press-scale flex h-[48px] shrink-0 items-center justify-center rounded-[10px] px-3 text-[13px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985] disabled:opacity-40"
                            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                          >
                            Återställ
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {editing === p.id && draft ? (
                <div className="pt-[14px]" style={{ boxShadow: `inset 0 1px 0 ${C.hairline}` }}>
                  <div className="mb-[14px] flex gap-[10px]">
                    <div className="min-w-0 flex-1">
                      <SoftField label="Börjar">
                        <SoftInput type="time" value={draft.start}
                          onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
                      </SoftField>
                    </div>
                    <div className="min-w-0 flex-1">
                      <SoftField label="Slutar">
                        <SoftInput type="time" value={draft.end}
                          onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
                      </SoftField>
                    </div>
                    <div className="min-w-0 flex-1">
                      <SoftField label="Timmar">
                        <SoftInput inputMode="decimal" value={draft.hours}
                          aria-label="Timmar"
                          onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
                      </SoftField>
                    </div>
                  </div>
                  <div className="flex gap-[10px]">
                    <button
                      type="button"
                      onClick={() => saveEdit(p)}
                      disabled={busy === p.id}
                      className="press-scale flex h-12 flex-1 items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#3a2a20] active:scale-[.985] disabled:opacity-40"
                      style={{ background: C.accent, color: C.onAccent }}
                    >
                      Spara
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditing(null); setDraft(null); }}
                      className="press-scale flex h-12 flex-1 items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985]"
                      style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                    >
                      Avbryt
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(p.id);
                      setDraft({
                        start: hhmm(p.start_time), end: hhmm(p.end_time),
                        hours: String(p.planned_hours).replace(".", ","),
                        headcount: p.headcount,
                      });
                    }}
                    className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985]"
                    style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                  >
                    Ändra detta pass
                  </button>
                  {/* The only control here that destroys something, so it is a
                      tint and it is last. */}
                  {account?.role === "admin" && (
                    <button
                      type="button"
                      onClick={() => setDeleting(p)}
                      disabled={busy === p.id}
                      className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#ebe9e5] active:scale-[.985] disabled:opacity-40"
                      style={{ background: C.stopBg, color: C.stopInk }}
                    >
                      Ta bort detta pass
                    </button>
                  )}
                </div>
              )}
          </section>
        ))}
      </div>
    </div>
  );}

