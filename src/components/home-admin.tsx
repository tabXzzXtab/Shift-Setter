"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTourReplay, useTourSandbox } from "./tour/tour-provider";
import { SANDBOX_PROJECT } from "@/lib/tour/sandbox";
import {
  C, EmptyState, GroupedList, HomeTitle, SHADOW, SignOut, SoftNotice, SoftSheet,
} from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { fel } from "@/lib/fel";
import { NotisBell } from "./notis-bell";

type Row = {
  project_id: string;
  name: string;
  site_address: string;
};

/**
 * The admin's landing page: the three things he creates, then the list.
 *
 * The list is the work. Those three sit above it because creating is the only
 * thing an owner does that a list cannot show him (spec Section 7). The
 * handoff gathers them into one "Skapa" card rather than leaving three
 * identical slabs stacked down the screen -- Nytt projekt is the accent
 * button, and the two that follow a project's existence share a 56px row
 * beneath it.
 *
 * The Arbetsdagbok is not here and not in the menu. It lives inside the
 * project, because a document is about one project over one range and a button
 * on the landing page would have to ask which before it could do anything.
 *
 * IT DRAWS ITS OWN TOP BAR, as the other two landing pages do: the handoff's
 * icon buttons are a different shape from app-bar's, and behind them are
 * soft.tsx's bottom sheets rather than a panel from the top.
 */
const MENU = [
  { href: "/kalender", label: "Kalender" },
  // Alla Pass is not here. A company-wide list of every shift answered a
  // question nobody asks; shifts belong to the project they run on, and Alla
  // Projekt opens them per project as "Kolla pass".
  { href: "/projekt", label: "Alla Projekt" },
  // Stage 2 AND its log, one entry. In the menu rather than above the list:
  // the three buttons are the things an owner creates, and a review queue is
  // not one. Granska Pass is still a page -- it is where a day is reviewed --
  // but it is reached from the queue that names the day, not from here.
  { href: "/historik", label: "Bekräftelser" },
];

// Behind the profile icon, not in the hamburger. The menu is the work --
// Kalender, the projects, the days waiting. Alla Konton is this installation
// and the people in it, which is what someone opens their own icon looking for.
//
// TWO ENTRIES, NOT THREE. Konto and Profil were separate screens asking about
// one person and are now one; listing the same page twice under two names was
// the menu describing an old seam rather than what is there. "Min profil" is
// what that screen calls itself when it is about you.
// Företaget is the third, and the note above is not a bar on it. What that
// said was that Konto and Profil had been ONE screen listed under two names --
// a seam in the menu rather than a place to go. This is a different screen
// about a different thing: the company itself, as opposed to the people in it.
// It sits here rather than in the hamburger for the same reason Alla Konton
// does. The menu is the work; this is the installation.
//
// Its label matches what fel.ts tells an admin when the Arbetsdagbok refuses
// to generate -- "Företaget i menyn" -- so the sentence names something they
// can see.
const PROFILE_MENU = [
  { href: "/konto", label: "Min profil" },
  { href: "/foretag", label: "Företaget" },
  { href: "/installningar", label: "Alla Konton" },
];

