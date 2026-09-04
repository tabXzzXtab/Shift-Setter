"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { surveyDayHeading } from "@/lib/dates";

/** What the database says is in the way. Shaped by public.bristsurvey_gaps(). */
export type Gaps = {
  project: {
    id: string;
    name: string;
    bestallare_bolag: string;
    bestallare_address: string;
    bestallare_orgnr: string;
    missing: string[];
  };
  leaders: string[];
  has_shifts: boolean;
  days: {
    work_date: string;
    needs_confirm: boolean;
    needs_text: boolean;
    vad_vi_gjorde: string | null;
    rows: { worker: string; tider: string; timmar: number; stamplat: boolean }[];
  }[];
};

export function hasGaps(g: Gaps): boolean {
  return g.days.length > 0 || g.project.missing.length > 0;
}

/** Ask the database what is in the way. No gaps means the range can generate. */
export async function fetchGaps(projectId: string, from: string, to: string) {
  const { data, error } = await getSupabase().rpc("bristsurvey_gaps", {
    p_project: projectId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return data as unknown as Gaps;
}

/** The four cover values a document cannot print without. */
type ProjectField = "name" | "bestallare_bolag" | "bestallare_address" | "bestallare_orgnr";

const FIELD_LABELS: Record<ProjectField, string> = {
  name: "Projektnamn",
  bestallare_bolag: "Beställarens bolag",
  bestallare_address: "Beställarens adress",
  bestallare_orgnr: "Beställarens org nummer",
};

/**
 * The whole survey is one panel over a darkened page, so it cannot be walked
 * past. Declared at module scope, not inside the component: a component
 * defined during render is a new type on every render, so React would unmount
 * and remount the subtree on each keystroke and the textarea would lose focus
 * after every letter.
 */
function Panel({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bristsurvey"
    >
      <div className="mx-auto w-full max-w-md border-2 border-black bg-white p-4">
        {error && <Notice kind="error">{error}</Notice>}
        {children}
      </div>
    </div>
  );
}

/**
 * Bristsurvey -- the admin's gap-filling path, in three screens.
 *
 * The admin cannot make a stage 1 confirmation; only the assigned arbetsledare
 * can. But a leader can quit, go silent, or never get to it, and the
 * Arbetsdagbok is a legal obligation that cannot wait. So when a range has a
 * gap in it he is stopped here and made to close it himself.
 *
 * Deliberately laborious. One day, one question, one answer -- which for the
 * admin means ringing round and asking people what they did, because it should
 * have been the leader's job. Every choice on these screens points back at the
 * leader: the warning names what he is about to book, the second screen names
 * who owed the confirmation, and the button that leaves is the heavy one.
 */
export function Bristsurvey({
  gaps,
  from,
  to,
  onDone,
  onAbandon,
}: {
  gaps: Gaps;
  from: string;
  to: string;
  onDone: () => void;
  onAbandon: () => void;
}) {
  const router = useRouter();

  const [step, setStep] = useState<"warning" | "leader" | "work">("warning");
  const [live, setLive] = useState(gaps);
  const [text, setText] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The project's cover values come first: four boxes, and they block the
  // document exactly as hard as a missing day does. There is no cursor to keep
  // -- every step re-reads what is left, so the head of the list is the
  // question to ask.
  const onFields = live.project.missing.length > 0;
  const day = onFields ? undefined : live.days[0];

  /**
   * Ask the database again rather than counting down a list taken once. What is
   * in the way can have changed while the admin was on the phone -- a leader
   * may have confirmed one of these days in the meantime, and the survey must
   * not then ask about a day that is no longer his to close.
   */
  async function advance() {
    try {
      const next = await fetchGaps(live.project.id, from, to);
      setBusy(false);
      if (!hasGaps(next)) { onDone(); return; }
      setLive(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunde inte läsa vad som saknas.");
      setBusy(false);
    }
  }

  async function saveFields() {
    setBusy(true);
    setError(null);
    // Typed rather than a bare Record: the update is against a real table, and
    // a key the database has never heard of should not compile.
    const patch: Partial<Record<ProjectField, string>> = {};
    for (const k of live.project.missing) {
      if (k in FIELD_LABELS) patch[k as ProjectField] = (fields[k] ?? "").trim();
    }
    if (Object.keys(patch).length === 0 || Object.values(patch).some((v) => v === "")) {
      setError("Alla fälten behövs innan dokumentet kan skapas.");
      setBusy(false);
      return;
    }
    const { error: uErr } = await getSupabase()
      .from("project").update(patch).eq("id", live.project.id);
    if (uErr) { setError(uErr.message); setBusy(false); return; }
    await advance();
  }

  async function saveDay() {
    if (!day) return;
    setBusy(true);
    setError(null);
    // Only the description is typed. The figures come from what was registered
    // and the database derives them -- the one place in the system where hours
    // come from a span, and the reason this path opens behind a warning.
    const { error: sErr } = await getSupabase().rpc("complete_bristsurvey", {
      p_project: live.project.id,
      p_work_date: day.work_date,
      p_text: text,
    });
    if (sErr) { setError(sErr.message); setBusy(false); return; }
    setText("");
    await advance();
  }

  if (step === "warning") {
    return (
      <Panel error={error}>
        <p className="mb-6 text-lg">
          Att generera en obekräftad arbetsdagbok riskerar att du bokför obekräftade
          arbetstimmar, felaktiga tider och ej verifierade uppgifter i arbetsdagboken,
          vill du gå vidare?
        </p>
        <div className="mb-3">
          {/* Nej leaves, back to Alla Projekt. It is the outcome this screen
              would rather have. */}
          <Button onClick={() => router.push("/projekt")}>Nej</Button>
        </div>
        <Button
          variant="outline"
          onClick={() => setStep(live.days.length > 0 ? "leader" : "work")}
        >
          Ja
        </Button>
      </Panel>
    );
  }

  if (step === "leader") {
    return (
      <Panel error={error}>
        <p className="mb-6 text-lg">
          Passen du begär om har inte blivit bekräftade av{" "}
          <strong>
            {live.leaders.length > 0 ? live.leaders.join(", ") : "någon arbetsledare"}
          </strong>
          , be de att bekräfta passen.
        </p>
        <div className="mb-3">
          {/* The heavier button is the one that leaves. Chasing the leader is
              the right outcome and it looks like the default; taking the day
              off him is the recessive option, deliberately. */}
          <Button onClick={onAbandon}>Tillbaka</Button>
        </div>
        <Button variant="outline" onClick={() => setStep("work")}>
          Bekräfta Uppgifter
        </Button>
      </Panel>
    );
  }

  if (onFields) {
    return (
      <Panel error={error}>
        <h2 className="mb-2 text-xl font-bold">Uppgifter saknas om projektet</h2>
        <p className="mb-4 text-base">
          Dokumentet kan inte skapas med en tom ruta. Fyll i det som saknas.
        </p>
        {live.project.missing.map((k) => (
          <Field key={k} label={FIELD_LABELS[k as ProjectField] ?? k}>
            <Input
              value={fields[k] ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
            />
          </Field>
        ))}
        <Button onClick={saveFields} disabled={busy}>
          {busy ? "Sparar…" : "Spara"}
        </Button>
      </Panel>
    );
  }

  if (!day) return <Panel error={error}><p className="text-lg">Läser…</p></Panel>;

  return (
    <Panel error={error}>
      <p className="mb-1 text-sm font-bold uppercase tracking-wide">
        {live.days.length} dag{live.days.length === 1 ? "" : "ar"} kvar
      </p>
      <h2 className="mb-4 text-xl font-bold">
        Vad har ni uppfyllt på {live.project.name} den {surveyDayHeading(day.work_date)}?
      </h2>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="T.ex. Rev gammalt tegel, la ny underlagspapp och läkt på södra takfallet."
      />

      {/*
        Read-only, and shown rather than hidden. The warning this path opens
        with names "obekräftade arbetstimmar, felaktiga tider" -- so the figures
        about to be booked in the admin's name are put in front of him before he
        does it. He cannot type them; that would be a stage 1 claim by another
        name, which is the one thing this path must not become.
      */}
      {day.rows.length > 0 && (
        <div className="mt-4 border-2 border-black">
          <p className="border-b-2 border-black px-3 py-2 text-sm font-bold uppercase tracking-wide">
            Registrerat — bokförs som det står
          </p>
          <ul>
            {day.rows.map((r, i) => (
              <li key={i} className="flex justify-between gap-2 border-t border-neutral-300 px-3 py-2 text-base first:border-t-0">
                <span>{r.worker}</span>
                <span className="text-right">
                  {r.tider}
                  <span className="block text-sm">
                    {String(r.timmar).replace(".", ",")} h
                    {r.stamplat ? " (stämplat)" : " (planerat)"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <Button onClick={saveDay} disabled={busy || text.trim() === ""}>
          {busy ? "Sparar…" : "Bekräfta dagen"}
        </Button>
      </div>
      <div className="mt-3">
        <Button variant="outline" onClick={onAbandon} disabled={busy}>
          Avbryt
        </Button>
      </div>
    </Panel>
  );
}
