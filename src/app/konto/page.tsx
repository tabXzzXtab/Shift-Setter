"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { Button, Field, Input, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount, type Role } from "@/lib/account";

type Konto = { id: string; name: string | null; email: string | null; role: Role; active: boolean };

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  arbetsledare: "Arbetsledare",
  arbetare: "Arbetare",
};

/**
 * Konto -- who this account is.
 *
 * Namn and e-post are read-only for an arbetare and editable by the admin.
 * That is not enforced here: worker.name and worker.email are already locked
 * against a non-admin by app.tg_worker_self_edit_guard(), and the login email
 * lives in auth.users where the browser cannot reach it at all. This screen
 * only declines to draw a field nobody would be allowed to save.
 *
 * The admin's edit goes through the update-account Edge Function, because
 * changing the login means writing auth.users, which needs the service-role
 * key. It writes both sides: an account whose displayed address is not the one
 * that signs in is worse than a change that was refused.
 */
function Konto({ askedId }: { askedId: string | null }) {
  const { account, reload } = useAccount();
  const target = askedId || account?.id || null;
  const [row, setRow] = useState<Konto | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const isAdmin = account?.role === "admin";

  useEffect(() => {
    if (!target) return;
    let live = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("account_directory")
        .select("id, name, email, role, active")
        .eq("id", target)
        .maybeSingle();

      if (!live) return;
      if (error) { setError(error.message); return; }
      const k = (data ?? null) as Konto | null;
      setRow(k);
      setName(k?.name ?? "");
      setEmail(k?.email ?? "");
    })();
    return () => { live = false; };
  }, [target, tick]);

  async function save() {
    if (!row) return;
    setBusy(true); setError(null); setNote(null);
    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ account_id: row.id, name: name.trim(), email: email.trim() }),
      },
    );
    const body = await res.json().catch(() => ({ error: "Oväntat svar från servern." }));
    if (!res.ok) { setError(body.error ?? "Kunde inte spara."); setBusy(false); return; }

    setNote("Sparat.");
    setBusy(false);
    setTick((t) => t + 1);
    if (row.id === account?.id) reload();
  }

  async function setRole(role: Role) {
    if (!row) return;
    setBusy(true); setError(null); setNote(null);
    const { error } = await getSupabase().from("account").update({ role }).eq("id", row.id);
    if (error) {
      setError(/last active admin/i.test(error.message)
        ? "Det här är den sista aktiva administratören och kan inte degraderas."
        : error.message);
    } else {
      setNote(`Rollen ändrad till ${ROLE_LABEL[role]}.`);
    }
    setBusy(false);
    setTick((t) => t + 1);
    if (row.id === account?.id) reload();
  }

  if (!row) return <Screen title="Konto" back="/"><span>Laddar…</span></Screen>;

  return (
    <Screen title="Konto" back={isAdmin && row.id !== account?.id ? "/installningar" : "/"}>
      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="ok">{note}</Notice>}

      {isAdmin ? (
        <>
          <Field label="Namn">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-post" hint="Det här är inloggningen.">
            <Input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button onClick={save} disabled={busy || !name.trim() || !email.trim()}>
            {busy ? "Sparar…" : "Spara"}
          </Button>

          <div className="mt-8">
            <label className="block">
              <span className="mb-1 block text-sm font-bold uppercase tracking-wide">Roll</span>
              <Select
                value={row.role}
                disabled={busy}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="arbetare">Arbetare</option>
                <option value="arbetsledare">Arbetsledare</option>
                <option value="admin">Admin</option>
              </Select>
            </label>
          </div>
        </>
      ) : (
        <dl className="text-base">
          <div className="flex justify-between gap-3 border-t-2 border-black py-3">
            <dt>Namn</dt>
            <dd className="text-right font-bold">{row.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t-2 border-black py-3">
            <dt>E-post</dt>
            <dd className="break-all text-right font-bold">{row.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3 border-y-2 border-black py-3">
            <dt>Roll</dt>
            <dd className="text-right font-bold">{ROLE_LABEL[row.role]}</dd>
          </div>
        </dl>
      )}

      {!isAdmin && (
        <p className="mt-4 text-base text-neutral-600">
          Namn och e-post ändras av administratören.
        </p>
      )}
    </Screen>
  );
}

/**
 * The account being looked at arrives as ?id=. useSearchParams needs a Suspense
 * boundary in a statically exported app -- the query string is not known when
 * the page is prerendered, only when a browser opens it.
 */
function KontoFromUrl() {
  return <Konto askedId={useSearchParams().get("id")} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<Screen title="Konto" back="/"><span>Laddar…</span></Screen>}>
        <KontoFromUrl />
      </Suspense>
    </AuthGate>
  );
}
