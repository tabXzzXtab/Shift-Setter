"use client";

import { useEffect, useRef, useState } from "react";
import { C, SHADOW, SoftField, SoftInput } from "@/components/soft";

/**
 * A time field whose picker is a wheel, the phone's own idiom, drawn by us.
 *
 * The native time control opens a different thing on every phone and paints
 * its value at its own width. This shows "07:00" in the app's field and drops a
 * card with two wheels -- hours 00-23, minutes in quarters -- under a pale
 * selection band, rows tilting and fading away from it (Bumble's and Mindtrip's
 * inline wheel card; the band from the user's own reference).
 *
 * QUARTERS ONLY ON THE WHEEL. A value that is not on a quarter (typed, or
 * stored before this existed) is kept as it is; the wheel opens on the nearest
 * quarter and only changes the value when somebody spins it.
 *
 * THE PANEL HANGS OFF THE ROW, NOT THE FIELD. This component's root is not
 * positioned, so the card's `absolute` resolves to the nearest positioned
 * ancestor -- the caller's row, given `relative`. A third-width field in a
 * Börjar / Slutar / Timmar row would otherwise open a card a third wide.
 *
 * THE VISIBLE FIELD IS STILL AN INPUT (data-time), and typing "HH:MM" into it
 * sets the time -- the walkthroughs fill times that way. inputMode="none"
 * keeps the keyboard down on a phone.
 */

const ROW = 40;                 // px per wheel row
const VISIBLE = 5;              // rows in view; the middle one is the choice
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const QUARTERS = ["00", "15", "30", "45"];

function Wheel({
  items, index, onPick, label,
}: {
  items: string[];
  index: number;
  onPick: (i: number) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ONLY A PERSON PICKS. Setting scrollTop -- on opening, or to follow a time
  // typed into the field -- fires the same scroll event a swipe does, and the
  // settle below used to answer it by writing the wheel's position back: the
  // old time, over the one just typed. A pointer, wheel or key on the wheel is
  // what makes the next settle a choice.
  const touched = useRef(false);
  const mark = () => { touched.current = true; };

  /** Each row tilts and fades with its distance from the band. */
  const paint = () => {
    const el = box.current;
    if (!el) return;
    const centre = el.scrollTop / ROW;
    el.querySelectorAll<HTMLElement>("[data-wheel-item]").forEach((item, i) => {
      const d = Math.max(-2.6, Math.min(2.6, i - centre));
      item.style.transform = `rotateX(${-d * 22}deg) scale(${1 - Math.abs(d) * 0.06})`;
      item.style.opacity = String(Math.max(0.18, 1 - Math.abs(d) * 0.32));
      item.style.fontWeight = Math.abs(d) < 0.5 ? "700" : "500";
    });
  };

  // Opens on the chosen row, without animating there.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollTop = index * ROW;
    paint();
    // Only on mount: afterwards the wheel's own scroll is the truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A time typed into the field moves the wheel to it, without picking.
  useEffect(() => {
    const el = box.current;
    if (!el || Math.round(el.scrollTop / ROW) === index) return;
    touched.current = false;
    el.scrollTop = index * ROW;
    paint();
  }, [index]);

  return (
    <div
      ref={box}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onPointerDown={mark}
      onWheel={mark}
      onTouchStart={mark}
      onScroll={() => {
        paint();
        if (settle.current) clearTimeout(settle.current);
        // Snap has landed once scrolling has been still for a moment.
        settle.current = setTimeout(() => {
          const el = box.current;
          if (!el) return;
          if (!touched.current) return;
          const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
          onPick(i);
        }, 90);
      }}
      onKeyDown={(e) => {
        mark();
        const el = box.current;
        if (!el) return;
        const i = Math.round(el.scrollTop / ROW);
        if (e.key === "ArrowDown") { e.preventDefault(); el.scrollTo({ top: Math.min(items.length - 1, i + 1) * ROW, behavior: "smooth" }); }
        if (e.key === "ArrowUp") { e.preventDefault(); el.scrollTo({ top: Math.max(0, i - 1) * ROW, behavior: "smooth" }); }
      }}
      className="relative h-full flex-1 snap-y snap-mandatory overflow-y-scroll overscroll-contain outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ perspective: "600px" }}
    >
      <div style={{ height: ROW * Math.floor(VISIBLE / 2) }} />
      {items.map((it, i) => (
        <button
          key={it}
          type="button"
          data-wheel-item
          role="option"
          aria-selected={i === index}
          onClick={() => box.current?.scrollTo({ top: i * ROW, behavior: "smooth" })}
          className="flex w-full snap-center items-center justify-center text-[24px] tabular-nums"
          style={{ height: ROW, color: C.ink, letterSpacing: "-.4px", transformOrigin: "center" }}
        >
          {it}
        </button>
      ))}
      <div style={{ height: ROW * Math.floor(VISIBLE / 2) }} />
    </div>
  );
}

export function TimeField({
  label, value, onChange, disabled = false,
}: {
  label: string;
  /** Shown, not editable: a running pass on Bekräfta dagen. */
  disabled?: boolean;
  /** "HH:MM". */
  value: string;
  onChange: (time: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!field.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  const [h, m] = /^\d{2}:\d{2}$/.test(value) ? value.split(":").map(Number) as [number, number] : [7, 0];
  const hourIx = h;
  const quarterIx = Math.min(3, Math.round(m / 15)) % 4;
  const write = (hh: number, mm: number) => {
    const next = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    if (next !== value) onChange(next);
  };

  return (
    <>
      <SoftField label={label}>
        <span ref={field} className="relative block">
          <SoftInput
            type="text"
            data-time
            inputMode="none"
            autoComplete="off"
            aria-haspopup="dialog"
            aria-expanded={open}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) onChange(v);
            }}
            onFocus={() => { if (!disabled) setOpen(true); }}
            onClick={() => { if (!disabled) setOpen(true); }}
            className="cursor-pointer pr-[36px] tabular-nums"
            style={open ? { borderColor: C.accent, boxShadow: `0 0 0 1px ${C.accent}` } : undefined}
          />
          <svg
            aria-hidden width="17" height="17" viewBox="0 0 18 18" fill="none"
            className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2"
          >
            <circle cx="9" cy="9" r="7.5" stroke={C.chevron} strokeWidth="1.8" />
            <path d="M9 5v4.2l2.6 1.6" stroke={C.chevron} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </SoftField>

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={`Välj ${label.toLowerCase()}`}
          data-time-wheel
          className="absolute left-0 right-0 top-full z-30 mt-2 rounded-[20px] px-4 py-3"
          style={{ background: C.surface, boxShadow: SHADOW.hero, color: C.ink }}
        >
          <div className="relative flex items-stretch" style={{ height: ROW * VISIBLE }}>
            {/* The band the choice sits in -- behind the numbers. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 rounded-[12px]"
              style={{ top: ROW * Math.floor(VISIBLE / 2), height: ROW, background: C.panel2 }}
            />
            <Wheel
              label="Timme"
              items={HOURS}
              index={hourIx}
              onPick={(i) => write(i, m)}
            />
            <div className="relative flex items-center text-[24px] font-bold" aria-hidden>:</div>
            <Wheel
              label="Minut"
              items={QUARTERS}
              index={quarterIx}
              onPick={(i) => write(h, i * 15)}
            />
          </div>
        </div>
      )}
    </>
  );
}
