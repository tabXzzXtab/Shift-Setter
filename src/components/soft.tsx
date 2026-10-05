"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
// The fallback letters live with the rest of the avatar handling rather than
// here: two copies of "what do we draw when there is no photograph" is two
// copies that drift.
import { initials } from "@/lib/avatar";

/**
 * The handoff's design language, as components.
 *
 * ONE PLACE FOR THE VALUES. The bundle is marked high fidelity across
 * twenty-four screens, which means the same hex appears dozens of times and a
 * single wrong one is invisible in review. Everything below is the handoff's
 * own numbers; screens compose these rather than restating them.
 *
 * IT BEGAN AS A SECOND SET, alongside the black-and-white components/ui.tsx,
 * so the three roles could be migrated one at a time without leaving every
 * un-migrated screen half-converted. Every screen has moved now and ui.tsx is
 * gone; this is simply the app's components.
 *
 * Inter is still applied HERE rather than on <body>, because a fixed dialog is
 * outside whatever screen opened it and has to say so for itself.
 */

/* ---- colour: the Komponentspråk palette (owner-approved 2026-10-05) -------
 *
 * NO SAME-HUE TINT PAIRS. The handoff paired every ink with a pale tint of
 * itself -- green on pale green, the brand blue on a blue-tinted ground --
 * which is the stock badge of every generated dashboard. Grounds are now a
 * near-neutral stone (OKLCH chroma <= 0.006, hue 85), and colour lives only
 * in ink: text, a dot, an icon, a 1px edge. The status inks were moved off
 * pure green/red/amber to teal, rust and ochre at matched lightness; each
 * clears 4.5:1 on both white and the ground. `chevron` is for icons only
 * (3.4:1), never for text.
 *
 * The *Bg names survive so nothing breaks, but they are neutral now: a status
 * colour is never a background. The eight project colours are NOT here --
 * they are lib/project-colour.ts and a database constraint, and stay put.
 */
export const C = {
  /** Text. A warm near-black (owner, 2026-10-05: no cool colours). */
  ink: "#24180f",
  inkHover: "#3a2a20",
  /** The brand colour, as a FILL (owner, 2026-10-05). White on it is 2.9:1, so what sits on it is `onAccent`. */
  accent: "#e87a46",
  /** The accent as text or an icon on white/ground: the same hue darkened to 5.1:1. */
  accentInk: "#b64e10",
  /** Text and icons ON an accent fill: the dark ink, 6.1:1. */
  onAccent: "#24180f",
  text2: "#5e5a53",
  chevron: "#89867f",
  ground: "#f7f6f3",
  surface: "#ffffff",
  panel: "#f1f0ed",
  panel2: "#f1f0ed",
  rowHover: "#f4f3f0",
  hairline: "#e4e3df",
  /** Outline of a control that is not the primary one: secondary buttons, steppers. */
  border: "#d3d1cd",
  /** Done / live -- as ink only. */
  liveInk: "#427138",
  liveBg: "#f1f0ed",
  /** Needs a look -- as ink only. */
  warnInk: "#826817",
  tagWarnInk: "#826817",
  warnBg: "#f1f0ed",
  /** Changes or blocks real work -- as ink only. */
  stopInk: "#9d2a39",
  stopBg: "#f1f0ed",
} as const;

/**
 * FLAT BY DEFAULT. A card on the ground is told apart by its white against the
 * pale blue, not by a shadow under it -- the Ro pass (handoff §1). `group`, the
 * shadow every ordinary card used to wear, is now a hairline's worth of depth;
 * hero, offer, sheet and the action shadow keep their lift because those are
 * the things on a screen that should stand up.
 */
export const SHADOW = {
  flat: "0 1px 3px rgba(36,24,15,.08)",
  group: "0 1px 2px rgba(36,24,15,.04)",
  hero: "0 8px 28px rgba(36,24,15,.09), 0 1px 2px rgba(36,24,15,.05)",
  offer: "0 10px 30px rgba(36,24,15,.10), 0 1px 2px rgba(36,24,15,.05)",
  action: "0 6px 18px rgba(232,122,70,.28)",
  sheet: "0 -12px 40px rgba(36,24,15,.22)",
} as const;

