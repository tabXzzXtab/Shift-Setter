"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The handoff's design language, as components.
 *
 * ONE PLACE FOR THE VALUES. The bundle is marked high fidelity across
 * twenty-four screens, which means the same hex appears dozens of times and a
 * single wrong one is invisible in review. Everything below is the handoff's
 * own numbers; screens compose these rather than restating them.
 *
 * WHY A SECOND SET rather than restyling components/ui.tsx in place: ui.tsx is
 * shared by every screen in the app, so changing it would redesign all three
 * roles at once and leave every un-migrated screen half-converted. These live
 * alongside it while the roles are migrated one at a time, and ui.tsx retires
 * when the last screen has moved.
 *
 * Inter is applied HERE rather than on <body> for the same reason: a screen
 * gets the font when it gets the design, not before.
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
  back: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
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
        <IconButton label="Tillbaka" href={back}><BackArrow /></IconButton>
        <h1 className="text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
          {title}
        </h1>
      </div>

      {subtitle && (
        <p
          className="pb-1 pl-[72px] pr-4 text-[15px] font-medium"
          style={{ color: C.text2, textWrap: "pretty" }}
        >
          {subtitle}
        </p>
      )}

      {children}
    </div>
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
      <span
        className="mb-[6px] block text-[12px] font-bold uppercase"
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
      className={`h-[52px] w-full rounded-[10px] border-0 px-[14px] text-[16px] font-semibold outline-none focus:bg-white focus:outline-2 focus:outline-[#1b2cc1] ${className}`}
      style={{ background: C.panel2, color: C.ink, ...style }}
    />
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
export function Tag({ tone, children }: { tone: "live" | "warn" | "stop" | "quiet"; children: ReactNode }) {
  const pair = {
    live: [C.liveInk, C.liveBg],
    warn: [C.warnInk, C.warnBg],
    stop: [C.stopInk, C.stopBg],
    quiet: [C.inkHover, C.panel2],
  }[tone];
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-[10px] py-[5px] text-[12px] font-bold"
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
  tone, children,
}: {
  tone: "live" | "warn" | "stop" | "quiet";
  children: ReactNode;
}) {
  const pair = {
    live: [C.liveInk, C.liveBg],
    warn: [C.warnInk, C.warnBg],
    stop: [C.stopInk, C.stopBg],
    quiet: [C.text2, C.panel],
  }[tone];
  return (
    <div
      role={tone === "stop" ? "alert" : "status"}
      className="rounded-[14px] p-[18px] text-[15px] font-medium"
      style={{ color: pair[0], background: pair[1] }}
    >
      {children}
    </div>
  );
}
