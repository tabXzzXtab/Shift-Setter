"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Field, Input, Notice, Screen, Select } from "@/components/ui";
import { NyArbetareForm, type CreatedWorker } from "@/components/ny-arbetare";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";

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
 * momentarily false.
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
  const [hours, setHours] = useState("8");
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

    if (error) { setError(error.message); setSaving(false); return; }

    setDone(workers.find((w) => w.id === workerId)?.name ?? "Arbetaren");
    setSaving(false);
  }

  // ---- Ny Arbetare, from inside the dropdown --------------------------------
  if (creatingWorker) {
    return (
      <Screen title="Ny arbetare" back="/snabb">
        <p className="mb-4 text-base">
          Skapas och läggs sedan direkt på passet.
        </p>
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
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen title="Snabb Pass skapat" back="/">
        <Notice kind="ok">{done} är inlagd på {date}.</Notice>
        <p className="mb-6 text-base">
          Passet syns som vilket pass som helst och ska bekräftas som vanligt.
        </p>
        {credentials && (
          <>
            <p className="mb-2 text-base font-bold">Inloggning att lämna över:</p>
            <pre className="mb-6 whitespace-pre-wrap border-2 border-black p-3 text-base">
              {credentials}
            </pre>
          </>
        )}
        <Button onClick={() => { setDone(null); setCredentials(null); setWorkerId(""); }}>
          Skapa ett till
        </Button>
      </Screen>
    );
  }

  // A courtesy, not a boundary: create_snabb_pass refuses anyone but an admin,
  // and would do so whatever this screen showed. Saying it plainly beats a form
  // whose every button fails.
  if (account && account.role !== "admin") {
    return (
      <Screen title="Snabb Pass" back="/">
        <Notice kind="info">
          Endast administratören kan skapa Snabb Pass.
        </Notice>
      </Screen>
    );
  }

  return (
    <Screen title="Snabb Pass" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <p className="mb-4 text-base">
        Går förbi hela turordningen. Används när någon hoppar av i sista stund.
      </p>

      {projects.length === 0 && (
        <Notice kind="info">Du är inte tilldelad något projekt.</Notice>
      )}

      <Field label="Projekt">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Välj…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Vem?" hint="Finns personen inte i listan — välj Ny arbetare.">
        <Select
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
        </Select>
      </Field>

      <Field label="Datum">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Börjar">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Slutar">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      <Field label="Timmar" hint="Skrivs för hand. Rasten räknas inte.">
        <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
      </Field>

      <Notice kind="info">
        Har personen redan ett pass den dagen tas det bort och detta gäller i stället.
      </Notice>

      <Button onClick={save} disabled={saving || !projectId || !workerId || hours.trim() === ""}>
        {saving ? "Skapar…" : "Skapa Snabb Pass"}
      </Button>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <SnabbPass />
    </AuthGate>
  );
}
