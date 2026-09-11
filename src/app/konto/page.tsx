"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SoftField, SoftInput, SoftNotice, SoftScreen,
  SoftSelect, Tag,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount, type Role } from "@/lib/account";
import { fel } from "@/lib/fel";

type Konto = { id: string; name: string | null; email: string | null; role: Role; active: boolean };

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  arbetsledare: "Arbetsledare",
  arbetare: "Arbetare",
};

/** The handoff gives each role its own fill, deepest for the one with the most. */
const ROLE_TONE: Record<Role, "deep" | "warn" | "quiet"> = {
  admin: "deep",
  arbetsledare: "warn",
  arbetare: "quiet",
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
      if (error) {
        setError(fel(error, "Kunde inte läsa kontot. Ladda om sidan."));
        return;
      }
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
    if (!res.ok) {
      setError(fel(body.error, "Kontot kunde inte sparas. Kontakta administratören."));
      setBusy(false);
      return;
    }

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
      setError(fel(error, "Rollen kunde inte ändras. Kontakta administratören."));
    } else {
      setNote(`Rollen ändrad till ${ROLE_LABEL[role]}.`);
    }
    setBusy(false);
    setTick((t) => t + 1);
    if (row.id === account?.id) reload();
  }

  if (!row) {
    return (
      <SoftScreen title="Konto" back="/">
        <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Konto" back={isAdmin && row.id !== account?.id ? "/installningar" : "/"}>
      {(error || note) && (
        <div className="px-4 pb-[10px] pt-[2px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {note && !error && <SoftNotice tone="live">{note}</SoftNotice>}
        </div>
      )}

      {/* The account card the handoff draws: who this is, at 22/800, with the
          role beside it as a tag rather than as another line of prose. */}
      <div className="px-4 pt-[2px]">
        <Card radius={16} pad="p-[18px]">
          <div className="mb-[14px] flex items-center justify-between gap-[10px]">
            <div
              className="text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Konto
            </div>
            <Tag tone={ROLE_TONE[row.role]}>{ROLE_LABEL[row.role]}</Tag>
          </div>

          <div className="text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
            {row.name ?? "Namn saknas"}
          </div>
          <div
            className={`break-all text-[15px] font-medium ${isAdmin ? "mb-4" : ""}`}
            style={{ color: C.text2 }}
          >
            {row.email ?? "—"}
          </div>

          {/* Editable for the admin only. Not a permission check: worker.name
              and worker.email are locked against a non-admin by
              app.tg_worker_self_edit_guard(), and the login address lives in
              auth.users where the browser cannot reach it at all. This screen
              only declines to draw a field nobody would be allowed to save. */}
          {isAdmin && (
            <>
              <div className="mb-[14px]">
                <SoftField label="Namn">
                  <SoftInput value={name} onChange={(e) => setName(e.target.value)} />
                </SoftField>
              </div>
              <SoftField label="E-post" help="Det här är inloggningen.">
                <SoftInput
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </SoftField>
            </>
          )}
        </Card>
      </div>

      {isAdmin ? (
        <>
          <div className="px-4 pt-[22px]">
            <PrimaryButton onClick={save} disabled={busy || !name.trim() || !email.trim()}>
              {busy ? "Sparar…" : "Spara"}
            </PrimaryButton>
          </div>

          {/* Its own card, 26px down: changing what somebody may do is a
              different act from correcting their name, and the Spara above
              does not save it -- the selector writes on change. */}
          <div className="px-4 pt-[26px]">
            <Card radius={16} pad="p-[18px]">
              <SoftField label="Roll">
                <SoftSelect
                  value={row.role}
                  disabled={busy}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  <option value="arbetare">Arbetare</option>
                  <option value="arbetsledare">Arbetsledare</option>
                  <option value="admin">Admin</option>
                </SoftSelect>
              </SoftField>
            </Card>
          </div>
        </>
      ) : (
        <p
          className="px-5 pt-[14px] text-[15px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          Namn och e-post ändras av administratören.
        </p>
      )}
    </SoftScreen>
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
      <Suspense fallback={<SoftScreen title="Konto" back="/"><span /></SoftScreen>}>
        <KontoFromUrl />
      </Suspense>
    </AuthGate>
  );
}
