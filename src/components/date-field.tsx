"use client";

import { useEffect, useRef, useState } from "react";
import { C, SHADOW, SoftField, SoftInput, monthShape } from "@/components/soft";
import { stockholmToday } from "@/lib/dates";

/**
 * A date field whose picker is ours, not the browser's.
 *
 * The native date control is the one input on these screens drawn by the
 * browser rather than by us: on a phone it paints its own value at its own
 * width -- "2026-09-30" ran into its own calendar icon on Skapa ett projekt --
 * and opens a system wheel that looks like nothing else in the app. So the
 * field shows the date in words ("1 okt. 2026") and a tap drops a month card
 * under it, the way Bumble's date step does: the month and two arrows on top,
 * the chosen day a filled accent circle, today a ring. Picking a day closes it.
 *
 * THE FORM STILL GETS ISO. A hidden input carries `name` and "YYYY-MM-DD", so a
 * page that reads FormData does not change.
 *
 * THE VISIBLE FIELD IS STILL AN INPUT, and typing an ISO date into it sets the
 * date. That is for the walkthroughs, every one of which fills Startdatum with
 * `fill("2026-10-01")`; a button there would have broken 23 suites at once.
 * inputMode="none" keeps the keyboard down on a phone, where the card is the
 * way in.
 */

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function words(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

const Arrow = ({ d }: { d: string }) => (
  <svg width="8" height="14" viewBox="0 0 9 15" fill="none" aria-hidden>
    <path d={d} stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function DateField({
  label, help, name, value, onChange,
}: {
  label: string;
  help?: string;
  /** The FormData key; the hidden input carries it. */
  name?: string;
  /** "YYYY-MM-DD". */
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value || stockholmToday()).slice(0, 7));
  const box = useRef<HTMLDivElement>(null);
  const today = stockholmToday();

  // Outside a tap or Escape closes it -- the two ways out a dropdown has to have.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  function show() {
    // Opens on the month of the date it holds, not the one last paged to.
    setMonth((value || today).slice(0, 7));
    setOpen(true);
  }

  const { daysInMonth, leadingBlanks } = monthShape(month);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const step = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1, 12));
    setMonth(d.toISOString().slice(0, 7));
  };
  const title = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T12:00:00Z`));

  return (
    <div ref={box} className="relative">
      <SoftField label={label} help={help}>
        <span className="relative block">
          <SoftInput
            type="text"
            inputMode="none"
            autoComplete="off"
            aria-haspopup="dialog"
            aria-expanded={open}
            value={words(value)}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { onChange(v); setMonth(v.slice(0, 7)); }
            }}
            onFocus={show}
            onClick={show}
            className="cursor-pointer pr-[42px]"
          />
          {/* A calendar glyph says "this opens a picker" without a word. */}
          <svg
            aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none"
            className="pointer-events-none absolute right-[14px] top-1/2 -translate-y-1/2"
          >
            <rect x="1.5" y="3" width="15" height="13.5" rx="3" stroke={C.chevron} strokeWidth="1.8" />
            <path d="M1.5 7.5h15M5.5 1.5v3M12.5 1.5v3" stroke={C.chevron} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
      </SoftField>
      {name && <input type="hidden" name={name} value={value} />}

      {open && (
        <div
          role="dialog"
          aria-label={`Välj ${label.toLowerCase()}`}
          data-date-picker
          className="absolute left-0 top-full z-30 mt-2 w-[calc(100vw-68px)] max-w-[322px] rounded-[20px] p-4"
          style={{ background: C.surface, boxShadow: SHADOW.hero, color: C.ink }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="pl-1 text-[17px] font-bold capitalize" style={{ letterSpacing: "-.3px" }}>
              {title}
            </div>
            <div className="flex gap-1">
              <button
                type="button" aria-label="Föregående månad" onClick={() => step(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#f1f0ed]"
              >
                <Arrow d="M7.5 1.5 2 7.5l5.5 6" />
              </button>
              <button
                type="button" aria-label="Nästa månad" onClick={() => step(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#f1f0ed]"
              >
                <Arrow d="M1.5 1.5 7 7.5l-5.5 6" />
              </button>
            </div>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => (
              <div key={i} className="text-center text-[11px] font-bold" style={{ letterSpacing: ".8px", color: C.text2 }}>
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const date = iso(y, m, i + 1);
              const on = date === value;
              const isToday = date === today;
              return (
                <button
                  key={date}
                  type="button"
                  data-pick={date}
                  aria-label={words(date)}
                  aria-pressed={on}
                  onClick={() => { onChange(date); setOpen(false); }}
                  className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-[16px] ${
                    on ? "font-extrabold" : "font-medium hover:bg-[#f1f0ed]"
                  }`}
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
        </div>
      )}
    </div>
  );
}
