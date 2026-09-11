"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SoftField, SoftInput, SoftNotice, SoftScreen, SoftSelect,
} from "@/components/soft";
import { NyArbetareForm, type CreatedWorker } from "@/components/ny-arbetare";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";
import { defaultHours } from "@/lib/hours";
import { useAccount } from "@/lib/account";
import { fel } from "@/lib/fel";

type Project = { id: string; name: string };
type Worker = { id: string; name: string };

const NEW = "__ny__";

/**
 * Snabb Pass -- the escape hatch. ADMIN ONLY.
 *
 * Creating one is inseparable from putting someone on a shift who may not be
 * on the roster, and adding them creates an account. That is the admin's
 * power, so this whole screen is.
 *
 * Bypasses the entire priority list: no förval, no acceptance, no headcount
 * check, no priolista. For last-second dropouts, verbal arrangements, covering
 * a no-show. The leader has already decided; this only records it.
 *
 * On paper it is an ordinary shift. It prints in the Arbetsdagbok exactly like
 * any other row and it still enters the confirmation queue -- Snabb Pass skips
 * the picking, never the confirming.
 *
 * If the person is not on the roster, the dropdown offers Ny Arbetare: the same
 * form, the same copy-then-create gate, and then straight back here to finish
 * as though nothing happened.
 *
 * If they already hold an assignment that day, the Snabb Pass wins and the
 * earlier one is released -- in one transaction, so invariant 2 is never
 * momentarily false. The amber panel says so BEFORE the button, which is the
 * handoff's rule for it: an override is explained where the decision is made,
 * not reported once it has happened.
 */