/* ---- icons: inline paths, ~2px stroke, round caps ------------------------ */
export const BackArrow = () => (
  <svg width="18" height="15" viewBox="0 0 18 15" fill="none" aria-hidden>
    <path d="M7.5 1.5 1.5 7.5l6 6M1.5 7.5H17" stroke={C.ink} strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ChevronRight = ({ colour = C.chevron }: { colour?: string }) => (
  <svg width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden>
    <path d="M1.5 1.5 7 7.5l-5.5 6" stroke={colour} strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 44x44, radius 11, white, flat shadow. The handoff's shared icon button. */
/**
 * A landing page's two lines, under its bar of icon buttons: what to do now,
 * and -- only when something can go wrong -- what to check first. The same
 * 28/800 and 15/400 as every sub-screen's title and subtitle, so a home reads
 * like any other screen, just without a back button. Dynamic by design: the
 * caller passes whatever the screen's state makes true.
 */
export function HomeTitle({ title, line }: { title: string; line?: string | null }) {
  return (
    <div className="px-5 pb-[14px] pt-[2px]">
      <h1 className="text-[28px] font-extrabold leading-[1.1]" style={{ letterSpacing: "-1px" }}>
        {title}
      </h1>
      {line && (
        <p className="mt-1 text-[15px] font-normal" style={{ color: C.text2, textWrap: "pretty" }}>
          {line}
        </p>
      )}
    </div>
  );
}

export function IconButton({
  label, onClick, href, children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
}) {
  const cls =
    "press-scale flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] p-0 " +
    "transition-transform duration-[110ms] hover:bg-[#f4f3f0] active:scale-[.985] active:bg-[#e9e8e4]";
  const style = { background: C.surface, boxShadow: SHADOW.flat };

  return href ? (
    <Link href={href} aria-label={label} className={cls} style={style}>{children}</Link>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}

/**
 * A sub-screen: the ground, the back button, the 28/800 title, and an optional
 * subtitle indented 72px so it clears the button rather than wrapping under it.
 */
export function SoftScreen({
  title, back, subtitle, action, children,
}: {
  title: string;
  /** Omitted where there is nowhere to go back TO -- the screen a recovery
   *  link lands on was not opened from anywhere in this app. */
  back?: string;
  subtitle?: ReactNode;
  /** The trailing corner of the title row -- the day screen's +. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main
      data-soft-screen={title}
      className="mx-auto min-h-[844px] w-full max-w-[390px] pb-[40px]"
      style={{
        background: C.ground,
        color: C.ink,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div className={`flex items-center gap-3 px-4 pt-[14px] ${subtitle ? "pb-[6px]" : "pb-3"}`}>
        {back && <IconButton label="Tillbaka" href={back}><BackArrow /></IconButton>}
        {/* An empty title draws no heading: an end state's SoftDone carries
            the page's heading itself, centred, rather than saying it twice. */}
        {title && (
          <h1 className="min-w-0 flex-1 text-[28px] font-extrabold leading-[1.1]" style={{ letterSpacing: "-1px" }}>
            {title}
          </h1>
        )}
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>

      {subtitle && (
        <p
          className={`pb-[10px] pr-4 text-[15px] font-normal ${back ? "pl-[72px]" : "pl-4"}`}
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          {subtitle}
        </p>
      )}

      {children}
    </main>
  );
}

/** A white card, flat on the ground. Radius 16; 20 for a hero. */
export function Card({
  children, radius = 16, pad = "p-[18px] pb-5", shadow = SHADOW.group, className = "",
}: {
  children: ReactNode;
  radius?: number;
  pad?: string;
  shadow?: string;
  className?: string;
}) {
  return (
    <div
      className={`${pad} ${className}`}
      style={{ background: C.surface, borderRadius: radius, boxShadow: shadow }}
    >
      {children}
    </div>
  );
}

/** 12/700/+1 uppercase, OUTSIDE its card, 10px above it. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-1 pb-[10px] text-[12px] font-bold uppercase"
      style={{ letterSpacing: "1px", color: C.text2 }}
    >
      {children}
    </div>
  );
}

/**
 * The empty state: NO BOX. A plain sentence, left-aligned, then one grey line,
 * then -- when there is one -- the thing to do about it. An empty list is a
 * moment to say what happens next, not a grey slab saying "nothing".
 */
export function EmptyState({
  headline, children, action,
}: {
  headline?: string;
  children: ReactNode;
  /** The next step, drawn directly under the line. */
  action?: ReactNode;
}) {
  return (
    <div className="px-1 py-[10px]">
      {headline && (
        <div className="mb-1 text-[20px] font-semibold leading-[1.25]" style={{ letterSpacing: "-.4px", textWrap: "pretty" }}>
          {headline}
        </div>
      )}
      <div
        className={headline ? "text-[15px] font-normal" : "text-[17px] font-medium leading-[1.35]"}
        style={{ color: headline ? C.text2 : C.ink, textWrap: "pretty" }}
      >
        {children}
      </div>
      {action && <div className="pt-[14px]">{action}</div>}
    </div>
  );
}

/**
 * The GO Club number: huge, heavy, ink, with a small grey label under it.
 * Hours, counts, platser -- any figure a screen exists to show. Ink rather
 * than accent: the size already says "this is the point", and accent stays
 * for the one action.
 */
export function BigNumber({
  value, unit, label, align = "left",
}: {
  value: ReactNode;
  /** "h", "st" -- set smaller beside the figure, so the number stays the number. */
  unit?: string;
  label?: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <div className={align === "right" ? "text-right" : align === "center" ? "text-center" : ""}>
      <div className="text-[34px] font-extrabold leading-none" style={{ letterSpacing: "-1.4px", color: C.ink }}>
        {value}
        {unit && <span className="ml-[3px] text-[18px] font-bold" style={{ letterSpacing: "-.3px" }}>{unit}</span>}
      </div>
      {label && (
        <div className="mt-[6px] text-[13px] font-medium" style={{ color: C.text2 }}>
          {label}
        </div>
      )}
    </div>
  );
}

/**
 * The shape of a month: what a Monday-first grid needs to draw one.
 *
 * Exported because both calendars compute it and a leading-blank count that
 * disagrees between two grids puts the same date under two different weekdays.
 */
export function monthShape(month: string) {
  const first = `${month}-01`;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  return {
    first,
    daysInMonth,
    // Monday-based, matching the ISO week the priority list counts in.
    leadingBlanks: (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7,
  };
}

/**
 * The card every month grid is drawn in: the pager, the month over its year,
 * and the weekday letters. The grid itself is the caller's, because the two
 * calendars in this app disagree about everything below this line -- cell
 * height, gap, what a cell contains, and whether it can be painted.
 *
 * ONE COPY OF THE CHROME. The shift calendar and the day picker are different
 * screens that must look like the same object; two pagers drifting a pixel
 * apart is the kind of thing nobody sees in review and everybody feels in use.
 */
export function MonthCard({
  month, onMonthChange, gap = 3, children,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  /** 3px on the shift calendar, 2px on the picker -- the handoff's own two. */
  gap?: 2 | 3;
  children: ReactNode;
}) {
  const { first, daysInMonth } = monthShape(month);
  const monthName = new Intl.DateTimeFormat("sv-SE", { month: "long" })
    .format(new Date(`${first}T12:00:00Z`));

  const pager = (label: string, to: string, d: string) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => onMonthChange(to)}
      className="press-scale flex h-10 w-10 items-center justify-center rounded-[11px] p-0 transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985]"
      style={{ background: C.panel2 }}
    >
      <svg width="8" height="14" viewBox="0 0 9 15" fill="none" aria-hidden>
        <path d={d} stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  // Day-of-month arithmetic without importing lib/dates: soft.tsx is the
  // design layer and has no other reason to know about the calendar.
  const shift = (days: number) =>
    new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1 + days, 12))
      .toISOString().slice(0, 7);

  return (
    <Card radius={16} pad="px-[14px] pb-[18px] pt-4">
      <div className="mb-4 flex items-center justify-between">
        {pager("Föregående månad", shift(-1), "M7.5 1.5 2 7.5l5.5 6")}
        <div className="text-center">
          <div className="text-[19px] font-extrabold capitalize" style={{ letterSpacing: "-.5px" }}>
            {monthName}
          </div>
          <div className="text-[12px] font-bold" style={{ letterSpacing: "1px", color: C.text2 }}>
            {month.slice(0, 4)}
          </div>
        </div>
        {pager("Nästa månad", shift(daysInMonth), "M1.5 1.5 7 7.5l-5.5 6")}
      </div>

      {/* The weekend a step lighter in weight -- the handoff's only mark that
          Saturday and Sunday are different from the rest. */}
      <div className={`mb-[6px] grid grid-cols-7 ${gap === 2 ? "gap-[2px]" : "gap-[3px]"}`}>
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

      {children}
    </Card>
  );
}

