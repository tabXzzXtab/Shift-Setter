"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SoftField, SoftInput, SoftNotice, SoftScreen, SoftSelect,
} from "@/components/soft";
import { useAccount } from "@/lib/account";
import { derivesTenant, getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";
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
        services: String(f.get("services")),
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

    router.push("/projekt");
  }

  return (
    <SoftScreen
      title="Nytt projekt"
      back="/"
      subtitle="Alla fält krävs. De skrivs ut i Arbetsdagboken och kan inte fyllas i efteråt."
    >
      {error && <div className="px-4 pb-[4px] pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <form onSubmit={onSubmit}>
        {/* The same two cards Redigera Projekt wears, in the same order: what
            the project is, then who is being billed. Creating and correcting a
            project must not be two different forms. */}
        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div
              className="mb-[14px] text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Projektet
            </div>

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

            <div className="mb-[14px] flex gap-[10px]">
              <div className="min-w-0 flex-1">
                <SoftField label="Startdatum">
                  <SoftInput
                    type="date" name="start_date" required defaultValue={stockholmToday()}
                  />
                </SoftField>
              </div>
              <div className="min-w-0 flex-1">
                <SoftField label="Tjänster">
                  <SoftInput name="services" required autoComplete="off" />
                </SoftField>
              </div>
            </div>

            {/* Part of creation, not an afterthought: this is the per-row scope
                for invariant 4b, and a project with no leader can never have a
                day confirmed, so it could never produce a document. */}
            <SoftField
              label="Arbetsledare"
              help={
                iAmLeader
                  ? "Personen som bekräftar projektets dagar. Du läggs till på projektet också."
                  : "Endast denna person kan bekräfta projektets dagar."
              }
            >
              <SoftSelect required value={leaderId} onChange={(e) => setChosen(e.target.value)}>
                <option value="">Välj…</option>
                {leaders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name ?? l.id.slice(0, 8)}
                  </option>
                ))}
              </SoftSelect>
            </SoftField>
          </Card>
        </div>

        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div
              className="mb-1 text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Beställaren
            </div>
            <div className="mb-[14px] text-[14px] font-medium" style={{ color: C.text2 }}>
              Skrivs ut på arbetsdagboken.
            </div>

            <div className="mb-[14px]">
              <SoftField label="Beställarens bolag">
                <SoftInput name="bestallare_bolag" required autoComplete="off" />
              </SoftField>
            </div>

            <div className="mb-[14px]">
              <SoftField label="Beställarens adress" help="Kundens adress.">
                <SoftInput name="bestallare_address" required autoComplete="off" />
              </SoftField>
            </div>

            <SoftField label="Beställarens org nummer">
              <SoftInput
                name="bestallare_orgnr" required autoComplete="off" placeholder="556788-2369"
              />
            </SoftField>
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
          <PrimaryButton type="submit" disabled={saving || !leaderId}>
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
