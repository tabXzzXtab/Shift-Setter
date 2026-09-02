"use client";

import { useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Button, Field, Input, Notice, Screen, Select } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Creating a worker creates their account. There is no separate flow.
 *
 * The sequence is fixed and the order is the point (spec Section 3):
 *   1. Fill in name and email.
 *   2. Press Kopiera Inloggning -- generates the password and copies the block.
 *   3. Only THEN does Tillverka Arbetare become pressable.
 *
 * The copy gates the create deliberately: an account whose credentials nobody
 * holds is an account nobody can use, and the worker has no way to ask for
 * them. Recovery is the admin regenerating and copying again; there is no
 * self-service reset, because the email is an identifier and not a guaranteed
 * inbox.
 */

/** Six digits: 6-20 characters, and every character typeable on a phone keypad
 *  and a desktop keyboard without hunting through symbol panels. */
function generatePassword(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(100000 + (n % 900000));
}

function NyArbetare() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"arbetare" | "arbetsledare">("arbetare");
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = name.trim() !== "" && email.trim() !== "";

  function credentialBlock(pw: string) {
    // The link is the app's current homepage, whatever it is running as.
    const link = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? "/Shift-Setter"}/`;
    return `Länk: ${link}\nNamn: ${name.trim()}\nEmail: ${email.trim()}\nLösenord: ${pw}`;
  }

  async function copyLogin() {
    const pw = password ?? generatePassword();
    setPassword(pw);
    const block = credentialBlock(pw);
    try {
      await navigator.clipboard.writeText(block);
    } catch {
      // Clipboard can be refused (insecure context, permission). The block is
      // shown on screen regardless, so the admin is never left without it.
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

    setDone(`${name.trim()} skapad.`);
    setSaving(false);
  }

  if (done) {
    return (
      <Screen title="Klar" back="/">
        <Notice kind="ok">{done}</Notice>
        <pre className="mb-6 whitespace-pre-wrap border-2 border-black p-3 text-base">
          {credentialBlock(password!)}
        </pre>
        <p className="mb-6 text-base">
          Ge blocket till arbetaren. Det visas inte igen.
        </p>
        <Button
          onClick={() => {
            setName(""); setEmail(""); setPassword(null);
            setCopied(false); setDone(null);
          }}
        >
          Skapa en till
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title="Ny arbetare" back="/">
      {error && <Notice kind="error">{error}</Notice>}

      <Field label="Namn">
        <Input value={name} onChange={(e) => { setName(e.target.value); setCopied(false); }} autoComplete="off" />
      </Field>

      <Field label="E-post" hint="Används för att logga in. Måste inte vara en riktig brevlåda.">
        <Input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setCopied(false); }}
          autoComplete="off"
        />
      </Field>

      <Field label="Roll">
        <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="arbetare">Arbetare</option>
          <option value="arbetsledare">Arbetsledare</option>
        </Select>
      </Field>

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
      </div>
    </Screen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <NyArbetare />
    </AuthGate>
  );
}
