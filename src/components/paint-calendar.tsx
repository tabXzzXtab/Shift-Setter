"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { addDays } from "@/lib/dates";
import { MonthCard, monthShape } from "./soft";

export type CellLook = {
  className: string;
  label: string;
  /** The handoff's cells are fills and radii rather than borders, and a fill
   *  that changes per state is a value, not a class. Only `soft` uses it. */
  style?: CSSProperties;
};

/**
 * A month grid you paint by dragging.
 *
 * The worker's förval calendar and the leader's day picker are the same
 * interaction, so they are the same component: drag across days to mark them,
 * drag back over one to unmark it, and a single tap toggles one day — a leader
 * picking three scattered days should not have to drag each one.
 *
 * Two things make it work with a finger rather than only a mouse:
 *
 *  - The day under the pointer is found by HIT-TESTING, not by hover. Touch
 *    fires no enter/leave on the elements a finger slides across, so a
 *    hover-driven grid marks the first cell and nothing else.
 *  - `touch-action: none` on the grid. Without it the browser claims the
 *    gesture as a scroll and cancels the drag partway through.
 *
 * The consumer owns the meaning: this reports each date the finger crosses,
 * once per gesture, and asks how each cell should look.
 *
 * `soft` draws it in the handoff's language -- the shared MonthCard chrome and
 * 44px radius-10 cells instead of the black bordered squares. A VARIANT rather
 * than a second component, for the same reason SignOut has one: the gesture
 * above is the whole reason this file exists and it must not be copied to get
 * a different skin. The prop retires when the last screen using the old look
 * has moved.
 */
export function PaintCalendar({
  month,
  onMonthChange,
  look,
  onPaint,
  onPaintEnd,
  cellContent,
  soft = false,
}: {
  month: string;                       // YYYY-MM
  onMonthChange: (month: string) => void;
  look: (date: string) => CellLook;
  onPaint: (date: string) => void;
  onPaintEnd?: () => void;
  cellContent?: (date: string, day: number) => ReactNode;
  soft?: boolean;
}) {
  const painting = useRef(false);
  const swept = useRef<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);

  const { first, daysInMonth, leadingBlanks } = monthShape(month);

  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" })
    .format(new Date(`${first}T12:00:00Z`));

  const dateUnder = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-date]")?.dataset.date ?? null;

  const sweep = (date: string) => {
    if (swept.current.has(date)) return;   // one toggle per day per gesture
    swept.current.add(date);
    onPaint(date);
  };

  const end = () => {
    if (!painting.current) return;
    painting.current = false;
    onPaintEnd?.();
  };

  /** The grid, with the gesture on it. Both looks share every handler. */
  const grid = (
    <div
      ref={gridRef}
      data-calendar-grid
      className={`grid touch-none select-none grid-cols-7 ${soft ? "gap-[2px]" : "gap-1"}`}
      onPointerDown={(e) => {
        const d = dateUnder(e.clientX, e.clientY);
        if (!d) return;
        painting.current = true;
        swept.current.clear();
        // Keeps the gesture ours even if the finger leaves the grid.
        gridRef.current?.setPointerCapture(e.pointerId);
        sweep(d);                       // a tap is a one-cell drag
      }}
      onPointerMove={(e) => {
        if (!painting.current) return;
        const d = dateUnder(e.clientX, e.clientY);
        if (d) sweep(d);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {Array.from({ length: leadingBlanks }, (_, i) => (
        <span key={`b${i}`} className={soft ? "h-11" : undefined} />
      ))}

      {Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const { className, label, style } = look(date);
        return (
          <div
            key={date}
            data-date={date}
            role="button"
            aria-label={label}
            className={
              soft
                ? `flex h-11 items-center justify-center rounded-[10px] text-[16px] ${className}`
                : `flex aspect-square items-center justify-center border-2 border-black text-lg font-bold ${className}`
            }
            style={soft ? { letterSpacing: "-.2px", ...style } : style}
          >
            {cellContent ? cellContent(date, day) : day}
          </div>
        );
      })}
    </div>
  );

  if (soft) return <MonthCard month={month} onMonthChange={onMonthChange} gap={2}>{grid}</MonthCard>;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Föregående månad"
          onClick={() => onMonthChange(addDays(first, -1).slice(0, 7))}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ‹
        </button>
        <span className="text-lg font-bold capitalize">{monthName}</span>
        <button
          type="button"
          aria-label="Nästa månad"
          onClick={() => onMonthChange(addDays(first, daysInMonth).slice(0, 7))}
          className="h-14 w-14 border-2 border-black text-2xl font-bold"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-bold">
        {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      {grid}
    </>
  );
}
