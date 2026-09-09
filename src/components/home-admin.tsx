"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SignOut } from "./ui";
import {
  C, Card, EmptyState, GroupedList, SHADOW, SoftNotice, SoftSheet,
} from "./soft";
import { getSupabase } from "@/lib/supabase/client";

type Row = {
  project_id: string;
  name: string;
  site_address: string;
  hours: number;
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
// Kalender, the projects, the days waiting. Inställningar is this installation
// and the people in it, which is what someone opens their own icon looking for.
const PROFILE_MENU = [
  { href: "/konto", label: "Konto" },
  { href: "/profil", label: "Profil" },
  { href: "/installningar", label: "Inställningar" },
];

/** Swedish decimal comma, and no trailing ",0" on a whole number. */
const hours = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};

export function HomeAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<"menu" | "profile" | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // The hours are summed in the database. Adding them here would mean
      // shipping every assignment in the company to a phone to total them.
      const { data, error } = await getSupabase()
        .from("project_hours")
        .select("project_id, name, site_address, hours")
        .order("name");

      if (!active) return;
      if (error) { setError(error.message); setRows([]); return; }
      setRows((data ?? []) as Row[]);
    })();
    return () => { active = false; };
  }, []);

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
            Admin
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

        {/* ---- skapa ------------------------------------------------------ */}
        <div className="px-4 pt-[6px]">
          <Card radius={16} shadow={SHADOW.hero} pad="px-[18px] pb-5 pt-[18px]">
            <div
              className="mb-3 text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Skapa
            </div>

            <Link
              href="/projekt/ny"
              className="press-scale mb-[10px] flex h-[60px] w-full items-center justify-center gap-[10px] rounded-[12px] text-[18px] font-extrabold transition-[transform,background] duration-150 hover:bg-[#12206b] active:scale-[.985]"
              style={{
                letterSpacing: "-.4px",
                background: C.accent,
                color: C.surface,
                boxShadow: "0 6px 18px rgba(27,44,193,.26)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M7.5 1v13M1 7.5h13" stroke={C.surface} strokeWidth="2.4" strokeLinecap="round" />
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
                  className="press-scale flex h-14 flex-1 items-center justify-center rounded-[12px] text-[16px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
                  style={{ letterSpacing: "-.2px", background: C.panel2, color: C.inkHover }}
                >
                  {a.label}
                </Link>
              ))}
            </div>
          </Card>
        </div>

        {/* ---- alla projekt ------------------------------------------------ */}
        <div className="px-4 pt-[26px]">
          <div className="flex items-baseline justify-between px-1 pb-[10px]">
            <h2 className="text-[12px] font-bold uppercase" style={{ letterSpacing: "1px", color: C.text2 }}>
              Alla projekt
            </h2>
            {rows !== null && rows.length > 0 && (
              <span className="text-[12px] font-bold" style={{ color: C.accent }}>
                {rows.length} projekt
              </span>
            )}
          </div>

          {rows === null && (
            <p className="px-1 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
          )}
          {rows !== null && rows.length === 0 && <EmptyState>Inga projekt än.</EmptyState>}

          {rows !== null && rows.length > 0 && (
            <div
              className="overflow-hidden rounded-[14px]"
              style={{ background: C.surface, boxShadow: SHADOW.group }}
            >
              {rows.map((p, i) => (
                <div key={p.project_id}>
                  {i > 0 && <div className="ml-[18px] h-px" style={{ background: C.hairline }} />}
                  <Link
                    href={`/arbetsdagbok?projekt=${p.project_id}`}
                    className="flex items-center justify-between gap-3 px-[18px] py-[13px] hover:bg-[#f6f9ff]"
                    style={{ color: C.ink }}
                  >
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[16px] font-bold"
                        style={{ letterSpacing: "-.3px" }}
                      >
                        {p.name}
                      </span>
                      <span className="block truncate text-[14px] font-medium" style={{ color: C.text2 }}>
                        {p.site_address}
                      </span>
                    </span>
                    {/* Accent when there are hours on it, secondary when there
                        are none: the accent is reserved for numbers that
                        change, and "0 h" is the one that has not. */}
                    <span
                      className="whitespace-nowrap text-[15px] font-bold"
                      style={{ color: p.hours ? C.accent : C.text2 }}
                    >
                      {hours(p.hours)} h
                    </span>
                  </Link>
                </div>
              ))}
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
          <GroupedList rows={PROFILE_MENU} />
          {/* SignOut is ui.tsx's, and stays there: one place signs out, whatever
              the screen around it looks like. */}
          <SignOut soft />
        </SoftSheet>
      )}
    </main>
  );
}
