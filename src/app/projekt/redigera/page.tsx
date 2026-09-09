"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { useAccount } from "@/lib/account";
import {
  C, Card, DangerButton, PrimaryButton, SecondaryButton, SoftField, SoftInput,
  SoftNotice, SoftScreen,
} from "@/components/soft";
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
 *
 * TWO CARDS, NOT ONE COLUMN. The handoff splits the seven fields into what the
 * project is and who is being billed, because those are read at different
 * times: the site address is checked against a van's satnav, the org nummer
 * against an invoice. The card titles are what make that split visible.
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

type FieldSpec = { key: keyof Omit<Project, "id">; label: string; help?: string };

/**
 * The labels are the ones /projekt/ny already uses, not the shorter ones the
 * handoff draws under its card titles. The two project forms write the same
 * seven columns, and a field a person fills in as "Beställarens bolag" on one
 * screen and "Bolag" on the other is two names for one thing.
 */
const PROJEKTET: FieldSpec[] = [
  { key: "name", label: "Projektnamn" },
  { key: "site_address", label: "Projektets adress", help: "Dit arbetaren åker." },
];

const PROJEKTET_PAIR: FieldSpec[] = [
  { key: "start_date", label: "Startdatum" },
  { key: "services", label: "Tjänster" },
];

const BESTALLAREN: FieldSpec[] = [
  { key: "bestallare_bolag", label: "Beställarens bolag" },
  { key: "bestallare_address", label: "Beställarens adress", help: "Kundens adress." },
  { key: "bestallare_orgnr", label: "Beställarens org nummer" },
];

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

/** The ground, the header and a line -- the three loading and dead ends. */
function Plain({ children }: { children: React.ReactNode }) {
  return (
    <SoftScreen title="Redigera projekt" back="/projekt">
      <div className="px-4 pt-[2px]">{children}</div>
    </SoftScreen>
  );
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
    return <Plain><p className="text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p></Plain>;
  }

  if (!id || missing) {
    return <Plain><SoftNotice tone="stop">Projektet finns inte.</SoftNotice></Plain>;
  }

  if (!project) {
    return <Plain><p className="text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p></Plain>;
  }

  /** One field, wired to the row. Every one on this screen is the same object. */
  const field = ({ key, label, help }: FieldSpec) => (
    <SoftField key={key} label={label} help={help}>
      <SoftInput
        type={key === "start_date" ? "date" : "text"}
        value={project[key]}
        required
        autoComplete="off"
        onChange={(e) => {
          setSaved(false);
          setProject({ ...project, [key]: e.target.value });
        }}
      />
    </SoftField>
  );

  return (
    <SoftScreen title="Redigera projekt" back="/projekt">
      {(error || saved) && (
        <div className="px-4 pb-[10px] pt-[2px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {saved && !error && <SoftNotice tone="live">Ändringarna är sparade.</SoftNotice>}
        </div>
      )}

      <form onSubmit={onSave}>
        <div className="px-4 pt-[2px]">
          <Card radius={16} pad="p-[18px]">
            <div
              className="mb-[14px] text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Projektet
            </div>
            {PROJEKTET.map((f) => (
              <div key={f.key} className="mb-[14px]">{field(f)}</div>
            ))}
            {/* Startdatum and Tjänster share a row: both are short, and a date
                on its own line reads as more of the form than it is. */}
            <div className="flex gap-[10px]">
              {PROJEKTET_PAIR.map((f) => (
                <div key={f.key} className="min-w-0 flex-1">{field(f)}</div>
              ))}
            </div>
          </Card>
        </div>

        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div
              className="mb-1 text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Beställaren
            </div>
            <div className="mb-[14px] text-[14px] font-medium" style={{ color: C.text2 }}>
              Skrivs ut på arbetsdagboken.
            </div>
            {BESTALLAREN.map((f, i) => (
              <div key={f.key} className={i < BESTALLAREN.length - 1 ? "mb-[14px]" : undefined}>
                {field(f)}
              </div>
            ))}
          </Card>
        </div>

        <div className="px-4 pt-[22px]">
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? "Sparar…" : "Spara ändringar"}
          </PrimaryButton>
        </div>
      </form>

      {/*
        Separated by 26px and drawn as a tint rather than a fill. This is the
        only control on the screen that destroys something, and the handoff is
        explicit that it must not be the loudest button on the page -- it sits
        under Spara ändringar, shorter and quieter, with the consequence
        spelled out beneath it.

        The confirmation step is not in the handoff, which draws the resting
        state only. It stays: deletion is irreversible and a single tap is not
        a decision.
      */}
      <div className="px-4 pt-[26px]">
        {!confirming ? (
          <>
            <DangerButton
              solid
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              Ta bort projekt
            </DangerButton>
            <p
              className="pt-[10px] text-center text-[14px] font-medium"
              style={{ color: C.text2 }}
            >
              Går inte att ångra.
            </p>
          </>
        ) : (
          <div className="rounded-[14px] p-[18px]" style={{ background: C.stopBg }}>
            <p
              className="mb-[14px] text-[17px] font-bold"
              style={{ letterSpacing: "-.2px", color: C.stopInk }}
            >
              Är du säker? Detta går inte att ångra.
            </p>
            <div className="mb-[10px]">
              <DangerButton solid onClick={onDelete} disabled={deleting}>
                {deleting ? "Tar bort…" : "Ja, ta bort projektet"}
              </DangerButton>
            </div>
            <SecondaryButton onClick={() => setConfirming(false)} disabled={deleting}>
              Avbryt
            </SecondaryButton>
          </div>
        )}
      </div>
    </SoftScreen>
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
          <Plain>
            <p className="text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
          </Plain>
        }
      >
        <RedigeraFromUrl />
      </Suspense>
    </AuthGate>
  );
}
