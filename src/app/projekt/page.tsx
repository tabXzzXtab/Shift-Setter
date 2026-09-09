"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/auth-gate";
import { Empty, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

type Project = { id: string; name: string; site_address: string; start_date: string };

/**
 * Alla Projekt -- every project, and the three things done to one.
 *
 * THE CARD IS THE CONTROL. Tapping a project opens its actions rather than
 * navigating: a project is not a page you read, it is a thing you generate a
 * document from, edit, or look at the shifts of, and those are three different
 * errands. Putting one of them on the card as a permanent button -- which is
 * what Redigera used to be -- makes that one look like what a project is for.
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

  if (!projects) return <Screen title="Alla projekt" back="/"><span>Laddar…</span></Screen>;

  return (
    <Screen title="Alla projekt" back="/">
      {projects.length === 0 && <Empty>Inga projekt än.</Empty>}
      <div className="flex flex-col gap-3">
        {projects.map((p) => {
          const shown = open === p.id;
          return (
            <section key={p.id} className="border-2 border-black">
              <button
                type="button"
                aria-expanded={shown}
                onClick={() => setOpen(shown ? null : p.id)}
                className="flex w-full flex-col items-start gap-1 p-4 text-left"
              >
                <span className="text-xl font-bold">{p.name}</span>
                <span className="text-base">{p.site_address}</span>
                <span className="text-base text-neutral-600">Start {p.start_date}</span>
              </button>

              {shown && (
                <div className="flex flex-col gap-3 border-t-2 border-black p-4">
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
                      className="flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold"
                    >
                      {a.label}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <AllaProjekt />
    </AuthGate>
  );
}