/**
 * A 4px-padded #f1f0ed track; the active option is a white thumb, radius 9.
 *
 * TWO DENSITIES, chosen by how many options there are rather than by a prop.
 * A third thumb takes a 360px phone's share of the track from ~150px to ~104px,
 * and "Tillgänglighet" at 15px does not fit that -- it wraps to two lines and
 * spills out of the 44px height. So three or more drop to 13px and lose their
 * horizontal padding, which is enough for the longest label this app has. It
 * is not a prop because the caller cannot see the width it is being drawn at,
 * and a switch that fits on one screen and breaks on the next is worse than
 * one size the component picks for itself.
 */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const tight = options.length > 2;

  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 rounded-[13px] p-1"
      style={{ background: C.panel }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-current={on ? "page" : undefined}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex h-11 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[9px] ${
              tight ? "px-[2px] text-[13px]" : "text-[15px]"
            } ${on ? "font-bold" : "font-semibold"}`}
            style={{
              letterSpacing: tight ? "-.2px" : "-.1px",
              background: on ? C.surface : "transparent",
              color: on ? C.ink : C.text2,
              boxShadow: on ? "0 1px 3px rgba(36,24,15,.10)" : undefined,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A field: 12/700 uppercase label over a 52px white input, radius 14, a 1px
 * #e4e3df border that turns accent on focus -- Ro's field, in the handoff's inks. `big` is the hours variant -- 60px at 26/800,
 * because on a confirmation screen the hours are the biggest thing in the card.
 */
export function SoftField({
  label, help, big = false, children,
}: {
  label: string;
  help?: string;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {/* 2px under the label when a help line follows it, 6px when none does.
          The label and its help are one block with one gap beneath -- 6px
          twice would open a hole between a field's name and its explanation
          the same size as the one before the input. */}
      <span
        className={`block text-[12px] font-bold uppercase ${help ? "mb-[2px]" : "mb-[6px]"}`}
        style={{ letterSpacing: ".9px", color: C.text2 }}
      >
        {label}
      </span>
      {help && (
        <span className="mb-[6px] block text-[14px] font-medium" style={{ color: C.text2 }}>
          {help}
        </span>
      )}
      <span className={big ? "block [&>input]:h-[60px] [&>input]:text-[26px] [&>input]:font-extrabold" : "block"}>
        {children}
      </span>
    </label>
  );
}

/**
 * The input itself, so every field on every screen is the same object.
 *
 * A native date or time control is the one input that will not obey the box it
 * is handed. iOS Safari draws it at the intrinsic width of its own value and
 * lets that run past a narrower parent -- which is how the Snabb Pass card
 * broke on a phone: the two time fields painted over the 10px between them and
 * out through the card's right edge, and the date beside them did the same.
 * `appearance: none` is not enough on its own, because the width it hands back
 * is still the one the control's own shadow tree asked for.
 *
 * SO THE BOX IS NO LONGER THE INPUT'S TO DECIDE. A picker gets a wrapper that
 * owns the fill, the radius, the 52px and the focus ring, and clips whatever
 * the control draws inside it. A control that ignores the width it was given
 * can then only be cropped -- it cannot move anything else on the screen. The
 * ring moves to the wrapper with it (`focus-within`), carrying the same
 * declarations the input would have had, because an outline on a clipped child
 * is a clipped outline.
 *
 * Every other input still is its own box: nothing else on these screens is
 * drawn by the browser rather than by us.
 */
export function SoftInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", style, ...rest } = props;
  const picker = rest.type === "date" || rest.type === "time" || rest.type === "datetime-local";

  if (picker) {
    return (
      <span
        className="flex h-[52px] w-full min-w-0 overflow-hidden rounded-[14px] border border-[#e4e3df] outline-none focus-within:border-[#b64e10] focus-within:outline-1 focus-within:outline-[#b64e10]"
        style={{ background: C.surface }}
      >
        <input
          {...rest}
          className={`h-full w-full min-w-0 border-0 bg-transparent px-[14px] text-[16px] font-medium outline-none ${className}`}
          style={{
            color: C.ink,
            WebkitAppearance: "none",
            appearance: "none",
            display: "block",
            ...style,
          }}
        />
      </span>
    );
  }

  return (
    <input
      {...rest}
      className={`h-[52px] w-full min-w-0 rounded-[14px] border border-[#e4e3df] px-[14px] text-[16px] font-medium outline-none focus:border-[#b64e10] focus:outline-1 focus:outline-[#b64e10] ${className}`}
      style={{ background: C.surface, color: C.ink, ...style }}
    />
  );
}

