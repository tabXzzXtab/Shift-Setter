"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  Avatar, C, ChevronRight, DangerButton, EmptyState, SecondaryButton, SHADOW,
  SoftDialog, SoftInput, SoftNotice, SoftScreen,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount, type Role } from "@/lib/account";
import { signAvatars } from "@/lib/avatar";
import { fel } from "@/lib/fel";

type Konto = {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  active: boolean;
  avatar_path: string | null;
};

/** Sections, in the order a company is shaped: fewest people first. */
const ORDER: Role[] = ["admin", "arbetsledare", "arbetare"];

const ROLE_HEADING: Record<Role, string> = {
  admin: "Admin",
  arbetsledare: "Arbetsledare",
  arbetare: "Arbetare",
};

const TrashIcon = () => (
  <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
    <path d="M1.6 4.2h10.8M5 4.2V2.4h4v1.8M2.8 4.2l.8 9.4h6.8l.8-9.4"
      stroke={C.stopInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Alla Konton -- every account the company has.
 *
 * THIS SCREEN USED TO BE A WALL. Each account was a card carrying a role tag,
 * an Aktiv pill, a role selector, two half-width buttons and a pause button --
 * five controls and two status chips, repeated down a page that ran to thirty
 * thousand pixels at fifty people. Everything on it was findable and nothing
 * was scannable.
 *
 * What it is now:
 *
 *   THE ROLE IS THE SECTION HEADING, not a tag on every row. Fifty tags
 *   spelling out three words is fifty things to read past, and grouping
 *   answers the same question better -- a role change moves somebody between
 *   sections, which is a stronger signal than a chip changing colour.
 *
 *   AKTIV IS GONE. It said "normal" on almost every row. PAUSAD is not gone,
 *   because it is the exception and the reason somebody is getting no shifts;
 *   it sits on the email line in the stop ink, as words rather than as a pill.
 *
 *   THE SELECTOR AND THE PAUSE MOVED to the account's own screen. They are
 *   things you do to one person after deciding to, not things you should be
 *   able to do by mis-tapping while scrolling past them.
 *
 *   THE ROW IS A LINK, and the handoff's red square is beside it. Two
 *   controls, the second of which asks before it acts.
 *
 *   SEARCH, because grouping alone still leaves a long scroll, and "where is
 *   Jonas" should not be answered by scrolling.
 *
 * Nothing here is a permission check. The list is account_directory, whose
 * WHERE is "admin sees everyone, everyone else sees exactly themselves", so an
 * arbetsledare who forces their way to this URL reads one row -- their own.
 * Removal goes through public.delete_account(), which refuses a non-admin in
 * the database.
 */
function AllaKonton() {
  const { account } = useAccount();
  const [rows, setRows] = useState<Konto[] | null>(null);
  const [faces, setFaces] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Konto | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await getSupabase()
        .from("account_directory")
        .select("id, name, email, role, active, avatar_path")
        .order("name");

      if (!live) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa kontona. Ladda om sidan."));
        setRows([]);
        return;
      }
      const list = (data ?? []) as Konto[];
      setRows(list);
      // ONE call for every face on the screen. The bucket is private, so each
      // path has to be signed; fifty rows must not mean fifty requests.
      setFaces(await signAvatars(list.map((k) => k.avatar_path)));
    })();
    return () => { live = false; };
  }, [tick]);

  /**
   * Removal. The database decides whether the account is erased outright or
   * shut down with its rows intact -- it asks the foreign keys, because an
   * account that has confirmed a day cannot lose the name on those hours
   * (invariant 3). The Edge Function is only there for auth.users, which needs
   * the service-role key and can never be reached from a static bundle.
   */
  async function remove(k: Konto) {
    setBusy(true); setError(null); setNote(null);
    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ account_id: k.id }),
      },
    );
    const body = await res.json().catch(() => ({ error: "Oväntat svar från servern." }));

    setBusy(false);
    setConfirming(null);

    if (!res.ok) {
      setError(fel(body.error, "Kontot kunde inte tas bort. Kontakta administratören."));
      return;
    }

    const who = k.name ?? k.email ?? "Kontot";
    setNote(
      body.warning
        ? body.warning
        : body.mode === "raderat"
        ? `${who} är borttagen.`
        : `${who} är borttagen. Namnet står kvar på de arbetsdagböcker som redan är skapade.`,
    );
    setTick((t) => t + 1);
  }

  const me = rows?.find((k) => k.id === account?.id) ?? null;

  /**
   * Everyone else, filtered and grouped. Self is excluded: they are already at
   * the top of the screen, and a list that shows you twice is a list that is
   * wrong about how many people work here.
   */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = (rows ?? []).filter((k) => {
      if (k.id === account?.id) return false;
      if (!q) return true;
      return (k.name ?? "").toLowerCase().includes(q)
        || (k.email ?? "").toLowerCase().includes(q);
    });
    return ORDER
      .map((role) => ({ role, list: matching.filter((k) => k.role === role) }))
      .filter((g) => g.list.length > 0);
  }, [rows, query, account?.id]);

  const found = groups.reduce((n, g) => n + g.list.length, 0);

  if (rows === null) {
    return (
      <SoftScreen title="Alla Konton" back="/">
        <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Alla Konton" back="/">
      {(error || note) && (
        <div className="flex flex-col gap-[10px] px-4 pb-[10px] pt-[2px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {note && !error && <SoftNotice tone="live">{note}</SoftNotice>}
        </div>
      )}

      {/* YOU, above everything. The owner opening this screen is usually here
          for somebody else, but their own details were previously two menu
          levels away behind an icon -- and the one account an admin can always
          edit should not be the hardest one to reach. Press it and it is the
          same screen every other row opens. */}
      {me && (
        <div className="px-4 pt-[2px]">
          <Link
            href="/konto"
            className="press-scale flex items-center gap-[14px] rounded-[16px] p-[14px] transition-transform duration-[110ms] hover:bg-[#f6f9ff] active:scale-[.99]"
            style={{ background: C.surface, boxShadow: SHADOW.hero, color: C.ink }}
          >
            <Avatar src={faces.get(me.avatar_path ?? "")} name={me.name} email={me.email} size={56} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[18px] font-extrabold" style={{ letterSpacing: "-.4px" }}>
                {me.name ?? "Namn saknas"}
              </div>
              <div className="truncate text-[14px] font-medium" style={{ color: C.text2 }}>
                {me.email ?? "—"}
              </div>
              <div className="pt-[1px] text-[12px] font-bold uppercase"
                   style={{ letterSpacing: "1px", color: C.text2 }}>
                Din profil · {ROLE_HEADING[me.role]}
              </div>
            </div>
            <ChevronRight />
          </Link>
        </div>
      )}

      {/* The one thing on this screen the list itself cannot show. */}
      <div className="px-4 pt-[14px]">
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

      {/* Sticky, so it is still reachable forty rows down -- which is the only
          depth at which anybody actually wants it. */}
      <div
        className="sticky top-0 z-10 px-4 pb-[10px] pt-[18px]"
        style={{ background: C.ground }}
      >
        <SoftInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök namn eller e-post"
          aria-label="Sök bland kontona"
        />
      </div>

      {rows.length <= 1 && (
        <div className="px-4">
          <EmptyState headline="Inga andra konton än ditt">
            Tillverka Konto lägger till den första arbetaren.
          </EmptyState>
        </div>
      )}

      {rows.length > 1 && found === 0 && (
        <div className="px-4">
          <EmptyState headline="Ingen träff">
            Inget konto matchar “{query.trim()}”. Prova en del av namnet eller e-posten.
          </EmptyState>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.role} data-roll={g.role} className="px-4 pt-[14px]">
          <div className="px-1 pb-[10px] text-[12px] font-bold uppercase"
               style={{ letterSpacing: "1px", color: C.text2 }}>
            {ROLE_HEADING[g.role]} · {g.list.length}
          </div>

          <div className="flex flex-col gap-[10px]">
            {g.list.map((k) => (
              <div
                key={k.id}
                data-konto={k.id}
                className="flex items-center gap-[10px] rounded-[14px] p-[10px]"
                style={{ background: C.surface, boxShadow: SHADOW.group }}
              >
                <Link
                  href={`/konto?id=${k.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 py-[6px] hover:bg-[#f6f9ff]"
                  style={{ color: C.ink }}
                >
                  <Avatar src={faces.get(k.avatar_path ?? "")} name={k.name} email={k.email} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
                      {k.name ?? "Namn saknas"}
                    </div>
                    {/* Colour is never the only carrier: the word is there too. */}
                    <div className="truncate text-[14px] font-medium" style={{ color: C.text2 }}>
                      {!k.active && (
                        <span className="font-bold" style={{ color: C.stopInk }}>Pausad · </span>
                      )}
                      {k.email ?? "—"}
                    </div>
                  </div>
                  <ChevronRight />
                </Link>

                <DangerButton
                  full={false}
                  disabled={busy}
                  label={`Ta bort ${k.name ?? k.email ?? "kontot"}`}
                  onClick={() => setConfirming(k)}
                >
                  <TrashIcon />
                </DangerButton>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Removal is asked about before it happens, and the question is honest
          about BOTH outcomes without pretending to know which one this is: the
          database decides that by asking the foreign keys. */}
      {confirming && (
        <SoftDialog label="Ta bort konto" onDismiss={busy ? undefined : () => setConfirming(null)}>
          <div className="mb-[6px] text-[20px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
            Ta bort {confirming.name ?? confirming.email ?? "kontot"}?
          </div>
          <p className="mb-[18px] text-[15px] font-medium"
             style={{ color: C.text2, textWrap: "pretty" }}>
            Kontot försvinner ur listan och personen kan inte logga in igen. Pass
            som inte har börjat frisläpps. Har de arbetat står namnet kvar på de
            arbetsdagböcker som redan är skapade.
          </p>
          <div className="flex flex-col gap-[10px]">
            <DangerButton solid disabled={busy} onClick={() => void remove(confirming)}>
              {busy ? "Tar bort…" : "Ta bort kontot"}
            </DangerButton>
            <SecondaryButton onClick={() => setConfirming(null)} disabled={busy}>
              Avbryt
            </SecondaryButton>
          </div>
        </SoftDialog>
      )}
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <AllaKonton />
    </AuthGate>
  );
}
