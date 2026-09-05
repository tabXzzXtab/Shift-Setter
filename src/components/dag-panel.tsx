"use client";

import { useEffect, useState } from "react";
import { Button, Empty, Input, Notice } from "@/components/ui";
import { BytArbetsledare, replacementOptions, type Options } from "./byt-arbetsledare";
import { BytaPlats, swapPartners, type SwapOptions } from "./byta-plats";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading } from "@/lib/dates";
import { useAccount } from "@/lib/account";

type Person = {
  tilldelning_id: string; worker_id: string; name: string; source: string;
  /** Step 4b: the workers' envelope, carried on an auto-assigned leader's
   *  own row. Null on a worker's row, which reads the pass. */
  own_start: string | null; own_end: string | null;
};
type Replacement = { worker_id: string; name: string };

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
 * Shared by Öppna dag and by the shift calendar, which shows it inline when a
 * day is tapped. One component, so deletion has exactly one implementation --
 * and deletion is admin-only, refuses a shift that has started, notifies the
 * people on it and blocks them from being re-offered it, all in the database.
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
  const [passes, setPasses] = useState<PassRow[] | null>(null);
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

  return (
    <div>
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

      {passes === null && <p>Laddar…</p>}
      {passes?.length === 0 && <Empty>Inga pass den dagen.</Empty>}

      <div className="flex flex-col gap-4">
        {(passes ?? []).map((p) => (
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