/**
 * The multi-line variant of SoftInput, for the one field that is prose.
 *
 * Same fill, radius, focus ring and type as the input -- only the height
 * differs, and it is a minimum rather than the input's fixed 52 because a
 * description that has outgrown two lines should show what it says.
 */
export function SoftTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", style, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`min-h-[76px] w-full resize-y rounded-[14px] border border-[#e4e3df] p-[14px] text-[16px] font-medium leading-[1.45] outline-none focus:border-[#b64e10] focus:outline-1 focus:outline-[#b64e10] ${className}`}
      style={{ background: C.surface, color: C.ink, ...style }}
    />
  );
}

/**
 * A number chosen with − and +, never with a keyboard (owner's brief, 2026-10-05).
 *
 * ONE BORDERED CONTROL, [ − | value | + ], 52px -- Komponentspråk panel 03.
 *
 * THE VALUE IS STILL AN <input>, a string in the page's own format ("8,5"),
 * so the page keeps the state it already had and every walkthrough that types
 * a figure with fill() still can. inputMode="none" is what keeps a phone's
 * keyboard down: the figure is chosen with the buttons, and typing remains
 * possible on a computer.
 *
 * HOURS STAY A HUMAN NUMBER (invariant 1). The stepper starts from whatever
 * the page prefilled and only ever moves when somebody presses it; a quarter
 * step covers the figures stamped days really produce (8,25, 7,75). A figure
 * off the grid -- 8,2 -- is kept as it is and the next press lands on a quarter.
 */
export function Stepper({
  value, onChange, step = 1, min = 0, max = 99, unit, label, testId,
}: {
  /** "8,5" or "8.5" or "" -- what the page holds. */
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Shown after the figure: "h". */
  unit?: string;
  /** The accessible name, e.g. "Timmar". */
  label: string;
  testId?: string;
}) {
  const n = Number(value.replace(",", "."));
  const current = Number.isFinite(n) && value.trim() !== "" ? n : null;
  const fmt = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  const move = (dir: 1 | -1) => {
    const base = current ?? (dir > 0 ? min - step : min + step);
    // From an off-grid figure the first press snaps to the grid in that direction.
    const snapped = dir > 0 ? Math.floor(base / step + 1e-9) * step + step : Math.ceil(base / step - 1e-9) * step - step;
    onChange(fmt(Math.min(max, Math.max(min, snapped))));
  };
  const btn = "flex h-full w-[52px] shrink-0 items-center justify-center disabled:opacity-40";
  return (
    <span
      className="flex h-[52px] w-full min-w-0 items-center overflow-hidden rounded-[14px]"
      style={{ background: C.surface, border: `1px solid ${C.border}` }}
    >
      <button type="button" aria-label={`Minska ${label.toLowerCase()}`} className={btn}
        disabled={current !== null && current <= min} onClick={() => move(-1)}>
        <svg width="14" height="2" viewBox="0 0 14 2" aria-hidden><path d="M1 1h12" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      <span className="h-full w-px shrink-0" style={{ background: C.border }} />
      <span className="flex min-w-0 flex-1 items-baseline justify-center gap-[4px]">
        <input
          aria-label={label}
          data-stepper={testId}
          inputMode="none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 border-0 bg-transparent text-center text-[18px] font-bold tabular-nums outline-none"
          style={{ color: C.ink, maxWidth: unit ? "4.2em" : undefined }}
        />
        {unit && <span className="shrink-0 text-[15px] font-semibold" style={{ color: C.text2 }}>{unit}</span>}
      </span>
      <span className="h-full w-px shrink-0" style={{ background: C.border }} />
      <button type="button" aria-label={`Öka ${label.toLowerCase()}`} className={btn}
        disabled={current !== null && current >= max} onClick={() => move(1)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1v12M1 7h12" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
    </span>
  );
}

/**
 * The prose field with a count under it, for "Vad vi gjorde" and its kin.
 *
 * A COUNT, NOT A LIMIT. Nothing in the database caps this text and the
 * Arbetsdagbok wraps and splits it across pages, so a "48 / 500" would invent
 * a rule. The count is there so a one-word answer looks as thin as it is.
 */
export function CountedTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const n = props.value.trim().length;
  return (
    <span className="block">
      <SoftTextarea {...props} />
      <span className="mt-[4px] block text-right text-[13px] font-medium tabular-nums" style={{ color: C.text2 }}>
        {n} tecken
      </span>
    </span>
  );
}

