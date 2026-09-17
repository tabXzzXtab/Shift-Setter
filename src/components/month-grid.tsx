"use client";

import type { ReactNode } from "react";
import { C, Card } from "./soft";
import { addDays } from "@/lib/dates";

/**
 * The month grid both calendar views are drawn on.
 *
 * ONE GRID, TWO VIEWS. Arbete and Personlig sit behind a switch on the same
 * screen, so the pager, the weekday row and the cell geometry have to be the
 * same object -- two grids drifting a pixel apart is the sort of thing nobody
 * sees in review and everybody feels in use. What differs between the views is
 * the CONTENT of a cell, which is why that arrives as a render prop rather than
 * as a flag: the two treatments are then written side by side and can be told
 * apart on purpose (spec Section 2c).
 *
 * The chrome is the handoff's Skiftkalender card verbatim -- 40px pager
 * buttons, 19/800 month over a 12/700 year, 11px weekday letters with the
 * weekend at 600, 3px gaps.
 */

/**
 * The empty cell's ground. From the handoff's Skiftkalender markup rather than
 * its colour table -- it is the one fill that screen introduces, a shade
 * between `ground` and `surface` so a day reads as a tile without competing
 * with the card it sits on.
 */
export const CELL_GROUND = "#f8faff";

/**
 * A day cell is a FIXED height whatever the day holds (spec Section 2b).
 *
 * The handoff draws `min-height:64px`. A minimum is what the old reserved-line
 * grid had, and a month with twenty sites on it grew cells taller than the
 * screen until the grid stopped reading as a calendar. So 64 is a ceiling here
 * as well as a floor, and every view drawing into it packs its marks to fit:
 * 20px for the day number leaves 44, and both views spend it down to the pixel.
 */
export const CELL_H = 64;

export function MonthGrid({
  month, onMonthChange, today, cell,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  today: string;
  /** One day's cell, drawn whole by the caller. */
  cell: (date: string, day: number, isToday: boolean) => ReactNode;
}) {
  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const leadingBlanks = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;  // Monday-based

  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long" })
    .format(new Date(`${first}T12:00:00Z`));

  return (
    <Card radius={16} pad="px-[14px] pb-[18px] pt-4">
      <div className="mb-4 flex items-center justify-between">
        <PagerButton
          label="Föregående månad"
          onClick={() => onMonthChange(addDays(first, -1).slice(0, 7))}
          d="M7.5 1.5 2 7.5l5.5 6"
        />

        <div className="text-center">
          <div className="text-[19px] font-extrabold capitalize" style={{ letterSpacing: "-.5px" }}>
            {monthName}
          </div>
          <div className="text-[12px] font-bold" style={{ letterSpacing: "1px", color: C.text2 }}>
            {month.slice(0, 4)}
          </div>
        </div>

        <PagerButton
          label="Nästa månad"
          onClick={() => onMonthChange(addDays(first, daysInMonth).slice(0, 7))}
          d="M1.5 1.5 7 7.5l-5.5 6"
        />
      </div>

      <div className="mb-[6px] grid grid-cols-7 gap-[3px]">
        {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => (
          <div
            key={i}
            className={`text-center text-[11px] ${i > 4 ? "font-semibold" : "font-bold"}`}
            style={{ letterSpacing: ".8px", color: C.text2 }}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`b${i}`} style={{ height: CELL_H }} />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          return <div key={date}>{cell(date, day, date === today)}</div>;
        })}
      </div>
    </Card>
  );
}

/** The 40px `#eef3fe` chevron button either side of the month name. */
function PagerButton({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press-scale flex h-10 w-10 items-center justify-center rounded-[11px] transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
      style={{ background: C.panel2 }}
    >
      <svg width="8" height="14" viewBox="0 0 9 15" fill="none" aria-hidden>
        <path d={d} stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
