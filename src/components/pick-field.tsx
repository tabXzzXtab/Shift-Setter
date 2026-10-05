"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, C, SHADOW, SoftField } from "@/components/soft";

/**
 * A choice of one person (or thing), drawn by us rather than by the browser.
 *
 * The native select opens the phone's own wheel, which looks like nothing else
 * in the app and shows a name and nothing more. This drops a card under the
 * field instead -- the same object as the Startdatum calendar (DateField):
 * each option a 56px row with initials, the chosen one ticked, picking closes it.
 *
 * A REAL <select> IS STILL THERE, transparent and under the trigger. It holds
 * the value the page reads, and it is what every walkthrough drives with
 * selectOption({ label }) -- 23 suites create a project that way. Opacity 0
 * rather than display:none because Playwright counts a transparent element as
 * visible and a hidden one as not; pointer-events none so a finger lands on the
 * trigger rather than opening the native wheel underneath it.
 */
export function PickField({
  label, help, value, onChange, options, placeholder = "Välj…", required, people = false, action,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; sub?: string }[];
  placeholder?: string;
  required?: boolean;
  /** Draw initials beside each option: the options are people. */
  people?: boolean;
  /**
   * A last row that does something rather than choosing somebody -- Snabb
   * Pass's "+ Ny arbetare". Its value is never stored: picking it (here or
   * through the hidden select) calls onPick and leaves the value alone.
   */
  action?: { value: string; label: string; onPick: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.value === value) ?? null;
  // SEARCHABLE once the list is longer than a thumb's reach (owner's brief,
  // 2026-10-05): a field that filters on name and second line, at the top of
  // the open list. Short lists stay a plain list -- a search box over five
  // names is one more thing to read.
  const searchable = options.length > 6;
  const needle = q.trim().toLocaleLowerCase("sv");
  const shown = needle
    ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLocaleLowerCase("sv").includes(needle))
    : options;

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

  return (
    <div ref={box} className="relative">
      <SoftField label={label} help={help}>
        <span className="relative block">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-[52px] w-full min-w-0 items-center gap-[10px] rounded-[14px] border px-[14px] text-left text-[16px] font-medium outline-none"
            style={{
              background: C.surface,
              color: chosen ? C.ink : C.chevron,
              borderColor: open ? C.accent : C.hairline,
              boxShadow: open ? `0 0 0 1px ${C.accent}` : undefined,
            }}
          >
            {people && chosen && <Avatar name={chosen.label} size={30} />}
            <span className="min-w-0 flex-1 truncate">{chosen ? chosen.label : placeholder}</span>
            <svg
              width="13" height="8" viewBox="0 0 13 8" fill="none" aria-hidden
              className="shrink-0 transition-transform duration-150"
              style={{ transform: open ? "rotate(180deg)" : undefined }}
            >
              <path d="M1.5 1.5 6.5 6.5l5-5" stroke={C.chevron} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <select
            tabIndex={-1}
            aria-hidden
            required={required}
            value={value}
            onChange={(e) => {
              if (action && e.target.value === action.value) { action.onPick(); return; }
              onChange(e.target.value);
            }}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          >
            <option value="">{placeholder}</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {action && <option value={action.value}>{action.label}</option>}
          </select>
        </span>
      </SoftField>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          data-pick-list
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[300px] overflow-y-auto overscroll-contain rounded-[20px] p-2"
          style={{ background: C.surface, boxShadow: SHADOW.hero, color: C.ink }}
        >
          {searchable && (
            <input
              type="search"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Sök"
              aria-label={`Sök ${label.toLowerCase()}`}
              data-pick-search
              className="mb-2 h-[44px] w-full rounded-[12px] px-[12px] text-[16px] font-medium outline-none"
              style={{ background: C.panel, color: C.ink }}
            />
          )}
          {/* The action first ("Ny arbetare", "Ny beställare"): it is the way
              out when the list does not have the one you are looking for. */}
          {action && (
            <button
              type="button"
              onClick={() => { setOpen(false); action.onPick(); }}
              className="flex min-h-[56px] w-full items-center gap-3 rounded-[14px] px-3 text-left hover:bg-[#f4f3f0]"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ border: `1px solid ${C.border}` }}
              >
                <svg width="13" height="13" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 1v13M1 7.5h13" stroke={C.accentInk} strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 truncate text-[16px] font-bold" style={{ color: C.accentInk }}>
                {action.label}
              </span>
            </button>
          )}
          {options.length === 0 && (
            <p className="px-3 py-[14px] text-[15px]" style={{ color: C.text2 }}>Ingen att välja än.</p>
          )}
          {options.length > 0 && shown.length === 0 && (
            <p className="px-3 py-[14px] text-[15px]" style={{ color: C.text2 }}>Ingen träff på “{q.trim()}”.</p>
          )}
          {shown.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-[14px] px-3 text-left hover:bg-[#f4f3f0]"
              >
                {people && <Avatar name={o.label} size={36} />}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[16px] ${on ? "font-bold" : "font-medium"}`}>{o.label}</span>
                  {o.sub && (
                    <span className="block truncate text-[14px] font-medium" style={{ color: C.text2 }}>{o.sub}</span>
                  )}
                </span>
                {on && (
                  <svg width="16" height="12" viewBox="0 0 11 9" fill="none" aria-hidden className="shrink-0">
                    <path d="M1 4.6 4 7.6 10 1.4" stroke={C.accentInk} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
