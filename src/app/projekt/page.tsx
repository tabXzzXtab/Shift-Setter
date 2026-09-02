"use client";

import { useEffect, useState } from "react";
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
