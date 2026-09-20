"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, EmptyState, SectionLabel, SoftNotice, SoftScreen, SoftSelect, Tag,
} from "@/components/soft";
import { ACTING_ROLE_KEY, HOME_FOR, type ActingRole } from "@/components/agerar-banner";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";
import { fel } from "@/lib/fel";

type Tenant = {
  id: string;
  name: string;
  org_nr: string;
  account_type: "demo" | "sold" | "gift" | "owner";
  expires_at: string | null;
};

const TYPE_WORD: Record<Tenant["account_type"], string> = {
  owner: "Operatör",
  sold: "Kund",
  demo: "Demo",
  gift: "Gåva",
};

const ROLES: { value: ActingRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "arbetsledare", label: "Arbetsledare" },
  { value: "arbetare", label: "Arbetare" },
];

/**
 * The operator's screen -- every tenancy, and the way into one.
 *
 * NOT A ROLE CHECK DRESSED AS A PAGE. What stops somebody else reading this is
 * public.tenant's policy: it returns the caller's own tenancy and nothing more
 * unless app.is_super_admin() says otherwise. A client's admin who types this
 * address gets their own company and a list of one -- so the refusal below is
 * a courtesy that explains, not the boundary. The boundary is in the database,
 * as everything here is.
 *
 * ENTERING IS A DATABASE ACT. enter_tenant() writes a row that
 * app.current_tenant_id() reads, so from the next request onwards every policy
 * narrows the operator to that tenancy -- including out of Korperation's own
 * rows. That is why the banner's Lämna button lives in the root layout rather
 * than only here: once inside, this page is one of the things scoped away.
 *
 * THE ROLE IS NOT A DEMOTION and the banner's comment says so at length. It
 * chooses which home screen to open. A super admin who picks "Arbetare" is
 * still an admin to the database.
 */
function SuperScreen() {
  const { account, loading } = useAccount();
  const router = useRouter();
  const [isSuper, setIsSuper] = useState<boolean | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [role, setRole] = useState<Record<string, ActingRole>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // super_admin is not on account_directory, so it is read from the row the
  // caller owns -- which M2a's account policy keeps readable whatever tenancy
  // they are standing in.
  useEffect(() => {
    if (!account) return;
    let live = true;
    void (async () => {
      const { data } = await getSupabase()
        .from("account").select("super_admin").eq("id", account.id).maybeSingle();
      if (live) setIsSuper(Boolean(data?.super_admin));
    })();
    return () => { live = false; };
  }, [account]);

  useEffect(() => {
    if (isSuper !== true) return;
    let live = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("tenant")
        .select("id, name, org_nr, account_type, expires_at")
        .order("account_type")
        .order("name");
      if (!live) return;
      if (error) { setError(fel(error, "Kunde inte läsa företagen. Ladda om sidan.")); setTenants([]); return; }
      setTenants((data ?? []) as Tenant[]);
    })();
    return () => { live = false; };
  }, [isSuper]);

  async function enter(t: Tenant) {
    setBusy(t.id); setError(null);
    const chosen = role[t.id] ?? "admin";
    const { error } = await getSupabase().rpc("enter_tenant", { p_tenant: t.id });
    if (error) {
      setError(fel(error, "Kunde inte gå in i företaget."));
      setBusy(null);
      return;
    }
    try { window.sessionStorage.setItem(ACTING_ROLE_KEY, chosen); } catch { /* private mode */ }
    router.push(HOME_FOR[chosen]);
    router.refresh();
  }

  if (loading || isSuper === null) {
    return <SoftScreen title="Företag"><div className="px-4 pt-[14px]" /></SoftScreen>;
  }

  if (!isSuper) {
    return (
      <SoftScreen title="Företag" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">
            Den här sidan är för dem som driver ByggKoll. Ditt konto hör till ett
            företag och ser bara det.
          </SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen
      title="Företag"
      back="/"
      subtitle="Välj ett företag för att arbeta inuti det."
    >
      {error && <div className="px-4 pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {tenants !== null && tenants.length === 0 && (
        <div className="px-4 pt-[22px]"><EmptyState>Inga företag ännu.</EmptyState></div>
      )}

      {tenants !== null && tenants.length > 0 && (
        <div className="px-4 pt-[14px]">
          <SectionLabel>{tenants.length} företag</SectionLabel>
          <div className="flex flex-col gap-[10px]">
            {tenants.map((t) => (
              <Card key={t.id} radius={14} pad="px-4 py-[14px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      data-tenant={t.name}
                      className="truncate text-[17px] font-extrabold"
                      style={{ letterSpacing: "-.3px" }}
                    >
                      {t.name}
                    </div>
                    <div className="pt-[2px] text-[14px] font-medium" style={{ color: C.text2 }}>
                      {t.org_nr}
                    </div>
                  </div>
                  <Tag tone={t.account_type === "owner" ? "live" : "quiet"}>
                    {TYPE_WORD[t.account_type]}
                  </Tag>
                </div>

                {/* A demo that has run out is the one thing about a tenancy
                    worth saying on a list rather than on its own screen. */}
                {t.expires_at && (
                  <div className="pt-[6px] text-[13px] font-semibold" style={{ color: C.text2 }}>
                    Går ut {t.expires_at.slice(0, 10)}
                  </div>
                )}

                <div className="flex items-center gap-[10px] pt-[12px]">
                  <div className="min-w-0 flex-1">
                    <SoftSelect
                      aria-label={`Roll i ${t.name}`}
                      value={role[t.id] ?? "admin"}
                      onChange={(e) =>
                        setRole((p) => ({ ...p, [t.id]: e.target.value as ActingRole }))}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </SoftSelect>
                  </div>
                  <button
                    type="button"
                    data-enter={t.name}
                    onClick={() => void enter(t)}
                    disabled={busy !== null}
                    className="press-scale h-[52px] shrink-0 rounded-[10px] px-[18px] text-[15px] font-bold transition-transform duration-[110ms] active:scale-[.985]"
                    style={{
                      background: busy === t.id ? C.panel2 : C.accent,
                      color: busy === t.id ? C.text2 : C.surface,
                    }}
                  >
                    {busy === t.id ? "Går in…" : "Gå in"}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <SuperScreen />
    </AuthGate>
  );
}
