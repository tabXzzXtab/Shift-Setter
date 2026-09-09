"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/auth-gate";
import { C, EmptyState, SHADOW, SoftScreen } from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";

type Project = { id: string; name: string; site_address: string; start_date: string };

/**
 * Alla Projekt -- every project, and the three things done to one.
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
 * None of this is gated on the role here. The pages it opens do their own
 * checking and the database does the real one; a second copy of that rule in
 * a list is a second place for it to drift.
 */
function AllaProjekt() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .from("project")
      .select("id, name, site_address, start_date")
      .order("name")
      .then(({ data }) => setProjects((data ?? []) as Project[]));
  }, []);

  if (!projects) {
    return (
      <SoftScreen title="Alla projekt" back="/">
        <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Alla projekt" back="/">
      <div className="flex flex-col gap-[10px] px-4 pt-1">
        {projects.length === 0 && <EmptyState>Inga projekt än.</EmptyState>}

        {projects.map((p) => {
          const shown = open === p.id;
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
                className="w-full px-4 py-[15px] text-left"
              >
                <span className="block text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                  {p.name}
                </span>
                <span
                  className="mb-3 mt-[2px] block text-[15px] font-medium"
                  style={{ color: C.text2 }}
                >
                  {p.site_address}
                </span>
                <span className="flex items-center justify-between gap-[10px]">
                  <span
                    className="text-[12px] font-bold"
                    style={{ letterSpacing: ".4px", color: C.text2 }}
                  >
                    Start {p.start_date}
                  </span>
                  {/* The chevron turns to point at what it opened, which is the
                      only thing on the card that says the card is a control. */}
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
                        className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
                        style={{ background: C.panel2, color: C.inkHover }}
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
