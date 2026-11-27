"use client";

import { Suspense, memo, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SHADOW, SoftDialog, SoftNotice,
  SoftScreen, SoftToast,
} from "@/components/soft";
import { PaintCalendar } from "@/components/paint-calendar";
import { NyArbetareForm, type CreatedWorker } from "@/components/ny-arbetare";
import { PickField } from "@/components/pick-field";
import { TimeField } from "@/components/time-wheel";
import { getSupabase } from "@/lib/supabase/client";
import { stockholmToday, svDate } from "@/lib/dates";
import {
  DEFAULT_PRESETS, DEFAULT_WORKER_OPTIONS, loadDefaultWorkers, loadPresets, loadWorkerOptions,
  type Presets, type WorkerOptions,
} from "@/lib/presets";
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

function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const s = toMin(start);
  const e = toMin(end);
  return (e <= s ? e + 24 * 60 : e) - s;
}

function cardKey(date: string, slot: number) { return `${date}::${slot}`; }

/** "12:e november", "1:a december": Swedish ordinals, the year only when it is not this one. */
function svOrdinalDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const month = new Intl.DateTimeFormat("sv-SE", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
  const suffix = (d % 10 === 1 || d % 10 === 2) && d !== 11 && d !== 12 ? "a" : "e";
  const year = String(y) === stockholmToday().slice(0, 4) ? "" : ` ${y}`;
  return `${d}:${suffix} ${month}${year}`;
}

const STRIP_MASK = "linear-gradient(to right, transparent, black 22%, black 78%, transparent)";
// A day's column takes this much of the screen, so the next day shows at the edge.
const DAY_COL = 76;
const DAY_GAP = 10;
// Slow out of a fast start: the day lands with some weight instead of snapping.
const SETTLE = "transform 420ms cubic-bezier(.22,.9,.24,1), opacity 420ms cubic-bezier(.22,.9,.24,1)";

const columnsOf = (track: HTMLElement | null) =>
  Array.from(track?.querySelectorAll<HTMLElement>(":scope > [data-day-col]") ?? []);

const prefersStill = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Percentages in translateX are of the track, which is as wide as the screen. */
function trackStyle(idx: number, dx: number, many: boolean): React.CSSProperties {
  if (!many) return { transform: "none" };
  const side = (100 - DAY_COL) / 2;
  return { transform: `translateX(calc(${side}% - ${idx} * (${DAY_COL}% + ${DAY_GAP}px) + ${dx}px))` };
}

/**
 * `at` is where the track is, in days. Neighbours turn away round their inner edge, as if
 * the days stood on a wheel, and sit smaller and dimmer until they reach the middle.
 */
function columnStyle(i: number, at: number, many: boolean): React.CSSProperties {
  const off = many ? Math.max(-1, Math.min(1, i - at)) : 0;
  const d = Math.abs(off);
  if (d < 0.005) return { transform: "none", opacity: 1, transformOrigin: "center top" };
  return {
    transform: `perspective(1100px) rotateY(${-off * 24}deg) scale(${1 - 0.05 * d})`,
    transformOrigin: `${off > 0 ? "left" : "right"} top`,
    opacity: 1 - 0.5 * d,
  };
}

function defaultCard(): CardState {
  return { personId: "", start: "07:00", end: "16:00", breakMin: null, customGap: "" };
}

// One shared object for untouched cards, so the memoised card sees the same props render to render.
const DEFAULT_CARD: CardState = Object.freeze(defaultCard());