export function HomeAdmin() {
  /** Guide: the first-launch tour again, from its first step. */
  const replay = useTourReplay();
  // THE ADMIN GUIDE'S SANDBOX (lib/tour/sandbox.ts): the project the guide
  // "created" is first in the list -- shown, never saved -- so step 8 has a
  // project to open whether or not the company has one yet.
  const sandbox = useTourSandbox();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<"menu" | "profile" | null>(null);
  /** Which project has its actions showing. Separate from `open`, which is
   *  about the two sheets -- a sheet and a project are not one control. */
  const [openProject, setOpenProject] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // project_hours is the list the landing page has always read -- the
      // same rows RLS and the view's tenant predicate decide. Its hours column
      // is no longer shown here, so it is no longer asked for.
      const { data, error } = await getSupabase()
        .from("project_hours")
        .select("project_id, name, site_address")
        .order("name");

      if (!active) return;
      if (error) {
        setError(fel(error, "Kunde inte läsa projekten. Ladda om sidan."));
        setRows([]);
        return;
      }
      setRows((data ?? []) as Row[]);
    })();
    return () => { active = false; };
  }, []);

  const list: Row[] | null = sandbox
    ? [{ project_id: SANDBOX_PROJECT.id, name: SANDBOX_PROJECT.name, site_address: SANDBOX_PROJECT.site_address },
       ...(rows ?? [])]
    : rows;

  return (
    <main
      data-screen="admin"
      className="mx-auto min-h-[844px] w-full max-w-[390px] pb-[40px]"
      style={{
        background: C.ground,
        color: C.ink,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* Everything the sheet covers. The handoff draws the home BLURRED and
          dimmed behind an open sheet, not merely darkened, so the page stays
          legible as the place you are coming back to.

          It is its own element because a CSS filter makes an ancestor the
          containing block for fixed positioning: a sheet inside this would
          stop being fixed to the viewport, and would be blurred with the rest
          of the page. */}
      <div style={open ? { filter: "blur(2px)", opacity: 0.5 } : undefined}>
        {/* ---- top bar ---------------------------------------------------- */}
        <div
          className="sticky top-0 z-[5] flex items-center justify-between gap-2 px-4 pb-[10px] pt-[14px]"
          style={{ background: "rgba(247,246,243,.88)", backdropFilter: "blur(12px)" }}
        >
          <button
            type="button"
            aria-label="Meny"
            aria-expanded={open === "menu"}
            onClick={() => setOpen("menu")}
            className="press-scale flex h-11 w-11 items-center justify-center rounded-[11px] p-0 transition-transform duration-[120ms] hover:bg-[#f4f3f0] active:scale-[.985] active:bg-[#e9e8e4]"
            style={{ background: C.surface, boxShadow: SHADOW.flat }}
          >
            <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden>
              <path d="M1 1.5h18M1 7h18M1 12.5h18" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>

          <div className="flex items-center gap-2">
            <NotisBell />
            <button
              type="button"
              aria-label="Profil"
              aria-expanded={open === "profile"}
              onClick={() => setOpen("profile")}
              className="press-scale flex h-11 w-11 items-center justify-center rounded-[11px] p-0 transition-transform duration-[120ms] hover:bg-[#f4f3f0] active:scale-[.985] active:bg-[#e9e8e4]"
              style={{ background: C.surface, boxShadow: SHADOW.flat }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <circle cx="10" cy="6.4" r="3.4" stroke={C.ink} strokeWidth="2" />
                <path d="M3.6 17c.9-3.3 3.4-5 6.4-5s5.5 1.7 6.4 5" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* What an owner does here, not whose screen it is. Nothing to check:
            creating and opening are both undoable. */}
        <HomeTitle title="Skapa eller öppna ett projekt" />

        {error && <div className="px-4 pb-[6px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

        {/* ---- skapa ------------------------------------------------------ */}
        {/* No card around these: the title says what the screen is for and the
            actions follow it straight on the ground (the Ro pass). */}
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
              Nytt projekt
            </Link>

            <div className="flex gap-[10px]">
              {[
                { href: "/pass/ny", label: "Skapa pass" },
                { href: "/snabb", label: "Snabb pass" },
              ].map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="press-scale flex h-[54px] flex-1 items-center justify-center rounded-full text-[16px] font-bold transition-transform duration-[110ms] hover:bg-[#f4f3f0] active:scale-[.985]"
                  style={{ letterSpacing: "-.2px", background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                >
                  {a.label}
                </Link>
              ))}
            </div>
        </div>

        {/* ---- alla projekt ------------------------------------------------ */}
        <div className="px-4 pt-[26px]">
          <div className="flex items-baseline justify-between px-1 pb-[10px]">
            <h2 className="text-[12px] font-bold uppercase" style={{ letterSpacing: "1px", color: C.text2 }}>
              Alla projekt
            </h2>
          </div>

          {list === null && (
            <p className="px-1 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
          )}
          {list !== null && list.length === 0 && <EmptyState>Inga projekt än.</EmptyState>}

          {list !== null && list.length > 0 && (
            <div className="flex flex-col gap-2">
              {list.map((p) => {
                const shown = openProject === p.project_id;
                return (
                <div
                  key={p.project_id}
                  data-project={p.project_id}
                  className="overflow-hidden rounded-[16px]"
                  style={{ background: C.surface }}
                >
                  {/*
                    THE ROW IS A CONTROL, not a link, and it opens the same
                    three actions Alla Projekt opens. It used to go straight to
                    Generera Arbetsdagbok -- which made one of three equal
                    errands look like what a project is for, and made this list
                    disagree with the list on the other screen about what
                    tapping a project means.
                  */}
                  <button
                    type="button"
                    aria-expanded={shown}
                    onClick={() => setOpenProject(shown ? null : p.project_id)}
                    className="flex w-full items-center justify-between gap-3 px-[18px] py-[14px] text-left hover:bg-[#f4f3f0]"
                    style={{ color: C.ink }}
                  >
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[16px] font-bold"
                        style={{ letterSpacing: "-.3px" }}
                      >
                        {p.name}
                      </span>
                      <span className="block truncate text-[14px] font-normal" style={{ color: C.text2 }}>
                        {p.site_address}
                      </span>
                    </span>
                    {/* No hours on the row: this list is for getting to a project,
                        not for reporting on it. Hours belong in the Arbetsdagbok. */}
                    <span className="flex shrink-0 items-center gap-[10px]">
                      {/* The chevron turns to point at what it opened, which is
                          the only thing on the row that says it is a control. */}
                      <svg
                        width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden
                        className="transition-transform duration-150"
                        style={{ transform: shown ? "rotate(90deg)" : undefined }}
                      >
                        <path d="M1.5 1.5 7 7.5l-5.5 6" stroke={C.chevron} strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>

                  {shown && (
                    <div className="px-[18px] pb-4">
                      <div className="mb-[14px] h-px" style={{ background: C.hairline }} />
                      <div className="flex flex-col gap-[10px]">
                        {/* The same three, in the same order, pointing at the
                            same routes as Alla Projekt. Two lists that disagree
                            about what a project offers is worse than either. */}
                        {[
                          { href: `/arbetsdagbok?projekt=${p.project_id}`, label: "Generera Arbetsdagbok" },
                          { href: `/projekt/redigera?id=${p.project_id}`, label: "Redigera Projekt" },
                          { href: `/pass?projekt=${p.project_id}`, label: "Kolla Pass" },
                        ].map((a) => (
                          <Link
                            key={a.href}
                            href={a.href}
                            className="press-scale flex h-12 w-full items-center justify-center rounded-full text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985]"
                            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
                          >
                            {a.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---- the two sheets ------------------------------------------------ */}
      {open === "menu" && (
        <SoftSheet onClose={() => setOpen(null)} label="Meny">
          <GroupedList rows={MENU} />
        </SoftSheet>
      )}

      {open === "profile" && (
        <SoftSheet onClose={() => setOpen(null)} label="Profil">
          <GroupedList rows={[...PROFILE_MENU, ...(replay ? [{ label: "Guide", onClick: () => { setOpen(null); replay?.(); } }] : [])]} />
          {/* One place signs out, whatever the screen around it looks like. */}
          <SignOut quiet />
        </SoftSheet>
      )}
    </main>
  );
}
