"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/auth-gate";
import { C, EmptyState, SHADOW, SoftScreen } from "@/components/soft";
import { useAccount } from "@/lib/account";
import { getSupabase } from "@/lib/supabase/client";

type Project = {
  id: string;
  name: string;
  site_address: string;
  bestallare_bolag: string;
  bestallare_address: string;
  bestallare_orgnr: string;
};

/** Wraps every occurrence of `query` in `text` with an orange highlight span. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let pos = 0;
  let idx = lower.indexOf(q, pos);
  while (idx !== -1) {
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(
      <mark
        key={idx}
        style={{
          background: "transparent",
          color: C.accentInk,
          fontWeight: 800,
          textDecoration: "underline",
          textDecorationColor: C.accent,
          textDecorationThickness: "2px",
          textUnderlineOffset: "2px",
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/** Returns true if `query` matches any searchable field on this project (or its leaders). */
function matches(p: Project, leaderNames: string[], query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    p.name.toLowerCase().includes(q) ||
    p.site_address.toLowerCase().includes(q) ||
    p.bestallare_bolag.toLowerCase().includes(q) ||
    p.bestallare_address.toLowerCase().includes(q) ||
    p.bestallare_orgnr.toLowerCase().includes(q) ||
    leaderNames.some((n) => n.toLowerCase().includes(q))
  );
}

/**
 * Alla Projekt -- every project the caller can see, and what they may do to one.
 *
 * THE CARD IS THE CONTROL. Tapping a project opens its actions rather than
 * navigating: a project is not a page you read, it is a thing you generate a
 * document from, edit, or look at the shifts of, and those are three different
 * errands. Putting one of them on the card as a permanent button -- which is
 * what Redigera used to be, and what the handoff still draws -- makes that one
 * look like what a project is for.
 *
 * Only one open at a time. Three buttons under every row would be a wall of
 * nine identical controls on a screen with three projects.
 *
 * KOLLA PASS IS WHERE ALLA PASS WENT. That screen is still one screen; it
 * takes ?projekt= and shows this project's shifts. A company-wide list of
 * every shift was a menu entry that answered a question nobody asks -- the
 * calendar is where shape is read, and shifts belong to the project they run
 * on.
 *
 * A LEADER IS OFFERED KOLLA PASS AND NOTHING ELSE, and that is not a
 * permission check -- the database is the boundary, and both of the other two
 * refuse an arbetsledare on their own. It is that the screen became a leader's
 * screen when Alla Projekt entered their menu: an arbetsledare creates
 * projects now, and this is where they see them. Generera Arbetsdagbok and
 * Redigera Projekt send them straight back to their landing page, so drawing
 * them puts two dead controls on every row of a list that is mostly their own
 * projects. A control that cannot do anything for the person looking at it is
 * not a courtesy to them.
 *
 * AND SO A LEADER'S CARD DOES NOT OPEN AT ALL. With one errand behind it, an
 * expanding card is two taps and a divider to reach the only thing it offers;
 * the card is the link to Kolla Pass instead. The admin's still opens, because
 * three errands are a choice.
 *
 * No start date on the card, for either role. Nobody opens this screen to learn
 * when a project began; it is on Redigera Projekt for the one who edits it.
 *
 * TILLVERKA PROJEKT BUTTON + SEARCH (spec 08). The button lives at the top of
 * this page so the creation flow is one tap from the list; it is a second entry
 * point alongside the one on the home screen, not a replacement. The search bar
 * filters in real time against name, address, beställare name and org number,
 * and the arbetssledare names visible to the caller. Matching text is highlighted
 * with an orange underline. Cards whose data contains a hit are still returned
 * even when that field is not visible on the face; the visible fields that do
 * match get highlighted.
 */
