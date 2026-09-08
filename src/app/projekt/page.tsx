"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/auth-gate";
import { Empty, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

type Project = { id: string; name: string; site_address: string; start_date: string };

function AllaProjekt() {
  const [projects, setProjects] = useState<Project[] | null>(null);

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
        {projects.map((p) => (
          <section key={p.id} className="border-2 border-black p-4">
            <p className="text-xl font-bold">{p.name}</p>
            <p className="text-base">{p.site_address}</p>
            <p className="text-base text-neutral-600">Start {p.start_date}</p>

            {/*
              A link and not a button: it goes somewhere, so it opens in a new
              tab on a long press and the back arrow behaves. The id travels in
              the query string because there is no server to resolve
              /projekt/<uuid>/redigera against -- see the page it points at.

              Not gated on the role. Only the admin's landing page links here,
              and the edit page sends anybody else to their own home; a check
              in this list would be a second place to keep the same rule.
            */}
            <Link
              href={`/projekt/redigera?id=${p.id}`}
              className="mt-3 flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold"
            >
              Redigera
            </Link>
          </section>
        ))}
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
