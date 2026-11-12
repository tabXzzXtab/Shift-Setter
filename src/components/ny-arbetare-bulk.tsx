"use client";

import { useState, useMemo } from "react";
import {
  C, Card, SecondaryButton, SHADOW, SoftInput, SoftNotice, SoftSelect,
} from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { fel } from "@/lib/fel";

type Role = "arbetare" | "arbetsledare" | "admin";

type BulkRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
};

export type CreatedAccount = {
  name: string;
  email: string;
  password: string;
};

let nextId = 0;
function makeRow(): BulkRow {
  return { id: nextId++, name: "", email: "", role: "arbetare" };
}

/** Six digits — typeable on a phone keypad. */
function generatePassword(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(100000 + (n % 900000));
}

function loginLink(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return typeof window === "undefined" ? `${base}/` : `${window.location.origin}${base}/`;
}

function credentialBlock(acc: CreatedAccount): string {
  return `Länk: ${loginLink()}\nNamn: ${acc.name}\nEmail: ${acc.email}\nLösenord: ${acc.password}`;
}

// ---- Icons ------------------------------------------------------------------

const CopyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
    <rect x="6" y="6" width="10" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M4 12H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
    <path d="M9 1v10M5 5l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 11v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const TrashRowIcon = () => (
  <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden>
    <path d="M1.6 3.7h10.8M5 3.7V2h4v1.7M2.8 3.7l.8 8.9h6.8l.8-8.9"
      stroke={C.stopInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ---- Login list (post-creation) screen --------------------------------------

function downloadCSV(accounts: CreatedAccount[]) {
  const link = loginLink();
  const rows = [
    ["Namn", "E-post", "Lösenord", "Länk"],
    ...accounts.map((a) => [a.name, a.email, a.password, link]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "inloggningar.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function InloggningsLista({
  accounts,
  onCreateMore,
}: {
  accounts: CreatedAccount[];
  onCreateMore: () => void;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  async function copySingle(acc: CreatedAccount, index: number) {
    try {
      await navigator.clipboard.writeText(credentialBlock(acc));
    } catch { /* ignore — the text is on screen */ }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  async function copyAll() {
    const all = accounts.map(credentialBlock).join("\n\n");
    try {
      await navigator.clipboard.writeText(all);
    } catch { /* ignore */ }
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  async function share(acc: CreatedAccount) {
    if (!navigator.share) return;
    await navigator.share({ title: "Inloggning", text: credentialBlock(acc) }).catch(() => {});
  }

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div>
      {/* Top actions */}
      <div className="flex gap-[10px] pb-[18px]">
        <button
          type="button"
          onClick={() => void copyAll()}
          className="flex flex-1 items-center justify-center gap-[8px] rounded-[12px] py-[13px] text-[15px] font-bold transition-colors"
          style={{
            background: copiedAll ? C.liveInk : C.accent,
            color: C.onAccent,
            boxShadow: SHADOW.action,
          }}
        >
          <CopyIcon />
          {copiedAll ? "Kopierade alla!" : "Kopiera alla"}
        </button>

        <button
          type="button"
          onClick={() => downloadCSV(accounts)}
          className="flex flex-1 items-center justify-center gap-[8px] rounded-[12px] py-[13px] text-[15px] font-bold transition-colors"
          style={{
            background: C.surface,
            color: C.accentInk,
            border: `1px solid ${C.border}`,
          }}
        >
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
            <path d="M8.5 2v9M5 8l3.5 3.5L12 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Ladda ner CSV
        </button>
      </div>

      {/* Account cards */}
      <div className="flex flex-col gap-[10px]">
        {accounts.map((acc, i) => (
          <Card key={i} radius={16} pad="p-[16px]">
            <div className="mb-[10px] flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[17px] font-bold" style={{ color: C.ink }}>
                  {acc.name}
                </div>
                <div className="truncate text-[13px] font-medium" style={{ color: C.text2 }}>
                  {acc.email}
                </div>
              </div>
              <div className="flex shrink-0 gap-[6px]">
                <button
                  type="button"
                  aria-label={`Kopiera inloggning för ${acc.name}`}
                  onClick={() => void copySingle(acc, i)}
                  className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors"
                  style={{
                    background: copiedIndex === i ? C.liveInk : C.panel,
                    color: copiedIndex === i ? C.onAccent : C.text2,
                  }}
                >
                  <CopyIcon />
                </button>
                {canShare && (
                  <button
                    type="button"
                    aria-label={`Dela inloggning för ${acc.name}`}
                    onClick={() => void share(acc)}
                    className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors"
                    style={{ background: C.panel, color: C.text2 }}
                  >
                    <ShareIcon />
                  </button>
                )}
              </div>
            </div>

            {/* Password display */}
            <div
              className="rounded-[10px] px-[14px] py-[12px]"
              style={{ background: C.panel2 }}
            >
              <div
                className="mb-[2px] text-[11px] font-bold uppercase"
                style={{ letterSpacing: ".9px", color: C.text2 }}
              >
                Lösenord
              </div>
              <div
                className="text-[22px] font-extrabold"
                style={{ letterSpacing: "1px", color: C.ink }}
              >
                {acc.password}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Create more */}
      <div className="pt-[22px]">
        <button
          type="button"
          onClick={onCreateMore}
          className="press-scale h-14 w-full rounded-[12px] text-[17px] font-extrabold transition-transform duration-150 active:scale-[.985]"
          style={{
            background: C.accent,
            color: C.onAccent,
            boxShadow: SHADOW.action,
          }}
        >
          Skapa fler konton
        </button>
      </div>
    </div>
  );
}

// ---- Bulk input form --------------------------------------------------------

/** Dynamic primary button label based on the roles in the rows. */
function buttonLabel(rows: BulkRow[]): string {
  const roles = new Set(rows.map((r) => r.role));
  if (roles.size === 1) {
    const r = [...roles][0]!;
    if (r === "arbetare") return "Tillverka Arbetare";
    if (r === "arbetsledare") return "Tillverka Arbetsledare";
  }
  return "Tillverka Konton";
}

export function NyArbetareBulkForm({
  onCreated,
  onCancel,
}: {
  onCreated: (accounts: CreatedAccount[]) => void;
  onCancel?: () => void;
}) {
  const [rows, setRows] = useState<BulkRow[]>([makeRow(), makeRow(), makeRow()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
  }

  function updateRow(id: number, field: keyof Omit<BulkRow, "id">, value: string) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }

  function removeRow(id: number) {
    setRows((prev) => prev.length <= 1 ? prev : prev.filter((r) => r.id !== id));
  }

  const filledRows = useMemo(
    () => rows.filter((r) => r.name.trim() && r.email.trim()),
    [rows],
  );

  const canSubmit = filledRows.length > 0 && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token ?? "";
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-account`;

    const results: CreatedAccount[] = [];
    const errors: string[] = [];

    for (const row of filledRows) {
      const password = generatePassword();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: row.name.trim(),
          email: row.email.trim(),
          password,
          role: row.role,
        }),
      });
      if (res.ok) {
        results.push({ name: row.name.trim(), email: row.email.trim(), password });
      } else {
        const body = await res.json().catch(() => ({}));
        errors.push(`${row.name.trim() || row.email.trim()}: ${fel(body.error, "Kunde inte skapas")}`);
      }
    }

    setSaving(false);

    if (results.length === 0) {
      setError(errors.join(" · "));
      return;
    }
    if (errors.length > 0) {
      setError(`${errors.length} konto(n) misslyckades: ${errors.join(" · ")}`);
    }
    onCreated(results);
  }

  const label = buttonLabel(rows);

  return (
    <div>
      {error && (
        <div className="pb-[14px]">
          <SoftNotice tone="stop">{error}</SoftNotice>
        </div>
      )}

      {/* Row list */}
      <div className="flex flex-col gap-[10px]">
        {rows.map((row, idx) => (
          <Card key={row.id} radius={14} pad="p-[14px]">
            <div className="mb-[10px] flex items-center gap-2">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                style={{ background: C.panel, color: C.text2 }}
              >
                {idx + 1}
              </span>
              <SoftSelect
                value={row.role}
                onChange={(e) => updateRow(row.id, "role", e.target.value)}
                aria-label="Roll"
                style={{ flex: 1, fontSize: 14 }}
              >
                <option value="arbetare">Arbetare</option>
                <option value="arbetsledare">Arbetsledare</option>
                <option value="admin">Admin</option>
              </SoftSelect>
              {rows.length > 1 && (
                <button
                  type="button"
                  aria-label="Ta bort rad"
                  onClick={() => removeRow(row.id)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
                  style={{ background: C.panel }}
                >
                  <TrashRowIcon />
                </button>
              )}
            </div>

            <div className="mb-[8px]">
              <SoftInput
                placeholder="Namn"
                value={row.name}
                onChange={(e) => updateRow(row.id, "name", e.target.value)}
                autoComplete="off"
              />
            </div>
            <SoftInput
              type="email"
              placeholder="E-post"
              value={row.email}
              onChange={(e) => updateRow(row.id, "email", e.target.value)}
              autoComplete="off"
            />
          </Card>
        ))}
      </div>

      {/* Add row */}
      <div className="pt-[10px]">
        <button
          type="button"
          onClick={addRow}
          className="flex w-full items-center justify-center gap-2 rounded-[12px] py-[13px] text-[15px] font-semibold transition-colors"
          style={{ background: C.panel, color: C.accentInk }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Lägg till rad
        </button>
      </div>

      {/* Submit */}
      <div className="pt-[18px]">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="press-scale h-16 w-full rounded-[12px] text-[20px] font-extrabold transition-[transform,background] duration-150 active:scale-[.985]"
          style={{
            letterSpacing: "-.4px",
            background: canSubmit ? C.accent : C.hairline,
            color: canSubmit ? C.onAccent : C.chevron,
            boxShadow: canSubmit ? SHADOW.action : undefined,
            cursor: canSubmit ? undefined : "not-allowed",
          }}
        >
          {saving ? "Skapar…" : label}
        </button>
        {filledRows.length === 0 && (
          <p className="px-1 pt-[10px] text-[14px] font-medium" style={{ color: C.text2 }}>
            Fyll i minst ett namn och en e-post.
          </p>
        )}
      </div>

      {onCancel && (
        <div className="pt-[10px]">
          <SecondaryButton onClick={onCancel}>Avbryt</SecondaryButton>
        </div>
      )}
    </div>
  );
}
