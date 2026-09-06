"use client";

import { useEffect, useState } from "react";
import { Button, Empty, Input, Notice } from "@/components/ui";
import { BytArbetsledare, replacementOptions, type Options } from "./byt-arbetsledare";
import { BytaPlats, swapPartners, type SwapOptions } from "./byta-plats";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading } from "@/lib/dates";
import { useAccount } from "@/lib/account";
import { useMonthColour } from "@/lib/project-palette";

type Person = {
  tilldelning_id: string; worker_id: string; name: string; source: string;
  /** Step 4b: the workers' envelope, carried on an auto-assigned leader's
   *  own row. Null on a worker's row, which reads the pass. */
  own_start: string | null; own_end: string | null;
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
export function DagPanel({ date }: { date: string }) {
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
  const [swap, setSwap] = useState<Options | null>(null);
  const [trade, setTrade] = useState<SwapOptions | null>(null);

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
      setError(e instanceof Error ? e.message : "Kunde inte läsa vilka som kan byta.");
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
      setError(e instanceof Error ? e.message : "Kunde inte läsa vilka som är lediga.");
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
        .select("id, project_id, start_time, end_time, planned_hours, headcount, project(name)")
        .eq("work_date", date)
        .is("deleted_at", null)
        .order("start_time");
      if (!active) return;
      if (error) { setError(error.message); setPasses([]); return; }

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
            .select("id, pass_id, worker_id, source, own_start, own_end")
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
      setError(error.message);
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

    if (error) setError(saySwedish(error.message));
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
    if (error) setError(error.message);
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
  function saySwedish(message: string): string {
    if (/has started and cannot be deleted/.test(message)) {
      return "Passet har redan börjat och kan inte tas bort. Det ska bekräftas i stället.";
    }
    if (/clocked in on this shift/.test(message)) {
      return "Någon har redan stämplat in på passet. Det kan inte tas bort.";
    }
    if (/only an admin may delete a shift/.test(message)) {
      return "Bara administratören kan ta bort ett pass.";
    }
    if (/already deleted/.test(message)) {
      return "Passet är redan borttaget.";
    }
    return message;
  }

  async function cancelPass(p: PassRow) {
    setBusy(p.id);
    setError(null);
    const { error } = await getSupabase().rpc("delete_pass", { p_pass: p.id });
    if (error) setError(saySwedish(error.message));
    else setNote("Passet är borttaget. Övriga pass är orörda.");
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
  const active =
    projectsToday.find((p) => p.id === openProject)?.id ?? projectsToday[0]?.id ?? null;
  const showing = (passes ?? []).filter((p) => p.project_id === active);

  return (
    <div data-day-panel={date}>
      {/*
        VÄLJ UTBYTE -- Step 5b's popup.
        Over a darkened page, because the slot is open right now and the answer
        is one press away. Closing it without picking is allowed and leaves the
        slot open: the cards are the fallback for having nobody to ask, not a
        consolation for indecision, so nothing goes out behind the leader's
        back after they decided to handle it themselves.
      */}
      {vacancy && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Välj Utbyte"
        >
          <div className="mx-auto w-full max-w-md border-2 border-black bg-white p-4">
            <h2 className="mb-1 text-xl font-bold">Välj Utbyte</h2>
            <p className="mb-4 text-base">
              {vacancy.removed} är borttagen. De här har förvalt {vacancy.work_date} och
              är lediga.
            </p>

            <div className="mb-3 flex flex-col gap-2">
              {vacancy.replacements.map((r) => (
                <button
                  key={r.worker_id}
                  type="button"
                  onClick={() => place(r.worker_id, r.name)}
                  disabled={busy === r.worker_id}
                  className="flex min-h-[56px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold disabled:opacity-30"
                >
                  <span>{r.name}</span>
                  <span aria-hidden className="text-2xl">→</span>
                </button>
              ))}
            </div>

            <Button variant="outline" onClick={() => setVacancy(null)}>
              Ingen av dem
            </Button>
          </div>
        </div>
      )}

      {trade && (
        <BytaPlats
          options={trade}
          onClose={() => setTrade(null)}
          onDone={(message) => { setTrade(null); setNote(message); setReload((n) => n + 1); }}
        />
      )}

      {swap && (
        <BytArbetsledare
          options={swap}
          onClose={() => setSwap(null)}
          onDone={(message) => { setSwap(null); setNote(message); setReload((n) => n + 1); }}
        />
      )}

      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="info">{note}</Notice>}

      <p className="mb-4 text-xl font-bold">{longDayHeading(date)}</p>

      {/*
        THE PROJECT TABS. Only when there is a choice to make -- with one
        project on the day a tab strip of one is a control that does nothing.
        Scrolls sideways rather than wrapping: a day with six sites on it would
        otherwise push the shifts off the bottom of a phone.
      */}
      {projectsToday.length > 1 && (
        <>
          <p className="mb-2 text-base">
            {projectsToday.length} projekt den här dagen. Välj vilket du vill se.
          </p>
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
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
                  className={`flex min-h-[56px] shrink-0 items-center gap-2 border-2 border-black px-3 text-base font-bold ${
                    on ? "bg-black text-white" : "bg-white text-black"
                  }`}
                >
                  {/* The same colour the day wore on the calendar. Findable by
                      attribute rather than by carrying a style, so a tab that
                      failed to get a colour is something a test can see and
                      report instead of an element it waits for forever. */}
                  <span
                    aria-hidden
                    data-tab-swatch={p.name}
                    className="inline-block h-6 w-3 shrink-0 border border-current"
                    style={colour ? { background: colour } : undefined}
                  />
                  <span className="whitespace-nowrap">{p.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {passes === null && <p>Laddar…</p>}
      {/*
        AN EMPTY DAY AND A CANCELLED ONE ARE DIFFERENT FACTS. Nothing was ever
        planned here, versus what was planned here was called off -- the second
        is a decision somebody made, and an admin scrolling for a gap to fill
        should not have to remember which days he emptied himself.
      */}
      {passes?.length === 0 && (cancelled.length > 0 ? (
        <div className="border-4 border-black p-4">
          <p className="text-xl font-bold">Inställd dag</p>
          <p className="mt-2 text-base">
            Passen är borttagna och ingen jobbar den här dagen. De som stod på
            dem är meddelade.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {cancelled.map((c) => (
              <li key={c.project_id} className="border-2 border-black p-3">
                <span className="block text-lg font-bold">{c.project_name}</span>
                <span className="text-base">
                  {c.cancelled_passes === 1
                    ? "1 pass borttaget"
                    : `${c.cancelled_passes} pass borttagna`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Empty>Inga pass den dagen.</Empty>
      ))}

      <div className="flex flex-col gap-4">
        {showing.map((p) => (
          <section key={p.id} className="border-2 border-black p-4">
            <p className="text-lg font-bold">{p.project_name}</p>
            <p className="mb-1 text-lg">
              {hhmm(p.start_time)}–{hhmm(p.end_time)} · {String(p.planned_hours).replace(".", ",")} h
            </p>
            {/* Step 4b: the leader's row was never a slot the pass demanded,
                so it is not counted against the headcount here either. */}
            <p className="mb-4 text-base">
              {p.people.filter((x) => x.source !== "ledare").length} av {p.headcount} platser
            </p>

            <ul className="mb-4 flex flex-col gap-2">
              {p.people.filter((x) => x.source !== "ledare").map((person) => (
                <li key={person.tilldelning_id} className="flex items-stretch gap-2">
                  <span className="flex min-h-[56px] flex-1 items-center border-2 border-black px-3 text-lg font-bold">
                    {person.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`Ta bort ${person.name}`}
                    onClick={() => remove(p, person)}
                    disabled={busy === person.tilldelning_id}
                    className="h-auto min-h-[56px] w-[64px] border-2 border-black text-2xl disabled:opacity-30"
                  >
                    🗑
                  </button>
                </li>
              ))}
              {p.people.filter((x) => x.source !== "ledare").length === 0 && (
                <li className="border-2 border-dashed border-black p-3 text-base">
                  Ingen tillsatt än.
                </li>
              )}

              {/* Placed automatically because their people are here, with the
                  span running from the first arrival to the last departure.
                  No trash icon: a leader is never simply absent, and taking one
                  off forces the question of who is answerable for the day. */}
              {p.people.filter((x) => x.source === "ledare").map((person) => (
                <li
                  key={person.tilldelning_id}
                  className="flex min-h-[56px] items-center justify-between gap-2 border-2 border-dashed border-black px-3"
                >
                  <span className="text-lg font-bold">{person.name}</span>
                  <span className="text-right text-sm font-bold uppercase tracking-wide">
                    Arbetsledare
                    {person.own_start && person.own_end && (
                      <span className="block text-base font-normal normal-case tracking-normal">
                        {hhmm(person.own_start)}–{hhmm(person.own_end)}
                      </span>
                    )}
                  </span>
                </li>
              ))}

              {/* Not a trash icon, and that is the point: this does not take
                  somebody off a day, it asks who is answerable for it instead. */}
              {p.people.filter((x) => x.source === "ledare").map((person) => (
                <li key={`avboka-${person.tilldelning_id}`}>
                  <button
                    type="button"
                    onClick={() => askWhoTakesOver(person.tilldelning_id)}
                    disabled={busy === person.tilldelning_id}
                    className="min-h-[56px] w-full border-2 border-black px-3 text-base font-bold disabled:opacity-30"
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
                      className="mt-2 min-h-[56px] w-full border-2 border-black px-3 text-base font-bold disabled:opacity-30"
                    >
                      Byta Plats Med Arbetsledare — {person.name}
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {editing === p.id && draft ? (
              <div className="border-t-2 border-black pt-3">
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase">Börjar</span>
                    <Input type="time" value={draft.start}
                      onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase">Slutar</span>
                    <Input type="time" value={draft.end}
                      onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase">Timmar</span>
                    <Input center inputMode="decimal" value={draft.hours}
                      aria-label="Timmar"
                      onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => saveEdit(p)} disabled={busy === p.id}>Spara</Button>
                  <Button variant="outline" onClick={() => { setEditing(null); setDraft(null); }}>
                    Avbryt
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(p.id);
                    setDraft({
                      start: hhmm(p.start_time), end: hhmm(p.end_time),
                      hours: String(p.planned_hours).replace(".", ","),
                      headcount: p.headcount,
                    });
                  }}
                >
                  Ändra detta pass
                </Button>
                {account?.role === "admin" && (
                  <Button variant="outline" onClick={() => cancelPass(p)} disabled={busy === p.id}>
                    Ta bort detta pass
                  </Button>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );}
