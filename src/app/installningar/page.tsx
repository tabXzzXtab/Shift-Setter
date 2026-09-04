"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { ActionLink, Empty, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount, type Role } from "@/lib/account";

type Konto = {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  active: boolean;
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  arbetsledare: "Arbetsledare",
  arbetare: "Arbetare",
};

/**
 * Turn what the database refuses into something a Swedish owner can act on.
 *
 * The guards raise in English because they are addressed to whoever is reading
 * the logs. This screen is addressed to the person who pressed the button.
 */
function saySwedish(message: string): string {
  if (/last active admin/i.test(message)) {
    return "Det här är den sista aktiva administratören. Kontot kan inte pausas eller ändras — gör någon annan till admin först.";
  }
  if (/permission denied|insufficient/i.test(message)) {
    return "Du har inte behörighet att göra det.";
  }
  return message;
}

/**
 * Inställningar -- the Konton list.
 *
 * Every account the company has: who they are, what they may do, and whether
 * they are working at all. Creating one lives at the top because it is the only
 * thing here that the list itself cannot show.
 *
 * Name and email come from auth.users through account_directory. That is
 * deliberate: an account created by bootstrap-admin has no worker record, and
 * a Konton list that could not show the owner his own line would be lying
 * about what accounts exist.
 *
 * Nothing here is a permission check. The role selector and the pause switch
 * write straight to public.account, where the admin policy and
 * app.tg_last_admin_guard() decide what actually happens -- an arbetsledare who
 * forces their way to this URL reads an empty list.
 */
function Installningar() {
  const { account, reload } = useAccount();
  const [rows, setRows] = useState<Konto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("account_directory")
        .select("id, name, email, role, active")
        .order("name");

      if (!live) return;
      if (error) { setError(error.message); setRows([]); return; }
      setRows((data ?? []) as Konto[]);
    })();
    return () => { live = false; };
  }, [tick]);

  async function setRole(id: string, role: Role) {
    setBusy(id); setError(null); setNote(null);
    const { error } = await getSupabase().from("account").update({ role }).eq("id", id);
    if (error) setError(saySwedish(error.message));
    else setNote(`Rollen ändrad till ${ROLE_LABEL[role]}.`);
    setBusy(null);
    setTick((t) => t + 1);
    if (id === account?.id) reload();   // your own role decides your own screen
  }

  async function setActive(id: string, active: boolean) {
    setBusy(id); setError(null); setNote(null);
    // Pausing releases every shift that has not started yet and withdraws any
    // pending offers -- done by a trigger, so it happens whether the pause
    // comes from here or from anywhere else.
    const { error } = await getSupabase().from("account").update({ active }).eq("id", id);
    if (error) setError(saySwedish(error.message));
    else setNote(active
      ? "Kontot är aktivt igen. Kommande pass måste tilldelas på nytt."
      : "Kontot är pausat. Pass som inte har börjat är frisläppta — pågående pass är deras sista.");
    setBusy(null);
    setTick((t) => t + 1);
    if (id === account?.id) reload();
  }

  if (rows === null) {
    return <Screen title="Inställningar" back="/"><span>Laddar…</span></Screen>;
  }

  return (
    <Screen title="Inställningar" back="/">
      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="ok">{note}</Notice>}

      <div className="mb-8">
        <ActionLink href="/arbetare/ny">Tillverka Konto</ActionLink>
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Konton</h2>

      {rows.length === 0 && <Empty>Inga konton att visa.</Empty>}

      <div className="flex flex-col gap-4">
        {rows.map((k) => (
          <section key={k.id} className="border-2 border-black p-4">
            <p className="text-xl font-bold">{k.name ?? "Namn saknas"}</p>
            <p className="mb-1 break-all text-base">{k.email ?? "—"}</p>
            <p className="mb-4 text-base font-bold">
              {ROLE_LABEL[k.role]} · {k.active ? "Aktiv" : "Pausad"}
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-bold uppercase tracking-wide">Roll</span>
              <Select
                value={k.role}
                disabled={busy === k.id}
                onChange={(e) => setRole(k.id, e.target.value as Role)}
              >
                <option value="arbetare">Arbetare</option>
                <option value="arbetsledare">Arbetsledare</option>
                <option value="admin">Admin</option>
              </Select>
            </label>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setActive(k.id, !k.active)}
                disabled={busy === k.id}
                className="flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold disabled:opacity-30"
              >
                {k.active ? "Pausa kontot" : "Aktivera kontot"}
              </button>

              <Link
                href={`/konto?id=${k.id}`}
                className="flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold"
              >
                Ändra konto
              </Link>

              <Link
                href={`/profil?id=${k.id}`}
                className="flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold"
              >
                Ändra profil
              </Link>
            </div>
          </section>
        ))}
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Installningar />
    </AuthGate>
  );
}