/**
 * A yes/no as a switch -- 51x31, accent when on. The label sits to its left
 * on the caller's row; the switch carries aria-checked and the same name.
 */
export function Switch({
  checked, onChange, label, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50"
      style={{ background: checked ? C.accent : C.border }}
    >
      <span
        aria-hidden
        className="absolute top-[2px] h-[27px] w-[27px] rounded-full transition-[left] duration-150"
        style={{ left: checked ? 22 : 2, background: C.surface, boxShadow: "0 1px 3px rgba(0,0,0,.18)" }}
      />
    </button>
  );
}

/**
 * The select, in the input's clothes.
 *
 * `appearance: none` because a native chrome-drawn arrow is the one thing on
 * these screens that would not be from the handoff, and the caret is drawn as
 * a background SVG instead -- data-encoded rather than fetched, since the CSP
 * on a static export has no host to allow.
 */
export function SoftSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", style, ...rest } = props;
  return (
    <select
      {...rest}
      className={`h-[52px] w-full min-w-0 cursor-pointer appearance-none rounded-[14px] border border-[#e4e3df] py-0 pl-[14px] pr-[38px] text-[16px] font-medium outline-none focus:border-[#b64e10] focus:outline-1 focus:outline-[#b64e10] ${className}`}
      style={{
        background: `${C.surface} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='8' viewBox='0 0 13 8' fill='none'%3E%3Cpath d='M1.5 1.5 6.5 6.5l5-5' stroke='%2389867f' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 14px center`,
        color: C.ink,
        ...style,
      }}
    />
  );
}

/**
 * The one control in the app that destroys something: 56px, #f1f0ed, #a0421d.
 *
 * NEVER THE LOUDEST BUTTON ON ITS SCREEN. It carries no shadow, unlike the primary
 * above it and it is a tint rather than a fill, because the handoff puts "Ta
 * bort projekt" below "Spara ändringar" and separated by 26px -- deletion is
 * reachable, not offered.
 */
