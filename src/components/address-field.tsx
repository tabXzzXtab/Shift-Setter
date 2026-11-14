"use client";

import { useEffect, useRef, useState } from "react";
import { C, SHADOW, SoftField, SoftInput } from "@/components/soft";

type Suggestion = { display_name: string; place_id: string };

/**
 * Address input with Nominatim autocomplete, restricted to Sweden.
 *
 * Renders inside a SoftField. Falls back to free text when Nominatim is
 * unreachable or returns nothing. The hidden <input name=...> carries the
 * value for form submission (same as SoftInput in the forms it replaces).
 */
export function AddressField({
  name, label, help, required, value, onChange,
}: {
  name: string;
  label: string;
  help?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  function fetchSuggestions(q: string) {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }

    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=se&format=json&addressdetails=1&limit=5`;
        const res = await fetch(url, {
          headers: { "Accept-Language": "sv" },
        });
        if (!res.ok) { setSuggestions([]); return; }
        const data = (await res.json()) as Suggestion[];
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  useEffect(() => {
    if (!open) return;
    function away(e: PointerEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, []);

  return (
    <div ref={box} className="relative">
      <SoftField label={label} help={help}>
        <span className="relative block">
          <SoftInput
            name={name}
            required={required}
            autoComplete="off"
            value={value}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              onChange(v);
              fetchSuggestions(v);
            }}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          />
          {loading && (
            <span
              className="pointer-events-none absolute right-[14px] top-1/2 -translate-y-1/2 text-[13px]"
              style={{ color: C.text2 }}
            >
              …
            </span>
          )}
        </span>
      </SoftField>

      {open && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[240px] overflow-y-auto rounded-[14px] p-[6px]"
          style={{ background: C.surface, boxShadow: SHADOW.hero }}
        >
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => {
                onChange(s.display_name);
                setOpen(false);
                setSuggestions([]);
              }}
              className="block w-full rounded-[10px] px-[12px] py-[10px] text-left text-[15px] font-medium hover:bg-[#f4f3f0]"
              style={{ color: C.ink }}
            >
              {s.display_name}
            </button>
          ))}
        </div>
      )}

      {open && suggestions.length === 0 && !loading && value.length >= 3 && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 rounded-[14px] px-[14px] py-[10px]"
          style={{ background: C.surface, boxShadow: SHADOW.hero, color: C.text2 }}
        >
          <span className="text-[14px]">Inga adresser hittades</span>
        </div>
      )}
    </div>
  );
}
