"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, MonthCard, PrimaryButton, SHADOW, SoftDialog, SoftField, SoftNotice,
  SoftScreen, SoftToast, Stepper, monthShape,
} from "@/components/soft";
import { NyArbetareForm, type CreatedWorker } from "@/components/ny-arbetare";
import { PickField } from "@/components/pick-field";
import { TimeField } from "@/components/time-wheel";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday, svDate } from "@/lib/dates";
import { defaultHours } from "@/lib/hours";
import { useAccount } from "@/lib/account";
import { fel } from "@/lib/fel";

type Project = { id: string; name: string };
type Worker = { id: string; name: string; role: string };

const NEW = "__ny__";

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function words(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** Readable Swedish role tag */
function roleTag(role: string) {
  if (role === "admin") return "Admin";
  if (role === "arbetsledare") return "Ledare";
  return "Arbetare";
}

/**
 * Multi-select day picker that uses MonthCard chrome.
 * Returns toggled set of ISO date strings.
 */
function MultiDayPicker({
  selected, onChange,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const today = stockholmToday();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const { daysInMonth, leadingBlanks } = monthShape(month);
  const [y, m] = month.split("-").map(Number) as [number, number];

  function toggle(date: string) {
    const next = new Set(selected);
    if (next.has(date)) next.delete(date); else next.add(date);
    onChange(next);
  }

  return (
    <MonthCard month={month} onMonthChange={setMonth} gap={2}>
      <div className="grid grid-cols-7 gap-y-[2px]">
        {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = iso(y, m, i + 1);
          const on = selected.has(date);
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              aria-label={words(date)}
              aria-pressed={on}
              onClick={() => toggle(date)}
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full text-[16px] font-medium"
              style={{
                background: on ? C.accent : undefined,
                color: on ? C.onAccent : C.ink,
                boxShadow: !on && isToday ? `inset 0 0 0 2px ${C.ink}` : undefined,
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </MonthCard>
  );
}

type Conflict = { workerName: string; date: string; project: string; start: string; end: string };

/**
 * Snabb Pass Bulk -- ADMIN ONLY.
 *
 * Replaces the single-worker/single-day form with:
 *   • Scrollable worker list with search + multi-select
 *   • Multi-select day calendar
 *   • Single start/end time + hours applied to all combinations
 *   • Conflict detection before submit; admin can dismiss and skip conflicts
 *   • Loops create_snabb_pass once per (worker, date) combination
 */
function SnabbPassBulk({ asked }: { asked: string | null }) {
  const { account } = useAccount();
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() =>
    asked ? new Set([asked]) : new Set()
  );
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("16:00");
  const [hours, setHours] = useState(() => defaultHours("07:00", "16:00"));
  const [hoursTouched, setHoursTouched] = useState(false);
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [credentials, setCredentials] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [reload, setReload] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sb = getSupabase();
    void (async () => {
      const { data: p } = await sb.from("project").select("id, name").order("name");
      const list = (p ?? []).map((x) => ({ id: x.id, name: x.name }));
      setProjects(list);
      if (list.length === 1) setProjectId((cur) => cur || list[0]!.id);

      const { data: w } = await sb
        .from("worker_roster")
        .select("id, name, role")
        .order("name");
      setWorkers(
        (w ?? []).flatMap((x) =>
          x.id && x.name ? [{ id: x.id, name: x.name, role: x.role ?? "arbetare" }] : []
        )
      );
    })();
  }, [reload]);

  function setTime(key: "start" | "end", value: string) {
    const next = { start, end, [key]: value } as { start: string; end: string };
    if (key === "start") setStart(value); else setEnd(value);
    if (!hoursTouched) setHours(defaultHours(next.start, next.end));
  }

  const filteredWorkers = workers.filter((w) =>
    w.name.toLowerCase().includes(workerSearch.toLowerCase())
  );

  function toggleWorker(id: string) {
    setSelectedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Check conflicts for all (worker, date) combos before submitting */
  async function checkConflicts(): Promise<Conflict[]> {
    const sb = getSupabase();
    const dates = [...selectedDays];
    const workerIds = [...selectedWorkers];
    const found: Conflict[] = [];

    const shift = (d: string, n: number) => {
      const t = new Date(`${d}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    const span = (d: string, a: string, b: string) => {
      const s0 = Date.parse(`${d}T${a.slice(0, 5)}:00Z`);
      let e0 = Date.parse(`${d}T${b.slice(0, 5)}:00Z`);
      if (b.slice(0, 5) <= a.slice(0, 5)) e0 += 86_400_000;
      return [s0, e0] as const;
    };

    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));

    type Joined = {
      worker_id: string;
      work_date: string;
      pass: { start_time: string; end_time: string; deleted_at: string | null; project: { name: string } | null } | null;
    };

    const { data } = await sb
      .from("tilldelning")
      .select("worker_id, work_date, pass:pass_id(start_time, end_time, deleted_at, project:project_id(name))")
      .in("worker_id", workerIds)
      .is("released_at", null)
      .neq("source", "ledare")
      .gte("work_date", shift(minDate, -1))
      .lte("work_date", shift(maxDate, 1));

    const rows = (data ?? []) as unknown as Joined[];

    for (const wid of workerIds) {
      const wName = workers.find((w) => w.id === wid)?.name ?? wid;
      for (const date of dates) {
        const [ns, ne] = span(date, start, end);
        const relevant = rows.filter(
          (r) => r.worker_id === wid &&
            (r.work_date === date || r.work_date === shift(date, -1) || r.work_date === shift(date, 1))
        );
        for (const row of relevant) {
          const ps = row.pass;
          if (!ps || ps.deleted_at) continue;
          const [os, oe] = span(row.work_date, ps.start_time, ps.end_time);
          if (os < ne && ns < oe) {
            found.push({
              workerName: wName,
              date,
              project: ps.project?.name ?? "",
              start: ps.start_time.slice(0, 5),
              end: ps.end_time.slice(0, 5),
            });
          }
        }
      }
    }
    return found;
  }

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    const found = await checkConflicts();
    setSaving(false);
    if (found.length > 0) {
      setConflicts(found);
      setShowConflictDialog(true);
      return;
    }
    await createPasses(new Set());
  }

  async function createPasses(skipCombos: Set<string>) {
    setSaving(true);
    setError(null);
    const sb = getSupabase();
    const h = Number(hours.replace(",", "."));
    let created = 0;

    for (const wid of selectedWorkers) {
      for (const date of selectedDays) {
        const key = `${wid}::${date}`;
        if (skipCombos.has(key)) continue;
        const { error: rpcErr } = await sb.rpc("create_snabb_pass", {
          p_project: projectId,
          p_worker: wid,
          p_date: date,
          p_start: start,
          p_end: end,
          p_hours: h,
        });
        if (rpcErr) {
          // If the DB itself refuses (overlap), treat it like a conflict and skip
          console.warn("create_snabb_pass error", rpcErr.message);
        } else {
          created++;
        }
      }
    }

    setSaving(false);
    if (created === 0) {
      setError("Inga pass skapades. Alla kombinationer hade krockar eller fel.");
      return;
    }
    setSelectedWorkers(new Set());
    setSelectedDays(new Set());
    setShowConflictDialog(false);
    setConflicts([]);
    setToast(`${created} pass skapade`);
  }

  async function dismissConflictsAndCreate() {
    const skipCombos = new Set(
      conflicts.map((c) => {
        const wid = workers.find((w) => w.name === c.workerName)?.id ?? "";
        return `${wid}::${c.date}`;
      })
    );
    setShowConflictDialog(false);
    await createPasses(skipCombos);
  }

  // ---- Ny Arbetare flow -------------------------------------------------------
  if (creatingWorker) {
    return (
      <SoftScreen title="Skapa ett konto" back="/snabb" subtitle="Kopiera inloggningen innan du skapar kontot.">
        <div className="px-4 pt-[14px]">
          <NyArbetareForm
            allowRoleChoice={false}
            onCancel={() => { setCreatingWorker(false); }}
            onCreated={(w: CreatedWorker, block) => {
              setWorkers((list) => [...list, { id: w.worker_id, name: w.name, role: "arbetare" }]);
              setSelectedWorkers((prev) => new Set([...prev, w.worker_id]));
              setCredentials(block);
              setCreatingWorker(false);
              setReload((n) => n + 1);
            }}
          />
        </div>
      </SoftScreen>
    );
  }

  if (account && account.role !== "admin") {
    return (
      <SoftScreen title="Sätt in folk på pass" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">Endast administratören kan skapa Snabb Pass.</SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  const workerCount = selectedWorkers.size;
  const dayCount = selectedDays.size;
  const passCount = workerCount * dayCount;
  const canSubmit =
    !saving &&
    projectId &&
    workerCount > 0 &&
    dayCount > 0 &&
    Number(hours.replace(",", ".")) > 0;

  return (
    <SoftScreen title="Sätt in folk på pass" back="/" subtitle="Välj vilka och när — alla kombinationer skapas.">
      <SoftToast message={toast} onDone={() => setToast(null)} />

      {showConflictDialog && (
        <SoftDialog label="Tidskrockar" onDismiss={() => setShowConflictDialog(false)}>
          <div className="mb-4 text-[17px] font-bold" style={{ color: C.ink }}>
            Tidskrockar hittades
          </div>
          <p className="mb-4 text-[15px]" style={{ color: C.text2, textWrap: "pretty" }}>
            Följande kombinationer hoppar över (personen är redan bokad):
          </p>
          <div className="mb-5 space-y-2">
            {conflicts.map((c, i) => (
              <div
                key={i}
                className="rounded-[12px] px-[14px] py-[10px] text-[14px]"
                style={{ background: C.panel, color: C.ink }}
              >
                <span className="font-semibold">{c.workerName}</span>
                {" · "}{svDate(c.date)}{" · "}
                <span style={{ color: C.text2 }}>{c.project} {c.start}–{c.end}</span>
              </div>
            ))}
          </div>
          <div className="space-y-[10px]">
            <PrimaryButton onClick={dismissConflictsAndCreate} disabled={saving}>
              {saving ? "Skapar…" : "Hoppa över och skapa resten"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setShowConflictDialog(false)}
              className="w-full rounded-[14px] border py-[14px] text-[16px] font-semibold"
              style={{ borderColor: C.border, color: C.ink }}
            >
              Avbryt
            </button>
          </div>
        </SoftDialog>
      )}

      {error && (
        <div className="px-4 pb-[4px] pt-[10px]">
          <SoftNotice tone="stop">{error}</SoftNotice>
        </div>
      )}

      {projects.length === 0 && !error && (
        <div className="px-4 pb-[4px] pt-[10px]">
          <SoftNotice tone="quiet">Du är inte tilldelad något projekt.</SoftNotice>
        </div>
      )}

      {/* ---- Projekt ---- */}
      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <PickField
            label="Projekt"
            value={projectId}
            onChange={setProjectId}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Card>
      </div>

      {/* ---- Välj personal ---- */}
      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-0 overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-[18px] py-[14px]"
            style={{ borderBottom: `1px solid ${C.hairline}` }}
          >
            <span className="text-[13px] font-bold uppercase" style={{ letterSpacing: "1px", color: C.text2 }}>
              Personal
            </span>
            {workerCount > 0 && (
              <span
                className="rounded-full px-[10px] py-[2px] text-[13px] font-bold"
                style={{ background: C.accent, color: C.onAccent }}
              >
                {workerCount} valda
              </span>
            )}
          </div>

          {/* Search */}
          <div className="px-[14px] py-[10px]" style={{ borderBottom: `1px solid ${C.hairline}` }}>
            <div className="relative">
              <svg
                aria-hidden width="16" height="16" viewBox="0 0 18 18" fill="none"
                className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2"
              >
                <circle cx="7.5" cy="7.5" r="5.5" stroke={C.chevron} strokeWidth="1.8" />
                <path d="M12 12l4 4" stroke={C.chevron} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                placeholder="Sök namn…"
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                className="w-full rounded-[10px] py-[9px] pl-[36px] pr-[12px] text-[15px] outline-none"
                style={{ background: C.panel, color: C.ink }}
              />
            </div>
          </div>

          {/* Worker list — max ~5 visible, then scroll */}
          <div className="max-h-[280px] overflow-y-auto overscroll-contain">
            {filteredWorkers.length === 0 ? (
              <div className="px-[18px] py-[16px] text-[15px]" style={{ color: C.text2 }}>
                Inga träffar
              </div>
            ) : (
              filteredWorkers.map((w) => {
                const on = selectedWorkers.has(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleWorker(w.id)}
                    className="flex w-full items-center gap-3 px-[18px] py-[13px]"
                    style={{
                      background: on ? "#fdf2ec" : undefined,
                      borderBottom: `1px solid ${C.hairline}`,
                    }}
                  >
                    {/* Checkmark circle */}
                    <span
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: on ? C.accent : "transparent",
                        border: on ? "none" : `2px solid ${C.border}`,
                      }}
                    >
                      {on && (
                        <svg width="12" height="9" viewBox="0 0 12 9" fill="none" aria-hidden>
                          <path d="M1 4l3.5 3.5L11 1" stroke={C.onAccent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1 text-left text-[15px] font-medium" style={{ color: C.ink }}>
                      {w.name}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-[8px] py-[2px] text-[12px] font-semibold"
                      style={{ background: C.panel, color: C.text2 }}
                    >
                      {roleTag(w.role)}
                    </span>
                  </button>
                );
              })
            )}

            {/* Ny Arbetare row */}
            <button
              type="button"
              onClick={() => setCreatingWorker(true)}
              className="flex w-full items-center gap-3 px-[18px] py-[13px]"
            >
              <span
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                style={{ border: `2px dashed ${C.border}` }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M5 1v8M1 5h8" stroke={C.accentInk} strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <span className="text-[15px] font-medium" style={{ color: C.accentInk }}>
                Ny arbetare
              </span>
            </button>
          </div>
        </Card>
      </div>

      {/* ---- Välj dagar ---- */}
      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-0 overflow-hidden">
          <div
            className="flex items-center justify-between px-[18px] py-[14px]"
            style={{ borderBottom: `1px solid ${C.hairline}` }}
          >
            <span className="text-[13px] font-bold uppercase" style={{ letterSpacing: "1px", color: C.text2 }}>
              Datum
            </span>
            {dayCount > 0 && (
              <span
                className="rounded-full px-[10px] py-[2px] text-[13px] font-bold"
                style={{ background: C.accent, color: C.onAccent }}
              >
                {dayCount} {dayCount === 1 ? "dag" : "dagar"} valda
              </span>
            )}
          </div>
          <div className="p-[14px]">
            <MultiDayPicker selected={selectedDays} onChange={setSelectedDays} />
          </div>
        </Card>
      </div>

      {/* ---- Tider & timmar ---- */}
      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <div className="relative mb-[14px] flex gap-[10px]">
            <div className="min-w-0 flex-1">
              <TimeField label="Börjar" value={start} onChange={(v) => setTime("start", v)} />
            </div>
            <div className="min-w-0 flex-1">
              <TimeField label="Slutar" value={end} onChange={(v) => setTime("end", v)} />
            </div>
          </div>

          <SoftField label="Timmar" htmlFor="snabb-timmar">
            <Stepper
              id="snabb-timmar"
              label="Timmar"
              decLabel="Färre timmar"
              incLabel="Fler timmar"
              step={0.25}
              min={0}
              max={24}
              unit="h"
              value={hours}
              onChange={(v) => { setHours(v); setHoursTouched(true); }}
            />
          </SoftField>
        </Card>
      </div>

      {/* ---- Credentials after ny arbetare ---- */}
      {credentials && (
        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div className="mb-3 text-[12px] font-bold uppercase" style={{ letterSpacing: "1px", color: C.text2 }}>
              Inloggning att lämna över
            </div>
            <pre
              className="whitespace-pre-wrap rounded-[10px] p-[14px] text-[15px] font-semibold"
              style={{ background: C.panel2, fontFamily: "inherit" }}
            >
              {credentials}
            </pre>
            <button
              type="button"
              className="mt-3 text-[14px] font-medium"
              style={{ color: C.text2 }}
              onClick={() => setCredentials(null)}
            >
              Stäng
            </button>
          </Card>
        </div>
      )}

      {/* ---- Skapa ---- */}
      <div className="px-4 pb-[32px] pt-[14px]">
        <PrimaryButton onClick={handleSubmit} disabled={!canSubmit}>
          {saving
            ? "Skapar…"
            : passCount > 0
              ? `Skapa ${passCount} pass`
              : "Skapa pass"}
        </PrimaryButton>
      </div>
    </SoftScreen>
  );
}

function SnabbFromUrl() {
  const asked = useSearchParams().get("datum");
  return <SnabbPassBulk asked={asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Sätt in folk på pass" back="/"><span /></SoftScreen>}>
        <SnabbFromUrl />
      </Suspense>
    </AuthGate>
  );
}