function AllaProjekt() {
  const { account } = useAccount();
  const isAdmin = account?.role === "admin";

  const [projects, setProjects] = useState<Project[] | null>(null);
  /** project_id → array of leader names, for search only. */
  const [leaderMap, setLeaderMap] = useState<Map<string, string[]>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sb = getSupabase();
    void (async () => {
      const [{ data: pData }, { data: plData }, { data: adData }] = await Promise.all([
        sb
          .from("project")
          .select("id, name, site_address, bestallare_bolag, bestallare_address, bestallare_orgnr")
          .order("name"),
        sb.from("project_leader").select("project_id, account_id"),
        sb.from("account_directory").select("id, name"),
      ]);

      setProjects((pData ?? []) as Project[]);

      // Build a map from account id -> name for the accounts visible to this caller.
      const accountNames = new Map<string, string>();
      for (const a of adData ?? []) {
        if (a.id && a.name) accountNames.set(a.id, a.name);
      }

      // Then map each project to the visible leader names.
      const lm = new Map<string, string[]>();
      for (const pl of plData ?? []) {
        if (!pl.project_id || !pl.account_id) continue;
        const name = accountNames.get(pl.account_id);
        if (!name) continue;
        const existing = lm.get(pl.project_id) ?? [];
        existing.push(name);
        lm.set(pl.project_id, existing);
      }
      setLeaderMap(lm);
    })();
  }, []);

  if (!projects) {
    return (
      <SoftScreen title="Välj ett projekt" back="/">
        <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </SoftScreen>
    );
  }

  const trimmed = query.trim();
  const filtered = trimmed
    ? projects.filter((p) => matches(p, leaderMap.get(p.id) ?? [], trimmed))
    : projects;

  return (
    <SoftScreen title="Välj ett projekt" back="/">
      {/* ---- Tillverka Projekt button (spec 08) ----------------------------- */}
      <div className="px-4 pt-[6px]">
        <Link
          href="/projekt/ny"
          className="press-scale mb-[10px] flex h-14 w-full items-center justify-center gap-[10px] rounded-full text-[17px] font-bold transition-[transform,background] duration-150 hover:bg-[#3a2a20] active:scale-[.985]"
          style={{
            letterSpacing: "-.2px",
            background: C.accent,
            color: C.onAccent,
            boxShadow: SHADOW.action,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M7.5 1v13M1 7.5h13" stroke={C.onAccent} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Tillverka Projekt
        </Link>

        {/* ---- Search bar (spec 08) ---------------------------------------- */}
        <div
          className="flex h-11 items-center gap-[10px] rounded-[12px] px-[14px]"
          style={{
            background: C.surface,
            border: `1px solid ${C.hairline}`,
            boxShadow: SHADOW.flat,
          }}
        >
          {/* magnifier icon */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
            <circle cx="6.5" cy="6.5" r="5" stroke={C.chevron} strokeWidth="1.8" />
            <path d="M10.5 10.5l3.5 3.5" stroke={C.chevron} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(null); // close any expanded card when query changes
            }}
            placeholder="Sök projekt…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:font-normal"
            style={{ color: C.ink }}
          />
          {query && (
            <button
              type="button"
              aria-label="Rensa sökning"
              onClick={() => { setQuery(""); searchRef.current?.focus(); }}
              className="shrink-0 rounded-full p-[2px] hover:bg-[#f4f3f0]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2 2l10 10M12 2L2 12" stroke={C.chevron} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ---- Project list --------------------------------------------------- */}
      <div className="flex flex-col gap-[10px] px-4 pt-[10px]">
        {projects.length === 0 && !trimmed && <EmptyState>Inga projekt än.</EmptyState>}

        {filtered.length === 0 && trimmed && (
          <EmptyState>Inga projekt hittades.</EmptyState>
        )}

        {filtered.map((p) => {
          const shown = open === p.id;
          // Name and address, then a chevron -- the whole of a card at rest.
          // The chevron turns to point at what it opened on the admin's card,
          // which is the only thing there that says the card is a control.
          const face = (
            <span className="flex items-center justify-between gap-3 px-4 py-[15px] text-left">
              <span className="min-w-0">
                <span className="block text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                  <Highlight text={p.name} query={trimmed} />
                </span>
                <span className="mt-[2px] block text-[15px] font-medium" style={{ color: C.text2 }}>
                  <Highlight text={p.site_address} query={trimmed} />
                </span>
              </span>
              <svg
                width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden
                className="shrink-0 transition-transform duration-150"
                style={{ transform: shown ? "rotate(90deg)" : undefined }}
              >
                <path d="M1.5 1.5 7 7.5l-5.5 6" stroke={C.chevron} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          );

          if (!isAdmin) {
            return (
              <section
                key={p.id}
                data-project={p.id}
                className="rounded-[14px]"
                style={{ background: C.surface, boxShadow: SHADOW.group }}
              >
                <Link href={`/pass?projekt=${p.id}`} className="block rounded-[14px] hover:bg-[#f4f3f0]">
                  {face}
                </Link>
              </section>
            );
          }

          return (
            <section
              key={p.id}
              data-project={p.id}
              className="rounded-[14px]"
              style={{ background: C.surface, boxShadow: SHADOW.group }}
            >
              <button
                type="button"
                aria-expanded={shown}
                onClick={() => setOpen(shown ? null : p.id)}
                className="block w-full"
              >
                {face}
              </button>

              {shown && (
                <div className="px-4 pb-4">
                  <div className="mb-[14px] h-px" style={{ background: C.hairline }} />
                  <div className="flex flex-col gap-[10px]">
                    {/*
                      Links and not buttons: they go somewhere, so a long press
                      opens a new tab and the back arrow behaves. Every id
                      travels in the query string because there is no server to
                      resolve /projekt/<uuid>/... against -- a static export
                      writes one file per route at build time, and a project id
                      does not exist until long after the build.
                    */}
                    {[
                      { href: `/arbetsdagbok?projekt=${p.id}`, label: "Generera Arbetsdagbok" },
                      { href: `/projekt/redigera?id=${p.id}`, label: "Redigera Projekt" },
                      { href: `/pass?projekt=${p.id}`, label: "Kolla Pass" },
                    ].map((a) => (
                      <Link
                        key={a.href}
                        href={a.href}
                        className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985]"
                        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                      >
                        {a.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <AllaProjekt />
    </AuthGate>
  );
}
