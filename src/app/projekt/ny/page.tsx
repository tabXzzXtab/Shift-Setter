"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SoftField, SoftInput, SoftNotice, SoftScreen,
} from "@/components/soft";
import { CardTitle } from "@/components/card-title";
import { DateField } from "@/components/date-field";
import { PickField } from "@/components/pick-field";
import { useTourAutofill } from "@/components/tour/use-tour-autofill";
import { useAccount } from "@/lib/account";
import { derivesTenant, getSupabase } from "@/lib/supabase/client";
import { addDays, stockholmToday } from "@/lib/dates";
import { tourSignal } from "@/lib/tour/signal";
import { fel } from "@/lib/fel";

/**
 * Invariant 7: project creation is a gate, not a form.
 *
 * Every field the Arbetsdagbok needs is required here, because discovering a
 * blank org nummer months later -- when every shift is confirmed and final --
 * is not recoverable. The database refuses a blank one either way; this screen
 * exists so the refusal happens while it is still cheap to fix.
 *
 * The assigned arbetsledare is part of creation, not an afterthought: it is the
 * per-row scope for invariant 4b, and a project with no leader can never have a
 * day confirmed, so it could never produce a document.
 *
 * AN ARBETSLEDARE OPENS THIS SCREEN TOO, and may name a colleague rather than
 * themselves. Two things follow, and both are below:
 *
 *   The list comes from arbetsledare_roster, not account_directory. That view
 *   ends in "is_admin() or id = auth.uid()", so a leader reading it sees one
 *   row -- their own -- and the choice would not exist. The roster carries
 *   names and nothing else, the way worker_roster does.
 *
 *   The creator is written onto the project as well. project_staff_select is
 *   who leads a project, so handing it to somebody else would take it off the
 *   screen of the person who just made it: gone from Alla Projekt, gone from
 *   the Skapa Pass picker, with no way to check the thing they made. The admin
 *   is not added -- the database refuses an admin in project_leader, because a
 *   row there would hand the owner a stage 1 confirmation.
 */
