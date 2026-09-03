"use client";

import { useState } from "react";
import { Button, Field, Input, Notice, Select } from "./ui";
import { getSupabase } from "@/lib/supabase/client";

export type CreatedWorker = { worker_id: string; name: string; email: string };

/**
 * Creating a worker creates their account. The sequence is fixed (spec §3):
 *
 *   1. Name and email.
 *   2. Kopiera Inloggning -- generates the password and copies the block.
 *   3. Only THEN does Tillverka Arbetare become pressable.
 *
 * The copy gates the create deliberately: an account whose credentials nobody
 * holds is an account nobody can use, and the worker has no way to ask.
 *
 * The same form serves the roster screen and the Snabb Pass dropdown, because
 * it is the same act: "the same form appears, the same copy-then-create
 * sequence runs, and the admin returns to the shift screen and finishes as
 * though nothing happened."
 */

/** Six digits: within 6-20 characters, and typeable on a phone keypad. */
function generatePassword(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(100000 + (n % 900000));
}

export function NyArbetareForm({
  allowRoleChoice = true,
  onCreated,
  onCancel,
}: {
  allowRoleChoice?: boolean;
  onCreated: (w: CreatedWorker, credentials: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"arbetare" | "arbetsledare">("arbetare");
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = name.trim() !== "" && email.trim() !== "";

  function credentialBlock(pw: string) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/Shift-Setter";
    return `Länk: ${window.location.origin}${base}/\nNamn: ${name.trim()}\nEmail: ${email.trim()}\nLösenord: ${pw}`;
  }

  async function copyLogin() {
    const pw = password ?? generatePassword();
    setPassword(pw);
    try {
      await navigator.clipboard.writeText(credentialBlock(pw));
    } catch {
      // Clipboard can be refused. The block is on screen regardless, so the
      // admin is never left without it.
    }
    setCopied(true);
  }

  async function create() {
    if (!password) return;
    setSaving(true);
    setError(null);

    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
      },
    );

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Kunde inte skapa arbetaren.");
      setSaving(false);
      return;
    }

    onCreated(
      { worker_id: body.worker_id, name: name.trim(), email: email.trim() },
      credentialBlock(password),
    );
    setSaving(false);
  }

  return (
    <div>
      {error && <Notice kind="error">{error}</Notice>}

      <Field label="Namn">
        <Input value={name} onChange={(e) => { setName(e.target.value); setCopied(false); }} autoComplete="off" />
      </Field>

      <Field label="E-post" hint="Används för att logga in. Måste inte vara en riktig brevlåda.">
        <Input
          type="email" value={email}
          onChange={(e) => { setEmail(e.target.value); setCopied(false); }}
          autoComplete="off"
        />
      </Field>

      {allowRoleChoice && (
        <Field label="Roll">
          <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="arbetare">Arbetare</option>
            <option value="arbetsledare">Arbetsledare</option>
          </Select>
        </Field>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <Button onClick={copyLogin} disabled={!ready} variant="outline">
          {copied ? "Kopierad ✓  Kopiera igen" : "Kopiera inloggning"}
        </Button>

        {password && (
          <pre className="whitespace-pre-wrap border-2 border-black p-3 text-base">
            {credentialBlock(password)}
          </pre>
        )}

        <Button onClick={create} disabled={!copied || saving}>
          {saving ? "Skapar…" : "Tillverka arbetare"}
        </Button>

        {!copied && (
          <p className="text-base text-neutral-600">
            Kopiera inloggningen först. Ett konto vars uppgifter ingen har är ett
            konto ingen kan använda.
          </p>
        )}

        {onCancel && (
          <Button variant="outline" onClick={onCancel}>Avbryt</Button>
        )}
      </div>
    </div>
  );
}