/** "8,5", "8.5", "8 h" -> 8.5. Null for anything that is not a working day's hours. */
function parseHours(text: string): number | null {
  const t = text.trim().replace(/\s*h$/i, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const h = Number(t);
  return h > 0 && h <= 24 ? h : null;
}

/** Typed hours are the human's figure and nothing recomputes them; otherwise span less rast. */
function cardHours(card: CardState): number {
  const span = minutesBetween(card.start, card.end);
  if (card.customGap) return parseHours(card.customGap) ?? span / 60;
  if (card.breakMin != null) return Math.max(0, span - card.breakMin) / 60;
  return span / 60;
}

const hoursOk = (card: CardState) => !card.customGap || parseHours(card.customGap) !== null;

const svNumber = (h: number) => String(Math.round(Math.max(0, h) * 100) / 100).replace(".", ",");

/* ── DayPainter: Skapa Pass's drag-to-pick calendar, past days allowed ── */

function DayPainter({
  selected, onToggle,
}: {
  selected: Set<string>;
  onToggle: (date: string) => void;
}) {
  const today = stockholmToday();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  return (
    <PaintCalendar
      month={month}
      onMonthChange={setMonth}
      onPaint={onToggle}
      look={(date) => {
        const on = selected.has(date);
        return {
          className: on ? "font-extrabold" : "font-semibold",
          style: {
            background: on ? C.accent : C.panel2,
            color: on ? C.onAccent : C.ink,
            boxShadow: !on && date === today ? `inset 0 0 0 2px ${C.ink}` : undefined,
            cursor: "pointer",
          },
          label: `${Number(date.slice(8))} ${on ? "vald" : "inte vald"}`,
        };
      }}
    />
  );
}

/* ── ShiftCard ──────────────────────────────────────────────────────── */

// Memoised with stable callbacks: changing day must not re-render every card (60 at 5 st × 12 days).
const ShiftCard = memo(function ShiftCard({
  id, card, workers, presets, onChange, onNewWorker, onRemove, error,
}: {
  id: string;
  card: CardState;
  workers: Worker[];
  presets: Presets;
  onChange: (id: string, c: CardState) => void;
  onNewWorker: (id: string) => void;
  onRemove: (id: string) => void;
  error?: string;
}) {
  const set = (c: CardState) => onChange(id, c);
  const span = minutesBetween(card.start, card.end);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const typed = card.customGap ? parseHours(card.customGap) : null;
  const bad = !hoursOk(card);
  const display = bad ? card.customGap : svNumber(cardHours(card));
  const shown = editing ? draft : display;
  const typedBreak = typed !== null ? Math.round(span - typed * 60) : null;

  return (
    <Card
      radius={16}
      pad="p-[16px]"
      className="relative"
      shadow={error ? `0 0 0 2px ${C.stopMark}` : SHADOW.group}
    >
      <button
        type="button"
        data-remove-shift
        aria-label="Ta bort skiftet"
        onClick={() => onRemove(id)}
        className="absolute right-[6px] top-[4px] z-10 flex h-9 w-9 items-center justify-center rounded-full hover:bg-[#f4f3f0]"
        style={{ color: C.text2 }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      <PickField
        label="Person"
        value={card.personId}
        onChange={(v) => set({ ...card, personId: v })}
        options={workers.map((w) => ({ value: w.id, label: w.name }))}
        people
        action={{ value: "__ny__", label: "Ny arbetare", onPick: () => onNewWorker(id) }}
      />

      <div className="relative mt-3 flex gap-[10px]">
        <div className="min-w-0 flex-1">
          <TimeField
            label="Från"
            value={card.start}
            onChange={(v) => set({ ...card, start: v })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <TimeField
            label="Till"
            value={card.end}
            onChange={(v) => set({ ...card, end: v })}
          />
        </div>
      </div>

      {/* The figure is the field: it shows times less rast, and typing over it makes it the human's. */}
      <label className="mt-3 block">
        <span className="mb-[6px] block text-[15px] font-bold" style={{ color: C.ink }}>
          Arbetstid:
        </span>
        <span
          className="flex h-[56px] cursor-text items-center justify-center gap-[6px] rounded-[14px] border"
          style={{
            background: C.surface,
            borderColor: bad ? C.stopMark : editing ? C.accentInk : C.hairline,
            boxShadow: editing ? `0 0 0 1px ${bad ? C.stopMark : C.accentInk}` : undefined,
          }}
        >
          <input
            data-hours
            type="text"
            inputMode="decimal"
            aria-label="Arbetstid i timmar"
            aria-invalid={bad}
            value={shown}
            onFocus={(e) => { setDraft(display); setEditing(true); e.currentTarget.select(); }}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              set({ ...card, customGap: v.trim(), breakMin: v.trim() ? null : card.breakMin });
            }}
            className="min-w-[1ch] bg-transparent text-right text-[26px] font-extrabold tabular-nums outline-none"
            style={{ color: C.ink, width: `${Math.max(1, shown.length) + 0.4}ch` }}
          />
          <span aria-hidden className="text-[26px] font-extrabold" style={{ color: C.ink }}>h</span>
        </span>
        {bad && (
          <span className="mt-1 block text-[13px] font-medium" style={{ color: C.stopInk }}>
            Skriv timmar mellan 0 och 24, t.ex. 8,5.
          </span>
        )}
        {!bad && typedBreak !== null && typedBreak > 0 && (
          <span className="mt-1 block text-[13px]" style={{ color: C.text2 }}>
            Ditt eget värde. Rasten blir {typedBreak} min.
          </span>
        )}
      </label>

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
                  set({ ...card, breakMin: active ? null : min, customGap: "" })
                }
                className="flex-1 rounded-full py-[8px] text-[13px] font-bold transition-colors"
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

      {error && (
        <div className="mt-2 text-[13px] font-medium" style={{ color: C.stopInk }}>
          {error}
        </div>
      )}
    </Card>
  );
});

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
  /** The counts "Hur många arbetare?" offers -- Inställningar's, per bolag. */
  const [workerOptions, setWorkerOptions] = useState<WorkerOptions>([...DEFAULT_WORKER_OPTIONS]);

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

  const stripRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Map<string, HTMLElement>>(new Map());
  const daysRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  // Scrolled down among the cards with the date strip gone off the top: the day you are
  // on floats in at the top of the screen, and leaves again as the strip comes back.
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const strip = stripRef.current?.getBoundingClientRect();
      const cards = carouselRef.current?.getBoundingClientRect();
      setFloating(!!strip && !!cards && strip.bottom < 8 && cards.bottom > 140);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const drag = useRef<{
    x: number; y: number; id: number; axis: "x" | "y" | null; dx: number;
    samples: { x: number; t: number }[];
  } | null>(null);
  const dragged = useRef(false);

  const [createdKeys, setCreatedKeys] = useState<Set<string>>(new Set());

  const sortedDays = [...selectedDays].sort();
  const dayIdx = Math.min(activeDay, Math.max(0, sortedDays.length - 1));
  const currentDay = sortedDays[dayIdx] ?? null;
  // Shifts taken off one day with their own ✕; every other list skips them.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // Shifts added to one day with its own "+ Lägg till", counted per day. They take the
  // slot numbers after the worker count's, so every list below reads them like the rest.
  const [extra, setExtra] = useState<Map<string, number>>(new Map());
  const allSlotsOf = (day: string) =>
    Array.from({ length: workerCount + (extra.get(day) ?? 0) }, (_, i) => cardKey(day, i));
  const slotsOf = (day: string) => allSlotsOf(day).filter((k) => !removed.has(k));
  function addSlot(day: string) {
    setExtra((prev) => new Map(prev).set(day, (prev.get(day) ?? 0) + 1));
  }
  const keys = sortedDays.flatMap(slotsOf);
  const cardAt = (k: string) => cards.get(k) ?? DEFAULT_CARD;

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
      if (t?.id) {
        setPresets(loadPresets(t.id));
        const options = loadWorkerOptions(t.id);
        setWorkerOptions(options);
        // Inställningar's starting count -- only if nobody has picked one yet,
        // and only if it is still one of the buttons.
        const n = loadDefaultWorkers(t.id);
        if (n && options.includes(n)) setWorkerCount((cur) => cur || n);
      }
    })();
  }, [reload]);

  /* ── keep the chosen day in the middle of the strip ── */
  useEffect(() => {
    const row = stripRef.current;
    const chip = currentDay ? chipRefs.current.get(currentDay) : undefined;
    if (!row || !chip) return;
    row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: "smooth" });
  }, [currentDay, sortedDays.length]);

  /* A drag crosses several days before React re-renders, so each toggle reads the latest set. */
  function toggleDay(date: string) {
    forgetRemoved(date);
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  function removeDay(date: string) {
    forgetRemoved(date);
    setSelectedDays((prev) => {
      const next = new Set(prev);
      next.delete(date);
      return next;
    });
  }

  /** A date picked again comes back with all its shifts, and none of the added ones. */
  function forgetRemoved(date: string) {
    setExtra((prev) => {
      if (!prev.has(date)) return prev;
      const next = new Map(prev);
      next.delete(date);
      return next;
    });
    setRemoved((prev) => {
      if (![...prev].some((k) => k.startsWith(`${date}::`))) return prev;
      return new Set([...prev].filter((k) => !k.startsWith(`${date}::`)));
    });
  }

  // The last shift on a day takes the date with it: there is nothing left to create there.
  const removeCard = useCallback((key: string) => {
    const date = key.split("::")[0]!;
    const left = Array.from({ length: workerCount + (extra.get(date) ?? 0) }, (_, i) => cardKey(date, i))
      .filter((k) => k !== key && !removed.has(k));
    if (left.length === 0) { removeDay(date); return; }
    setRemoved((prev) => new Set(prev).add(key));
  }, [workerCount, removed, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the day carousel: follows the finger, settles one day at a time ── */
  const many = sortedDays.length > 1;
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    mq.addEventListener("change", sync);
    queueMicrotask(sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const SETTLE_OR_NONE = still ? "none" : SETTLE;

  /** Writes the track and every column straight to the DOM, so a drag never waits on React. */
  function place(idx: number, dx: number, settle: boolean) {
    const track = daysRef.current;
    if (!track) return;
    const ease = settle && !prefersStill() ? SETTLE : "none";
    Object.assign(track.style, { ...trackStyle(idx, dx, many), transition: ease });
    const step = track.clientWidth * (DAY_COL / 100) + DAY_GAP;
    columnsOf(track).forEach((el, i) => {
      Object.assign(el.style, { ...columnStyle(i, idx - dx / step, many), transition: ease });
    });
  }

  // The day the track is heading for, updated the instant a flick lands. A second
  // flick can arrive before React re-renders, and must step on from here, not from the stale render.
  const idxRef = useRef(0);
  useEffect(() => { idxRef.current = dayIdx; }, [dayIdx]);

  function goToDay(i: number) {
    idxRef.current = i;
    place(i, 0, true);
    setActiveDay(i);
  }

  function onDaysPointerDown(e: React.PointerEvent) {
    // A swipe ends without a click, so the flag from the last one must not eat this tap.
    dragged.current = false;
    if (!many || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: null, dx: 0, samples: [{ x: e.clientX, t: e.timeStamp }] };
  }

  function onDaysPointerMove(e: React.PointerEvent) {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "y") { drag.current = null; return; }
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      // A mouse drag selects text, and in Safari the next press on that selection starts a
      // native text drag that swallows the pointerup and leaves the track hanging mid-swipe.
      window.getSelection()?.removeAllRanges();
      el.style.userSelect = "none";
      el.style.setProperty("-webkit-user-select", "none");
    }
    const at = idxRef.current;
    const atEdge = (at === 0 && dx > 0) || (at === sortedDays.length - 1 && dx < 0);
    g.dx = atEdge ? dx * 0.3 : dx;
    g.samples.push({ x: e.clientX, t: e.timeStamp });
    if (g.samples.length > 6) g.samples.shift();
    place(at, g.dx, false);
  }

  function releaseSelection(el: HTMLElement) {
    el.style.userSelect = "";
    el.style.removeProperty("-webkit-user-select");
  }

  function onDaysPointerUp(e: React.PointerEvent) {
    const g = drag.current;
    drag.current = null;
    releaseSelection(e.currentTarget as HTMLElement);
    if (!g || g.id !== e.pointerId || g.axis !== "x") return;
    dragged.current = true;
    const width = (daysRef.current?.clientWidth ?? 1) * (DAY_COL / 100);
    const first = g.samples[0]!;
    const last = g.samples[g.samples.length - 1]!;
    const v = (last.x - first.x) / Math.max(1, last.t - first.t);
    const at = idxRef.current;
    let to = at;
    if (g.dx < -width * 0.18 || v < -0.35) to = at + 1;
    else if (g.dx > width * 0.18 || v > 0.35) to = at - 1;
    goToDay(Math.max(0, Math.min(sortedDays.length - 1, to)));
  }

  /** A tap on a peeking neighbour brings it in; a drag is never also a click. */
  function onDaysClickCapture(e: React.MouseEvent) {
    if (dragged.current) {
      dragged.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const hit = columnsOf(daysRef.current).findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right;
    });
    if (hit >= 0 && hit !== idxRef.current) {
      e.preventDefault();
      e.stopPropagation();
      goToDay(hit);
    }
  }

  /* ── worker count change ── */
  function handleCountChange(n: number) {
    if (n === workerCount) return;
    if (keys.length > 0) {
      setPendingCount(n);
      setShowResetDialog(true);
    } else {
      setRemoved(new Set());
      setExtra(new Map());
      setWorkerCount(n);
    }
  }

  function confirmReset() {
    setCards(new Map());
    setCardErrors(new Map());
    setCreatedKeys(new Set());
    setRemoved(new Set());
    setExtra(new Map());
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

  /* ── submit ── */
  async function handleSubmit() {
    setError(null);
    setCardErrors(new Map());
    setSaving(true);

    const sb = getSupabase();
    let created = 0;
    let failed = 0;
    const errors = new Map<string, string>();
    const done = new Set(createdKeys);
    const pending = keys.filter((k) => !done.has(k));
    const total = pending.length;

    for (let i = 0; i < pending.length; i++) {
      const key = pending[i]!;
      const card = cardAt(key);
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
        done.add(key);
        created++;
      }
    }

    setCreatedKeys(done);
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

  const totalCards = keys.length - keys.filter((k) => createdKeys.has(k)).length;
  const filledCards = keys.filter((k) => !createdKeys.has(k) && cardAt(k).personId).length;
  const missingDays = sortedDays.filter((d) =>
    slotsOf(d).some((k) => !createdKeys.has(k) && !cardAt(k).personId));
  const hoursReadable = keys.every((k) => createdKeys.has(k) || hoursOk(cardAt(k)));
  const canSubmit = !saving && projectId && totalCards > 0 && filledCards === totalCards && hoursReadable;

  return (
    <SoftScreen
      title="Skiftfabrik"
      back="/"
      subtitle="Skapa skift med egna tider per person."
    >
      <SoftToast message={toast} onDone={() => setToast(null)} />

      {/* The day you are on, floating in once the date strip has scrolled away. Decorative:
          the strip is the control, so this never takes a tap. */}
      {currentDay && keys.length > 0 && (
        <div
          aria-hidden
          data-floating-date={floating ? "shown" : "hidden"}
          className="pointer-events-none fixed left-1/2 top-0 z-40 w-full max-w-[390px]"
          style={{
            height: "calc(84px + env(safe-area-inset-top))",
            paddingTop: "env(safe-area-inset-top)",
            background: "linear-gradient(to bottom, rgba(255,255,255,.96) 0%, rgba(255,255,255,.82) 48%, rgba(255,255,255,0) 100%)",
            opacity: floating ? 1 : 0,
            transform: `translateX(-50%) translateY(${floating ? 0 : -12}px)`,
            transition: still ? "none" : "opacity 260ms ease, transform 320ms cubic-bezier(.22,.9,.24,1)",
          }}
        >
          <div
            className="flex items-center justify-center gap-[8px] pt-[14px] text-[17px] font-extrabold"
            style={{
              color: C.ink,
              letterSpacing: "-.3px",
              opacity: floating ? 1 : 0,
              transform: `translateY(${floating ? 0 : -6}px)`,
              transition: still ? "none" : "opacity 220ms ease 80ms, transform 300ms cubic-bezier(.22,.9,.24,1) 80ms",
            }}
          >
            <span aria-hidden className="block h-[8px] w-[8px] rounded-full" style={{ background: C.accent }} />
            <span key={currentDay} className="fade-rise">{svDate(currentDay)}</span>
          </div>
        </div>
      )}

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
            <DayPainter selected={selectedDays} onToggle={toggleDay} />
          </div>
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
            {workerOptions.map((n) => {
              const active = workerCount === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleCountChange(n)}
                  className="flex-1 rounded-full py-[10px] text-[15px] font-bold transition-colors"
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
          {/* Date strip: the chosen day centred, the rest fading out both sides. */}
          {sortedDays.length > 0 && (
            <div className="mb-[10px]">
              <div
                ref={stripRef}
                role="tablist"
                aria-label="Dagar"
                className="relative flex gap-[8px] overflow-x-auto py-[4px]"
                style={{
                  scrollbarWidth: "none",
                  scrollSnapType: "x mandatory",
                  paddingInline: "50%",
                  maskImage: STRIP_MASK,
                  WebkitMaskImage: STRIP_MASK,
                }}
              >
                {sortedDays.map((d, i) => {
                  const on = i === dayIdx;
                  return (
                    <span
                      key={d}
                      ref={(el) => {
                        if (el) chipRefs.current.set(d, el);
                        else chipRefs.current.delete(d);
                      }}
                      className="flex shrink-0 items-center rounded-full text-[14px] font-bold transition-[opacity,background-color] duration-150"
                      style={{
                        scrollSnapAlign: "center",
                        background: on ? C.accent : C.surface,
                        color: on ? C.onAccent : C.ink,
                        border: `1px solid ${on ? C.accent : C.border}`,
                        opacity: on ? 1 : 0.45,
                      }}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => goToDay(i)}
                        className={`rounded-full py-[6px] pl-[14px] ${on ? "pr-[4px]" : "pr-[14px]"}`}
                      >
                        {svDate(d)}
                      </button>
                      {on && (
                        <button
                          type="button"
                          aria-label={`Ta bort ${svDate(d)}`}
                          data-remove-day
                          onClick={() => removeDay(d)}
                          className="mr-[3px] flex h-[28px] w-[28px] items-center justify-center rounded-full"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cards: one column per day, swiped like album covers. */}
          <div
            ref={carouselRef}
            className="-mx-4"
            style={{ overflowX: "clip", overflowY: "visible", touchAction: "pan-y" }}
            onPointerDown={onDaysPointerDown}
            onPointerMove={onDaysPointerMove}
            onPointerUp={onDaysPointerUp}
            onPointerCancel={(e) => { drag.current = null; releaseSelection(e.currentTarget); place(idxRef.current, 0, true); }}
            onClickCapture={onDaysClickCapture}
            onDragStart={(e) => e.preventDefault()}
          >
          <div
            ref={daysRef}
            className="flex w-full"
            style={{
              gap: DAY_GAP,
              padding: many ? 0 : "0 16px",
              ...trackStyle(dayIdx, 0, many),
              transition: SETTLE_OR_NONE,
            }}
          >
            {sortedDays.map((day, i) => (
              <div
                key={day}
                data-day-col
                aria-label={svDate(day)}
                role="group"
                inert={many && i !== dayIdx}
                className="space-y-[12px] py-[2px]"
                style={{
                  flex: `0 0 ${many ? `${DAY_COL}%` : "100%"}`,
                  ...columnStyle(i, dayIdx, many),
                  transition: SETTLE_OR_NONE,
                }}
              >
                {slotsOf(day).map((k) => (
                  <ShiftCard
                    key={k}
                    id={k}
                    card={cardAt(k)}
                    workers={workers}
                    presets={presets}
                    onChange={updateCard}
                    onNewWorker={setCreatingForCard}
                    onRemove={removeCard}
                    error={cardErrors.get(k)}
                  />
                ))}
                {/* One more shift on this day only: 07:00–16:00, nobody, no break. */}
                <button
                  type="button"
                  data-add-slot={day}
                  onClick={() => addSlot(day)}
                  className="press-scale flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#f4f3f0] active:scale-[.985]"
                  style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.ink }}
                >
                  + Lägg till
                </button>
              </div>
            ))}
          </div>
          </div>

          {/* Dot indicator */}
          {sortedDays.length > 1 && (
            <div className="mt-[10px] flex justify-center gap-[6px]">
              {sortedDays.map((_, i) => (
                <span
                  key={i}
                  className="block h-[6px] w-[6px] rounded-full transition-colors"
                  style={{ background: i === dayIdx ? C.accent : C.border }}
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
        {/* What is holding Skapa back: one line per day with a card nobody is on. */}
        <div aria-live="polite" className="mt-[10px] space-y-[2px] text-center">
          {missingDays.map((d) => (
            <p key={d} data-missing-day={d} className="text-[13px] font-semibold" style={{ color: C.stopInk }}>
              {svOrdinalDate(d)} saknar arbetare
            </p>
          ))}
        </div>
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
