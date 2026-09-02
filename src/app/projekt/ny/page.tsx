"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { Button, Field, Input, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";

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
 */
function NyttProjekt() {
  const router = useRouter();
  const [leaders, setLeaders] = useState<{ id: string; name: string | null }[]>([]);
  const [leaderId, setLeaderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSupabase()
      .from("account_directory")
      .select("id, name, role")
      .eq("role", "arbetsledare")
      .then(({ data }) => {
        const rows = (data ?? []).map((d) => ({ id: d.id!, name: d.name }));
        setLeaders(rows);
        if (rows.length === 1) setLeaderId(rows[0]!.id);
      });
  }, []);

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
      setError(pErr?.message ?? "Kunde inte spara projektet.");
      setSaving(false);
      return;
    }

    const { error: lErr } = await sb
      .from("project_leader")
      .insert({ project_id: project.id, account_id: leaderId });

    if (lErr) {
      setError(`Projektet skapades men arbetsledaren kunde inte kopplas: ${lErr.message}`);
      setSaving(false);
      return;
    }

    router.push("/projekt");
  }

  return (
    <Screen title="Nytt projekt" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-6 text-base">
        Alla fält krävs. De skrivs ut i Arbetsdagboken och kan inte fyllas i
        efteråt.
      </p>

      <form onSubmit={onSubmit}>
        <Field label="Projektnamn">
          <Input name="name" required autoComplete="off" />
        </Field>

        <Field label="Projektets adress" hint="Dit arbetaren åker.">
          <Input name="site_address" required autoComplete="off" />
        </Field>

        <Field label="Beställarens adress" hint="Kundens adress. Skrivs ut på dokumentet.">
          <Input name="bestallare_address" required autoComplete="off" />
        </Field>

        <Field label="Beställarens bolag">
          <Input name="bestallare_bolag" required autoComplete="off" />
        </Field>

        <Field label="Beställarens org nummer">
          <Input name="bestallare_orgnr" required autoComplete="off" placeholder="556788-2369" />
        </Field>

        <Field label="Tjänster">
          <Input name="services" required autoComplete="off" />
        </Field>

        <Field label="Startdatum">
          <Input type="date" name="start_date" required defaultValue={stockholmToday()} />
        </Field>

        <Field label="Arbetsledare" hint="Endast denna person kan bekräfta projektets dagar.">
          <Select required value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
            <option value="">Välj…</option>
            {leaders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name ?? l.id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>

        {leaders.length === 0 && (
          <Notice kind="info">
            Det finns ingen arbetsledare än. Skapa en under “Ny arbetare” först.
          </Notice>
        )}

        <div className="mt-6">
          <Button type="submit" disabled={saving || !leaderId}>
            {saving ? "Sparar…" : "Skapa projekt"}
          </Button>
        </div>
      </form>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyttProjekt />
    </AuthGate>
  );
}
