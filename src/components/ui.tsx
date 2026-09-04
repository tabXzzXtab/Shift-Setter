"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PlusIcon } from "./icons";

/**
 * Black and white. No styling before function.
 *
 * Mobile first: every control is at least 56px tall, which is above the 44px
 * minimum for a thumb and comfortably above it for a cold hand on a site. The
 * page is a single column capped at phone width and centred, so the desktop
 * view is the phone view with air around it -- never a wide layout squeezed
 * down, which is the failure the spec names.
 *
 * Affordances are literal: buttons look like buttons, inputs have visible
 * borders, one action per screen where the flow allows it.
 */

export function Screen({
  title,
  back,
  children,
}: {
  title: string;
  back?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-24 pt-4">
      <header className="mb-6 flex items-center gap-3">
        {back && (
          <Link
            href={back}
            aria-label="Tillbaka"
            className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-black text-2xl leading-none"
          >
            ←
          </Link>
        )}
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
      </header>
      {children}
    </main>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  disabled,
  variant = "solid",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  variant?: "solid" | "outline";
}) {
  const base =
    "flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-center text-lg font-bold disabled:opacity-30";
  const look = variant === "solid" ? "bg-black text-white" : "bg-white text-black";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

/**
 * The page a role lands on. Same shell as Screen, minus the title row --
 * a landing page wears the AppBar there instead.
 */
export function Landing({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-24 pt-4">{children}</main>
  );
}

/**
 * The three things an owner does that a list cannot show him, and their
 * equivalents for the other roles: a filled button carrying a + .
 *
 * Filled rather than outlined because these sit above a list and have to read
 * as actions rather than as its first rows.
 */
export function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] w-full items-center gap-3 border-2 border-black bg-black px-4 text-lg font-bold text-white"
    >
      <PlusIcon />
      <span>{children}</span>
    </Link>
  );
}

export function BigLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-[72px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold"
    >
      <span>{children}</span>
      <span aria-hidden className="text-2xl">→</span>
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-bold uppercase tracking-wide">{label}</span>
      {hint && <span className="mb-1 block text-sm text-neutral-600">{hint}</span>}
      {children}
    </label>
  );
}

/**
 * A labelled group of several controls.
 *
 * NOT a <label>: a label may only label one control, and wrapping several in
 * one makes the label's text part of the first control's accessible name --
 * so a button reading "Anna Arbetare" announces itself as "Vilka jobbar? (0/1)
 * Anna Arbetare" to a screen reader. fieldset/legend is the element for this.
 */
export function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="mb-4 block border-0 p-0">
      <legend className="mb-1 block text-sm font-bold uppercase tracking-wide">{label}</legend>
      {hint && <span className="mb-1 block text-sm text-neutral-600">{hint}</span>}
      {children}
    </fieldset>
  );
}

const inputClass =
  "block w-full min-h-[56px] border-2 border-black bg-white px-3 text-lg text-black " +
  "placeholder:text-black/25 outline-none focus:ring-4 focus:ring-black/20";

/**
 * `center` is for the small numeric boxes that sit beside a time field -- the
 * hours in a template row. A bare input leaves its value on the left and
 * riding low in a 56px box, which reads as adrift next to 07:00 and 16:00.
 *
 * The line-height is the content box exactly (56px tall, less the 2px borders),
 * so the single line is centred vertically by construction rather than by
 * whatever the browser's default happens to be -- Chrome, Safari and Firefox
 * do not agree on that.
 */
export function Input({
  center,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { center?: boolean }) {
  return (
    <input
      {...props}
      className={`${inputClass}${center ? " text-center leading-[52px]" : ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} min-h-[120px] py-3`} />;
}

/**
 * A checkbox that is a target, not a speck.
 *
 * The whole 56px row is the label, so a thumb anywhere on it toggles -- a 16px
 * native box is unmissable on a desktop and unhittable with a cold hand on a
 * site. `accent-black` keeps the checked state inside the palette.
 */
export function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="mb-4 flex min-h-[56px] w-full items-center gap-3 border-2 border-black px-4">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-7 w-7 shrink-0 accent-black"
      />
      <span className="text-lg font-bold">{label}</span>
    </label>
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputClass} />;
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const border = kind === "error" ? "border-black bg-black text-white" : "border-black bg-white text-black";
  return (
    <p role={kind === "error" ? "alert" : undefined} className={`mb-4 border-2 p-3 text-base ${border}`}>
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border-2 border-dashed border-black p-6 text-center text-base">{children}</p>;
}

export function SignOut() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        const { getSupabase } = await import("@/lib/supabase/client");
        await getSupabase().auth.signOut();
        router.replace("/login");
      }}
      className="mt-8 flex min-h-[56px] w-full items-center justify-center border-2 border-black bg-white text-base font-bold"
    >
      Logga ut
    </button>
  );
}
