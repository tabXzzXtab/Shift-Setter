"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Empty, Field, Input, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading, stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";

type Person = { tilldelning_id: string; worker_id: string; name: string; source: string };
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
 * Öppna dag -- everyone working a given day, and the trash icon beside a name.
 *
 * Removing someone is Step 5b. The vacated slot REOPENS: headcount does not
 * drop, because the pass still needs the same number of people. What happens
 * next is the database's business -- release_assignment walks the same tiers
 * the slot was filled from, unless the shift is inside five days, in which case
 * nothing fires automatically and the leader places someone by hand.
 *
 * Editing a pass here edits THAT pass. A batch generates independent rows, not
 * a series, so there is nothing to accidentally edit through: changing this
 * Tuesday cannot reach the next one.
 */
function Dag() {
  const { account } = useAccount();
  const [date, setDate] = useState(stockholmToday());
  const [passes, setPasses] = useState<PassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
            .select("id, pass_id, worker_id, source")
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
      .rpc("release_assignment", { p_tilldelning: person.tilldelning_id });

    if (error) setError(error.message);
    else {
      const r = data?.[0];
      setNote(
        r?.reopened
          ? `${person.name} är borttagen. Platsen öppnades igen: ${r.filled} tillsatt, ${r.offered} fick Acceptera Pass.`
          : `${person.name} är borttagen. Passet är inom fem dagar, så platsen fylls inte automatiskt — sätt in någon själv.`,
      );
    }
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

  async function cancelPass(p: PassRow) {
    setBusy(p.id);
    setError(null);
    const { error } = await getSupabase().rpc("delete_pass", { p_pass: p.id });
    if (error) setError(error.message);
    else setNote("Passet är borttaget. Övriga pass är orörda.");
    setReload((n) => n + 1);
    setBusy(null);
  }

  return (
    <Screen title="Öppna dag" back="/">
      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="info">{note}</Notice>}

      <Field label="Datum">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

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
            <p className="mb-4 text-base">
              {p.people.length} av {p.headcount} platser
            </p>

            <ul className="mb-4 flex flex-col gap-2">
              {p.people.map((person) => (
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
              {p.people.length === 0 && (
                <li className="border-2 border-dashed border-black p-3 text-base">
                  Ingen tillsatt än.
                </li>
              )}
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
                    <Input inputMode="decimal" value={draft.hours}
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
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Dag />
    </AuthGate>
  );
}
