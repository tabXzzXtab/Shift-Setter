"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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

/* ---- colour, straight from the handoff's table --------------------------- */
export const C = {
  ink: "#091540",
  inkHover: "#12206b",
  accent: "#1b2cc1",
  text2: "#4a5578",
  chevron: "#8b98c4",
  ground: "#f3f6fd",
  surface: "#ffffff",
  panel: "#e7edfb",
  panel2: "#eef3fe",
  rowHover: "#f6f9ff",
  hairline: "#e3eafb",
  liveInk: "#146b41",
  liveBg: "#e4f0e8",
  warnInk: "#7a4407",
  /** The warn pair has two inks. Tags use the darker one; the handoff's own
   *  tag() helper and its Arbetsledare role tag are both #5c3305. */
  tagWarnInk: "#5c3305",
  warnBg: "#fdf2e3",
  stopInk: "#8e1d15",
  stopBg: "#fbe9ec",
} as const;

export const SHADOW = {
  flat: "0 1px 3px rgba(9,21,64,.08)",
  group: "0 4px 18px rgba(9,21,64,.07), 0 1px 2px rgba(9,21,64,.04)",
  hero: "0 8px 28px rgba(9,21,64,.09), 0 1px 2px rgba(9,21,64,.05)",
  offer: "0 10px 30px rgba(9,21,64,.10), 0 1px 2px rgba(9,21,64,.05)",
  action: "0 6px 18px rgba(27,44,193,.28)",
  sheet: "0 -12px 40px rgba(9,21,64,.22)",
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
    "transition-transform duration-[110ms] hover:bg-[#f0f5ff] active:scale-[.985] active:bg-[#dbe4f9]";
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
 * A sub-screen: the ground, the back button, the 22/800 title, and an optional
 * subtitle indented 72px so it clears the button rather than wrapping under it.
 */
export function SoftScreen({
  title, back, subtitle, children,
}: {
  title: string;
  /** Omitted where there is nowhere to go back TO -- the screen a recovery
   *  link lands on was not opened from anywhere in this app. */
  back?: string;
  subtitle?: ReactNode;
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
        <h1 className="text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
          {title}
        </h1>
      </div>

      {subtitle && (
        <p
          className={`pb-1 pr-4 text-[15px] font-medium ${back ? "pl-[72px]" : "pl-4"}`}
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          {subtitle}
        </p>
      )}

      {children}
    </main>
  );
}

/** A white card. radius 16 for forms and heroes, 14 for grouped lists. */
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
 * The empty state: #e7edfb, radius 14, centred. A headline plus a line when
 * there is something to explain, one line when there is not.
 */
export function EmptyState({ headline, children }: { headline?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-[14px] text-center ${headline ? "px-[22px] py-[34px]" : "p-[22px]"}`}
      style={{ background: C.panel }}
    >
      {headline && (
        <div className="mb-1 text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
          {headline}
        </div>
      )}
      <div className="text-[15px] font-medium" style={{ color: C.text2 }}>{children}</div>
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
      className="press-scale flex h-10 w-10 items-center justify-center rounded-[11px] p-0 transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
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

/** A 4px-padded #e7edfb track; the active option is a white thumb, radius 9. */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
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
            className={`flex h-11 flex-1 items-center justify-center rounded-[9px] text-[15px] ${
              on ? "font-bold" : "font-semibold"
            }`}
            style={{
              letterSpacing: "-.1px",
              background: on ? C.surface : "transparent",
              color: on ? C.ink : C.text2,
              boxShadow: on ? "0 1px 3px rgba(9,21,64,.10)" : undefined,
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
 * A field: 12/700 uppercase label over a 52px #eef3fe input, radius 10, no
 * border, accent focus ring. `big` is the hours variant -- 60px at 26/800,
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

/** The input itself, so every field on every screen is the same object. */
export function SoftInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", style, ...rest } = props;
  return (
    <input
      {...rest}
      className={`h-[52px] w-full min-w-0 rounded-[10px] border-0 px-[14px] text-[16px] font-semibold outline-none focus:bg-white focus:outline-2 focus:outline-[#1b2cc1] ${className}`}
      style={{ background: C.panel2, color: C.ink, ...style }}
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
      className={`min-h-[76px] w-full resize-y rounded-[10px] border-0 p-[14px] text-[16px] font-medium leading-[1.45] outline-none focus:bg-white focus:outline-2 focus:outline-[#1b2cc1] ${className}`}
      style={{ background: C.panel2, color: C.ink, ...style }}
    />
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
      className={`h-[52px] w-full min-w-0 cursor-pointer appearance-none rounded-[10px] border-0 py-0 pl-[14px] pr-[38px] text-[16px] font-semibold outline-none focus:bg-white focus:outline-2 focus:outline-[#1b2cc1] ${className}`}
      style={{
        background: `${C.panel2} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='8' viewBox='0 0 13 8' fill='none'%3E%3Cpath d='M1.5 1.5 6.5 6.5l5-5' stroke='%238b98c4' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 14px center`,
        color: C.ink,
        ...style,
      }}
    />
  );
}

/**
 * The one control in the app that destroys something: 56px, #fbe9ec, #8e1d15.
 *
 * NEVER THE LOUDEST BUTTON ON ITS SCREEN. It is shorter than the 64px primary
 * above it and it is a tint rather than a fill, because the handoff puts "Ta
 * bort projekt" below "Spara ändringar" and separated by 26px -- deletion is
 * reachable, not offered.
 */
export function DangerButton({
  children, onClick, disabled, full = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** false for the 48px square icon variant on the Konton rows. */
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press-scale flex items-center justify-center rounded-[12px] text-[17px] font-bold transition-transform duration-[110ms] hover:bg-[#f6d8dd] active:scale-[.985] ${
        full ? "h-14 w-full" : "h-12 w-12 rounded-[10px]"
      }`}
      style={{
        letterSpacing: "-.2px",
        background: C.stopBg,
        color: C.stopInk,
        opacity: disabled ? 0.5 : undefined,
        cursor: disabled ? "not-allowed" : undefined,
      }}
    >
      {children}
    </button>
  );
}

/** The one primary action per screen: 64px, accent, its own shadow. */
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
      className="press-scale h-16 w-full rounded-[12px] text-[20px] font-extrabold transition-[transform,background] duration-150 active:scale-[.985]"
      style={{
        letterSpacing: "-.4px",
        background: disabled ? C.hairline : C.accent,
        color: disabled ? C.chevron : C.surface,
        boxShadow: disabled ? undefined : SHADOW.action,
        cursor: disabled ? "not-allowed" : undefined,
      }}
    >
      {children}
    </button>
  );
}

/** 60px, #eef3fe, ink label. The second-rank action. */
export function SecondaryButton({
  children, onClick, href, disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const cls =
    "press-scale flex h-[60px] w-full items-center justify-center rounded-[12px] text-[17px] font-bold " +
    "transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]";
  const style = {
    letterSpacing: "-.2px",
    background: disabled ? C.hairline : C.panel2,
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

/** A grouped list card: 60px rows, 17/700, chevron, divider inset 18. */
export function GroupedList({ rows }: { rows: { href: string; label: string }[] }) {
  return (
    <div
      className="overflow-hidden rounded-[14px]"
      style={{ background: C.surface, boxShadow: SHADOW.group }}
    >
      {rows.map((r, i) => (
        <div key={r.href}>
          {i > 0 && <div className="ml-[18px] h-px" style={{ background: C.hairline }} />}
          <Link
            href={r.href}
            className="flex h-[60px] items-center justify-between px-[18px] hover:bg-[#f6f9ff]"
            style={{ color: C.ink }}
          >
            <span className="text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
              {r.label}
            </span>
            <ChevronRight />
          </Link>
        </div>
      ))}
    </div>
  );
}

/** A status pill. Colour is never the only carrier -- it always has a word. */
export function Tag({
  tone, children,
}: {
  tone: "live" | "warn" | "stop" | "quiet" | "deep";
  children: ReactNode;
}) {
  const pair = {
    live: [C.liveInk, C.liveBg],
    warn: [C.tagWarnInk, C.warnBg],
    stop: [C.stopInk, C.stopBg],
    quiet: [C.inkHover, C.panel2],
    /** The handoff's Admin role tag: a step deeper than quiet, so the three
     *  roles are told apart by weight of fill rather than by hue. */
    deep: [C.inkHover, "#dbe4f9"],
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-full px-[10px] py-[5px] text-[12px] font-bold"
      style={{ letterSpacing: ".4px", color: pair[0], background: pair[1] }}
    >
      {children}
    </span>
  );
}

/**
 * A notice, in the design's language rather than the old black-and-white one.
 * The handoff does not draw error states, so these reuse its signal pairs.
 */
export function SoftNotice({
  tone, headline, children,
}: {
  tone: "live" | "warn" | "stop" | "quiet";
  /** 17/800 above the body. The handoff draws one: "Dagen kördes utan
   *  arbetsledare." on Granska pass, where the panel is the reason the screen
   *  exists rather than an aside on it. */
  headline?: string;
  children: ReactNode;
}) {
  const pair = {
    live: [C.liveInk, C.liveBg],
    warn: [C.warnInk, C.warnBg],
    stop: [C.stopInk, C.stopBg],
    /** The handoff's own inset notice -- "Bekräftat är slutgiltigt." It is
     *  #eef3fe rather than the empty state's #e7edfb, and 600 rather than 500,
     *  because it is a statement the screen is making, not a shrug. */
    quiet: [C.inkHover, C.panel2],
  }[tone];
  return (
    <div
      role={tone === "stop" ? "alert" : "status"}
      className={`rounded-[12px] px-4 py-[14px] text-[15px] ${
        tone === "quiet" ? "font-semibold" : "font-medium"
      }`}
      style={{ color: pair[0], background: pair[1], textWrap: "pretty" }}
    >
      {headline && (
        <div
          className="mb-[6px] text-[17px] font-extrabold"
          style={{ letterSpacing: "-.3px", color: tone === "warn" ? C.tagWarnInk : pair[0] }}
        >
          {headline}
        </div>
      )}
      {children}
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
export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        const { getSupabase } = await import("@/lib/supabase/client");
        await getSupabase().auth.signOut();
        router.replace("/login");
      }}
      className="press-scale mt-3 flex h-14 w-full items-center justify-center rounded-[12px] text-[17px] font-bold transition-transform duration-[110ms] hover:bg-[#f6f9ff] active:scale-[.985]"
      style={{ letterSpacing: "-.2px", background: C.surface, color: C.stopInk, boxShadow: SHADOW.group }}
    >
      Logga ut
    </button>
  );
}

/**
 * A dialog over the scrim: the sheet's own rgba(9,21,64,.42), a hero-shadowed
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
      className="fixed inset-0 z-50 overflow-y-auto p-4"
      style={{ background: "rgba(9,21,64,.42)" }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        className="mx-auto mt-[40px] w-full max-w-[358px] pb-[40px]"
        style={{
          color: C.ink,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Card radius={16} shadow={SHADOW.hero} pad="p-[18px]">{children}</Card>
      </div>
    </div>
  );
}

/**
 * A grouped card of things to pick between -- 60px rows, a chevron, dividers
 * inset 18px. The same object as GroupedList, except these do something here
 * rather than going somewhere, so they are buttons and carry an onClick.
 */
export function ChoiceList({
  choices, disabled,
}: {
  choices: { key: string; label: ReactNode; sub?: ReactNode; onClick: () => void }[];
  disabled?: boolean;
}) {
  return (
    <div
      className="overflow-hidden rounded-[14px]"
      style={{ background: C.surface, boxShadow: SHADOW.group }}
    >
      {choices.map((c, i) => (
        <div key={c.key}>
          {i > 0 && <div className="ml-[18px] h-px" style={{ background: C.hairline }} />}
          <button
            type="button"
            onClick={c.onClick}
            disabled={disabled}
            className={`flex w-full items-center justify-between gap-3 px-[18px] text-left hover:bg-[#f6f9ff] disabled:opacity-40 ${
              c.sub ? "py-[13px]" : "h-[60px]"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
                {c.label}
              </span>
              {c.sub && (
                <span className="block text-[15px] font-medium" style={{ color: C.text2 }}>
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
        style={{ background: "rgba(9,21,64,.42)" }}
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
          borderRadius: "22px 22px 0 0",
          boxShadow: SHADOW.sheet,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        }}
      >
        <div
          className="mx-auto mb-[14px] h-1 w-[38px] rounded-full"
          style={{ background: "#dbe4f9" }}
        />
        {children}
        <button
          type="button"
          onClick={onClose}
          className="press-scale mt-3 h-14 w-full rounded-[12px] text-[17px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
          style={{ letterSpacing: "-.2px", background: C.panel2, color: C.inkHover }}
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