export function DangerButton({
  children, onClick, disabled, full = true, solid = false, label,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * The accessible name. REQUIRED in practice for the square variant, which
   * holds an icon and no text -- "button" is not a thing anyone can act on.
   */
  label?: string;
  /** false for the 48px square icon variant on the Konton rows. */
  full?: boolean;
  /**
   * The stop pair, inverted: #a0421d filled, white label.
   *
   * A DEPARTURE FROM THE HANDOFF, which draws every destructive control as
   * #a0421d on #f1f0ed -- see its Redigera projekt screen and its Konton rows.
   * It is opt-in for that reason: the pale treatment stays the default, so the
   * delete icon on a Konton row and anything added later keep the drawn look,
   * and only the screens told to shout do.
   */
  solid?: boolean;
}) {
  // NOT A TINTED PILL any more (Komponentspråk panel 04): the default is the
  // rust word with no box, and the square icon variant is a bare grey icon --
  // the confirmation dialog behind it carries the weight, not the colour of a
  // button repeated down a list. `solid` keeps its filled rust for the
  // screens told to shout.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`press-scale flex items-center justify-center rounded-[12px] text-[17px] font-bold transition-transform duration-[110ms] active:scale-[.985] ${
        solid ? "hover:bg-[#86361a]" : "hover:bg-[#f4f3f0]"
      } ${full ? "h-14 w-full !rounded-full" : "h-12 w-12"}`}
      style={{
        letterSpacing: "-.2px",
        background: solid ? C.stopInk : "transparent",
        color: solid ? C.surface : full ? C.stopInk : C.chevron,
        opacity: disabled ? 0.5 : undefined,
        cursor: disabled ? "not-allowed" : undefined,
      }}
    >
      {children}
    </button>
  );
}

/** The one primary action per screen: a 56px accent pill with its own shadow. */
export function PrimaryButton({
  children, onClick, disabled, type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="press-scale h-14 w-full rounded-full text-[17px] font-bold transition-[transform,background] duration-150 active:scale-[.985]"
      style={{
        letterSpacing: "-.2px",
        background: disabled ? C.hairline : C.accent,
        color: disabled ? C.chevron : C.onAccent,
        boxShadow: disabled ? undefined : SHADOW.action,
        cursor: disabled ? "not-allowed" : undefined,
      }}
    >
      {children}
    </button>
  );
}

/**
 * The second-rank action: a 54px white pill with a 1px border, ink label.
 * Not a pale fill -- a pale fill reads as a disabled button and competes
 * with the one primary on the screen.
 */
export function SecondaryButton({
  children, onClick, href, disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const cls =
    "press-scale flex h-[54px] w-full items-center justify-center rounded-full text-[17px] font-bold " +
    "transition-transform duration-[110ms] hover:bg-[#f4f3f0] active:scale-[.985]";
  const style = {
    letterSpacing: "-.2px",
    background: C.surface,
    border: `1px solid ${disabled ? C.hairline : C.border}`,
    color: disabled ? C.chevron : C.ink,
  };
  return href ? (
    <Link href={href} className={cls} style={style}>{children}</Link>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} style={style}>
      {children}
    </button>
  );
}

/**
 * A list, Ro's way: every row its own white tile, radius 16, 8px apart, no
 * dividers and no shadow -- the gap is the separator. White rather than
 * #f1f0ed, because #f1f0ed on the #f7f6f3 ground is a difference the eye cannot
 * find; white on it is the contrast Ro gets from grey on white.
 */
/** A row goes somewhere (href) or does something on this screen (onClick). */
export type GroupedRow = { label: string } & ({ href: string } | { onClick: () => void });

export function GroupedList({ rows }: { rows: GroupedRow[] }) {
  const cls = "flex h-[60px] w-full items-center justify-between rounded-[16px] px-[18px] text-left hover:bg-[#f4f3f0]";
  const face = (label: string) => (
    <>
      <span className="text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>{label}</span>
      <ChevronRight />
    </>
  );
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label}>
          {"href" in r ? (
            <Link href={r.href} className={cls} style={{ color: C.ink, background: C.surface }}>{face(r.label)}</Link>
          ) : (
            <button type="button" onClick={r.onClick} className={cls} style={{ color: C.ink, background: C.surface }}>
              {face(r.label)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A status word. Colour is never the only carrier -- it always has a word.
 *
 * NO BOX. It used to be a pill: the ink on a pale tint of itself, which is
 * the generic badge the Komponentspråk removes. Now it is the word in its
 * status ink, and a status that is live carries a dot in front of it. quiet
 * and deep (roles, history) are plain grey -- a role is a property of a
 * person, not a status.
 */
export function Tag({
  tone, children,
}: {
  tone: "live" | "warn" | "stop" | "quiet" | "deep";
  children: ReactNode;
}) {
  const ink = {
    live: C.liveInk, warn: C.warnInk, stop: C.stopInk, quiet: C.text2, deep: C.text2,
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-[6px] whitespace-nowrap text-[13px] font-semibold"
      style={{ color: ink }}
    >
      {tone === "live" && (
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: ink }} />
      )}
      {children}
    </span>
  );
}

/**
 * A face, or the initials standing in for one.
 *
 * A ROUNDED SQUARE, not a circle. Nothing else in the handoff is round --
 * buttons are 10 to 12, cards 14 to 16, the icon button 11 -- and one circle
 * in an app built entirely from rounded rectangles reads as an import from
 * somewhere else. The radius is 30% of the edge, which is round enough to say
 * "person" at 44px and still belong to the same drawing.
 *
 * ALWAYS THE SAME BOX, picture or not. A row whose avatar collapses when
 * somebody has not uploaded one is a row that changes height down the list,
 * and a list that changes height is the thing this screen was redesigned to
 * stop being.
 *
 * aria-hidden and alt="": the name is always next to it. A screen reader that
 * says "Anna Karlsson, Anna Karlsson" is worse than one that says it once.
 */
export function Avatar({
  src, name, email, size = 44,
}: {
  src?: string | null;
  name: string | null;
  email?: string | null;
  size?: number;
}) {
  const radius = Math.round(size * 0.3);
  const letters = initials(name, email ?? null);

  return (
    <span
      aria-hidden
      className="flex shrink-0 select-none items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: C.panel2,
        boxShadow: `inset 0 0 0 1px ${C.hairline}`,
      }}
    >
      {src ? (
        // A signed URL from a private bucket cannot go through next/image:
        // there is no server in a static export to do the optimising
        // (CLAUDE.md). The browser has already downscaled it to 512px before
        // upload, which is what the optimiser would have been for.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: "cover", display: "block" }}
        />
      ) : (
        <span
          className="font-extrabold"
          style={{
            color: C.inkHover,
            fontSize: Math.round(size * 0.36),
            letterSpacing: size > 56 ? "-.5px" : "-.2px",
          }}
        >
          {letters}
        </span>
      )}
    </span>
  );
}

/**
 * A notice. COLOUR LIVES IN THE ICON, NOT IN THE BOX.
 *
 * It used to be a block filled with the signal's pale tint and set in the
 * signal's ink -- pink behind red, pale green behind green -- which is the
 * look of a stock alert component and made every refusal shout the same way.
 * Now a refusal, a warning or a success is a white card with the flat shadow,
 * a small filled icon carrying the colour, and ink text; a quiet note has no
 * container at all, just an accent "i" and a grey line. Every tone still
 * pairs its colour with a shape and words (handoff §4).
 *
 * The handoff does not draw error states, so these are its signal colours
 * applied to one mark each.
 */
function NoticeMark({ tone }: { tone: "live" | "warn" | "stop" | "quiet" }) {
  const fill = { live: C.liveInk, warn: C.warnInk, stop: C.stopInk, quiet: C.accentInk }[tone];
  return (
    <span
      aria-hidden
      className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{ background: fill }}
    >
      {tone === "live" ? (
        <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
          <path d="M1 4.6 4 7.6 10 1.4" stroke={C.surface} strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : tone === "quiet" ? (
        <svg width="4" height="11" viewBox="0 0 4 11" fill="none">
          <circle cx="2" cy="1.6" r="1.4" fill={C.surface} />
          <path d="M2 4.8v5" stroke={C.surface} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="4" height="11" viewBox="0 0 4 11" fill="none">
          <path d="M2 1.2v5" stroke={C.surface} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="2" cy="9.4" r="1.4" fill={C.surface} />
        </svg>
      )}
    </span>
  );
}

export function SoftNotice({
  tone, headline, children,
}: {
  tone: "live" | "warn" | "stop" | "quiet";
  /** 16/700 above the body. The handoff draws one: "Dagen kördes utan
   *  arbetsledare." on Granska pass, where the notice is the reason the screen
   *  exists rather than an aside on it. */
  headline?: string;
  children: ReactNode;
}) {
  // A quiet note is a line of information, not an event: no card to frame it.
  if (tone === "quiet") {
    return (
      <div
        role="status"
        className="flex items-start gap-[10px] px-1 text-[15px] font-medium"
        style={{ color: C.text2, textWrap: "pretty" }}
      >
        <NoticeMark tone="quiet" />
        <div className="min-w-0">
          {headline && (
            <div className="mb-[2px] text-[16px] font-bold" style={{ color: C.ink, letterSpacing: "-.2px" }}>
              {headline}
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      role={tone === "stop" ? "alert" : "status"}
      className="flex items-start gap-3 rounded-[12px] px-4 py-[14px] text-[15px] font-medium"
      style={{ color: C.ink, background: C.surface, boxShadow: SHADOW.flat, textWrap: "pretty" }}
    >
      <NoticeMark tone={tone} />
      <div className="min-w-0">
        {headline && (
          <div className="mb-[2px] text-[16px] font-bold" style={{ letterSpacing: "-.2px" }}>
            {headline}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Logga ut. ONE PLACE SIGNS OUT, whatever the screen around it looks like.
 *
 * It lived in ui.tsx behind a `soft` flag while the app was migrating; the flag
 * retired with the last black-and-white screen and the button came here. In the
 * stop ink on white rather than a stop-tint fill: it ends a session, it does
 * not destroy anything, and the sheet it sits in is already quiet.
 */
/**
 * `quiet` inside a sheet: a text button on the sheet's ground rather than a
 * third white slab. The sheet's rows are where the thumb is going; signing out
 * is available, not suggested. Without it -- the paused-account screen, where
 * it is the only thing there is to do -- it keeps the full card.
 */
export function SignOut({ quiet = false }: { quiet?: boolean } = {}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        const { getSupabase } = await import("@/lib/supabase/client");
        // BEFORE the session goes. forget_push_token() deletes the caller's
        // own row, so once signOut() has run there is no auth.uid() left to
        // scope the delete to and the handset would keep its registration.
        // A no-op in a browser, and it never throws -- a sign-out that failed
        // because a token could not be filed away would strand somebody
        // signed in.
        const { forgetToken } = await import("@/lib/push");
        await forgetToken();
        await getSupabase().auth.signOut();
        router.replace("/login");
      }}
      className={
        quiet
          ? "press-scale mt-2 flex h-12 w-full items-center justify-center rounded-full text-[16px] font-bold transition-transform duration-[110ms] hover:bg-[#f1f0ed] active:scale-[.985]"
          : "press-scale mt-3 flex h-14 w-full items-center justify-center rounded-full text-[17px] font-bold transition-transform duration-[110ms] hover:bg-[#f4f3f0] active:scale-[.985]"
      }
      style={
        quiet
          ? { letterSpacing: "-.2px", color: C.stopInk }
          : { letterSpacing: "-.2px", background: C.surface, color: C.stopInk, boxShadow: SHADOW.group }
      }
    >
      Logga ut
    </button>
  );
}

/**
 * An end state: the thing is done, and the screen says so and little else.
 * A filled check circle, the result as the page's heading, and at most one
 * line -- no box around it. Pair with SoftScreen title="" so the heading is
 * not said twice.
 */
export function SoftDone({ title, line }: { title: string; line?: ReactNode }) {
  return (
    <div role="status" className="px-6 pb-[6px] pt-[18px] text-center">
      <span
        aria-hidden
        className="mx-auto mb-[14px] flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: C.liveInk }}
      >
        <svg width="24" height="19" viewBox="0 0 11 9" fill="none">
          <path d="M1 4.6 4 7.6 10 1.4" stroke={C.surface} strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h1 className="text-[28px] font-extrabold leading-[1.1]" style={{ letterSpacing: "-1px" }}>{title}</h1>
      {line && (
        <p className="mx-auto mt-[6px] max-w-[320px] text-[15px] font-normal" style={{ color: C.text2, textWrap: "pretty" }}>
          {line}
        </p>
      )}
    </div>
  );
}

/**
 * A plain confirmation that an action worked -- "Sparat.", "Bilden är sparad."
 * -- dropped in under the top of the screen and gone again after four seconds.
 *
 * ONLY FOR THE PLAIN ONES. A note that tells the reader a consequence ("Kontot
 * är pausat. Pass som inte har börjat är frisläppta …") stays inline as a
 * SoftNotice, because a sentence that fades cannot be read twice. role=status,
 * so a screen reader hears it without the focus moving.
 */
export function SoftToast({ message, onDone }: { message: string | null; onDone: () => void }) {
  // The latest onDone without restarting the timer every render.
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => done.current(), 4000);
    return () => clearTimeout(t);
  }, [message]);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-slidedown fixed inset-x-0 top-3 z-[60] mx-auto w-[calc(100%-32px)] max-w-[358px]"
    >
      <div
        className="flex items-center gap-3 rounded-[14px] px-4 py-[14px] text-[15px] font-semibold"
        style={{ background: C.surface, color: C.ink, boxShadow: SHADOW.group, fontFamily: "var(--font-inter), system-ui, sans-serif" }}
      >
        <NoticeMark tone="live" />
        {message}
      </div>
    </div>
  );
}

/**
 * A dialog over the scrim: the sheet's own rgba(36,24,15,.42), a hero-shadowed
 * card, and the app's font, since a fixed element is outside the screen that
 * set it.
 *
 * The handoff draws no dialog anywhere -- it designs the happy path in a
 * straight line. So this is its language applied to the thing the app actually
 * needs: five screens ask a question over the page they are on, and five
 * hand-rolled scrims is five chances for one of them to be a different grey.
 */
export function SoftDialog({
  label, onDismiss, children,
}: {
  label: string;
  /** Escape closes when given. The scrim does not: these dialogs sit in front
   *  of decisions -- who covers a day, whether to book unconfirmed hours -- and
   *  a stray tap outside is not an answer to any of them. */
  onDismiss?: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!onDismiss) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(36,24,15,.42)" }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* CAPPED AT THE VIEWPORT, 16px clear on every side, and the content
          scrolls inside it. The scrim used to scroll instead, so a long list
          -- Avboka Pass on an arbetsledare, every candidate who could cover --
          carried the card's own edge and its buttons off the bottom of a
          phone (UI audit). */}
      <div
        className="w-full max-w-[358px] overflow-y-auto overscroll-contain rounded-[20px] p-5"
        style={{
          maxHeight: "calc(100dvh - 32px)",
          background: C.surface,
          boxShadow: SHADOW.hero,
          color: C.ink,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Things to pick between, as separate white tiles 8px apart -- 60px, a
 * chevron, no dividers. The same object as GroupedList, except these do something here
 * rather than going somewhere, so they are buttons and carry an onClick.
 */
export function ChoiceList({
  choices, disabled,
}: {
  choices: { key: string; label: ReactNode; sub?: ReactNode; onClick: () => void }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {choices.map((c) => (
        <div key={c.key}>
          <button
            type="button"
            onClick={c.onClick}
            disabled={disabled}
            style={{ background: C.surface }}
            className={`flex w-full rounded-[16px] items-center justify-between gap-3 px-[18px] text-left hover:bg-[#f4f3f0] disabled:opacity-40 ${
              c.sub ? "py-[13px]" : "h-[60px]"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
                {c.label}
              </span>
              {c.sub && (
                <span className="block text-[15px] font-normal" style={{ color: C.text2 }}>
                  {c.sub}
                </span>
              )}
            </span>
            <ChevronRight />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * The handoff's bottom sheet, which is what a menu is in this design.
 *
 * From the BOTTOM rather than the top, unlike the DropPanel it replaced: the
 * sheet is where a thumb already is, and the handoff draws the home behind it
 * blurred and dimmed rather than merely darkened, so the page it covers is
 * still legible as the place you will come back to.
 *
 * All three landing pages open this one. The panel from the top went with the
 * admin's screens, which were the last role still wearing it.
 *
 * Tapping the scrim closes it, so does Escape, and so does the Stäng button --
 * three ways out, because a sheet with no visible exit is the thing people get
 * stuck in.
 */
export function SoftSheet({
  onClose, label, children,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);

  // The flip happens on the frame AFTER mount, which is what gives the
  // transform a value to move from; a single render would jump.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(id); window.removeEventListener("keydown", esc); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Stäng"
        onClick={onClose}
        className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        style={{ background: "rgba(36,24,15,.42)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`absolute inset-x-0 bottom-0 mx-auto w-full max-w-[390px] px-4 pb-[22px] pt-[10px] transition-transform duration-200 ${
          shown ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          background: C.ground,
          color: C.ink,
          borderRadius: "20px 20px 0 0",
          boxShadow: SHADOW.sheet,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        }}
      >
        <div
          className="mx-auto mb-[14px] h-1 w-[38px] rounded-full"
          style={{ background: "#e9e8e4" }}
        />
        {children}
        <button
          type="button"
          onClick={onClose}
          className="press-scale mt-2 h-12 w-full rounded-full text-[16px] font-bold transition-transform duration-[110ms] hover:bg-[#e9e8e4] active:scale-[.985]"
          style={{ letterSpacing: "-.2px", background: C.surface, border: `1px solid ${C.border}`, color: C.inkHover }}
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
