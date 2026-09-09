"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SoftNastaPass } from "./nasta-pass-card";
import { SignOut } from "./ui";
import {
  C, Card, GroupedList, SHADOW, SoftNotice, SoftSheet,
} from "./soft";
import { pendingDays } from "@/lib/pending-days";

const MENU = [
  // "Arbetsdagar", not "Min Pass Kalender". The page sets AVAILABILITY -- it
  // writes forval -- and Mina Pass's Kalender tab shows the days already held.
  // Two calendars whose names both said "pass" read as the same screen twice,
  // and this is the name the arbetare already opens the very same route under.
  { href: "/min-kalender", label: "Arbetsdagar" },
  { href: "/mina-pass", label: "Mina Pass" },
  // Both roles read the log, scoped to the projects they are on -- day_history
  // answers the same question for the leader and the owner, so this is the
  // same page the admin opens and not a second version of it.
  { href: "/historik", label: "Bekräftelser" },
];

/**
 * The arbetsledare's landing page, per the handoff.
 *
 * THE HERO IS A COUNT, not a list. The role's job is to confirm days, so the
 * first thing on the screen is how many are owed -- which is what "a leader
 * should see the size of the debt without pressing anything" asked for. The
 * days themselves are named one tap away, in Bekräfta Pass and in
 * Bekräftelser' "Att bekräfta"; neither existed as a list when the widget was
 * written, and three places saying the same thing is two too many.
 *
 * The red dot went with it. #d62728 is not in this design's palette at all,
 * and a count that reads "2 dagar" carries the alarm the dot was carrying
 * without needing a second colour to say it.
 *
 * Nästa Pass is READ ONLY, and that is a decision rather than an omission: a
 * leader's days are auto-assigned (Step 4b), so there is nothing to accept,
 * and a button that only ever agrees with what is already true teaches people
 * to press without reading.
 *
 * Alla Projekt and Alla Arbetare are not in the menu. They stay reachable from
 * the project rows, and neither is a leader's daily work.
 */
export function HomeArbetsledare() {
  const [waiting, setWaiting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<"menu" | "profile" | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        // The same definition Bekräfta Pass and the "Att bekräfta" tab use, so
        // the number on this card and the list it opens cannot disagree.
        const days = await pendingDays();
        if (live) setWaiting(days.length);
      } catch (e) {
        if (live) { setError(e instanceof Error ? e.message : "Kunde inte läsa passen."); setWaiting(0); }
      }
    })();

    return () => { live = false; };
  }, []);

  // Swedish counts one day in the singular, and a screen whose whole subject is
  // a number should not get its own number's grammar wrong.
  const count =
    waiting === null ? "…" : waiting === 0 ? "Inget just nu" : `${waiting} ${waiting === 1 ? "dag" : "dagar"}`;
  const line =
    waiting === null
      ? "Hämtar dina dagar."
      : waiting === 0
        ? "Allt är bekräftat."
        : `Bekräfta ${waiting === 1 ? "den" : "dem"} innan admin kan godkänna.`;

  return (
    <div
      data-screen="arbetsledare"
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
          of the page.

          No aria-hidden on it: the sheet carries aria-modal, which is what
          takes the page behind out of the accessibility tree, and hiding an
          element that still holds focus -- the hamburger that opened the sheet
          is in here -- is itself the error. */}
      <div
        style={open ? { filter: "blur(2px)", opacity: 0.5 } : undefined}
      >
      {/* ---- top bar ------------------------------------------------------ */}
      <div
        className="sticky top-0 z-[5] flex items-center justify-between gap-2 px-4 pb-[10px] pt-[14px]"
        style={{ background: "rgba(243,246,253,.88)", backdropFilter: "blur(12px)" }}
      >
        <button
          type="button"
          aria-label="Meny"
          aria-expanded={open === "menu"}
          onClick={() => setOpen("menu")}
          className="press-scale flex h-11 w-11 items-center justify-center rounded-[11px] p-0 transition-transform duration-[120ms] hover:bg-[#f0f5ff] active:scale-[.985] active:bg-[#dbe4f9]"
          style={{ background: C.surface, boxShadow: SHADOW.flat }}
        >
          <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden>
            <path d="M1 1.5h18M1 7h18M1 12.5h18" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>

        <h1 className="text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
          Arbetsledare
        </h1>

        <button
          type="button"
          aria-label="Profil"
          aria-expanded={open === "profile"}
          onClick={() => setOpen("profile")}
          className="press-scale flex h-11 w-11 items-center justify-center rounded-[11px] p-0 transition-transform duration-[120ms] hover:bg-[#f0f5ff] active:scale-[.985] active:bg-[#dbe4f9]"
          style={{ background: C.surface, boxShadow: SHADOW.flat }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="10" cy="6.4" r="3.4" stroke={C.ink} strokeWidth="2" />
            <path d="M3.6 17c.9-3.3 3.4-5 6.4-5s5.5 1.7 6.4 5" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {error && <div className="px-4 pb-[6px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {/* ---- the hero: what is owed --------------------------------------- */}
      <div className="px-4 pt-[6px]">
        <Card radius={16} shadow={SHADOW.hero} pad="px-5 pb-[18px] pt-5">
          <div
            className="mb-[2px] text-[12px] font-bold uppercase"
            style={{ letterSpacing: "1px", color: C.text2 }}
          >
            Väntar på dig
          </div>
          <div
            role="status"
            aria-label={
              waiting === null
                ? "Hämtar dagar som väntar på bekräftelse"
                : `${waiting} dagar väntar på bekräftelse`
            }
            className="mb-1 text-[34px] font-extrabold leading-[1.05]"
            style={{ letterSpacing: "-1.4px" }}
          >
            {count}
          </div>
          <div className="mb-[18px] text-[15px] font-medium" style={{ color: C.text2 }}>
            {line}
          </div>

          {/* 66px, the one primary action on the screen. It leads somewhere
              real even at zero: Bekräfta Pass draws its own empty state, which
              the handoff designs, rather than this card having to. */}
          <Link
            href="/bekrafta"
            className="press-scale flex h-[66px] w-full items-center justify-center rounded-[12px] text-[23px] font-extrabold transition-[transform,background] duration-150 hover:bg-[#12206b] active:scale-[.985]"
            style={{
              letterSpacing: "-.5px",
              background: C.accent,
              color: C.surface,
              boxShadow: SHADOW.action,
            }}
          >
            Bekräfta pass
          </Link>
        </Card>
      </div>

      {/* ---- skapa pass ---------------------------------------------------- */}
      <div className="px-4 pt-[14px]">
        <Link
          href="/pass/ny"
          className="press-scale flex h-[60px] w-full items-center justify-center gap-[10px] rounded-[12px] text-[18px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
          style={{ letterSpacing: "-.3px", background: C.panel2, color: C.inkHover }}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M7.5 1v13M1 7.5h13" stroke={C.inkHover} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Skapa pass
        </Link>
      </div>

      {/* ---- grouped nav --------------------------------------------------- */}
      <div className="px-4 pt-[14px]">
        <GroupedList rows={MENU} />
      </div>

      {/* ---- nästa pass ---------------------------------------------------- */}
      <div className="px-4 pt-[26px]">
        <SoftNastaPass />
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
          <GroupedList rows={[{ href: "/konto", label: "Konto" }, { href: "/profil", label: "Profil" }]} />
          {/* SignOut is ui.tsx's, and stays there: one place signs out, whatever
              the screen around it looks like. */}
          <SignOut soft />
        </SoftSheet>
      )}
    </div>
  );
}