function SnabbPass() {
  const { account } = useAccount();
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [date, setDate] = useState(stockholmToday());
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("16:00");
  const [hours, setHours] = useState(() => defaultHours("07:00", "16:00"));
  // Once the admin types their own figure the field is theirs, and changing a
  // time stops touching it.
  const [hoursTouched, setHoursTouched] = useState(false);
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [credentials, setCredentials] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    void (async () => {
      const { data: p } = await sb.from("project").select("id, name").order("name");
      const list = (p ?? []).map((x) => ({ id: x.id, name: x.name }));
      setProjects(list);
      if (list.length === 1) setProjectId((cur) => cur || list[0]!.id);

      const { data: w } = await sb.from("worker_roster").select("id, name").order("name");
      setWorkers((w ?? []).flatMap((x) => (x.id && x.name ? [{ id: x.id, name: x.name }] : [])));
    })();
  }, [reload]);

  async function save() {
    setSaving(true);
    setError(null);

    const { error } = await getSupabase().rpc("create_snabb_pass", {
      p_project: projectId,
      p_worker: workerId,
      p_date: date,
      p_start: start,
      p_end: end,
      p_hours: Number(hours.replace(",", ".")),
    });

    if (error) {
      setError(fel(error, "Snabbpasset kunde inte skapas. Kontakta administratören."));
      setSaving(false);
      return;
    }

    setDone(workers.find((w) => w.id === workerId)?.name ?? "Arbetaren");
    setSaving(false);
  }

  function setTime(key: "start" | "end", value: string) {
    const next = { start, end, [key]: value } as { start: string; end: string };
    if (key === "start") setStart(value); else setEnd(value);
    if (!hoursTouched) setHours(defaultHours(next.start, next.end));
  }

  // ---- Ny Arbetare, from inside the dropdown --------------------------------
  if (creatingWorker) {
    return (
      <SoftScreen
        title="Ny arbetare"
        back="/snabb"
        subtitle="Skapas och läggs sedan direkt på passet."
      >
        <div className="px-4 pt-[14px]">
          <NyArbetareForm
            allowRoleChoice={false}
            onCancel={() => { setCreatingWorker(false); setWorkerId(""); }}
            onCreated={(w: CreatedWorker, block) => {
              // Straight back to the shift, with them selected.
              setWorkers((list) => [...list, { id: w.worker_id, name: w.name }]);
              setWorkerId(w.worker_id);
              setCredentials(block);
              setCreatingWorker(false);
              setReload((n) => n + 1);
            }}
          />
        </div>
      </SoftScreen>
    );
  }

  if (done) {
    return (
      <SoftScreen title="Snabb Pass skapat" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="live">{done} är inlagd på {date}.</SoftNotice>
        </div>

        <p
          className="px-5 pt-[14px] text-[15px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          Passet syns som vilket pass som helst och ska bekräftas som vanligt.
        </p>

        {credentials && (
          <div className="px-4 pt-[22px]">
            <Card radius={16} pad="p-[18px]">
              <div
                className="mb-3 text-[12px] font-bold uppercase"
                style={{ letterSpacing: "1px", color: C.text2 }}
              >
                Inloggning att lämna över
              </div>
              {/* A <pre>, because these are credentials: the line breaks are
                  the format, and a proportional wrap turns a password into a
                  guess. */}
              <pre
                className="whitespace-pre-wrap rounded-[10px] p-[14px] text-[15px] font-semibold"
                style={{ background: C.panel2, fontFamily: "inherit" }}
              >
                {credentials}
              </pre>
            </Card>
          </div>
        )}

        <div className="px-4 pt-[22px]">
          <PrimaryButton
            onClick={() => { setDone(null); setCredentials(null); setWorkerId(""); }}
          >
            Skapa ett till
          </PrimaryButton>
        </div>
      </SoftScreen>
    );
  }

  // A courtesy, not a boundary: create_snabb_pass refuses anyone but an admin,
  // and would do so whatever this screen showed. Saying it plainly beats a form
  // whose every button fails.
  if (account && account.role !== "admin") {
    return (
      <SoftScreen title="Snabb Pass" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">
            Endast administratören kan skapa Snabb Pass.
          </SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen
      title="Snabb Pass"
      back="/"
      subtitle="Går förbi hela turordningen. Används när någon hoppar av i sista stund."
    >
      {(error || projects.length === 0) && (
        <div className="px-4 pb-[4px] pt-[10px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {!error && projects.length === 0 && (
            <SoftNotice tone="quiet">Du är inte tilldelad något projekt.</SoftNotice>
          )}
        </div>
      )}

      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <div className="mb-[14px]">
            <SoftField label="Projekt">
              <SoftSelect value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Välj…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </SoftSelect>
            </SoftField>
          </div>

          <div className="mb-[14px]">
            <SoftField label="Vem?" help="Finns personen inte i listan — välj Ny arbetare.">
              <SoftSelect
                value={workerId}
                onChange={(e) => {
                  if (e.target.value === NEW) { setCreatingWorker(true); return; }
                  setWorkerId(e.target.value);
                }}
              >
                <option value="">Välj…</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
                <option value={NEW}>+ Ny arbetare…</option>
              </SoftSelect>
            </SoftField>
          </div>

          <div className="mb-[14px]">
            <SoftField label="Datum">
              <SoftInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </SoftField>
          </div>

          <div className="mb-[14px] flex gap-[10px]">
            <div className="min-w-0 flex-1">
              <SoftField label="Börjar">
                <SoftInput type="time" value={start} onChange={(e) => setTime("start", e.target.value)} />
              </SoftField>
            </div>
            <div className="min-w-0 flex-1">
              <SoftField label="Slutar">
                <SoftInput type="time" value={end} onChange={(e) => setTime("end", e.target.value)} />
              </SoftField>
            </div>
          </div>

          {/* The biggest thing in the card, because it is the one figure a
              human is answerable for. Prefilled, never derived (invariant 1). */}
          <SoftField
            label="Timmar"
            help="Förifylls som tiden minus 30 min. Ändra om rasten var längre."
            big
          >
            <SoftInput
              inputMode="decimal"
              value={hours}
              onChange={(e) => { setHours(e.target.value); setHoursTouched(true); }}
            />
          </SoftField>
        </Card>
      </div>

      <div className="px-4 pt-[14px]">
        <SoftNotice tone="warn">
          Har personen redan ett pass den dagen tas det bort och detta gäller i stället.
        </SoftNotice>
      </div>

      <div className="px-4 pt-[14px]">
        <PrimaryButton
          onClick={save}
          disabled={saving || !projectId || !workerId || !(Number(hours.replace(",", ".")) > 0)}
        >
          {saving ? "Skapar…" : "Skapa Snabb Pass"}
        </PrimaryButton>
      </div>
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <SnabbPass />
    </AuthGate>
  );
}
