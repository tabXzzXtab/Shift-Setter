"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { SoftScreen } from "@/components/soft";
import { DagPanel } from "@/components/dag-panel";
import { getSupabase } from "@/lib/supabase/client";

/**
 * One project's day: every pass it runs on the date, who stands on each, and
 * everything that acts on them -- the trash icon (with Avboka bokning?), the
 * leader's Avboka Pass and Byta Plats, Ändra detta pass, Ta bort detta pass.
 *
 * Opened by tapping a pass on the day's timeline. These controls lived on the
 * day page itself, under project tabs; they moved here so the day can be read
 * as a timeline and the acting happens one project at a time. DagPanel is the
 * same component, scoped to the project -- the rules and guards are unchanged.
 */
function ProjektDag({ date, project, from }: { date: string; project: string; from: string }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getSupabase().from("project").select("name").eq("id", project).maybeSingle()
      .then(({ data }) => { if (live) setName(data?.name ?? null); });
    return () => { live = false; };
  }, [project]);

  return (
    <SoftScreen
      title={name ?? "Projektet"}
      back={from}
      subtitle="Kontrollera vem som står på passet innan du avbokar."
    >
      <div className="px-4 pt-[2px]">
        {/* heading: the panel's day kicker says which date this is. */}
        <DagPanel date={date} project={project} />
      </div>
    </SoftScreen>
  );
}

function FromUrl() {
  const params = useSearchParams();
  const d = params.get("datum");
  const p = params.get("projekt");
  const fran = params.get("fran");
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  const project = p && /^[0-9a-f-]{36}$/i.test(p) ? p : null;
  const from = fran && fran.startsWith("/") && !fran.startsWith("//") ? fran : date ? `/dag?datum=${date}` : "/";
  if (!date || !project) return <SoftScreen title="Projektet" back="/"><span /></SoftScreen>;
  return <ProjektDag date={date} project={project} from={from} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Projektet" back="/"><span /></SoftScreen>}>
        <FromUrl />
      </Suspense>
    </AuthGate>
  );
}
