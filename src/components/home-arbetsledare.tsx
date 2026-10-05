"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTourReplay } from "./tour/tour-provider";
import { SoftNastaPass } from "./nasta-pass-card";
import {
  C, Card, GroupedList, HomeTitle, SHADOW, SignOut, SoftNotice, SoftSheet,
} from "./soft";
import { pendingDays } from "@/lib/pending-days";
import { fel } from "@/lib/fel";

const MENU = [
  // ONE ENTRY, NOT TWO. Arbetsdagar -- the availability calendar that writes
  // forval -- is the Tillgänglighet tab of Mina Pass now, beside the days
  // already held. It was a separate row for as long as its name had to explain
  // that it was not the other calendar; a leader weighing whether to say yes to
  // a week reads both halves at once, and making that a round trip through the
  // hamburger is what the merge removes. The route still exists, because the
  // arbetare's landing page opens it as a grouped row.
  { href: "/mina-pass", label: "Mina Pass" },
  // Both roles read the log, scoped to the projects they are on -- day_history
  // answers the same question for the leader and the owner, so this is the
  // same page the admin opens and not a second version of it.
  { href: "/historik", label: "Bekräftelser" },
  // Last, because it is the least daily of the three -- and present at all
  // because a leader who creates a project needs somewhere to see it. The
  // screen is the admin's own; RLS decides which projects are in it, so for a
  // leader it holds the sites they lead and the ones they made.
  { href: "/projekt", label: "Alla projekt" },
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
  /** Guide: the first-launch tour again, from its first step. */
  const replay = useTourReplay();
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
        if (live) {
          setError(fel(e, "Kunde inte läsa dagarna som väntar på dig. Ladda om sidan."));
          setWaiting(0);
        }
      }
    })();

    return () => { live = false; };
  }, []);

  // Swedish counts one day in the singular, and a screen whose whole subject is
  // a number should not get its own number's grammar wrong.
  /** Days owed, or still loading -- either way the hero keeps its full weight
   *  until the count says there is nothing. */
  const owed = waiting === null || waiting > 0;
  // Drawn only while something is owed (or still loading), so there is no
  // zero case to word.
  const count = waiting === null ? "…" : `${waiting} ${waiting === 1 ? "dag" : "dagar"}`;
  const line = waiting === null
    ? "Hämtar dina dagar."
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

      {/* What to do now, not whose screen it is: the days while any are owed,
          a new pass when none are. Nothing on either to check first. */}
      <HomeTitle title={owed ? "Bekräfta dina dagar" : "Skapa ett pass"} />

      {error && <div className="px-4 pb-[6px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {/* ---- the hero: what is owed ---------------------------------------
          Only while something IS owed. With nothing waiting the title above
          already says what to do -- Skapa ett pass -- and a card announcing
          that nothing is waiting only stood between the title and the button.
          Days stay reachable through Bekräftelser below. */}
      {owed && (
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

          {/* 66px, the one primary action on the screen. */}
          <Link
            href="/bekrafta"
            className="press-scale flex h-[66px] w-full items-center justify-center rounded-[12px] text-[23px] font-extrabold transition-[transform,background] duration-150 hover:bg-[#12206b] active:scale-[.985]"
            style={{ letterSpacing: "-.5px", background: C.accent, color: C.surface, boxShadow: SHADOW.action }}
          >
            Bekräfta pass
          </Link>
        </Card>
      </div>
      )}

      {/* ---- skapa ---------------------------------------------------------
          Two creates, side by side rather than stacked: the hero above is the
          screen's one primary action, and a second full-width button under
          Skapa Pass would read as a second hero and push Nästa Pass off a
          phone. The pair is the shape the admin's landing page already uses
          for two creates of equal weight.

          Confirming is the leader's most common act, so while days are owed
          both stay secondary. With nothing owed the hero steps down and SKAPA
          PASS TAKES THE ACCENT: it is the natural next step for an idle
          leader, and the tour's first action. Both keep the handoff's plus. */}
      <div className="flex gap-[10px] px-4 pt-[14px]">
        {[
          { href: "/pass/ny", label: "Skapa pass", lead: !owed },
          { href: "/projekt/ny", label: "Nytt projekt", lead: false },
        ].map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={`press-scale flex h-[60px] min-w-0 flex-1 items-center justify-center gap-[8px] rounded-[12px] text-[16px] font-bold transition-transform duration-[110ms] active:scale-[.985] ${
              a.lead ? "hover:bg-[#12206b]" : "hover:bg-[#e9e8e4]"
            }`}
            style={
              a.lead
                ? { letterSpacing: "-.3px", background: C.accent, color: C.surface, boxShadow: SHADOW.action }
                : { letterSpacing: "-.3px", background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }
            }
          >
            <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden>
              <path d="M7.5 1v13M1 7.5h13" stroke={a.lead ? C.surface : C.inkHover} strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            {a.label}
          </Link>
        ))}
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
          <GroupedList rows={[{ href: "/konto", label: "Min profil" }, ...(replay ? [{ label: "Guide", onClick: () => { setOpen(null); replay?.(); } }] : [])]} />
          {/* One place signs out, whatever the screen around it looks like. */}
          <SignOut quiet />
        </SoftSheet>
      )}
    </div>
  );
}
