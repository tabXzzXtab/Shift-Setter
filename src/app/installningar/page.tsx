"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, EmptyState, SHADOW, SoftField, SoftNotice, SoftScreen, SoftSelect, Tag,
} from "@/components/soft";
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

/** The handoff gives each role its own fill, deepest for the one with the most. */
const ROLE_TONE: Record<Role, "deep" | "warn" | "quiet"> = {
  admin: "deep",
  arbetsledare: "warn",
  arbetare: "quiet",
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
    return (
      <SoftScreen title="Inställningar" back="/">
        <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Inställningar" back="/">
      {(error || note) && (
        <div className="px-4 pb-[10px] pt-[2px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {note && !error && <SoftNotice tone="live">{note}</SoftNotice>}
        </div>
      )}

      {/* The one thing on this screen the list itself cannot show. 56px and
          accent, above the list rather than in it. */}
      <div className="px-4 pt-[2px]">
        <Link
          href="/arbetare/ny"
          className="press-scale flex h-14 w-full items-center justify-center gap-[10px] rounded-[12px] text-[17px] font-extrabold transition-[transform,background] duration-150 hover:bg-[#12206b] active:scale-[.985]"
          style={{
            letterSpacing: "-.3px",
            background: C.accent,
            color: C.surface,
            boxShadow: "0 6px 18px rgba(27,44,193,.26)",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M7.5 1v13M1 7.5h13" stroke={C.surface} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Tillverka Konto
        </Link>
      </div>

      <div className="px-4 pt-[22px]">
        <div
          className="px-1 pb-[10px] text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          Konton
        </div>

        {rows.length === 0 && <EmptyState>Inga konton att visa.</EmptyState>}

        <div className="flex flex-col gap-3">
          {rows.map((k) => (
            <section
              key={k.id}
              data-konto={k.id}
              className="rounded-[16px] px-[18px] pb-[18px] pt-4"
              style={{ background: C.surface, boxShadow: SHADOW.group }}
            >
              <div className="flex items-center justify-between gap-[10px]">
                <div className="min-w-0 truncate text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                  {k.name ?? "Namn saknas"}
                </div>
                {/* The three roles are told apart by weight of fill, not hue --
                    the handoff's own roleTag. Paused is a separate mark: a
                    role and a state are two facts about one account. */}
                <Tag tone={ROLE_TONE[k.role]}>{ROLE_LABEL[k.role]}</Tag>
              </div>

              <div
                className="mb-[14px] mt-[2px] break-all text-[14px] font-medium"
                style={{ color: C.text2 }}
              >
                {k.email ?? "—"}
              </div>

              <div className="mb-[14px]">
                <Tag tone={k.active ? "live" : "stop"}>{k.active ? "Aktiv" : "Pausad"}</Tag>
              </div>

              <div className="mb-[14px]">
                <SoftField label="Roll">
                  <SoftSelect
                    value={k.role}
                    disabled={busy === k.id}
                    onChange={(e) => setRole(k.id, e.target.value as Role)}
                  >
                    <option value="arbetare">Arbetare</option>
                    <option value="arbetsledare">Arbetsledare</option>
                    <option value="admin">Admin</option>
                  </SoftSelect>
                </SoftField>
              </div>

              {/* Two 48px halves and the pause below them, which is the shape
                  the handoff gives an account row -- except that nothing here
                  deletes: an account is paused, never removed, so the red
                  square that would sit at the end has nothing to do. */}
              <div className="mb-[10px] flex gap-[10px]">
                <Link
                  href={`/konto?id=${k.id}`}
                  className="press-scale flex h-12 flex-1 items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
                  style={{ background: C.panel2, color: C.inkHover }}
                >
                  Ändra konto
                </Link>
                <Link
                  href={`/profil?id=${k.id}`}
                  className="press-scale flex h-12 flex-1 items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
                  style={{ background: C.panel2, color: C.inkHover }}
                >
                  Ändra profil
                </Link>
              </div>

              <button
                type="button"
                onClick={() => setActive(k.id, !k.active)}
                disabled={busy === k.id}
                className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] active:scale-[.985] disabled:opacity-40"
                style={
                  k.active
                    ? { background: C.stopBg, color: C.stopInk }
                    : { background: C.panel2, color: C.inkHover }
                }
              >
                {k.active ? "Pausa kontot" : "Aktivera kontot"}
              </button>
            </section>
          ))}
        </div>
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Installningar />
    </AuthGate>
  );
}
