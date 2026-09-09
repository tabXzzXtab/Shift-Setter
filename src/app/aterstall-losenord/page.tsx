"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import {
  C, Card, PrimaryButton, SecondaryButton, SHADOW, SoftField, SoftInput,
  SoftNotice, SoftScreen,
} from "@/components/soft";

/**
 * Where the reset mail's link lands -- choosing the new password.
 *
 * Supabase's recovery link carries a token that the client exchanges for a
 * session on load (detectSessionInUrl, set in lib/supabase/client.ts). So the
 * presence of a session IS the proof that the person opened a real link from a
 * real mailbox; there is nothing else to verify here and nothing to ask them.
 * No session means the link was already used, has expired, or was never valid.
 *
 * The recovery session is dropped the moment the password is written. That is
 * not ceremony: the app reads role from the database on load, so sending them
 * back through the front door is what makes the new session an ordinary one.
 */

// Spec Section 3, the same bounds create-account enforces: typeable on a phone
// and on a desktop.
const MIN = 6;
const MAX = 20;

export default function AterstallLosenordPage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN || password.length > MAX) {
      setError(`Lösenordet måste vara ${MIN}-${MAX} tecken.`);
      return;
    }
    // Typed blind and twice, because the only way back from a typo is the whole
    // flow again -- a new mail, a new link.
    if (password !== repeat) {
      setError("Lösenorden är inte lika.");
      return;
    }

    setSaving(true);
    setError(null);
    const { error: err } = await getSupabase().auth.updateUser({ password });
    if (err) {
      setError("Kunde inte spara lösenordet. Begär en ny länk och försök igen.");
      setSaving(false);
      return;
    }

    await getSupabase().auth.signOut();
    setDone(true);
    setSaving(false);
  }

  if (done) {
    return (
      // No back button on any of these: a recovery link was not opened from
      // anywhere inside this app, so there is nowhere behind it to return to.
      <SoftScreen title="Nytt lösenord">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="live">Lösenordet är ändrat.</SoftNotice>
        </div>
        <div className="px-4 pt-[22px]">
          <Link
            href="/login"
            className="press-scale flex h-16 w-full items-center justify-center rounded-[12px] text-[20px] font-extrabold transition-[transform,background] duration-150 hover:bg-[#12206b] active:scale-[.985]"
            style={{
              letterSpacing: "-.4px",
              background: C.accent,
              color: C.surface,
              boxShadow: SHADOW.action,
            }}
          >
            Logga in
          </Link>
        </div>
      </SoftScreen>
    );
  }

  if (loading) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        style={{ background: C.ground, fontFamily: "var(--font-inter), system-ui, sans-serif" }}
      >
        <p className="text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <SoftScreen title="Nytt lösenord" back="/login">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="stop">
            Länken gäller inte längre. Den kan ha använts redan eller hunnit gå ut.
          </SoftNotice>
        </div>
        <div className="px-4 pt-[22px]">
          <SecondaryButton href="/glomt-losenord">Begär en ny länk</SecondaryButton>
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Nytt lösenord">
      {error && <div className="px-4 pb-[4px] pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <form onSubmit={onSubmit}>
        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div className="mb-[14px]">
              <SoftField label="Nytt lösenord" help={`${MIN}-${MAX} tecken.`}>
                <SoftInput
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ letterSpacing: "2px" }}
                />
              </SoftField>
            </div>

            <SoftField label="Upprepa lösenordet">
              <SoftInput
                type="password"
                required
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                style={{ letterSpacing: "2px" }}
              />
            </SoftField>
          </Card>
        </div>

        <div className="px-4 pt-[22px]">
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? "Sparar…" : "Spara lösenord"}
          </PrimaryButton>
        </div>
      </form>
    </SoftScreen>
  );
}
