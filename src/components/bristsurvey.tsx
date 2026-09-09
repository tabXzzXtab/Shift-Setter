"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  C, Card, PrimaryButton, SecondaryButton, SHADOW, SoftField, SoftInput,
  SoftNotice, SoftTextarea,
} from "@/components/soft";
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
      className="fixed inset-0 z-50 overflow-y-auto p-4"
      style={{ background: "rgba(9,21,64,.42)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Bristsurvey"
    >
      <div
        className="mx-auto mt-[40px] w-full max-w-[358px] pb-[40px]"
        style={{ color: C.ink, fontFamily: "var(--font-inter), system-ui, sans-serif", fontVariantNumeric: "tabular-nums" }}
      >
        <Card radius={16} shadow={SHADOW.hero} pad="p-[18px]">
          {error && <div className="pb-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}
          {children}
        </Card>
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
        {/*
          The one path in the system where hours come from a span rather than
          from a person, so it opens by saying exactly that. Amber, because it
          is an override being explained before it happens.
        */}
        <SoftNotice tone="warn" headline="Dagen är inte bekräftad.">
          Att generera en obekräftad arbetsdagbok riskerar att du bokför obekräftade
          arbetstimmar, felaktiga tider och ej verifierade uppgifter i arbetsdagboken,
          vill du gå vidare?
        </SoftNotice>
        <div className="mt-[18px]">
          {/* Nej leaves, back to Alla Projekt. It is the outcome this screen
              would rather have, so it is the one that looks like the default. */}
          <PrimaryButton onClick={() => router.push("/projekt")}>Nej</PrimaryButton>
        </div>
        <div className="mt-[10px]">
          <SecondaryButton onClick={() => setStep(live.days.length > 0 ? "leader" : "work")}>
            Ja
          </SecondaryButton>
        </div>
      </Panel>
    );
  }

  if (step === "leader") {
    return (
      <Panel error={error}>
        <p className="text-[17px] font-medium leading-[1.45]" style={{ textWrap: "pretty" }}>
          Passen du begär om har inte blivit bekräftade av{" "}
          <strong className="font-extrabold">
            {live.leaders.length > 0 ? live.leaders.join(", ") : "någon arbetsledare"}
          </strong>
          , be de att bekräfta passen.
        </p>
        <div className="mt-[18px]">
          {/* The heavier button is the one that leaves. Chasing the leader is
              the right outcome and it looks like the default; taking the day
              off him is the recessive option, deliberately. */}
          <PrimaryButton onClick={onAbandon}>Tillbaka</PrimaryButton>
        </div>
        <div className="mt-[10px]">
          <SecondaryButton onClick={() => setStep("work")}>
            Bekräfta Uppgifter
          </SecondaryButton>
        </div>
      </Panel>
    );
  }

  if (onFields) {
    return (
      <Panel error={error}>
        <h2 className="text-[19px] font-extrabold" style={{ letterSpacing: "-.5px" }}>
          Uppgifter saknas om projektet
        </h2>
        <p
          className="mb-[14px] mt-1 text-[15px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          Dokumentet kan inte skapas med en tom ruta. Fyll i det som saknas.
        </p>
        <div className="mb-[18px] flex flex-col gap-[14px]">
          {live.project.missing.map((k) => (
            <SoftField key={k} label={FIELD_LABELS[k as ProjectField] ?? k}>
              <SoftInput
                value={fields[k] ?? ""}
                onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
              />
            </SoftField>
          ))}
        </div>
        <PrimaryButton onClick={saveFields} disabled={busy}>
          {busy ? "Sparar…" : "Spara"}
        </PrimaryButton>
      </Panel>
    );
  }

  if (!day) {
    return (
      <Panel error={error}>
        <p className="text-[15px] font-medium" style={{ color: C.text2 }}>Läser…</p>
      </Panel>
    );
  }

  return (
    <Panel error={error}>
      <p
        className="text-[12px] font-bold uppercase"
        style={{ letterSpacing: "1px", color: C.text2 }}
      >
        {live.days.length} dag{live.days.length === 1 ? "" : "ar"} kvar
      </p>
      <h2 className="mb-[14px] mt-[2px] text-[19px] font-extrabold" style={{ letterSpacing: "-.5px", textWrap: "pretty" }}>
        Vad har ni uppfyllt på {live.project.name} den {surveyDayHeading(day.work_date)}?
      </h2>

      <SoftTextarea
        rows={4}
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
        <div className="mt-[14px] rounded-[10px] px-[14px] py-[6px]" style={{ background: C.panel2 }}>
          <p
            className="py-2 text-[12px] font-bold uppercase"
            style={{ letterSpacing: ".9px", color: C.text2, boxShadow: "inset 0 -1px 0 #dbe4f9" }}
          >
            Registrerat — bokförs som det står
          </p>
          <ul>
            {day.rows.map((r, i) => (
              <li
                key={i}
                className="flex justify-between gap-3 py-[10px]"
                style={i > 0 ? { boxShadow: "inset 0 1px 0 #dbe4f9" } : undefined}
              >
                <span className="text-[15px] font-semibold">{r.worker}</span>
                <span className="shrink-0 text-right">
                  <span className="text-[15px] font-bold">{r.tider}</span>
                  <span className="block text-[14px] font-medium" style={{ color: C.text2 }}>
                    {String(r.timmar).replace(".", ",")} h
                    {r.stamplat ? " (stämplat)" : " (planerat)"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-[18px]">
        <PrimaryButton onClick={saveDay} disabled={busy || text.trim() === ""}>
          {busy ? "Sparar…" : "Bekräfta dagen"}
        </PrimaryButton>
      </div>
      <div className="mt-[10px]">
        <SecondaryButton onClick={onAbandon} disabled={busy}>
          Avbryt
        </SecondaryButton>
      </div>
    </Panel>
  );
}
