"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, MonthCard, PrimaryButton, SHADOW, SoftDialog, SoftNotice,
  SoftScreen, SoftToast, monthShape,
} from "@/components/soft";
import { NyArbetareForm, type CreatedWorker } from "@/components/ny-arbetare";
import { PickField } from "@/components/pick-field";
import { TimeField } from "@/components/time-wheel";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday, svDate } from "@/lib/dates";
import { DEFAULT_PRESETS, loadPresets, type Presets } from "@/lib/presets";
import { useAccount } from "@/lib/account";

/* ── types ─────────────────────────────────────────────────────────── */

type Project = { id: string; name: string };
type Worker = { id: string; name: string; role: string };

type CardState = {
  personId: string;
  start: string;
  end: string;
  breakMin: number | null;
  customGap: string;
};

/* ── helpers ────────────────────────────────────────────────────────── */

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function words(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const s = toMin(start);
  const e = toMin(end);
  return (e <= s ? e + 24 * 60 : e) - s;
}

function formatHM(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "0:00";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function cardKey(date: string, slot: number) { return `${date}::${slot}`; }

function defaultCard(): CardState {
  return { personId: "", start: "07:00", end: "16:00", breakMin: null, customGap: "" };
}

function cardHours(card: CardState): number {
  const span = minutesBetween(card.start, card.end);
  if (card.customGap) {
    const h = parseFloat(card.customGap.replace(",", "."));
    return Number.isFinite(h) && h >= 0 ? h : span / 60;
  }
  if (card.breakMin != null) return Math.max(0, span - card.breakMin) / 60;
  return span / 60;
}

/* ── MultiDayPicker ─────────────────────────────────────────────────── */

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

/* ── ShiftCard ──────────────────────────────────────────────────────── */

function ShiftCard({
  card, workers, presets, onChange, onNewWorker, error,
}: {
  card: CardState;
  workers: Worker[];
  presets: Presets;
  onChange: (c: CardState) => void;
  onNewWorker: () => void;
  error?: string;
}) {
  const span = minutesBetween(card.start, card.end);
  let arbetstid: string | null = null;
  let backCalcBreak: string | null = null;

  if (card.customGap) {
    const h = parseFloat(card.customGap.replace(",", "."));
    if (Number.isFinite(h) && h >= 0) {
      arbetstid = formatHM(h * 60);
      const br = span - h * 60;
      if (br > 0) backCalcBreak = `${Math.round(br)} min`;
    }
  } else if (card.breakMin != null) {
    arbetstid = formatHM(span - card.breakMin);
  }

  return (
    <Card
      radius={16}
      pad="p-[16px]"
      shadow={error ? `0 0 0 2px ${C.stopMark}` : SHADOW.group}
    >
      <PickField
        label="Person"
        value={card.personId}
        onChange={(v) => onChange({ ...card, personId: v })}
        options={workers.map((w) => ({ value: w.id, label: w.name }))}
        people
        action={{ value: "__ny__", label: "Ny arbetare", onPick: onNewWorker }}
      />

      <div className="relative mt-3 flex gap-[10px]">
        <div className="min-w-0 flex-1">
          <TimeField
            label="Från"
            value={card.start}
            onChange={(v) => onChange({ ...card, start: v })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <TimeField
            label="Till"
            value={card.end}
            onChange={(v) => onChange({ ...card, end: v })}
          />
        </div>
      </div>

      {/* Break presets */}
      <div className="mt-3">
        <span
          className="mb-[6px] block text-[12px] font-bold uppercase"
          style={{ letterSpacing: ".9px", color: C.text2 }}
        >
          Rast
        </span>
        <div className="flex gap-[6px]">
          {presets.map((min, j) => {
            const active = card.breakMin === min && !card.customGap;
            return (
              <button
                key={j}
                type="button"
                aria-pressed={active}
                aria-label={`${min} minuters rast${active ? ", aktiv" : ""}`}
                onClick={() =>
                  onChange({ ...card, breakMin: active ? null : min, customGap: "" })
                }
                className="flex-1 rounded-[8px] py-[8px] text-[13px] font-bold transition-colors"
                style={{
                  background: active ? C.accent : C.panel2,
                  color: active ? C.onAccent : C.ink,
                  border: `1px solid ${active ? C.accent : C.border}`,
                }}
              >
                {min} min
              </button>
            );
          })}
        </div>
      </div>

      {/* Arbetstid */}
      {arbetstid && (
        <div className="mt-3 text-[15px] font-semibold" style={{ color: C.ink }}>
          Arbetstid: {arbetstid}
        </div>
      )}

      {/* Custom gap */}
      <div className="mt-3">
        <input
          type="text"
          inputMode="decimal"
          placeholder="Egen arbetstid (t.ex. 8,5)"
          value={card.customGap}
          onChange={(e) => onChange({ ...card, customGap: e.target.value, breakMin: null })}
          className="w-full rounded-[10px] border px-[12px] py-[10px] text-[15px] outline-none"
          style={{ borderColor: C.hairline, background: C.surface, color: C.ink }}
        />
        {backCalcBreak && (
          <div className="mt-1 text-[13px]" style={{ color: C.text2 }}>
            Beräknad rast: {backCalcBreak}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 text-[13px] font-medium" style={{ color: C.stopInk }}>
          {error}
        </div>
      )}
    </Card>
  );
}

/* ── Skiftfabrik (main) ─────────────────────────────────────────────── */

function Skiftfabrik({ asked }: { asked: string | null }) {
  const { account } = useAccount();
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState("");
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() =>
    asked ? new Set([asked]) : new Set(),
  );
  const [workerCount, setWorkerCount] = useState(0);
  const [cards, setCards] = useState<Map<string, CardState>>(new Map());
  const [activeDay, setActiveDay] = useState(0);
  const [presets, setPresets] = useState<Presets>([...DEFAULT_PRESETS]);

  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [cardErrors, setCardErrors] = useState<Map<string, string>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showResetDialog, setShowResetDialog] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const [creatingForCard, setCreatingForCard] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const touchStartX = useRef(0);

  const sortedDays = [...selectedDays].sort();
  const currentDay = sortedDays[activeDay] ?? null;

  /* ── data load ── */
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
          x.id && x.name ? [{ id: x.id, name: x.name, role: x.role ?? "arbetare" }] : [],
        ),
      );

      const { data: t } = await sb.from("tenant").select("id").maybeSingle();
      if (t?.id) setPresets(loadPresets(t.id));
    })();
  }, [reload]);

  /* ── sync cards when days or workerCount changes ── */
  useEffect(() => {
    if (workerCount === 0) return;
    setCards((prev) => {
      const next = new Map<string, CardState>();
      for (const date of selectedDays) {
        for (let i = 0; i < workerCount; i++) {
          const k = cardKey(date, i);
          next.set(k, prev.get(k) ?? defaultCard());
        }
      }
      return next;
    });
  }, [selectedDays, workerCount]);

  /* ── clamp activeDay ── */
  useEffect(() => {
    setActiveDay((prev) => Math.min(prev, Math.max(0, sortedDays.length - 1)));
  }, [sortedDays.length]);

  /* ── worker count change ── */
  function handleCountChange(n: number) {
    if (n === workerCount) return;
    if (cards.size > 0 && workerCount > 0) {
      setPendingCount(n);
      setShowResetDialog(true);
    } else {
      setWorkerCount(n);
    }
  }

  function confirmReset() {
    setCards(new Map());
    setWorkerCount(pendingCount);
    setShowResetDialog(false);
  }

  /* ── update a single card ── */
  const updateCard = useCallback((key: string, card: CardState) => {
    setCards((prev) => {
      const next = new Map(prev);
      next.set(key, card);
      return next;
    });
    setCardErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  /* ── swipe between days ── */
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]!.clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0]!.clientX - touchStartX.current;
    if (Math.abs(dx) > 60) {
      setActiveDay((prev) =>
        dx > 0
          ? Math.max(0, prev - 1)
          : Math.min(sortedDays.length - 1, prev + 1),
      );
    }
  }

  /* ── submit ── */
  async function handleSubmit() {
    setError(null);
    setCardErrors(new Map());
    setSaving(true);

    const sb = getSupabase();
    let created = 0;
    let failed = 0;
    const errors = new Map<string, string>();
    const entries = [...cards.entries()];
    const total = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const [key, card] = entries[i]!;
      const date = key.split("::")[0]!;
      const h = cardHours(card);

      setProgress(`Skapar ${i + 1}/${total}…`);

      const { error: rpcErr } = await sb.rpc("create_snabb_pass", {
        p_project: projectId,
        p_worker: card.personId,
        p_date: date,
        p_start: card.start,
        p_end: card.end,
        p_hours: h,
      });

      if (rpcErr) {
        errors.set(key, rpcErr.message);
        failed++;
      } else {
        created++;
      }
    }

    setSaving(false);
    setProgress("");

    if (errors.size > 0) {
      setCardErrors(errors);
      setError(`${failed} skift misslyckades. Se markerade kort.`);
      if (created > 0) setToast(`${created} skift skapades`);
      return;
    }

    setToast(`${created} skift skapades`);
    setTimeout(() => router.push("/"), 1200);
  }

  /* ── Ny Arbetare sub-screen ── */
  if (creatingForCard !== null) {
    return (
      <SoftScreen
        title="Skapa ett konto"
        back="/snabb"
        subtitle="Kopiera inloggningen innan du skapar kontot."
      >
        <div className="px-4 pt-[14px]">
          <NyArbetareForm
            allowRoleChoice={false}
            onCancel={() => setCreatingForCard(null)}
            onCreated={(w: CreatedWorker, block) => {
              const newWorker = { id: w.worker_id, name: w.name, role: "arbetare" };
              setWorkers((list) => [...list, newWorker]);
              if (creatingForCard) {
                updateCard(creatingForCard, {
                  ...(cards.get(creatingForCard) ?? defaultCard()),
                  personId: w.worker_id,
                });
              }
              setCredentials(block);
              setCreatingForCard(null);
              setReload((n) => n + 1);
            }}
          />
        </div>
      </SoftScreen>
    );
  }

  /* ── access control ── */
  if (account && account.role !== "admin") {
    return (
      <SoftScreen title="Skiftfabrik" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">Endast administratören kan använda Skiftfabrik.</SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  const totalCards = cards.size;
  const filledCards = [...cards.values()].filter((c) => c.personId).length;
  const canSubmit = !saving && projectId && totalCards > 0 && filledCards === totalCards;

  return (
    <SoftScreen
      title="Skiftfabrik"
      back="/"
      subtitle="Skapa skift med egna tider per person."
    >
      <SoftToast message={toast} onDone={() => setToast(null)} />

      {/* Reset dialog */}
      {showResetDialog && (
        <SoftDialog label="Nollställ kort" onDismiss={() => setShowResetDialog(false)}>
          <div className="mb-4 text-[17px] font-bold" style={{ color: C.ink }}>
            Vill du nollställa korten?
          </div>
          <p className="mb-5 text-[15px]" style={{ color: C.text2 }}>
            Alla kort återställs till sina standardvärden.
          </p>
          <div className="space-y-[10px]">
            <PrimaryButton onClick={confirmReset}>Nollställ</PrimaryButton>
            <button
              type="button"
              onClick={() => setShowResetDialog(false)}
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

      {/* ── Projekt ── */}
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

      {/* ── Datum ── */}
      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-0 overflow-hidden">
          <div
            className="flex items-center justify-between px-[18px] py-[14px]"
            style={{ borderBottom: `1px solid ${C.hairline}` }}
          >
            <span
              className="text-[13px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              Datum
            </span>
            {selectedDays.size > 0 && (
              <span
                className="rounded-full px-[10px] py-[2px] text-[13px] font-bold"
                style={{ background: C.accent, color: C.onAccent }}
              >
                {selectedDays.size} {selectedDays.size === 1 ? "dag" : "dagar"}
              </span>
            )}
          </div>
          <div className="p-[14px]">
            <MultiDayPicker selected={selectedDays} onChange={setSelectedDays} />
          </div>

          {/* Selected date chips */}
          {sortedDays.length > 0 && (
            <div
              className="flex flex-wrap gap-[6px] px-[14px] pb-[14px]"
            >
              {sortedDays.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-full px-[10px] py-[4px] text-[13px] font-bold"
                  style={{ background: C.accent, color: C.onAccent }}
                >
                  {svDate(d)}
                  <button
                    type="button"
                    aria-label={`Ta bort ${svDate(d)}`}
                    onClick={() => {
                      const next = new Set(selectedDays);
                      next.delete(d);
                      setSelectedDays(next);
                    }}
                    className="ml-[2px] flex h-[16px] w-[16px] items-center justify-center rounded-full"
                    style={{ background: "rgba(0,0,0,.15)" }}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                      <path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Hur många arbetare? ── */}
      <div className="px-4 pt-[14px]">
        <Card radius={16} pad="p-[18px]">
          <span
            className="mb-[10px] block text-[12px] font-bold uppercase"
            style={{ letterSpacing: ".9px", color: C.text2 }}
          >
            Hur många arbetare?
          </span>
          <div className="flex gap-[8px]">
            {[1, 2, 3, 4, 5].map((n) => {
              const active = workerCount === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleCountChange(n)}
                  className="flex-1 rounded-[10px] py-[10px] text-[15px] font-bold transition-colors"
                  style={{
                    background: active ? C.accent : C.panel2,
                    color: active ? C.onAccent : C.ink,
                    border: `1px solid ${active ? C.accent : C.border}`,
                  }}
                >
                  {n} st
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── Card grid ── */}
      {sortedDays.length > 0 && workerCount > 0 && (
        <div className="px-4 pt-[14px]">
          {/* Day tabs */}
          {sortedDays.length > 1 && (
            <div
              className="mb-[10px] flex gap-[8px] overflow-x-auto pb-[2px]"
              style={{ scrollbarWidth: "none" }}
            >
              {sortedDays.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setActiveDay(i)}
                  className="shrink-0 rounded-full px-[14px] py-[6px] text-[14px] font-bold transition-colors"
                  style={{
                    background: i === activeDay ? C.accent : C.panel2,
                    color: i === activeDay ? C.onAccent : C.ink,
                    border: `1px solid ${i === activeDay ? C.accent : C.border}`,
                  }}
                >
                  {svDate(d)}
                </button>
              ))}
            </div>
          )}

          {/* Day header for single day */}
          {sortedDays.length === 1 && currentDay && (
            <div
              className="mb-[10px] text-[15px] font-bold"
              style={{ color: C.ink }}
            >
              {svDate(currentDay)}
            </div>
          )}

          {/* Cards */}
          <div
            className="space-y-[12px]"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {currentDay &&
              Array.from({ length: workerCount }, (_, slot) => {
                const k = cardKey(currentDay, slot);
                const card = cards.get(k) ?? defaultCard();
                return (
                  <ShiftCard
                    key={k}
                    card={card}
                    workers={workers}
                    presets={presets}
                    onChange={(c) => updateCard(k, c)}
                    onNewWorker={() => setCreatingForCard(k)}
                    error={cardErrors.get(k)}
                  />
                );
              })}
          </div>

          {/* Dot indicator */}
          {sortedDays.length > 1 && (
            <div className="mt-[10px] flex justify-center gap-[6px]">
              {sortedDays.map((_, i) => (
                <span
                  key={i}
                  className="block h-[6px] w-[6px] rounded-full transition-colors"
                  style={{ background: i === activeDay ? C.accent : C.border }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Credentials after ny arbetare ── */}
      {credentials && (
        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div
              className="mb-3 text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
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

      {/* ── Submit ── */}
      <div className="px-4 pb-[32px] pt-[14px]">
        <PrimaryButton onClick={handleSubmit} disabled={!canSubmit}>
          {saving
            ? progress || "Skapar…"
            : totalCards > 0
              ? `Skapa ${totalCards} skift`
              : "Skapa skift"}
        </PrimaryButton>
      </div>
    </SoftScreen>
  );
}

/* ── route wrappers ─────────────────────────────────────────────────── */

function SkiftfabrikFromUrl() {
  const asked = useSearchParams().get("datum");
  return (
    <Skiftfabrik asked={asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null} />
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <SoftScreen title="Skiftfabrik" back="/">
            <span />
          </SoftScreen>
        }
      >
        <SkiftfabrikFromUrl />
      </Suspense>
    </AuthGate>
  );
}
