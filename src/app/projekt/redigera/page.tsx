"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { useAccount } from "@/lib/account";
import { Button, Field, Input, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Redigera projekt -- the edit page Alla Projekt sends you to.
 *
 * WHY ?id= AND NOT /projekt/[id]/redigera
 *
 * There is no server. `output: "export"` writes a file per route at build
 * time, GitHub Pages has no rewrite layer, and a project id is a uuid minted
 * long after the build -- so /projekt/<uuid>/redigera/ could only resolve if
 * every id that will ever exist were known to `next build`. Next names this
 * outright: dynamic routes without generateStaticParams are unsupported under
 * a static export. The query string is the shape that works, and /dag?datum=
 * already established it here.
 *
 * WHAT THE DATABASE DOES, NOT THIS PAGE
 *
 * The admin check below picks which screen to draw. It protects nothing --
 * project_admin_write does that, and a leader who forces their way here gets a
 * form whose every write is refused. Same for the delete: the refusal lives in
 * public.delete_project(), and the confirmation step is a courtesy in front of
 * it rather than the thing holding the rule up.
 */

type Project = {
  id: string;
  name: string;
  site_address: string;
  start_date: string;
  services: string;
  bestallare_address: string;
  bestallare_bolag: string;
  bestallare_orgnr: string;
};

/** Every business column on the table, in the order the document reads them. */
const FIELDS = [
  ["name", "Projektnamn", ""],
  ["site_address", "Projektets adress", "Dit arbetaren åker."],
  ["start_date", "Startdatum", ""],
  ["services", "Tjänster", ""],
  ["bestallare_address", "Beställarens adress", "Kundens adress. Skrivs ut på dokumentet."],
  ["bestallare_bolag", "Beställarens bolag", ""],
  ["bestallare_orgnr", "Beställarens org nummer", ""],
] as const;

/**
 * The database speaks its own language and the site does not. Only the
 * refusals an admin can act on are translated; anything else arrives verbatim,
 * because a message nobody wrote is better than a friendly one that hides
 * which rule fired.
 */
function saySwedish(message: string): string {
  if (message.includes("active passes")) {
    return "Projektet har aktiva pass och kan inte tas bort.";
  }
  if (message.includes("only an admin")) {
    return "Bara en administratör kan ta bort ett projekt.";
  }
  if (message.includes("already deleted")) {
    return "Projektet är redan borttaget.";
  }
  return message;
}

function RedigeraProjekt({ id }: { id: string | null }) {
  const router = useRouter();
  const { account, loading: accountLoading } = useAccount();
  const isAdmin = account?.role === "admin";

  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Anyone who is not an admin goes to their own landing page. "/" is the
  // role-dispatched one, so a leader lands on the leader's home and a worker
  // on the worker's without this page needing to know which is which.
  useEffect(() => {
    if (!accountLoading && !isAdmin) router.replace("/");
  }, [accountLoading, isAdmin, router]);

  useEffect(() => {
    if (!id || !isAdmin) return;
    let active = true;

    void (async () => {
      // One literal, not a concatenation: supabase-js infers the row type by
      // parsing this string at compile time, and a joined expression it cannot
      // read comes back as GenericStringError instead of a project.
      const { data } = await getSupabase()
        .from("project")
        .select(
          "id, name, site_address, start_date, services, bestallare_address, bestallare_bolag, bestallare_orgnr",
        )
        .eq("id", id)
        .maybeSingle();

      if (!active) return;
      // No row is not necessarily "no such project": a deleted one is filtered
      // by the policy and reads exactly the same way from here. Both are dead
      // ends for this page, and it does not pretend to tell them apart.
      if (!data) setMissing(true);
      else setProject(data as Project);
    })();

    return () => {
      active = false;
    };
  }, [id, isAdmin]);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!project) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const { error: uErr } = await getSupabase()
      .from("project")
      .update({
        name: project.name,
        site_address: project.site_address,
        start_date: project.start_date,
        services: project.services,
        bestallare_address: project.bestallare_address,
        bestallare_bolag: project.bestallare_bolag,
        bestallare_orgnr: project.bestallare_orgnr,
      })
      .eq("id", project.id);

    if (uErr) setError(saySwedish(uErr.message));
    else setSaved(true);
    setSaving(false);
  }

  async function onDelete() {
    if (!project) return;
    setDeleting(true);
    setError(null);

    const { error: dErr } = await getSupabase().rpc("delete_project", {
      p_project: project.id,
    });

    if (dErr) {
      setError(saySwedish(dErr.message));
      setConfirming(false);
      setDeleting(false);
      return;
    }
    router.push("/projekt");
  }

  if (accountLoading || !isAdmin) {
    return (
      <Screen title="Redigera projekt" back="/projekt">
        <span>Laddar…</span>
      </Screen>
    );
  }

  if (!id || missing) {
    return (
      <Screen title="Redigera projekt" back="/projekt">
        <Notice kind="error">Projektet finns inte.</Notice>
      </Screen>
    );
  }

  if (!project) {
    return (
      <Screen title="Redigera projekt" back="/projekt">
        <span>Laddar…</span>
      </Screen>
    );
  }

  return (
    <Screen title="Redigera projekt" back="/projekt">
      {error && <Notice kind="error">{error}</Notice>}
      {saved && <Notice kind="ok">Ändringarna är sparade.</Notice>}

      <form onSubmit={onSave}>
        {FIELDS.map(([key, label, hint]) => (
          <Field key={key} label={label} hint={hint || undefined}>
            <Input
              type={key === "start_date" ? "date" : "text"}
              value={project[key]}
              required
              autoComplete="off"
              onChange={(e) => {
                setSaved(false);
                setProject({ ...project, [key]: e.target.value });
              }}
            />
          </Field>
        ))}

        <div className="mt-6">
          <Button type="submit" disabled={saving}>
            {saving ? "Sparar…" : "Spara ändringar"}
          </Button>
        </div>
      </form>

      {/*
        The one red thing on the site. CLAUDE.md keeps colour for the shift
        calendar, where it carries meaning -- and it carries meaning here for
        the same reason: this is the only control in the app that destroys
        something, and it must not look like the button above it.

        Styled inline rather than as a Button variant, because ui.tsx is shared
        and this page is not the place to add a colour every screen inherits.
      */}
      <div className="mt-12 border-t-2 border-black pt-6">
        {!confirming ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            className="flex min-h-[56px] w-full items-center justify-center border-2 border-red-700 bg-red-700 px-4 text-center text-lg font-bold text-white"
          >
            Ta bort projekt
          </button>
        ) : (
          <div className="border-2 border-red-700 p-4">
            <p className="mb-4 text-lg font-bold">Är du säker? Detta går inte att ångra.</p>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="mb-3 flex min-h-[56px] w-full items-center justify-center border-2 border-red-700 bg-red-700 px-4 text-center text-lg font-bold text-white disabled:opacity-30"
            >
              {deleting ? "Tar bort…" : "Ja, ta bort projektet"}
            </button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={deleting}>
              Avbryt
            </Button>
          </div>
        )}
      </div>
    </Screen>
  );
}

/**
 * The id arrives as ?id=. useSearchParams needs a Suspense boundary in a
 * statically exported app -- the query string is not known when the page is
 * prerendered, only when a browser opens it.
 *
 * Shape-checked before use: the value goes into a where-clause, and PostgREST
 * answers anything that is not a uuid with a 400 rather than an empty result.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function RedigeraFromUrl() {
  const asked = useSearchParams().get("id");
  return <RedigeraProjekt id={asked && UUID.test(asked) ? asked : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <Screen title="Redigera projekt" back="/projekt">
            <span>Laddar…</span>
          </Screen>
        }
      >
        <RedigeraFromUrl />
      </Suspense>
    </AuthGate>
  );
}