function NyttProjekt() {
  const router = useRouter();
  const { account } = useAccount();
  const me = account?.id ?? null;
  const iAmLeader = account?.role === "arbetsledare";

  const [leaders, setLeaders] = useState<{ id: string; name: string | null }[]>([]);
  // null means "nobody has touched the field yet", which is not the same as
  // the empty choice: picking "Välj…" back out has to leave it empty rather
  // than snap to the default again.
  const [chosen, setChosen] = useState<string | null>(null);

  // EARLIER BESTÄLLARE, from the company's own projects -- there is no table of
  // them, and none is needed: a beställare is the three fields a project
  // already carries. Unique by name and org nr, newest wording first.
  type Bestallare = { bolag: string; address: string; orgnr: string };
  const [tidigare, setTidigare] = useState<Bestallare[]>([]);
  const [valdBest, setValdBest] = useState("");
  const [nyBest, setNyBest] = useState(false);
  useEffect(() => {
    void (async () => {
      const { data } = await getSupabase()
        .from("project")
        .select("bestallare_bolag, bestallare_address, bestallare_orgnr, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      const seen = new Set<string>();
      const list: Bestallare[] = [];
      for (const r of data ?? []) {
        const b = { bolag: r.bestallare_bolag ?? "", address: r.bestallare_address ?? "", orgnr: r.bestallare_orgnr ?? "" };
        const key = `${b.bolag.trim().toLowerCase()}|${b.orgnr.trim()}`;
        if (!b.bolag.trim() || seen.has(key)) continue;
        seen.add(key);
        list.push(b);
      }
      list.sort((a, b) => a.bolag.localeCompare(b.bolag, "sv"));
      setTidigare(list);
    })();
  }, []);
  // The picker is the way in whenever there is anything to pick; the empty
  // fields are for "Ny beställare", or for a company with no projects yet.
  const visaFalt = nyBest || tidigare.length === 0;
  const best = valdBest === "" ? null : tidigare[Number(valdBest)] ?? null;
  const [start, setStart] = useState(stockholmToday);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSupabase()
      .from("arbetsledare_roster")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        setLeaders((data ?? []).map((d) => ({ id: d.id!, name: d.name })));
      });
  }, []);

  // A leader creating a project is usually the one who will run it, so their
  // own name starts in the field. It stays a field and not a label: naming
  // somebody else is the whole point of it being a choice.
  //
  // Derived rather than written into state from an effect. The default depends
  // on two things that arrive at their own pace -- the account and the roster
  // -- and an effect that copies a computed value into state has to be kept in
  // step with both, which is a second source of truth for the same answer.
  const leaderId = chosen ?? (iAmLeader && me ? me : leaders.length === 1 ? leaders[0]!.id : "");

  // The first-launch tour's example project. The inputs are uncontrolled -- the
  // submit reads FormData -- so their own values are what gets written. The
  // beställare is plainly an example: whatever is pressed with it becomes a
  // real project, and it prints on a real Arbetsdagbok.
  const form = useRef<HTMLFormElement>(null);
  const input = (name: string) => form.current?.elements.namedItem(name) as HTMLInputElement | null;
  const into = (name: string, text: string, typed = true) => ({
    text, typed, el: () => input(name), write: (v: string) => { const el = input(name); if (el) el.value = v; },
  });
  useTourAutofill("projekt", leaders.length > 0, () => [
    into("name", "Fasad Malmö"),
    into("site_address", "Storgatan 12, 211 34 Malmö"),
    // State, not the element: the visible field shows words, and the hidden
    // input follows `start`.
    { text: addDays(stockholmToday(), 14), typed: false, write: (v: string) => setStart(v) },
    ...(leaderId ? [] : [{ text: leaders[0]!.id, typed: false, write: (v: string) => setChosen(v) }]),
    // The example is a new beställare, so its fields have to be on screen.
    { text: "Ny beställare", typed: false, write: () => setNyBest(true) },
    into("bestallare_bolag", "Exempelbolaget AB"),
    into("bestallare_address", "Södra Förstadsgatan 4, 211 43 Malmö"),
    into("bestallare_orgnr", "556000-0000"),
  ]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const f = new FormData(e.currentTarget);
    const sb = getSupabase();

    const { data: project, error: pErr } = await sb
      .from("project")
      .insert({
        name: String(f.get("name")),
        site_address: String(f.get("site_address")),
        bestallare_address: String(f.get("bestallare_address")),
        bestallare_bolag: String(f.get("bestallare_bolag")),
        bestallare_orgnr: String(f.get("bestallare_orgnr")),
        start_date: String(f.get("start_date")),
      })
      .select("id")
      .single();

    if (pErr || !project) {
      setError(fel(pErr, "Projektet kunde inte sparas. Kontrollera fälten, eller kontakta administratören."));
      setSaving(false);
      return;
    }

    // One statement, so the named leader and the creator land together or not
    // at all. Deduplicated: a leader who names themselves is one row, and the
    // primary key would refuse the second.
    const ansvariga = [...new Set(iAmLeader && me ? [leaderId, me] : [leaderId])];

    const { error: lErr } = await sb
      .from("project_leader")
      .insert(derivesTenant(ansvariga.map((account_id) => ({ project_id: project.id, account_id }))));

    if (lErr) {
      // Not "koppla den under Redigera projekt": that page edits the seven
      // business fields and has never carried the arbetsledare. A project
      // whose leader row is missing cannot have a day confirmed at all, and
      // repairing it is the admin's.
      setError(fel(lErr, "Projektet skapades, men arbetsledaren kunde inte kopplas. Kontakta administratören."));
      setSaving(false);
      return;
    }

    tourSignal("project-created");
    router.push("/projekt");
  }

  return (
    <SoftScreen
      title="Skapa ett projekt"
      back="/"
      subtitle="Kontrollera beställarens org nummer och adress."
    >
      {error && <div className="px-4 pb-[4px] pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <form ref={form} onSubmit={onSubmit}>
        {/* The same two cards Redigera Projekt wears, in the same order: what
            the project is, then who is being billed. Creating and correcting a
            project must not be two different forms. */}
        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <CardTitle>Projektet</CardTitle>

            <div className="mb-[14px]">
              <SoftField label="Projektnamn">
                <SoftInput name="name" required autoComplete="off" />
              </SoftField>
            </div>

            <div className="mb-[14px]">
              <SoftField label="Projektets adress" help="Dit arbetaren åker.">
                <SoftInput name="site_address" required autoComplete="off" />
              </SoftField>
            </div>

            {/* No Tjänster here: a project's history is what the leaders write
                in "Vad vi gjorde idag", not a line typed once at creation. The
                column is optional (20261001100000); Redigera still edits it. */}
            <div className="mb-[14px]">
              <DateField label="Startdatum" name="start_date" value={start} onChange={setStart} />
            </div>

            {/* Part of creation, not an afterthought: this is the per-row scope
                for invariant 4b, and a project with no leader can never have a
                day confirmed, so it could never produce a document. */}
            <PickField
              label="Arbetsledare"
              help={
                iAmLeader
                  ? "Personen som bekräftar projektets dagar. Du läggs till på projektet också."
                  : "Endast denna person kan bekräfta projektets dagar."
              }
              required
              people
              value={leaderId}
              onChange={setChosen}
              options={leaders.map((l) => ({ value: l.id, label: l.name ?? l.id.slice(0, 8) }))}
            />
          </Card>
        </div>

        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <CardTitle mb={4}>Beställaren</CardTitle>

            {!visaFalt && (
              <div className="fade-rise">
                <PickField
                  label="Beställare"
                  value={valdBest}
                  onChange={setValdBest}
                  options={tidigare.map((t, i) => ({
                    value: String(i),
                    label: t.bolag,
                    sub: [t.address, t.orgnr].filter(Boolean).join(" · "),
                  }))}
                  action={{ value: "__ny__", label: "Ny beställare", onPick: () => { setValdBest(""); setNyBest(true); } }}
                />
                {/* What prints on the Arbetsdagbok, carried as the form's own
                    fields so the submit reads them exactly as it always has. */}
                {best && (
                  <>
                    <input type="hidden" name="bestallare_bolag" value={best.bolag} />
                    <input type="hidden" name="bestallare_address" value={best.address} />
                    <input type="hidden" name="bestallare_orgnr" value={best.orgnr} />
                  </>
                )}
              </div>
            )}

            {visaFalt && (
              <div className="fade-rise">
                <div className="mb-[14px]">
                  <SoftField label="Beställarens bolag">
                    <SoftInput name="bestallare_bolag" required autoComplete="off" />
                  </SoftField>
                </div>

                <div className="mb-[14px]">
                  <SoftField label="Beställarens adress">
                    <SoftInput name="bestallare_address" required autoComplete="off" />
                  </SoftField>
                </div>

                <SoftField label="Beställarens org nummer">
                  <SoftInput
                    name="bestallare_orgnr" required autoComplete="off" placeholder="556788-2369"
                  />
                </SoftField>

                {tidigare.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setNyBest(false)}
                    className="mt-[10px] h-[36px] text-[14px] font-semibold"
                    style={{ color: C.text2 }}
                  >
                    Tidigare beställare
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>

        {leaders.length === 0 && (
          <div className="px-4 pt-[14px]">
            <SoftNotice tone="quiet">
              Det finns ingen arbetsledare än. Skapa en under “Ny arbetare” först.
            </SoftNotice>
          </div>
        )}

        <div className="px-4 pt-[22px]">
          <PrimaryButton type="submit" disabled={saving || !leaderId || (!visaFalt && !best)}>
            {saving ? "Sparar…" : "Skapa projekt"}
          </PrimaryButton>
        </div>
      </form>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyttProjekt />
    </AuthGate>
  );
}
