"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Hamburger, ProfileIcon } from "./icons";
import { SignOut } from "./ui";

/**
 * A panel over a darkened page that arrives from the top.
 *
 * From the TOP because that is where both buttons are, and a panel that
 * appears somewhere other than the thing you pressed makes people hunt for it
 * (spec Section 7). The slide is a real transition rather than an appearance:
 * `shown` is flipped on the frame after mount so the transform has a value to
 * move from, which a single render would not give it.
 *
 * Tapping the darkened background closes it. So does Escape, for the desktop
 * view -- which is the phone view with air around it, keyboard and all.
 */
function DropPanel({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);

  // Mounted only while open, so `shown` begins false on every opening without
  // anything having to reset it. The flip happens inside requestAnimationFrame
  // -- the frame after mount -- which is both what gives the transform a value
  // to move from and why this is not a synchronous setState in an effect.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(id); window.removeEventListener("keydown", esc); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      {/* The darkened page. It is a button so a tap outside closes, and it is
          aria-hidden because the panel above it is the thing to read. */}
      <button
        type="button"
        aria-label="Stäng"
        onClick={onClose}
        className={`absolute inset-0 h-full w-full bg-black transition-opacity duration-200 ${
          shown ? "opacity-70" : "opacity-0"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`absolute inset-x-0 top-0 mx-auto w-full max-w-md border-b-4 border-black bg-white p-4 transition-transform duration-200 ${
          shown ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export type MenuItem = { href: string; label: string };

export function AppBar({ title, menu }: { title: string; menu: MenuItem[] }) {
  const [open, setOpen] = useState<"menu" | "profile" | null>(null);

  return (
    <>
      <header className="mb-6 flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Meny"
          aria-expanded={open === "menu"}
          onClick={() => setOpen("menu")}
          className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-black"
        >
          <Hamburger />
        </button>

        <h1 className="truncate text-2xl font-bold leading-tight">{title}</h1>

        <button
          type="button"
          aria-label="Profil"
          aria-expanded={open === "profile"}
          onClick={() => setOpen("profile")}
          className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-black"
        >
          <ProfileIcon />
        </button>
      </header>

      {open === "menu" && (
      <DropPanel onClose={() => setOpen(null)} label="Meny">
        <nav className="flex flex-col gap-3">
          {menu.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="flex min-h-[56px] w-full items-center justify-between border-2 border-black px-4 text-lg font-bold"
            >
              <span>{m.label}</span>
              <span aria-hidden className="text-2xl">→</span>
            </Link>
          ))}
        </nav>
      </DropPanel>
      )}

      {open === "profile" && (
      <DropPanel onClose={() => setOpen(null)} label="Profil">
        <div className="flex flex-col gap-3">
          <Link
            href="/konto"
            className="flex min-h-[56px] w-full items-center justify-center border-2 border-black bg-black px-4 text-lg font-bold text-white"
          >
            Konto
          </Link>
          <Link
            href="/profil"
            className="flex min-h-[56px] w-full items-center justify-center border-2 border-black px-4 text-lg font-bold"
          >
            Profil
          </Link>
          <SignOut />
        </div>
      </DropPanel>
      )}
    </>
  );
}
