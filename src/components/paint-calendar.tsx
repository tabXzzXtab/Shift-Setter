"use client";

import { useRef, type ReactNode } from "react";
import { addDays } from "@/lib/dates";

export type CellLook = { className: string; label: string };

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
 */
export function PaintCalendar({
  month,
  onMonthChange,
  look,
  onPaint,
  onPaintEnd,
  cellContent,
}: {
  month: string;                       // YYYY-MM
  onMonthChange: (month: string) => void;
  look: (date: string) => CellLook;
  onPaint: (date: string) => void;
  onPaintEnd?: () => void;
  cellContent?: (date: string, day: number) => ReactNode;
}) {
  const painting = useRef(false);
  const swept = useRef<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);

  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  // Monday-based, matching the ISO week the priority list counts in.
  const leadingBlanks = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;

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

      <div
        ref={gridRef}
        data-calendar-grid
        className="grid touch-none select-none grid-cols-7 gap-1"
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
        {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const { className, label } = look(date);
          return (
            <div
              key={date}
              data-date={date}
              role="button"
              aria-label={label}
              className={`flex aspect-square items-center justify-center border-2 border-black text-lg font-bold ${className}`}
            >
              {cellContent ? cellContent(date, day) : day}
            </div>
          );
        })}
      </div>
    </>
  );
}
